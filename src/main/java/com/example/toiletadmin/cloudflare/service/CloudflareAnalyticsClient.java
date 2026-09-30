package com.example.toiletadmin.cloudflare.service;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.LinkedHashMap;
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
        DO_TIME("durableObjectsPeriodicGroups", "sum { duration inboundWebsocketMsgCount rowsRead rowsWritten exceededCpuErrors exceededMemoryErrors fatalInternalErrors }", false);
        final String field, selection;
        final boolean storage;
        Dataset(String field, String selection, boolean storage) {
            this.field = field; this.selection = selection; this.storage = storage;
        }
    }
    public enum MonitorDataset {
        R2_HOURS("r2OperationsAdaptiveGroups", "dimensions { datetimeHour bucketName actionType storageClass responseStatusCode } sum { requests }"),
        WORKERS_HEALTH("workersInvocationsAdaptive", "dimensions { scriptName } sum { requests errors cpuTimeUs } quantiles { cpuTimeP95 requestDurationP95 }"),
        D1_HEALTH("d1AnalyticsAdaptiveGroups", "dimensions { databaseId } sum { readQueries writeQueries rowsRead rowsWritten } quantiles { queryBatchTimeMsP95 }");
        final String field, selection;
        MonitorDataset(String field, String selection) { this.field = field; this.selection = selection; }
    }
    static final Map<String, String> CACHE_PREFIXES = Map.of(
            "source", "public-toilets/", "body", "toilet-content/", "framework", "incremental-cache/",
            "cells", "map-cells/", "clusters", "map-clusters/", "regions", "region-markers/");
    private final RestClient restClient;
    private final String accountId, apiToken, zonesEndpoint;
    private volatile String resolvedZone;
    public CloudflareAnalyticsClient(
            @Value("${cloudflare.analytics.endpoint:https://api.cloudflare.com/client/v4/graphql}") String endpoint,
            @Value("${cloudflare.analytics.account-id:}") String accountId,
            @Value("${cloudflare.analytics.api-token:}") String apiToken) {
        var factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofSeconds(3));
        factory.setReadTimeout(Duration.ofSeconds(12));
        restClient = RestClient.builder().baseUrl(endpoint).requestFactory(factory).build();
        zonesEndpoint = endpoint.replaceFirst("/graphql/?$", "/zones");
        this.accountId = accountId == null ? "" : accountId.trim();
        this.apiToken = apiToken == null ? "" : apiToken.trim();
    }
    public boolean isConfigured() { return !accountId.isBlank() && !apiToken.isBlank(); }

    public JsonNode queryDataset(Dataset dataset, Instant start, Instant end) {
        return queryAccount(dataset.field, dataset.selection, dataset.storage, start, end);
    }
    public JsonNode queryMonitor(MonitorDataset dataset, Instant start, Instant end) {
        return queryAccount(dataset.field, dataset.selection, false, start, end);
    }
    private JsonNode queryAccount(String field, String selection, boolean storage, Instant start, Instant end) {
        // Field names are enum-owned. Provider errors never reach the browser.
        String query = "query AdminCost($accountTag:string!,$start:Time!,$end:Time!){viewer{accounts(filter:{accountTag:$accountTag}){"
                + "settings { capability:" + field + " { enabled maxDuration notOlderThan maxPageSize } } "
                + "rows:" + field + "(limit:10000,filter:{datetime_geq:$start,datetime_lt:$end}"
                + (storage ? ",orderBy:[datetime_DESC]" : "") + "){" + selection + "}}}}";
        return validate(post(query, variables(start, end)), start, end);
    }
    private Map<String, Object> variables(Instant start, Instant end) {
        return new LinkedHashMap<>(Map.of("accountTag", accountId, "start", start.toString(), "end", end.toString()));
    }
    private JsonNode post(String query, Map<String, Object> variables) {
        return restClient.post().header(HttpHeaders.AUTHORIZATION, "Bearer " + apiToken)
                .contentType(MediaType.APPLICATION_JSON)
                .body(Map.of("query", query, "variables", variables))
                .retrieve().body(JsonNode.class);
    }
    public Map<String, JsonNode> queryCacheWrites(String bucket, Instant start, Instant end) {
        StringBuilder query = new StringBuilder("query CacheWrites($accountTag:string!,$bucket:string!,$start:Time!,$end:Time!){viewer{accounts(filter:{accountTag:$accountTag}){settings{capability:r2OperationsAdaptiveGroups{enabled maxDuration notOlderThan maxPageSize}} ");
        Map<String, String> prefixes = new LinkedHashMap<>(CACHE_PREFIXES);
        prefixes.put("total", "");
        prefixes.forEach((key, prefix) -> query.append(key).append(":r2OperationsAdaptiveGroups(limit:10000,filter:{datetime_geq:$start,datetime_lt:$end,bucketName:$bucket,actionType:\"PutObject\"")
                .append(prefix.isEmpty() ? "" : ",objectName_like:\"" + prefix + "%\"")
                .append("}){dimensions{responseStatusCode} sum{requests}} "));
        query.append("}}}");
        Map<String, Object> vars = variables(start, end); vars.put("bucket", bucket);
        JsonNode account = scope(post(query.toString(), vars), "accounts");
        Map<String, JsonNode> result = new LinkedHashMap<>();
        for (String key : prefixes.keySet()) {
            validateRange(account.path("settings").path("capability"), account.path(key), start, end);
            result.put(key, account.path(key));
        }
        return result;
    }
    public JsonNode queryTraffic(String domain, Instant start, Instant end) {
        // Resolve only the configured account and public service domain. No new token or permission is created.
        String zone = resolvedZone;
        if (zone == null) {
            JsonNode response = restClient.get().uri(zonesEndpoint + "?name={domain}&account.id={account}&per_page=50", domain, accountId)
                    .header(HttpHeaders.AUTHORIZATION, "Bearer " + apiToken).retrieve().body(JsonNode.class);
            if (response == null || !response.path("success").asBoolean() || response.path("result").size() != 1
                    || !response.path("result").get(0).path("account").path("id").asText().equals(accountId)) {
                throw new IllegalStateException("Zone unavailable");
            }
            zone = response.path("result").get(0).path("id").asText();
            if (!zone.matches("[a-fA-F0-9]{32}")) throw new IllegalStateException("Zone unavailable");
            resolvedZone = zone;
        }
        Map<String, Object> vars = variables(start, end); vars.remove("accountTag"); vars.put("zone", zone);
        String query = "query Traffic($zone:string!,$start:Time!,$end:Time!){viewer{zones(filter:{zoneTag:$zone}){"
                + "settings{capability:httpRequestsAdaptiveGroups{enabled maxDuration notOlderThan maxPageSize}} "
                + "rows:httpRequestsAdaptiveGroups(limit:10000,filter:{datetime_geq:$start,datetime_lt:$end,requestSource:\"eyeball\"}){count dimensions{cacheStatus verifiedBotCategory edgeResponseStatus originResponseStatus}}}}}";
        JsonNode node = scope(post(query, vars), "zones");
        validateRange(node.path("settings").path("capability"), node.path("rows"), start, end);
        return node.path("rows");
    }
    public JsonNode queryRefreshRuns() {
        // Public execution metadata only. Never forward the Cloudflare credential to GitHub.
        // The filename alias returned older lists in production. Use the verified workflow ID.
        JsonNode root = restClient.get().uri("https://api.github.com/repos/toilet-project/toilet-web/actions/workflows/360043856/runs?branch=main&per_page=5&page=1")
                .header("User-Agent", "geupddong-admin-monitor").header("Accept", "application/vnd.github+json")
                .header(HttpHeaders.CACHE_CONTROL, "no-cache").header("X-GitHub-Api-Version", "2022-11-28")
                .retrieve().body(JsonNode.class);
        if (root == null || !root.path("workflow_runs").isArray() || root.path("workflow_runs").size() > 5) {
            throw new IllegalStateException("Workflow status unavailable");
        }
        return root.path("workflow_runs");
    }

    static JsonNode validate(JsonNode root, Instant start, Instant end) {
        JsonNode account = scope(root, "accounts"), cap = account.path("settings").path("capability"), rows = account.path("rows");
        validateRange(cap, rows, start, end);
        return rows;
    }
    private static JsonNode scope(JsonNode root, String name) {
        if (root == null || root.path("errors").size() > 0) throw new IllegalStateException("Analytics unavailable");
        JsonNode accounts = root.path("data").path("viewer").path(name);
        if (!accounts.isArray() || accounts.size() != 1) throw new IllegalStateException("Account unavailable");
        return accounts.get(0);
    }
    private static void validateRange(JsonNode cap, JsonNode rows, Instant start, Instant end) {
        long span = Duration.between(start, end).getSeconds();
        if (!cap.path("enabled").asBoolean() || span <= 0 || span > cap.path("maxDuration").asLong()
                || span + 900 > cap.path("notOlderThan").asLong() || !rows.isArray()
                || rows.size() >= Math.min(10000, cap.path("maxPageSize").asInt())) {
            throw new IllegalStateException("Incomplete analytics range");
        }
    }
}
