package com.example.toiletadmin.cloudflare.service;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import com.example.toiletadmin.cloudflare.service.CloudflareAnalyticsClient.Dataset;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.JsonNode;

class CloudflareMonitoringServiceTest {
    private final ObjectMapper json=new ObjectMapper();
    private final Instant start=Instant.parse("2026-09-29T06:00:00Z"),end=start.plusSeconds(86400);
    @Test void comparesOnlyCompletedHoursAndKeepsR2FailuresSeparateFromBilling() throws Exception {
        JsonNode rows=json.readTree("""
          [
           {"dimensions":{"datetimeHour":"2026-09-29T05:00:00Z","actionType":"PutObject","storageClass":"Standard","responseStatusCode":200},"sum":{"requests":90}},
           {"dimensions":{"datetimeHour":"2026-09-30T04:00:00Z","actionType":"PutObject","storageClass":"Standard","responseStatusCode":200},"sum":{"requests":10}},
           {"dimensions":{"datetimeHour":"2026-09-30T05:00:00Z","actionType":"PutObject","storageClass":"Standard","responseStatusCode":200},"sum":{"requests":30}},
           {"dimensions":{"datetimeHour":"2026-09-30T05:00:00Z","actionType":"PutObject","storageClass":"Standard","responseStatusCode":403},"sum":{"requests":5}},
           {"dimensions":{"datetimeHour":"2026-09-30T05:00:00Z","actionType":"GetObject","storageClass":"Standard","responseStatusCode":404},"sum":{"requests":7}},
           {"dimensions":{"datetimeHour":"2026-09-30T05:00:00Z","actionType":"GetObject","storageClass":"Standard","responseStatusCode":503},"sum":{"requests":2}}
          ]
          """);
        var r=CloudflareMonitoringService.r2(rows,start,end);
        assertThat(r.hours()).hasSize(24);
        assertThat(r.puts24h()).isEqualTo(45);
        assertThat(r.previousPuts24h()).isEqualTo(90);
        assertThat(r.lastHourPuts()).isEqualTo(35);
        assertThat(r.previousHourPuts()).isEqualTo(10);
        assertThat(r.hours().getLast().classA()).isEqualTo(30);
        assertThat(r.getMissing()).isEqualTo(7);
        assertThat(r.serverErrors()).isEqualTo(2);
        assertThatThrownBy(()->CloudflareMonitoringService.r2(rows,end,end.plusSeconds(86400))).isInstanceOf(IllegalArgumentException.class);
    }
    @Test void samplingDifferencesDoNotInventNegativeRemainders() throws Exception {
        Map<String,JsonNode> rows=new HashMap<>();
        for(String key:CloudflareAnalyticsClient.CACHE_PREFIXES.keySet())rows.put(key,json.readTree("[]"));
        rows.put("body",json.readTree("[{\"dimensions\":{\"responseStatusCode\":200},\"sum\":{\"requests\":101}}]"));
        rows.put("total",json.readTree("[{\"dimensions\":{\"responseStatusCode\":200},\"sum\":{\"requests\":100}}]"));
        var r=CloudflareMonitoringService.writes(rows,"test-cache");
        assertThat(r.categories().getLast().requests()).isNull();
        assertThat(r.total()).isEqualTo(100);
    }
    @Test void cpuQuantilesAreConvertedAndD1CountsAllQueries() throws Exception {
        var workers=CloudflareMonitoringService.workers(json.readTree("""
          [{"dimensions":{"scriptName":"web"},"sum":{"requests":100,"errors":2,"cpuTimeUs":1000000},"quantiles":{"cpuTimeP95":8000,"requestDurationP95":250000}}]
          """));
        assertThat(workers.getFirst().cpuMs()).isEqualTo(1000);
        assertThat(workers.getFirst().cpuP95Ms()).isEqualTo(8);
        assertThat(workers.getFirst().responseP95Ms()).isEqualTo(250);
        var d1=CloudflareMonitoringService.databases(json.readTree("""
          [{"dimensions":{"databaseId":"db"},"sum":{"readQueries":3,"writeQueries":2,"rowsRead":20,"rowsWritten":4},"quantiles":{"queryBatchTimeMsP95":12}}]
          """));
        assertThat(d1.getFirst().queries()).isEqualTo(5);
        assertThat(d1.getFirst().queryP95Ms()).isEqualTo(12);
    }
    @Test void cdnHitAndBotClassificationAreNotInferredFromDynamicTraffic() throws Exception {
        var r=CloudflareMonitoringService.traffic(json.readTree("""
          [
           {"count":80,"dimensions":{"cacheStatus":"dynamic","verifiedBotCategory":"","edgeResponseStatus":200,"originResponseStatus":200}},
           {"count":20,"dimensions":{"cacheStatus":"hit","verifiedBotCategory":"Search Engine Crawler","edgeResponseStatus":200,"originResponseStatus":0}},
           {"count":3,"dimensions":{"cacheStatus":"miss","verifiedBotCategory":"","edgeResponseStatus":503,"originResponseStatus":503}}
          ]
          """),"example.test");
        assertThat(r.requests()).isEqualTo(103);
        assertThat(r.cdnHits()).isEqualTo(20);
        assertThat(r.verifiedBots()).isEqualTo(20);
        assertThat(r.edgeErrors()).isEqualTo(3);
        assertThat(r.originErrors()).isEqualTo(3);
    }
    @Test void storageUsesLatestBeforeBoundaryAndKeepsMissingHistoryUnknown() throws Exception {
        var r=CloudflareMonitoringService.storage(json.readTree("""
          [
           {"dimensions":{"databaseId":"db","datetime":"2026-09-28T08:00:00Z"},"max":{"databaseSizeBytes":10}},
           {"dimensions":{"databaseId":"db","datetime":"2026-09-29T05:00:00Z"},"max":{"databaseSizeBytes":20}},
           {"dimensions":{"databaseId":"db","datetime":"2026-09-30T05:00:00Z"},"max":{"databaseSizeBytes":30}},
           {"dimensions":{"databaseId":"new-db","datetime":"2026-09-30T05:00:00Z"},"max":{"databaseSizeBytes":12}}
          ]
          """),start);
        assertThat(r.getFirst().previousBytes()).isEqualTo(20);
        assertThat(r.getFirst().bytes()).isEqualTo(30);
        assertThat(r.getLast().previousBytes()).isNull();
    }
    @Test void cachesReadOnlyQueriesAndIsolatesMissingPermissions() throws Exception {
        var client=mock(CloudflareAnalyticsClient.class);
        when(client.isConfigured()).thenReturn(true);
        when(client.queryMonitor(any(),any(),any())).thenReturn(json.readTree("[]"));
        when(client.queryDataset(any(),any(),any())).thenReturn(json.readTree("[]"));
        when(client.queryTraffic(anyString(),any(),any())).thenThrow(new IllegalStateException("private provider error"));
        when(client.queryCacheWrites(anyString(),any(),any())).thenReturn(null);
        var svc=new CloudflareMonitoringService(client,true,300,"example.test","bucket",Clock.fixed(end.plusSeconds(1800),ZoneOffset.UTC));
        var r=svc.getMonitoring();
        assertThat(r.end()).isEqualTo(end);
        assertThat(r.start()).isEqualTo(start);
        assertThat(r.status()).isEqualTo("PARTIAL");
        assertThat(r.sections().get("traffic").data()).isNull();
        assertThat(r.sections().get("r2").status()).isEqualTo("OK");
        assertThat(json.writeValueAsString(r)).doesNotContain("private provider error");
        assertThat(svc.getMonitoring()).isSameAs(r);
        verify(client,times(3)).queryMonitor(any(),any(),any());
        verify(client,times(3)).queryDataset(any(),any(),any());
    }
    @Test void disabledOrMalformedDataNeverBecomesHealthyZero() throws Exception {
        var client=mock(CloudflareAnalyticsClient.class);
        var r=new CloudflareMonitoringService(client,false,300,"example.test","bucket",Clock.systemUTC()).getMonitoring();
        assertThat(r.status()).isEqualTo("UNAVAILABLE");
        assertThat(r.sections().values()).allMatch(s->s.data()==null);
        verifyNoInteractions(client);
        assertThatThrownBy(()->CloudflareMonitoringService.workers(json.readTree("[{\"sum\":{}}]"))).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(()->CloudflareMonitoringService.num(json.readTree("-1"))).isInstanceOf(IllegalArgumentException.class);
    }
    @Test void workflowUsesLatestRunAndDoesNotTrustProviderLinks() throws Exception {
        var r=CloudflareMonitoringService.refreshRuns(json.readTree("""
          [
           {"id":11,"status":"completed","conclusion":"success","created_at":"2026-09-29T06:00:00Z","updated_at":"2026-09-29T06:05:00Z","html_url":"https://untrusted.invalid"},
           {"id":12,"status":"completed","conclusion":"failure","created_at":"2026-09-30T06:00:00Z","updated_at":"2026-09-30T06:05:00Z"}
          ]
          """));
        assertThat(r.runs().getFirst().conclusion()).isEqualTo("failure");
        assertThat(r.runs().getFirst().url()).isEqualTo("https://github.com/toilet-project/toilet-web/actions/runs/12");
        assertThat(r.lastSuccessAt()).isEqualTo(Instant.parse("2026-09-29T06:05:00Z"));
    }
}
