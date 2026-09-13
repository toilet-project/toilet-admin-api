package com.example.toiletadmin.cloudflare.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

class CloudflareUsageServiceTest {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void combinesCloudflareUsageAndCachesTheResult() throws Exception {
        CloudflareAnalyticsClient client = mock(CloudflareAnalyticsClient.class);
        when(client.isConfigured()).thenReturn(true);
        when(client.query(any(), any(), any(), any())).thenReturn(objectMapper.readTree("""
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
                client, true, 300, 100_000, 5_000_000, 10_737_418_240L,
                "https://dash.cloudflare.com/", clock);

        var first = service.getUsage();
        var cached = service.getUsage();

        assertThat(first.available()).isTrue();
        assertThat(first.status()).isEqualTo("UP");
        assertThat(first.workersRequests().used()).isEqualTo(18_420);
        assertThat(first.workersRequests().usedPercent()).isEqualTo(18);
        assertThat(first.d1RowsRead().used()).isEqualTo(620_000);
        assertThat(first.r2StorageBytes().used()).isEqualTo(800_003_000L);
        assertThat(first.dailyResetAt()).isEqualTo(Instant.parse("2026-09-14T00:00:00Z"));
        assertThat(cached).isSameAs(first);
        verify(client, times(1)).query(any(), any(), any(), any());
    }

    @Test
    void returnsAnUnavailableCardWhenIntegrationIsDisabled() {
        CloudflareAnalyticsClient client = mock(CloudflareAnalyticsClient.class);
        Clock clock = Clock.fixed(Instant.parse("2026-09-13T01:30:00Z"), ZoneOffset.UTC);
        CloudflareUsageService service = new CloudflareUsageService(
                client, false, 300, 100_000, 5_000_000, 10_737_418_240L,
                "https://dash.cloudflare.com/", clock);

        var response = service.getUsage();

        assertThat(response.available()).isFalse();
        assertThat(response.status()).isEqualTo("UNAVAILABLE");
        assertThat(response.message()).contains("연동 설정");
    }
}
