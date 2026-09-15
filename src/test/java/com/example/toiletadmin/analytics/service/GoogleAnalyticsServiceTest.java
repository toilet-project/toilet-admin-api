package com.example.toiletadmin.analytics.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import com.example.toiletadmin.analytics.dto.GoogleAnalyticsReportResponse.AnalyticsData;
import com.example.toiletadmin.analytics.service.GoogleAnalyticsGateway.FetchResult;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import tools.jackson.databind.ObjectMapper;

class GoogleAnalyticsServiceTest {

    private static final Instant NOW = Instant.parse("2026-09-15T03:00:00Z");

    @Test
    void keepsTheAdminAvailableWhenThePropertyIsNotConfigured() {
        GoogleAnalyticsGateway gateway = Mockito.mock(GoogleAnalyticsGateway.class);
        AnalyticsSnapshotRepository repository = Mockito.mock(AnalyticsSnapshotRepository.class);
        given(gateway.isConfigured()).willReturn(false);
        given(gateway.propertyHash()).willReturn("0".repeat(64));
        given(repository.status(gateway.propertyHash())).willReturn(AnalyticsSnapshotRepository.RepositoryStatus.empty());
        GoogleAnalyticsService service = service(gateway, repository);

        var response = service.report(AnalyticsDateRange.resolve("7d", null, null), false);

        assertThat(response.available()).isFalse();
        assertThat(response.status()).isEqualTo("NOT_CONFIGURED");
        assertThat(service.status().configured()).isFalse();
    }

    @Test
    void reusesTheSameAggregateWithoutCallingGoogleForEveryScreenRequest() {
        GoogleAnalyticsGateway gateway = Mockito.mock(GoogleAnalyticsGateway.class);
        AnalyticsSnapshotRepository repository = Mockito.mock(AnalyticsSnapshotRepository.class);
        given(gateway.isConfigured()).willReturn(true);
        given(gateway.propertyHash()).willReturn("a".repeat(64));
        given(repository.find("DETAIL_7D", gateway.propertyHash())).willReturn(Optional.empty());
        given(gateway.fetchReport(org.mockito.ArgumentMatchers.any()))
                .willReturn(new FetchResult<>(AnalyticsData.empty(), Map.of("tokensPerHour", 39_999)));
        GoogleAnalyticsService service = service(gateway, repository);
        AnalyticsDateRange range = AnalyticsDateRange.resolve("7d", null, null);

        var first = service.report(range, false);
        var second = service.report(range, false);

        assertThat(first.status()).isEqualTo("NO_DATA");
        assertThat(second).isSameAs(first);
        verify(gateway, times(1)).fetchReport(range);
    }

    private GoogleAnalyticsService service(GoogleAnalyticsGateway gateway, AnalyticsSnapshotRepository repository) {
        return new GoogleAnalyticsService(gateway, repository, new ObjectMapper(), 900, 60, 900_000,
                "https://analytics.google.com/analytics/web/", Clock.fixed(NOW, ZoneOffset.UTC));
    }
}
