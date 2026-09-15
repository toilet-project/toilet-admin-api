package com.example.toiletadmin.analytics.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import com.example.toiletadmin.analytics.dto.GoogleAnalyticsReportResponse.AnalyticsData;
import com.example.toiletadmin.analytics.service.GoogleAnalyticsGateway.FetchResult;
import com.google.api.gax.rpc.ApiException;
import com.google.api.gax.rpc.StatusCode;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.LocalDate;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
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

    @Test
    void returnsTheLastSuccessfulAggregateWhenGoogleIsTemporarilyUnavailable() throws Exception {
        GoogleAnalyticsGateway gateway = Mockito.mock(GoogleAnalyticsGateway.class);
        AnalyticsSnapshotRepository repository = Mockito.mock(AnalyticsSnapshotRepository.class);
        String propertyHash = "b".repeat(64);
        AnalyticsDateRange range = AnalyticsDateRange.resolve("7d", null, null);
        var saved = new com.example.toiletadmin.analytics.dto.GoogleAnalyticsReportResponse(
                true, "UP", "7d", NOW.minusSeconds(1_800), NOW.minusSeconds(1_800), false,
                "saved", AnalyticsData.empty(), Map.of("tokensPerHour", 39_000));
        String json = new ObjectMapper().writeValueAsString(saved);
        var stored = new AnalyticsSnapshotRepository.StoredSnapshot("DETAIL_7D", propertyHash,
                LocalDate.parse("2026-09-09"), LocalDate.parse("2026-09-15"), json,
                NOW.minusSeconds(1_800), NOW.minusSeconds(600), NOW.minusSeconds(1_800),
                NOW.minusSeconds(1_800), null, 0, "{}");
        given(gateway.isConfigured()).willReturn(true);
        given(gateway.propertyHash()).willReturn(propertyHash);
        given(repository.find("DETAIL_7D", propertyHash)).willReturn(Optional.of(stored));
        given(gateway.fetchReport(range)).willThrow(new IllegalStateException("synthetic outage"));

        var response = service(gateway, repository).report(range, false);

        assertThat(response.stale()).isTrue();
        assertThat(response.status()).isEqualTo("API_ERROR");
        assertThat(response.lastSuccessfulAt()).isEqualTo(saved.lastSuccessfulAt());
        verify(repository).markFailure("DETAIL_7D", propertyHash, NOW, "API_ERROR");
    }

    @Test
    void coalescesConcurrentRefreshesForTheSameReportKey() throws Exception {
        GoogleAnalyticsGateway gateway = Mockito.mock(GoogleAnalyticsGateway.class);
        AnalyticsSnapshotRepository repository = Mockito.mock(AnalyticsSnapshotRepository.class);
        AnalyticsDateRange range = AnalyticsDateRange.resolve("7d", null, null);
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        given(gateway.isConfigured()).willReturn(true);
        given(gateway.propertyHash()).willReturn("c".repeat(64));
        given(repository.find("DETAIL_7D", gateway.propertyHash())).willReturn(Optional.empty());
        given(gateway.fetchReport(range)).willAnswer(invocation -> {
            started.countDown();
            release.await(2, TimeUnit.SECONDS);
            return new FetchResult<>(AnalyticsData.empty(), Map.of());
        });
        GoogleAnalyticsService service = service(gateway, repository);

        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var first = executor.submit(() -> service.report(range, false));
            assertThat(started.await(2, TimeUnit.SECONDS)).isTrue();
            var second = executor.submit(() -> service.report(range, false));
            release.countDown();
            assertThat(first.get(2, TimeUnit.SECONDS).status()).isEqualTo("NO_DATA");
            assertThat(second.get(2, TimeUnit.SECONDS).status()).isEqualTo("NO_DATA");
        }
        verify(gateway, times(1)).fetchReport(range);
    }

    @Test
    void exposesSafeStatusCodesForAuthenticationAndQuotaFailures() {
        assertMappedStatus(StatusCode.Code.PERMISSION_DENIED, "AUTH_ERROR");
        assertMappedStatus(StatusCode.Code.RESOURCE_EXHAUSTED, "QUOTA_LIMITED");
    }

    private void assertMappedStatus(StatusCode.Code code, String expectedStatus) {
        GoogleAnalyticsGateway gateway = Mockito.mock(GoogleAnalyticsGateway.class);
        AnalyticsSnapshotRepository repository = Mockito.mock(AnalyticsSnapshotRepository.class);
        ApiException exception = Mockito.mock(ApiException.class);
        StatusCode statusCode = Mockito.mock(StatusCode.class);
        AnalyticsDateRange range = AnalyticsDateRange.resolve("30d", null, null);
        String propertyHash = expectedStatus.toLowerCase() + "0".repeat(64 - expectedStatus.length());
        given(gateway.isConfigured()).willReturn(true);
        given(gateway.propertyHash()).willReturn(propertyHash);
        given(repository.find("DETAIL_30D", propertyHash)).willReturn(Optional.empty());
        given(exception.getStatusCode()).willReturn(statusCode);
        given(statusCode.getCode()).willReturn(code);
        given(gateway.fetchReport(range)).willThrow(exception);

        var response = service(gateway, repository).report(range, false);

        assertThat(response.available()).isFalse();
        assertThat(response.status()).isEqualTo(expectedStatus);
        verify(repository).markFailure("DETAIL_30D", propertyHash, NOW, expectedStatus);
    }

    private GoogleAnalyticsService service(GoogleAnalyticsGateway gateway, AnalyticsSnapshotRepository repository) {
        return new GoogleAnalyticsService(gateway, repository, new ObjectMapper(), 900, 60, 900_000,
                "https://analytics.google.com/analytics/web/", Clock.fixed(NOW, ZoneOffset.UTC));
    }
}
