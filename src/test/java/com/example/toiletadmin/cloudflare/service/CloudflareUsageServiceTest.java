package com.example.toiletadmin.cloudflare.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import com.example.toiletadmin.cloudflare.dto.CloudflareUsageResponse;
import com.example.toiletadmin.cloudflare.service.CloudflareAnalyticsClient.Dataset;
import java.time.*;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.JsonNode;

class CloudflareUsageServiceTest {
    private final ObjectMapper json = new ObjectMapper();
    private final Instant now = Instant.parse("2026-09-30T06:00:00Z");
    private CloudflareUsageService service(CloudflareAnalyticsClient client, Clock clock) {
        return new CloudflareUsageService(client, true, 30, "Workers Paid", 29, 10_000_000,
                25_000_000_000L, 10_000_000_000L, "https://dash.cloudflare.com/", clock);
    }
    private CloudflareAnalyticsClient client() throws Exception {
        var client = mock(CloudflareAnalyticsClient.class);
        when(client.isConfigured()).thenReturn(true);
        when(client.queryDataset(any(), any(), any())).thenReturn(json.readTree("[]"));
        when(client.queryDataset(eq(Dataset.WORKERS), any(), any())).thenReturn(json.readTree("""
                [{"dimensions":{"scriptName":"web"},"sum":{"requests":18420,"cpuTimeUs":30000001000,"errors":2}}]
                """));
        when(client.queryDataset(eq(Dataset.D1), any(), any())).thenReturn(json.readTree("""
                [{"dimensions":{"databaseId":"db"},"sum":{"rowsRead":620000,"rowsWritten":50000001}}]
                """));
        when(client.queryDataset(eq(Dataset.R2_STORAGE), any(), any())).thenReturn(json.readTree("""
                [
                  {"dimensions":{"bucketName":"cache","storageClass":"Standard","datetime":"2026-09-30T05:00:00Z"},"max":{"payloadSize":800000000,"metadataSize":100}},
                  {"dimensions":{"bucketName":"cache","storageClass":"Standard","datetime":"2026-09-29T00:00:00Z"},"max":{"payloadSize":100000000,"metadataSize":0}},
                  {"dimensions":{"bucketName":"cache","storageClass":"InfrequentAccess","datetime":"2026-09-30T05:00:00Z"},"max":{"payloadSize":0,"metadataSize":0}}
                ]
                """));
        return client;
    }
    private CloudflareUsageResponse.CostMetric metric(CloudflareUsageResponse response, String id) {
        return response.metrics().stream().filter(m -> m.id().equals(id)).findFirst().orElseThrow();
    }

    @Test void includesCpuWritesAndR2ClassABWithoutTreatingStorageAsMonthlyCost() throws Exception {
        var client = client();
        when(client.queryDataset(eq(Dataset.R2), any(), any())).thenReturn(json.readTree("""
                [
                 {"dimensions":{"actionType":"PutObject","storageClass":"Standard","responseStatusCode":200},"sum":{"requests":1000001}},
                 {"dimensions":{"actionType":"GetObject","storageClass":"Standard","responseStatusCode":404},"sum":{"requests":10000001}},
                 {"dimensions":{"actionType":"DeleteObjects","storageClass":"Standard","responseStatusCode":200},"sum":{"requests":200}},
                 {"dimensions":{"actionType":"PutObject","storageClass":"Standard","responseStatusCode":403},"sum":{"requests":600}}
                ]
                """));
        var service = service(client, Clock.fixed(now, ZoneOffset.UTC));
        var result = service.getUsage();
        assertThat(metric(result,"r2-a").used()).isEqualTo(1000001);
        assertThat(metric(result,"r2-a").estimatedOverageUsd()).isEqualTo(4.5);
        assertThat(metric(result,"r2-b").estimatedOverageUsd()).isEqualTo(.36);
        assertThat(metric(result,"workers-cpu").used()).isEqualTo(30_000_001);
        assertThat(metric(result,"d1-write").used()).isEqualTo(50_000_001);
        assertThat(metric(result,"r2-storage").used()).isEqualTo(800_000_100d);
        assertThat(metric(result,"r2-storage").estimatedOverageUsd()).isNull();
        assertThat(metric(result,"workers-logs").used()).isNull();
        assertThat(result.status()).isEqualTo("WARN");
        assertThat(service.getUsage()).isSameAs(result);
        verify(client,times(7)).queryDataset(any(),any(),any());
        assertThat(result.measurementEnd()).isEqualTo(now.minusSeconds(900));
    }
    @Test void missingDatasetStaysUnknownWhileOtherServicesRemainVisible() throws Exception {
        var client = client();
        when(client.queryDataset(eq(Dataset.R2), any(), any())).thenThrow(new IllegalStateException("private upstream details"));
        var result = service(client, Clock.fixed(now, ZoneOffset.UTC)).getUsage();
        assertThat(result.available()).isTrue();
        assertThat(metric(result,"r2-a").used()).isNull();
        assertThat(metric(result,"r2-a").estimatedOverageUsd()).isNull();
        assertThat(metric(result,"d1-read").used()).isEqualTo(620000);
        assertThat(json.writeValueAsString(result)).doesNotContain("private upstream details");
    }
    @Test void staleValuesAreExcludedFromCostAndNeverCrossBillingCycles() throws Exception {
        var client = client();
        var time = new AtomicReference<>(Instant.parse("2026-09-28T23:59:00Z"));
        Clock clock = mock(Clock.class);
        when(clock.instant()).thenAnswer(invocation -> time.get());
        var service = service(client, clock);
        assertThat(metric(service.getUsage(),"workers-requests").used()).isEqualTo(18420);
        when(client.queryDataset(any(),any(),any())).thenThrow(new IllegalStateException("offline"));
        time.set(time.get().plusSeconds(31));
        var stale = service.getUsage();
        assertThat(metric(stale,"workers-requests").status()).isEqualTo("STALE");
        assertThat(metric(stale,"workers-requests").estimatedOverageUsd()).isNull();
        assertThat(stale.costSummary().observedSubtotalUsd()).isNull();
        time.set(Instant.parse("2026-09-29T00:20:00Z"));
        var nextMonth = service.getUsage();
        assertThat(metric(nextMonth,"workers-requests").used()).isNull();
        assertThat(nextMonth.usagePeriodStart()).isEqualTo(Instant.parse("2026-09-29T00:00:00Z"));
    }
    @Test void disabledIntegrationDoesNotReportZeroUsage() {
        var result = service(mock(CloudflareAnalyticsClient.class), Clock.fixed(now, ZoneOffset.UTC)).getUsage();
        assertThat(result.available()).isFalse();
        assertThat(result.metrics()).allMatch(m -> m.used() == null);
        assertThat(result.costSummary().observedSubtotalUsd()).isNull();
    }
    @Test void incompleteNumericFieldsAreNotZero() throws Exception {
        assertThat(CloudflareUsageService.sum(json.readTree("[{\"sum\":{}}]"),"requests")).isNull();
        assertThat(CloudflareUsageService.sum(json.readTree("[{\"sum\":{\"requests\":-1}}]"),"requests")).isNull();
        assertThat(CloudflareUsageService.sum(json.readTree("[]"),"requests")).isZero();
    }
    @Test void resourceBreakdownIncludesIdleStorageAndAllBucketOperations() throws Exception {
        var client = client();
        when(client.queryDataset(eq(Dataset.R2), any(), any())).thenReturn(json.readTree("""
                [
                  {"dimensions":{"bucketName":"cache","actionType":"PutObject","storageClass":"Standard","responseStatusCode":200},"sum":{"requests":20}},
                  {"dimensions":{"bucketName":"cache","actionType":"GetObject","storageClass":"Standard","responseStatusCode":200},"sum":{"requests":30}},
                  {"dimensions":{"bucketName":"removed","actionType":"DeleteObject","storageClass":"Standard","responseStatusCode":200},"sum":{"requests":1}}
                ]
                """));
        when(client.queryDataset(eq(Dataset.D1_STORAGE), any(), any())).thenReturn(json.readTree("""
                [{"dimensions":{"databaseId":"idle-db","datetime":"2026-09-30T04:00:00Z"},"max":{"databaseSizeBytes":12345}}]
                """));
        var result = service(client, Clock.fixed(now, ZoneOffset.UTC)).getUsage();
        assertThat(result.resources()).anyMatch(r -> r.name().equals("cache · Standard") && r.requests() == 50);
        assertThat(result.resources()).anyMatch(r -> r.name().equals("removed · Standard") && r.requests() == 1 && r.storageBytes() == null);
        assertThat(result.resources()).anyMatch(r -> r.name().equals("idle-db") && r.storageBytes() == 12345);
        assertThat(metric(result,"r2-a").used()).isEqualTo(20);
        assertThat(metric(result,"r2-b").used()).isEqualTo(30);
        assertThat(metric(result,"r2-storage").measuredAt()).isEqualTo(Instant.parse("2026-09-30T05:00:00Z"));
    }
    @Test void rejectsPartialErrorsAndDisabledOrTruncatedProviderResults() throws Exception {
        var start = now.minusSeconds(3600);
        assertThatThrownBy(() -> CloudflareAnalyticsClient.validate(json.readTree("""
                {"errors":[{"message":"access denied"}],"data":{}}
                """),start,now)).isInstanceOf(IllegalStateException.class);
        for (String capability : new String[]{
                "{\"enabled\":false,\"maxDuration\":2764800,\"notOlderThan\":7776000,\"maxPageSize\":10000}",
                "{\"enabled\":true,\"maxDuration\":60,\"notOlderThan\":7776000,\"maxPageSize\":10000}",
                "{\"enabled\":true,\"maxDuration\":2764800,\"notOlderThan\":60,\"maxPageSize\":10000}",
                "{\"enabled\":true,\"maxDuration\":2764800,\"notOlderThan\":7776000,\"maxPageSize\":0}"}) {
            JsonNode root = json.readTree("{\"data\":{\"viewer\":{\"accounts\":[{\"settings\":{\"capability\":"+capability+"},\"rows\":[]}]}}}");
            assertThatThrownBy(() -> CloudflareAnalyticsClient.validate(root,start,now)).isInstanceOf(IllegalStateException.class);
        }
    }
}
