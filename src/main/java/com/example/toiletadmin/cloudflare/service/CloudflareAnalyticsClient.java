package com.example.toiletadmin.cloudflare.service;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import tools.jackson.databind.JsonNode;

@Component
public class CloudflareAnalyticsClient {
    public enum Dataset {
        WORKERS("workersInvocationsAdaptive", "dimensions { scriptName } sum { requests cpuTimeUs errors }", false),
        D1("d1AnalyticsAdaptiveGroups", "dimensions { databaseId } sum { rowsRead rowsWritten }", false),
        R2("r2OperationsAdaptiveGroups", "dimensions { bucketName actionType storageClass responseStatusCode } sum { requests }", false),
        R2_STORAGE("r2StorageAdaptiveGroups", "dimensions { bucketName storageClass datetime } max { payloadSize metadataSize }", true),
        D1_STORAGE("d1StorageAdaptiveGroups", "dimensions { databaseId datetime } max { databaseSizeBytes }", true),
        DO_REQUESTS("durableObjectsInvocationsAdaptiveGroups", "sum { requests errors }", false),
        DO_TIME("durableObjectsPeriodicGroups", "sum { duration inboundWebsocketMsgCount rowsRead rowsWritten }", false);
        final String field, selection;
        final boolean storage;
        Dataset(String field, String selection, boolean storage) {
            this.field = field; this.selection = selection; this.storage = storage;
        }
    }
    private final RestClient restClient;
    private final String accountId, apiToken;
    public CloudflareAnalyticsClient(
            @Value("${cloudflare.analytics.endpoint:https://api.cloudflare.com/client/v4/graphql}") String endpoint,
            @Value("${cloudflare.analytics.account-id:}") String accountId,
            @Value("${cloudflare.analytics.api-token:}") String apiToken) {
        var factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofSeconds(3));
        factory.setReadTimeout(Duration.ofSeconds(12));
        restClient = RestClient.builder().baseUrl(endpoint).requestFactory(factory).build();
        this.accountId = accountId == null ? "" : accountId.trim();
        this.apiToken = apiToken == null ? "" : apiToken.trim();
    }
    public boolean isConfigured() { return !accountId.isBlank() && !apiToken.isBlank(); }

    public JsonNode queryDataset(Dataset dataset, Instant start, Instant end) {
        // Field names are enum-owned. Provider errors never reach the browser.
        String query = "query AdminCost($accountTag:string!,$start:Time!,$end:Time!){viewer{accounts(filter:{accountTag:$accountTag}){"
                + "settings { capability:" + dataset.field + " { enabled maxDuration notOlderThan maxPageSize } } "
                + "rows:" + dataset.field + "(limit:10000,filter:{datetime_geq:$start,datetime_lt:$end}"
                + (dataset.storage ? ",orderBy:[datetime_DESC]" : "") + "){" + dataset.selection + "}}}}";
        JsonNode root = restClient.post().header(HttpHeaders.AUTHORIZATION, "Bearer " + apiToken)
                .contentType(MediaType.APPLICATION_JSON)
                .body(Map.of("query", query, "variables", Map.of("accountTag", accountId,
                        "start", start.toString(), "end", end.toString())))
                .retrieve().body(JsonNode.class);
        return validate(root, start, end);
    }

    static JsonNode validate(JsonNode root, Instant start, Instant end) {
        if (root == null || root.path("errors").size() > 0) throw new IllegalStateException("Analytics unavailable");
        JsonNode accounts = root.path("data").path("viewer").path("accounts");
        if (!accounts.isArray() || accounts.size() != 1) throw new IllegalStateException("Account unavailable");
        JsonNode account = accounts.get(0), cap = account.path("settings").path("capability"), rows = account.path("rows");
        long span = Duration.between(start, end).getSeconds();
        if (!cap.path("enabled").asBoolean() || span <= 0 || span > cap.path("maxDuration").asLong()
                || span + 900 > cap.path("notOlderThan").asLong() || !rows.isArray()
                || rows.size() >= Math.min(10000, cap.path("maxPageSize").asInt())) {
            throw new IllegalStateException("Incomplete analytics range");
        }
        return rows;
    }
}
