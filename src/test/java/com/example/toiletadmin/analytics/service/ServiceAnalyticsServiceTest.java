package com.example.toiletadmin.analytics.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.BDDMockito.given;

import com.example.toiletadmin.analytics.dto.ServiceAnalyticsReportResponse.SummaryMetrics;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

class ServiceAnalyticsServiceTest {

    private static final Instant NOW = Instant.parse("2026-09-16T03:00:00Z");

    @Test
    void reportsAWaitingStateUntilTheOwnedSchemaExists() {
        ServiceAnalyticsRepository repository = Mockito.mock(ServiceAnalyticsRepository.class);
        given(repository.schemaReady()).willReturn(false);

        var response = service(repository).report(AnalyticsDateRange.resolve("7d", null, null));

        assertThat(response.available()).isFalse();
        assertThat(response.status()).isEqualTo("NOT_CONFIGURED");
        assertThat(service(repository).status().configured()).isFalse();
    }

    @Test
    void assemblesDashboardMetricsFromOwnedDailyAggregates() {
        ServiceAnalyticsRepository repository = Mockito.mock(ServiceAnalyticsRepository.class);
        SummaryMetrics current = new SummaryMetrics(120, 32, 150, 410, 96, 45, .64, 83.5);
        SummaryMetrics previous = new SummaryMetrics(100, 20, 130, 350, 70, 31, .54, 72.0);
        given(repository.schemaReady()).willReturn(true);
        given(repository.summary(any(), any())).willReturn(current, previous);
        given(repository.trend(any(), any())).willReturn(List.of());
        given(repository.dimensions(anyString(), any(), any(), anyInt())).willReturn(List.of());
        given(repository.lastCalculatedAt()).willReturn(NOW.minusSeconds(300));

        var response = service(repository).report(AnalyticsDateRange.resolve("7d", null, null));

        assertThat(response.available()).isTrue();
        assertThat(response.status()).isEqualTo("UP");
        assertThat(response.data().current()).isEqualTo(current);
        assertThat(response.data().activeUsersChangePercent()).isEqualTo(20d);
        assertThat(response.data().trend()).hasSize(7);
    }

    @Test
    void isolatesAnalyticsQueryFailuresFromTheRestOfTheAdmin() {
        ServiceAnalyticsRepository repository = Mockito.mock(ServiceAnalyticsRepository.class);
        given(repository.schemaReady()).willThrow(new IllegalStateException("synthetic database outage"));

        var response = service(repository).report(AnalyticsDateRange.resolve("today", null, null));

        assertThat(response.available()).isFalse();
        assertThat(response.status()).isEqualTo("QUERY_ERROR");
    }

    @Test
    void exposesRetentionAndCorrectionWindows() {
        ServiceAnalyticsRepository repository = Mockito.mock(ServiceAnalyticsRepository.class);
        given(repository.schemaReady()).willReturn(true);
        given(repository.lastCalculatedAt()).willReturn(NOW.minusSeconds(60));
        given(repository.lastEventAt()).willReturn(NOW.minusSeconds(30));

        var status = service(repository).status();

        assertThat(status.status()).isEqualTo("UP");
        assertThat(status.rawEventRetentionDays()).isEqualTo(35);
        assertThat(status.correctionWindowDays()).isEqualTo(14);
    }

    private ServiceAnalyticsService service(ServiceAnalyticsRepository repository) {
        return new ServiceAnalyticsService(repository, Clock.fixed(NOW, ZoneOffset.UTC));
    }
}
