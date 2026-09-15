package com.example.toiletadmin.analytics.service;

import com.example.toiletadmin.analytics.dto.GoogleAnalyticsRealtimeResponse;
import com.example.toiletadmin.analytics.dto.GoogleAnalyticsReportResponse;
import com.example.toiletadmin.analytics.dto.GoogleAnalyticsReportResponse.AnalyticsData;
import com.example.toiletadmin.analytics.dto.GoogleAnalyticsReportResponse.RealtimeMetrics;
import com.example.toiletadmin.analytics.dto.GoogleAnalyticsStatusResponse;
import com.example.toiletadmin.analytics.service.AnalyticsSnapshotRepository.RepositoryStatus;
import com.example.toiletadmin.analytics.service.AnalyticsSnapshotRepository.StoredSnapshot;
import com.example.toiletadmin.analytics.service.GoogleAnalyticsGateway.FetchResult;
import com.google.api.gax.rpc.ApiException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicReference;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

@Slf4j
@Service
public class GoogleAnalyticsService {

    private final GoogleAnalyticsGateway gateway;
    private final AnalyticsSnapshotRepository repository;
    private final ObjectMapper objectMapper;
    private final Duration cacheDuration;
    private final Duration realtimeCacheDuration;
    private final Duration scheduleDuration;
    private final String dashboardUrl;
    private final Clock clock;
    private final Map<String, CachedReport> reportCache = new ConcurrentHashMap<>();
    private final Map<String, Object> locks = new ConcurrentHashMap<>();
    private final AtomicReference<CachedRealtime> realtimeCache = new AtomicReference<>();
    private final AtomicReference<Instant> lastAttempt = new AtomicReference<>();
    private final AtomicReference<Instant> lastSuccess = new AtomicReference<>();
    private final AtomicReference<Map<String, Integer>> lastQuota = new AtomicReference<>(Map.of());
    private final AtomicReference<Instant> lastManualRefresh = new AtomicReference<>();

    @Autowired
    public GoogleAnalyticsService(
            GoogleAnalyticsGateway gateway,
            AnalyticsSnapshotRepository repository,
            ObjectMapper objectMapper,
            @Value("${google.analytics.cache-seconds:900}") long cacheSeconds,
            @Value("${google.analytics.realtime-cache-seconds:60}") long realtimeCacheSeconds,
            @Value("${google.analytics.refresh-millis:900000}") long refreshMillis,
            @Value("${google.analytics.dashboard-url:https://analytics.google.com/analytics/web/}") String dashboardUrl
    ) {
        this(gateway, repository, objectMapper, cacheSeconds, realtimeCacheSeconds, refreshMillis,
                dashboardUrl, Clock.systemUTC());
    }

    GoogleAnalyticsService(
            GoogleAnalyticsGateway gateway,
            AnalyticsSnapshotRepository repository,
            ObjectMapper objectMapper,
            long cacheSeconds,
            long realtimeCacheSeconds,
            long refreshMillis,
            String dashboardUrl,
            Clock clock
    ) {
        this.gateway = gateway;
        this.repository = repository;
        this.objectMapper = objectMapper;
        this.cacheDuration = Duration.ofSeconds(Math.max(60, cacheSeconds));
        this.realtimeCacheDuration = Duration.ofSeconds(Math.max(30, realtimeCacheSeconds));
        this.scheduleDuration = Duration.ofMillis(Math.max(60_000, refreshMillis));
        this.dashboardUrl = dashboardUrl;
        this.clock = clock;
    }

    public GoogleAnalyticsReportResponse overview() {
        GoogleAnalyticsReportResponse report = report(AnalyticsDateRange.resolve("today", null, null), false);
        GoogleAnalyticsReportResponse sevenDays = report(AnalyticsDateRange.resolve("7d", null, null), false);
        GoogleAnalyticsRealtimeResponse realtime = realtime(false);
        AnalyticsData today = report.data();
        AnalyticsData extended = sevenDays.data();
        AnalyticsData data = new AnalyticsData(today.current(), today.previous(), today.activeUsersChangePercent(),
                realtime.data(), extended.trend(), extended.pages(), extended.channels(), extended.sources(),
                extended.devices(), extended.operatingSystems(), extended.browsers(), extended.countries(),
                extended.cities(), extended.events());
        return new GoogleAnalyticsReportResponse(report.available(), report.status(), report.range(), report.fetchedAt(),
                report.lastSuccessfulAt(), report.stale(), report.message(), data, report.quotaRemaining());
    }

    public GoogleAnalyticsReportResponse report(AnalyticsDateRange range, boolean force) {
        Instant now = clock.instant();
        if (!gateway.isConfigured()) {
            return GoogleAnalyticsReportResponse.unavailable("NOT_CONFIGURED", range.label(), now,
                    "GA4 속성과 읽기 전용 서비스 계정 연결이 필요합니다.");
        }
        CachedReport memory = reportCache.get(range.cacheKey());
        if (!force && memory != null && now.isBefore(memory.expiresAt())) return memory.response();

        Object lock = locks.computeIfAbsent(range.cacheKey(), key -> new Object());
        synchronized (lock) {
            memory = reportCache.get(range.cacheKey());
            if (!force && memory != null && now.isBefore(memory.expiresAt())) return memory.response();
            Optional<GoogleAnalyticsReportResponse> stored = range.persistent() ? loadStored(range, now, false) : Optional.empty();
            if (!force && stored.isPresent() && !stored.get().stale()) return remember(range.cacheKey(), stored.get(), now.plus(cacheDuration));
            try {
                lastAttempt.set(now);
                FetchResult<AnalyticsData> fetched = gateway.fetchReport(range);
                boolean empty = fetched.data().current().activeUsers() == 0
                        && fetched.data().current().views() == 0 && fetched.data().trend().isEmpty();
                String status = empty ? "NO_DATA" : "UP";
                String message = empty ? "선택한 기간에 아직 수집된 데이터가 없습니다." : "GA4 집계를 최신 값으로 확인했습니다.";
                GoogleAnalyticsReportResponse response = new GoogleAnalyticsReportResponse(true, status, range.label(),
                        now, now, false, message, fetched.data(), fetched.quotaRemaining());
                lastSuccess.set(now);
                lastQuota.set(fetched.quotaRemaining());
                if (range.persistent()) save(range, response, now.plus(cacheDuration));
                return remember(range.cacheKey(), response, now.plus(cacheDuration));
            } catch (RuntimeException exception) {
                String code = errorCode(exception);
                repository.markFailure(range.cacheKey(), gateway.propertyHash(), now, code);
                log.warn("Google Analytics report refresh failed: {}", code);
                Optional<GoogleAnalyticsReportResponse> fallback = stored.isPresent() ? stored : loadStored(range, now, true);
                return fallback.map(value -> remember(range.cacheKey(), value.asStale(code, now,
                                "GA4 조회에 실패해 마지막 성공 데이터를 표시합니다."), now.plusSeconds(60)))
                        .orElseGet(() -> GoogleAnalyticsReportResponse.unavailable(code, range.label(), now,
                                "GA4 집계를 불러오지 못했습니다."));
            }
        }
    }

    public GoogleAnalyticsRealtimeResponse realtime(boolean force) {
        Instant now = clock.instant();
        if (!gateway.isConfigured()) return GoogleAnalyticsRealtimeResponse.unavailable("NOT_CONFIGURED", now,
                "GA4 속성과 읽기 전용 서비스 계정 연결이 필요합니다.");
        CachedRealtime current = realtimeCache.get();
        if (!force && current != null && now.isBefore(current.expiresAt())) return current.response();
        synchronized (realtimeCache) {
            current = realtimeCache.get();
            if (!force && current != null && now.isBefore(current.expiresAt())) return current.response();
            Optional<GoogleAnalyticsRealtimeResponse> stored = loadRealtime(now, false);
            if (!force && stored.isPresent() && !stored.get().stale()) return rememberRealtime(stored.get(), now.plus(realtimeCacheDuration));
            try {
                lastAttempt.set(now);
                FetchResult<RealtimeMetrics> fetched = gateway.fetchRealtime();
                GoogleAnalyticsRealtimeResponse response = new GoogleAnalyticsRealtimeResponse(true, "UP", now, now,
                        false, "최근 30분 실시간 집계입니다.", fetched.data(), fetched.quotaRemaining());
                lastSuccess.set(now);
                lastQuota.set(fetched.quotaRemaining());
                saveRealtime(response, now.plus(realtimeCacheDuration));
                return rememberRealtime(response, now.plus(realtimeCacheDuration));
            } catch (RuntimeException exception) {
                String code = errorCode(exception);
                repository.markFailure("REALTIME", gateway.propertyHash(), now, code);
                log.warn("Google Analytics realtime refresh failed: {}", code);
                Optional<GoogleAnalyticsRealtimeResponse> fallback = stored.isPresent() ? stored : loadRealtime(now, true);
                return fallback.map(value -> rememberRealtime(value.asStale(code, now,
                                "실시간 조회에 실패해 마지막 성공 데이터를 표시합니다."), now.plusSeconds(30)))
                        .orElseGet(() -> GoogleAnalyticsRealtimeResponse.unavailable(code, now,
                                "최근 30분 집계를 불러오지 못했습니다."));
            }
        }
    }

    public GoogleAnalyticsReportResponse refresh(AnalyticsDateRange range) {
        Instant now = clock.instant();
        Instant previous = lastManualRefresh.get();
        if (previous != null && now.isBefore(previous.plusSeconds(30))) return report(range, false);
        lastManualRefresh.set(now);
        if ("today".equals(range.label())) realtime(true);
        return report(range, true);
    }

    public GoogleAnalyticsStatusResponse status() {
        Instant now = clock.instant();
        RepositoryStatus stored = repository.status(gateway.propertyHash());
        Instant attempt = latest(lastAttempt.get(), stored.lastAttemptAt());
        Instant success = latest(lastSuccess.get(), stored.lastSuccessfulAt());
        if (!gateway.isConfigured()) return new GoogleAnalyticsStatusResponse(false, "NOT_CONFIGURED", now,
                attempt, success, null, "GA4 속성·웹 스트림·서비스 계정 연결이 필요합니다.", dashboardUrl, lastQuota.get());
        String state = success == null ? "WAITING_FOR_DATA" : now.isAfter(success.plus(cacheDuration.multipliedBy(3))) ? "STALE" : "UP";
        String message = "WAITING_FOR_DATA".equals(state) ? "연결 후 첫 집계를 기다리고 있습니다."
                : "STALE".equals(state) ? "마지막 성공 집계가 지연되고 있습니다." : "수집과 관리자 조회가 정상입니다.";
        return new GoogleAnalyticsStatusResponse(true, state, now, attempt, success,
                now.plus(scheduleDuration), message, dashboardUrl, lastQuota.get());
    }

    @Scheduled(fixedDelayString = "${google.analytics.refresh-millis:900000}", initialDelayString = "${google.analytics.initial-delay-millis:60000}")
    public void refreshScheduledReports() {
        if (!gateway.isConfigured()) return;
        for (String range : new String[]{"today", "7d", "30d"}) {
            try {
                report(AnalyticsDateRange.resolve(range, null, null), true);
            } catch (RuntimeException exception) {
                log.warn("Scheduled Google Analytics refresh failed: {}", errorCode(exception));
            }
        }
        realtime(true);
    }

    private Optional<GoogleAnalyticsReportResponse> loadStored(AnalyticsDateRange range, Instant now, boolean allowExpired) {
        return repository.find(range.cacheKey(), gateway.propertyHash()).flatMap(value -> {
            try {
                GoogleAnalyticsReportResponse response = objectMapper.readValue(value.payloadJson(), GoogleAnalyticsReportResponse.class);
                lastSuccess.set(latest(lastSuccess.get(), value.lastSuccessAt()));
                if (!allowExpired && now.isAfter(value.expiresAt())) return Optional.of(response.asStale("STALE", now,
                        "캐시가 만료되어 최신 집계를 확인하고 있습니다."));
                return Optional.of(response);
            } catch (RuntimeException exception) {
                return Optional.empty();
            }
        });
    }

    private Optional<GoogleAnalyticsRealtimeResponse> loadRealtime(Instant now, boolean allowExpired) {
        return repository.find("REALTIME", gateway.propertyHash()).flatMap(value -> {
            try {
                GoogleAnalyticsRealtimeResponse response = objectMapper.readValue(value.payloadJson(), GoogleAnalyticsRealtimeResponse.class);
                if (!allowExpired && now.isAfter(value.expiresAt())) return Optional.of(response.asStale("STALE", now,
                        "실시간 캐시가 만료되어 최신 집계를 확인하고 있습니다."));
                return Optional.of(response);
            } catch (RuntimeException exception) {
                return Optional.empty();
            }
        });
    }

    private void save(AnalyticsDateRange range, GoogleAnalyticsReportResponse response, Instant expiresAt) {
        try {
            repository.saveSuccess(range.cacheKey(), gateway.propertyHash(), range.start(), range.end(),
                    objectMapper.writeValueAsString(response), response.fetchedAt(), expiresAt,
                    objectMapper.writeValueAsString(response.quotaRemaining()));
        } catch (RuntimeException exception) {
            log.warn("Google Analytics snapshot save failed: {}", exception.getClass().getSimpleName());
        }
    }

    private void saveRealtime(GoogleAnalyticsRealtimeResponse response, Instant expiresAt) {
        try {
            repository.saveSuccess("REALTIME", gateway.propertyHash(), null, null,
                    objectMapper.writeValueAsString(response), response.fetchedAt(), expiresAt,
                    objectMapper.writeValueAsString(response.quotaRemaining()));
        } catch (RuntimeException exception) {
            log.warn("Google Analytics realtime snapshot save failed: {}", exception.getClass().getSimpleName());
        }
    }

    private GoogleAnalyticsReportResponse remember(String key, GoogleAnalyticsReportResponse response, Instant expiresAt) {
        reportCache.put(key, new CachedReport(response, expiresAt));
        return response;
    }

    private GoogleAnalyticsRealtimeResponse rememberRealtime(GoogleAnalyticsRealtimeResponse response, Instant expiresAt) {
        realtimeCache.set(new CachedRealtime(response, expiresAt));
        return response;
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
        return "API_ERROR";
    }

    private Instant latest(Instant left, Instant right) {
        if (left == null) return right;
        if (right == null) return left;
        return left.isAfter(right) ? left : right;
    }

    private record CachedReport(GoogleAnalyticsReportResponse response, Instant expiresAt) { }
    private record CachedRealtime(GoogleAnalyticsRealtimeResponse response, Instant expiresAt) { }
}
