package com.example.toiletadmin.cloudflare.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.eq;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

class CloudflareUsageServiceTest {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void combinesCloudflareUsageAndCachesTheResult() throws Exception {
        CloudflareAnalyticsClient client = mock(CloudflareAnalyticsClient.class);
        when(client.isConfigured()).thenReturn(true);
        when(client.query(any(), any(), any(), any(), any())).thenReturn(objectMapper.readTree("""
                {
                  "data": {"viewer": {"accounts": [{
                    "workersInvocationsAdaptive": [
                      {"sum": {"requests": 18000}},
                      {"sum": {"requests": 420}}
                    ],
                    "d1AnalyticsAdaptiveGroups": [
                      {"sum": {"rowsRead": 620000}}
                    ],
                    "r2StorageAdaptiveGroups": [
                      {"dimensions": {"bucketName": "photos", "datetime": "2026-09-13T01:00:00Z"}, "max": {"payloadSize": 700000000, "metadataSize": 2000}},
                      {"dimensions": {"bucketName": "backups", "datetime": "2026-09-13T01:00:00Z"}, "max": {"payloadSize": 100000000, "metadataSize": 1000}},
                      {"dimensions": {"bucketName": "photos", "datetime": "2026-09-12T01:00:00Z"}, "max": {"payloadSize": 600000000, "metadataSize": 1000}}
                    ]
                  }]}}
                }
                """));
        Clock clock = Clock.fixed(Instant.parse("2026-09-13T01:30:00Z"), ZoneOffset.UTC);
        CloudflareUsageService service = new CloudflareUsageService(
                client, true, 300, "Workers Paid", 29, 10_000_000, 25_000_000_000L, 10_000_000_000L,
                "https://dash.cloudflare.com/", clock);

        var first = service.getUsage();
        var cached = service.getUsage();

        assertThat(first.available()).isTrue();
        assertThat(first.status()).isEqualTo("UP");
        assertThat(first.planLabel()).isEqualTo("Workers Paid");
        assertThat(first.workersRequests().used()).isEqualTo(18_420);
        assertThat(first.workersRequests().limit()).isEqualTo(10_000_000);
        assertThat(first.workersRequests().usedPercent()).isZero();
        assertThat(first.d1RowsRead().used()).isEqualTo(620_000);
        assertThat(first.r2StorageBytes().used()).isEqualTo(800_003_000L);
        assertThat(first.lastSuccessfulAt()).isEqualTo(Instant.parse("2026-09-13T01:30:00Z"));
        assertThat(first.usagePeriodStart()).isEqualTo(Instant.parse("2026-08-29T00:00:00Z"));
        assertThat(first.usagePeriodEnd()).isEqualTo(Instant.parse("2026-09-28T00:00:00Z"));
        assertThat(cached).isSameAs(first);
        verify(client, times(1)).query(
                eq(Instant.parse("2026-08-29T00:00:00Z")),
                eq(Instant.parse("2026-09-13T01:30:00Z")),
                eq(LocalDate.parse("2026-08-29")),
                eq(LocalDate.parse("2026-09-13")),
                eq(Instant.parse("2026-09-11T01:30:00Z")));
    }

    @Test
    void returnsAnUnavailableCardWhenIntegrationIsDisabled() {
        CloudflareAnalyticsClient client = mock(CloudflareAnalyticsClient.class);
        Clock clock = Clock.fixed(Instant.parse("2026-09-13T01:30:00Z"), ZoneOffset.UTC);
        CloudflareUsageService service = new CloudflareUsageService(
                client, false, 300, "Workers Paid", 29, 10_000_000, 25_000_000_000L, 10_000_000_000L,
                "https://dash.cloudflare.com/", clock);

        var response = service.getUsage();

        assertThat(response.available()).isFalse();
        assertThat(response.status()).isEqualTo("UNAVAILABLE");
        assertThat(response.lastSuccessfulAt()).isNull();
        assertThat(response.message()).contains("연동 설정");
    }

    @Test
    void keepsTheLastSuccessfulValuesWhenARefreshFails() throws Exception {
        CloudflareAnalyticsClient client = mock(CloudflareAnalyticsClient.class);
        when(client.isConfigured()).thenReturn(true);
        when(client.query(any(), any(), any(), any(), any()))
                .thenReturn(objectMapper.readTree("""
                        {"data":{"viewer":{"accounts":[{
                          "workersInvocationsAdaptive":[{"sum":{"requests":1200}}],
                          "d1AnalyticsAdaptiveGroups":[],
                          "r2StorageAdaptiveGroups":[]
                        }]}}}
                        """))
                .thenThrow(new IllegalStateException("temporary failure"));
        Clock clock = mock(Clock.class);
        Instant firstCheck = Instant.parse("2026-09-13T01:30:00Z");
        when(clock.instant()).thenReturn(firstCheck, firstCheck.plusSeconds(31));
        CloudflareUsageService service = new CloudflareUsageService(
                client, true, 30, "Workers Paid", 29, 10_000_000, 25_000_000_000L, 10_000_000_000L,
                "https://dash.cloudflare.com/", clock);

        var successful = service.getUsage();
        var stale = service.getUsage();

        assertThat(successful.available()).isTrue();
        assertThat(stale.available()).isFalse();
        assertThat(stale.workersRequests().used()).isEqualTo(1_200);
        assertThat(stale.lastSuccessfulAt()).isEqualTo(firstCheck);
        assertThat(stale.message()).contains("마지막 성공 조회값");
        verify(client, times(2)).query(any(), any(), any(), any(), any());
    }

    @Test
    void treatsIncludedUsageOverageAsCostWarningInsteadOfServiceOutage() throws Exception {
        CloudflareAnalyticsClient client = mock(CloudflareAnalyticsClient.class);
        when(client.isConfigured()).thenReturn(true);
        when(client.query(any(), any(), any(), any(), any())).thenReturn(objectMapper.readTree("""
                {"data":{"viewer":{"accounts":[{
                  "workersInvocationsAdaptive":[{"sum":{"requests":12000000}}],
                  "d1AnalyticsAdaptiveGroups":[],
                  "r2StorageAdaptiveGroups":[]
                }]}}}
                """));
        Clock clock = Clock.fixed(Instant.parse("2026-09-13T01:30:00Z"), ZoneOffset.UTC);
        CloudflareUsageService service = new CloudflareUsageService(
                client, true, 300, "Workers Paid", 29, 10_000_000, 25_000_000_000L, 10_000_000_000L,
                "https://dash.cloudflare.com/", clock);

        var response = service.getUsage();

        assertThat(response.status()).isEqualTo("WARN");
        assertThat(response.workersRequests().usedPercent()).isEqualTo(120);
        assertThat(response.message()).contains("과금");
    }
}
