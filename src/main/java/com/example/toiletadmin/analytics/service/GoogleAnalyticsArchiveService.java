package com.example.toiletadmin.analytics.service;

import com.example.toiletadmin.analytics.service.GoogleAnalyticsGateway.FetchResult;
import com.google.api.gax.rpc.ApiException;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.OptionalLong;
import java.util.concurrent.atomic.AtomicBoolean;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

@Slf4j
@Service
public class GoogleAnalyticsArchiveService {

    private final GoogleAnalyticsGateway gateway;
    private final AnalyticsDailyArchiveRepository repository;
    private final ObjectMapper objectMapper;
    private final boolean archiveEnabled;
    private final int lookbackDays;
    private final ZoneId reportZone;
    private final Clock clock;
    private final AtomicBoolean running = new AtomicBoolean();

    @Autowired
    public GoogleAnalyticsArchiveService(
            GoogleAnalyticsGateway gateway,
            AnalyticsDailyArchiveRepository repository,
            ObjectMapper objectMapper,
            @Value("${google.analytics.archive-enabled:true}") boolean archiveEnabled,
            @Value("${google.analytics.archive-lookback-days:14}") int lookbackDays,
            @Value("${google.analytics.archive-zone:Asia/Seoul}") String reportZone
    ) {
        this(gateway, repository, objectMapper, archiveEnabled, lookbackDays,
                ZoneId.of(reportZone), Clock.systemUTC());
    }

    GoogleAnalyticsArchiveService(
            GoogleAnalyticsGateway gateway,
            AnalyticsDailyArchiveRepository repository,
            ObjectMapper objectMapper,
            boolean archiveEnabled,
            int lookbackDays,
            ZoneId reportZone,
            Clock clock
    ) {
        this.gateway = gateway;
        this.repository = repository;
        this.objectMapper = objectMapper;
        this.archiveEnabled = archiveEnabled;
        this.lookbackDays = Math.max(1, Math.min(31, lookbackDays));
        this.reportZone = reportZone;
        this.clock = clock;
    }

    @Scheduled(
            cron = "${google.analytics.archive-cron:0 30 16,19 * * *}",
            zone = "${google.analytics.archive-zone:Asia/Seoul}"
    )
    public void archiveScheduled() {
        archiveCompletedDays(false);
    }

    ArchiveResult archiveCompletedDays(boolean force) {
        if (!archiveEnabled || !gateway.isConfigured()) return ArchiveResult.NOT_CONFIGURED;
        if (!repository.tablesAvailable()) {
            log.warn("Google Analytics daily archive tables are unavailable");
            return ArchiveResult.STORAGE_UNAVAILABLE;
        }
        LocalDate targetDate = LocalDate.now(clock.withZone(reportZone)).minusDays(1);
        String propertyHash = gateway.propertyHash();
        if (!force && repository.alreadySucceeded(propertyHash, targetDate)) return ArchiveResult.ALREADY_COMPLETE;
        if (!running.compareAndSet(false, true)) return ArchiveResult.ALREADY_RUNNING;

        LocalDate rangeStart = targetDate.minusDays(lookbackDays - 1L);
        Instant startedAt = clock.instant();
        int retryCount = repository.nextRetryCount(propertyHash, targetDate);
        OptionalLong runId = repository.startRun(propertyHash, targetDate, rangeStart, targetDate, startedAt, retryCount);
        if (runId.isEmpty()) {
            running.set(false);
            log.warn("Google Analytics daily archive run could not be recorded");
            return ArchiveResult.STORAGE_UNAVAILABLE;
        }

        try {
            FetchResult<DailyAnalyticsArchive> fetched = gateway.fetchDailyArchive(rangeStart, targetDate);
            int storedRows = repository.replaceRange(propertyHash, reportZone.getId(), rangeStart, targetDate,
                    fetched.data(), clock.instant());
            repository.markSuccess(runId.getAsLong(), clock.instant(), fetched.data().apiRequestCount(), storedRows,
                    objectMapper.writeValueAsString(fetched.quotaRemaining()));
            return ArchiveResult.SUCCESS;
        } catch (RuntimeException exception) {
            String code = errorCode(exception);
            repository.markFailure(runId.getAsLong(), clock.instant(), code, exception.getClass().getSimpleName());
            log.warn("Google Analytics daily archive failed: {}", code);
            return ArchiveResult.FAILED;
        } finally {
            running.set(false);
        }
    }

    private String errorCode(RuntimeException exception) {
        if (exception instanceof ApiException apiException) {
            return switch (apiException.getStatusCode().getCode()) {
                case UNAUTHENTICATED, PERMISSION_DENIED -> "AUTH_ERROR";
                case RESOURCE_EXHAUSTED -> "QUOTA_LIMITED";
                case INVALID_ARGUMENT, FAILED_PRECONDITION -> "QUERY_ERROR";
                case UNAVAILABLE, DEADLINE_EXCEEDED -> "API_UNAVAILABLE";
                default -> "API_ERROR";
            };
        }
        return "ARCHIVE_ERROR";
    }

    enum ArchiveResult {
        SUCCESS,
        ALREADY_COMPLETE,
        ALREADY_RUNNING,
        NOT_CONFIGURED,
        STORAGE_UNAVAILABLE,
        FAILED
    }
}
