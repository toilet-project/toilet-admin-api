package com.example.toiletadmin.analytics.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import com.example.toiletadmin.analytics.service.DailyAnalyticsArchive.DailySummary;
import com.example.toiletadmin.analytics.service.GoogleAnalyticsArchiveService.ArchiveResult;
import com.example.toiletadmin.analytics.service.GoogleAnalyticsGateway.FetchResult;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.OptionalLong;
import java.util.stream.LongStream;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import tools.jackson.databind.ObjectMapper;

class GoogleAnalyticsArchiveServiceTest {

    private static final Instant NOW = Instant.parse("2026-09-17T08:00:00Z");
    private static final String PROPERTY_HASH = "a".repeat(64);

    @Test
    void archivesTheFourteenMostRecentCompletedKoreanCalendarDays() {
        GoogleAnalyticsGateway gateway = Mockito.mock(GoogleAnalyticsGateway.class);
        AnalyticsDailyArchiveRepository repository = Mockito.mock(AnalyticsDailyArchiveRepository.class);
        LocalDate start = LocalDate.parse("2026-09-03");
        LocalDate end = LocalDate.parse("2026-09-16");
        DailyAnalyticsArchive archive = archive(start, end);
        given(gateway.isConfigured()).willReturn(true);
        given(gateway.propertyHash()).willReturn(PROPERTY_HASH);
        given(repository.tablesAvailable()).willReturn(true);
        given(repository.alreadySucceeded(PROPERTY_HASH, end)).willReturn(false);
        given(repository.nextRetryCount(PROPERTY_HASH, end)).willReturn(0);
        given(repository.startRun(PROPERTY_HASH, end, start, end, NOW, 0)).willReturn(OptionalLong.of(7));
        given(gateway.fetchDailyArchive(start, end)).willReturn(new FetchResult<>(archive, Map.of("tokensPerHour", 39_000)));
        given(repository.replaceRange(PROPERTY_HASH, "Asia/Seoul", start, end, archive, NOW)).willReturn(14);

        ArchiveResult result = service(gateway, repository).archiveCompletedDays(false);

        assertThat(result).isEqualTo(ArchiveResult.SUCCESS);
        verify(gateway).fetchDailyArchive(start, end);
        verify(repository).markSuccess(7, NOW, 3, 14, "{\"tokensPerHour\":39000}");
    }

    @Test
    void skipsTheEveningRetryAfterTheDailyRunSucceeded() {
        GoogleAnalyticsGateway gateway = Mockito.mock(GoogleAnalyticsGateway.class);
        AnalyticsDailyArchiveRepository repository = Mockito.mock(AnalyticsDailyArchiveRepository.class);
        LocalDate target = LocalDate.parse("2026-09-16");
        given(gateway.isConfigured()).willReturn(true);
        given(gateway.propertyHash()).willReturn(PROPERTY_HASH);
        given(repository.tablesAvailable()).willReturn(true);
        given(repository.alreadySucceeded(PROPERTY_HASH, target)).willReturn(true);

        ArchiveResult result = service(gateway, repository).archiveCompletedDays(false);

        assertThat(result).isEqualTo(ArchiveResult.ALREADY_COMPLETE);
        verify(gateway, never()).fetchDailyArchive(Mockito.any(), Mockito.any());
    }

    @Test
    void recordsAFailureWithoutBreakingTheAdministratorApplication() {
        GoogleAnalyticsGateway gateway = Mockito.mock(GoogleAnalyticsGateway.class);
        AnalyticsDailyArchiveRepository repository = Mockito.mock(AnalyticsDailyArchiveRepository.class);
        LocalDate start = LocalDate.parse("2026-09-03");
        LocalDate end = LocalDate.parse("2026-09-16");
        given(gateway.isConfigured()).willReturn(true);
        given(gateway.propertyHash()).willReturn(PROPERTY_HASH);
        given(repository.tablesAvailable()).willReturn(true);
        given(repository.alreadySucceeded(PROPERTY_HASH, end)).willReturn(false);
        given(repository.nextRetryCount(PROPERTY_HASH, end)).willReturn(1);
        given(repository.startRun(PROPERTY_HASH, end, start, end, NOW, 1)).willReturn(OptionalLong.of(8));
        given(gateway.fetchDailyArchive(start, end)).willThrow(new IllegalStateException("synthetic outage"));

        ArchiveResult result = service(gateway, repository).archiveCompletedDays(false);

        assertThat(result).isEqualTo(ArchiveResult.FAILED);
        verify(repository).markFailure(8, NOW, "ARCHIVE_ERROR", "IllegalStateException");
    }

    private GoogleAnalyticsArchiveService service(
            GoogleAnalyticsGateway gateway,
            AnalyticsDailyArchiveRepository repository
    ) {
        return new GoogleAnalyticsArchiveService(gateway, repository, new ObjectMapper(), true, 14,
                ZoneId.of("Asia/Seoul"), Clock.fixed(NOW, ZoneOffset.UTC));
    }

    private DailyAnalyticsArchive archive(LocalDate start, LocalDate end) {
        List<DailySummary> summaries = LongStream.rangeClosed(0, ChronoUnit.DAYS.between(start, end))
                .mapToObj(offset -> new DailySummary(start.plusDays(offset),
                        DailyAnalyticsArchive.ArchiveMetrics.empty()))
                .toList();
        return new DailyAnalyticsArchive(summaries, List.of(), 3);
    }
}
