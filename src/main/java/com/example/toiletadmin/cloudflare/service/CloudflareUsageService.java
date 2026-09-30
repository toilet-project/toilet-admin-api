package com.example.toiletadmin.cloudflare.service;

import com.example.toiletadmin.cloudflare.dto.CloudflareUsageResponse;
import com.example.toiletadmin.cloudflare.dto.CloudflareUsageResponse.*;
import com.example.toiletadmin.cloudflare.service.CloudflareAnalyticsClient.Dataset;
import java.time.*;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.concurrent.*;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;

@Slf4j
@Service
public class CloudflareUsageService {
    private static final String R2_URL = "https://developers.cloudflare.com/r2/pricing/";
    private static final String WORKERS_URL = "https://developers.cloudflare.com/workers/platform/pricing/";
    private static final String D1_URL = "https://developers.cloudflare.com/d1/platform/pricing/";
    private static final String DO_URL = "https://developers.cloudflare.com/durable-objects/platform/pricing/";
    private static final Set<String> CLASS_A = Set.of("ListBuckets", "PutBucket", "ListObjects", "ListObjectsV2",
            "PutObject", "CopyObject", "CompleteMultipartUpload", "CreateMultipartUpload", "LifecycleStorageTierTransition",
            "ListMultipartUploads", "UploadPart", "UploadPartCopy", "ListParts", "PutBucketEncryption", "PutBucketCors",
            "PutBucketLifecycleConfiguration");
    private static final Set<String> CLASS_B = Set.of("HeadBucket", "HeadObject", "GetObject", "UsageSummary",
            "GetBucketEncryption", "GetBucketLocation", "GetBucketCors", "GetBucketLifecycleConfiguration");
    private static final Set<String> FREE = Set.of("DeleteObject", "DeleteObjects", "DeleteBucket", "AbortMultipartUpload");
    private final CloudflareAnalyticsClient client;
    private final boolean enabled;
    private final Duration cacheDuration;
    private final String planLabel, dashboardUrl;
    private final int billingCycleDay;
    private final long workersRequestIncluded, d1RowsReadIncluded, r2StorageByteIncluded;
    private final Clock clock;
    private volatile CacheEntry cache;

    @Autowired
    public CloudflareUsageService(CloudflareAnalyticsClient client,
            @Value("${cloudflare.analytics.enabled:false}") boolean enabled,
            @Value("${cloudflare.analytics.cache-seconds:300}") long cacheSeconds,
            @Value("${cloudflare.analytics.plan-label:Workers Paid}") String planLabel,
            @Value("${cloudflare.analytics.billing-cycle-day:29}") int billingCycleDay,
            @Value("${cloudflare.analytics.workers-request-included:10000000}") long workersRequestIncluded,
            @Value("${cloudflare.analytics.d1-rows-read-included:25000000000}") long d1RowsReadIncluded,
            @Value("${cloudflare.analytics.r2-storage-byte-included:10000000000}") long r2StorageByteIncluded,
            @Value("${cloudflare.analytics.dashboard-url:https://dash.cloudflare.com/}") String dashboardUrl) {
        this(client, enabled, cacheSeconds, planLabel, billingCycleDay, workersRequestIncluded,
                d1RowsReadIncluded, r2StorageByteIncluded, dashboardUrl, Clock.systemUTC());
    }
    CloudflareUsageService(CloudflareAnalyticsClient client, boolean enabled, long cacheSeconds, String planLabel,
            int billingCycleDay, long workersRequestIncluded, long d1RowsReadIncluded, long r2StorageByteIncluded,
            String dashboardUrl, Clock clock) {
        this.client = client; this.enabled = enabled;
        this.cacheDuration = Duration.ofSeconds(Math.max(cacheSeconds, 30));
        this.planLabel = planLabel; this.billingCycleDay = Math.max(1, Math.min(31, billingCycleDay));
        this.workersRequestIncluded = workersRequestIncluded; this.d1RowsReadIncluded = d1RowsReadIncluded;
        this.r2StorageByteIncluded = r2StorageByteIncluded; this.dashboardUrl = dashboardUrl; this.clock = clock;
    }

    public CloudflareUsageResponse getUsage() {
        Instant now = clock.instant();
        synchronized (this) {
            UsagePeriod period = period(now);
            if (cache != null && now.isBefore(cache.expiresAt()) && cache.response().usagePeriodStart().equals(period.start())) {
                return cache.response();
            }
            CloudflareUsageResponse previous = cache != null && cache.response().usagePeriodStart().equals(period.start())
                    ? cache.response() : null;
            var response = refresh(now, period, previous);
            cache = new CacheEntry(response, now.plus(cacheDuration));
            return response;
        }
    }

    private CloudflareUsageResponse refresh(Instant now, UsagePeriod period, CloudflareUsageResponse previous) {
        // A fixed ingestion allowance is visible in the response; Analytics remains an estimate, not billing data.
        Instant cutoff = now.minusSeconds(900).truncatedTo(ChronoUnit.MINUTES);
        Map<Dataset, JsonNode> rows = new EnumMap<>(Dataset.class);
        if (enabled && client.isConfigured() && cutoff.isAfter(period.start())) {
            try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
                Map<Dataset, Future<JsonNode>> futures = new EnumMap<>(Dataset.class);
                for (Dataset dataset : Dataset.values()) {
                    futures.put(dataset, executor.submit(() -> client.queryDataset(dataset,
                            dataset.storage ? cutoff.minus(Duration.ofDays(2)) : period.start(), cutoff)));
                }
                for (var entry : futures.entrySet()) {
                    try { rows.put(entry.getKey(), entry.getValue().get()); }
                    catch (InterruptedException error) {
                        Thread.currentThread().interrupt();
                        break;
                    } catch (ExecutionException error) {
                        log.warn("Cloudflare metric unavailable: {}", entry.getKey());
                    }
                }
            }
        }

        List<CostMetric> metrics = new ArrayList<>();
        List<ResourceUsage> resources = new ArrayList<>();
        List<OperationUsage> operations = operations(rows.get(Dataset.R2));
        boolean r2Known = rows.get(Dataset.R2) != null && operations != null;
        metrics.add(counter("r2-a", "R2 Class A · 저장·목록", "R2", operationTotal(operations, "Standard", "A", r2Known),
                1_000_000, "requests", 1_000_000, 4.5, true, "$4.50 / 초과 100만 회 · 단위 올림", R2_URL, period, cutoff));
        metrics.add(counter("r2-b", "R2 Class B · 읽기·조회", "R2", operationTotal(operations, "Standard", "B", r2Known),
                10_000_000, "requests", 1_000_000, .36, true, "$0.36 / 초과 100만 회 · 단위 올림", R2_URL, period, cutoff));
        if (operations != null && operations.stream().anyMatch(o -> o.storageClass().equals("InfrequentAccess") && o.requests() > 0)) {
            metrics.add(counter("r2-ia-a", "R2 IA Class A", "R2", operationTotal(operations, "InfrequentAccess", "A", true),
                    0, "requests", 1_000_000, 9, true, "$9 / 100만 회 · 무료 포함량 없음", R2_URL, period, cutoff));
            metrics.add(counter("r2-ia-b", "R2 IA Class B", "R2", operationTotal(operations, "InfrequentAccess", "B", true),
                    0, "requests", 1_000_000, .9, true, "$0.90 / 100만 회 · 무료 포함량 없음", R2_URL, period, cutoff));
        }
        metrics.add(counter("workers-requests", "Workers 요청", "Workers", sum(rows.get(Dataset.WORKERS), "requests"),
                workersRequestIncluded, "requests", 1_000_000, .30, false, "$0.30 / 초과 100만 회", WORKERS_URL, period, cutoff));
        metrics.add(counter("workers-cpu", "Workers CPU 실행 시간", "Workers", scale(sum(rows.get(Dataset.WORKERS), "cpuTimeUs"), .001),
                30_000_000, "ms", 1_000_000, .02, false, "$0.02 / 초과 100만 ms", WORKERS_URL, period, cutoff));
        metrics.add(counter("d1-read", "D1 행 읽기", "D1", sum(rows.get(Dataset.D1), "rowsRead"),
                d1RowsReadIncluded, "rows", 1_000_000, .001, false, "$0.001 / 초과 100만 행", D1_URL, period, cutoff));
        metrics.add(counter("d1-write", "D1 행 쓰기", "D1", sum(rows.get(Dataset.D1), "rowsWritten"),
                50_000_000, "rows", 1_000_000, 1, false, "$1 / 초과 100만 행", D1_URL, period, cutoff));

        JsonNode r2Storage = rows.get(Dataset.R2_STORAGE), d1Storage = rows.get(Dataset.D1_STORAGE);
        Map<String, JsonNode> buckets = latest(r2Storage, "bucketName", true);
        Map<String, JsonNode> databases = latest(d1Storage, "databaseId", false);
        metrics.add(stock("r2-storage", "R2 Standard 현재 저장량", "R2", storageSum(buckets, "Standard", true),
                r2StorageByteIncluded, "10 GB-month 포함 · 초과 $0.015 / GB-month", R2_URL, storageObserved(buckets, "Standard")));
        if (buckets != null && storageSum(buckets, "InfrequentAccess", true) != null
                && storageSum(buckets, "InfrequentAccess", true) > 0) {
            metrics.add(stock("r2-ia-storage", "R2 IA 현재 저장량", "R2", storageSum(buckets, "InfrequentAccess", true),
                    0, "$0.01 / GB-month + 조회 $0.01 / GB · 최소 30일 보관 과금", R2_URL, storageObserved(buckets, "InfrequentAccess")));
        }
        metrics.add(stock("d1-storage", "D1 현재 저장량", "D1", storageSum(databases, null, false),
                5_000_000_000L, "5 GB 포함 · 초과 $0.75 / GB-month", D1_URL, storageObserved(databases, null)));
        Double websocketMessages = sum(rows.get(Dataset.DO_TIME), "inboundWebsocketMsgCount");
        Double doRequests = websocketMessages != null && websocketMessages == 0
                ? sum(rows.get(Dataset.DO_REQUESTS), "requests") : null;
        metrics.add(counter("do-requests", "Durable Objects 요청", "Durable Objects", doRequests,
                1_000_000, "requests", 1_000_000, .15, true, "$0.15 / 초과 100만 회 · 단위 올림", DO_URL, period, cutoff));
        metrics.add(counter("do-duration", "Durable Objects 실행량", "Durable Objects", sum(rows.get(Dataset.DO_TIME), "duration"),
                400_000, "GB-s", 1_000_000, 12.5, true, "$12.50 / 초과 100만 GB-s · 단위 올림", DO_URL, period, cutoff));
        metrics.add(unknown("workers-logs", "Workers Logs 수집량", "Workers", "로그 수집 설정이 있습니다. 별도 과금 지표 연동 전에는 비용을 계산하지 않습니다.", WORKERS_URL));
        metrics.add(unknown("do-storage", "Durable Objects 저장·행 사용량", "Durable Objects",
                "SQLite/KV 저장소별 과금 집계는 추가 연동이 필요합니다. 요청·실행량에는 포함되지 않습니다.", DO_URL));

        addResources(resources, rows.get(Dataset.WORKERS), rows.get(Dataset.D1), rows.get(Dataset.R2), buckets, databases);
        // Retain last good per-meter values only inside the same billing period. Stale values are never priced.
        if (previous != null) {
            for (int i = 0; i < metrics.size(); i++) {
                CostMetric metric = metrics.get(i);
                if (metric.used() != null) continue;
                CostMetric old = previous.metrics().stream().filter(m -> m.id().equals(metric.id()) && m.used() != null).findFirst().orElse(null);
                if (old != null) metrics.set(i, new CostMetric(metric.id(), metric.label(), metric.service(), old.used(),
                        metric.included(), metric.unit(), "STALE", metric.periodKind(), null, null, null, metric.rateLabel(),
                        "조회 실패 · 마지막 성공값입니다. 현재 비용 계산에서 제외합니다.", metric.sourceUrl(), old.measuredAt()));
            }
        }
        int priced = (int) metrics.stream().filter(m -> m.estimatedOverageUsd() != null).count();
        Double subtotal = priced == 0 ? null : metrics.stream().filter(m -> m.estimatedOverageUsd() != null).mapToDouble(CostMetric::estimatedOverageUsd).sum();
        Double projected = priced == 0 || metrics.stream().filter(m -> m.estimatedOverageUsd() != null).anyMatch(m -> m.projectedOverageUsd() == null)
                ? null : metrics.stream().filter(m -> m.projectedOverageUsd() != null).mapToDouble(CostMetric::projectedOverageUsd).sum();
        boolean warn = metrics.stream().anyMatch(m -> m.status().equals("WARN") || m.status().equals("OVER"));
        boolean anyFresh = metrics.stream().anyMatch(m -> m.used() != null && !m.status().equals("STALE"));
        int unavailable = (int) metrics.stream().filter(m -> m.used() == null || m.status().equals("STALE")).count();
        String status = !anyFresh ? "UNAVAILABLE" : warn ? "WARN" : unavailable > 0 ? "PARTIAL" : "UP";
        String message = !anyFresh ? "이용량을 확인하지 못했습니다. 미확인 항목은 0으로 간주하지 않습니다."
                : warn ? "포함량 접근·초과 또는 청구 종료 시 초과가 예상되는 항목이 있습니다."
                : "조회된 항목 기준입니다. 미집계 비용과 예상액을 함께 확인하세요.";
        var summary = new CostSummary(subtotal, projected, 5, priced, metrics.size() - priced,
                "집계 가능한 항목의 초과액 소계입니다. Workers 기본요금 $5, 저장 GB-month, 로그·DO 저장 비용, 미분류 요청, 세금·할인·환율은 제외합니다. 계정 전체의 운영·미리보기·다른 앱을 포함합니다.");
        Instant lastSuccess = anyFresh ? now : previous == null ? null : previous.lastSuccessfulAt();
        return new CloudflareUsageResponse(anyFresh, status, planLabel, now, lastSuccess, period.start(),
                period.end().minus(Duration.ofDays(1)), dashboardUrl, legacy(metrics, "workers-requests", workersRequestIncluded, "requests"),
                legacy(metrics, "d1-read", d1RowsReadIncluded, "rows"), legacy(metrics, "r2-storage", r2StorageByteIncluded, "bytes"),
                message, List.copyOf(metrics), List.copyOf(resources), operations == null ? List.of() : operations, summary, cutoff);
    }

    private CostMetric counter(String id, String label, String service, Double used, double included, String unit,
            double billingUnit, double price, boolean rounding, String rate, String url, UsagePeriod period, Instant cutoff) {
        Double projected = CloudflareCostCalculator.project(used, period.start(), cutoff, period.end());
        String status = used == null ? "UNAVAILABLE" : used > included ? "OVER"
                : (included > 0 && used >= included * .8) || (projected != null && projected > included) ? "WARN" : "OK";
        return new CostMetric(id, label, service, used, included, unit, status, "CYCLE",
                CloudflareCostCalculator.overage(used, included, billingUnit, price, rounding), projected,
                CloudflareCostCalculator.overage(projected, included, billingUnit, price, rounding), rate,
                "계정 전체 · Analytics 추정치. 종료 예상은 현재 주기 평균 속도를 유지한다는 가정이며 24시간 미만은 보류합니다."
                        + (id.equals("do-requests") ? " WebSocket 요청은 과금 환산을 확인할 때까지 보류합니다." : ""),
                url, used == null ? null : cutoff);
    }
    private CostMetric stock(String id, String label, String service, Double used, double included, String rate, String url, Instant cutoff) {
        return new CostMetric(id, label, service, used, included, "bytes",
                used == null ? "UNAVAILABLE" : included > 0 && used >= included ? "OVER" : included > 0 && used >= included * .8 ? "WARN" : "OK",
                "CURRENT", null, null, null, rate,
                "최근 48시간 내 저장소별 마지막 관측값의 합입니다. 현재 GB는 월 누적 GB-month가 아니므로 청구액 소계에 넣지 않습니다.",
                url, used == null ? null : cutoff);
    }
    private CostMetric unknown(String id, String label, String service, String note, String url) {
        return new CostMetric(id, label, service, null, 0, "unknown", "UNAVAILABLE", "UNMEASURED", null, null, null,
                "별도 과금 지표 확인 필요", note, url, null);
    }
    static Double sum(JsonNode rows, String field) {
        if (rows == null || !rows.isArray()) return null;
        double total = 0;
        for (JsonNode row : rows) {
            Double value = number(row.path("sum").path(field));
            if (value == null) return null;
            total += value;
        }
        return total;
    }
    private static Double number(JsonNode value) {
        if (!value.isNumber()) return null;
        double n = value.asDouble();
        return Double.isFinite(n) && n >= 0 ? n : null;
    }
    private static Double scale(Double value, double multiplier) { return value == null ? null : value * multiplier; }
    static List<OperationUsage> operations(JsonNode rows) {
        if (rows == null || !rows.isArray()) return null;
        Map<String, OperationUsage> result = new TreeMap<>();
        for (JsonNode row : rows) {
            var d = row.path("dimensions");
            String action = d.path("actionType").asText(""), storage = d.path("storageClass").asText("");
            Double count = number(row.path("sum").path("requests"));
            if (action.isBlank() || storage.isBlank() || count == null || !d.path("responseStatusCode").isNumber()) return null;
            int code = d.path("responseStatusCode").asInt();
            String category = billingClass(action, code);
            String key = storage + ":" + category + ":" + action;
            long former = result.containsKey(key) ? result.get(key).requests() : 0;
            result.put(key, new OperationUsage(action, storage, category, former + count.longValue()));
        }
        return List.copyOf(result.values());
    }
    static String billingClass(String action, int code) {
        return code == 401 || code == 403 || FREE.contains(action) ? "FREE"
                : CLASS_A.contains(action) ? "A" : CLASS_B.contains(action) ? "B" : "UNKNOWN";
    }
    private static Double operationTotal(List<OperationUsage> rows, String storage, String category, boolean known) {
        return !known ? null : (double) rows.stream().filter(o -> o.storageClass().equals(storage) && o.billingClass().equals(category)).mapToLong(OperationUsage::requests).sum();
    }
    private static Map<String, JsonNode> latest(JsonNode rows, String field, boolean storageClass) {
        if (rows == null || !rows.isArray() || rows.isEmpty()) return null;
        Map<String, JsonNode> result = new TreeMap<>();
        for (JsonNode row : rows) {
            String name = row.path("dimensions").path(field).asText(""), time = row.path("dimensions").path("datetime").asText("");
            if (name.isBlank() || time.isBlank()) return null;
            String key = name + (storageClass ? ":" + row.path("dimensions").path("storageClass").asText("") : "");
            JsonNode old = result.get(key);
            if (old == null || time.compareTo(old.path("dimensions").path("datetime").asText()) > 0) result.put(key, row);
        }
        return result;
    }
    private static Double storageSum(Map<String, JsonNode> rows, String storage, boolean r2) {
        if (rows == null) return null;
        double total = 0;
        for (JsonNode row : rows.values()) {
            if (storage != null && !storage.equals(row.path("dimensions").path("storageClass").asText())) continue;
            Double a = number(row.path("max").path(r2 ? "payloadSize" : "databaseSizeBytes"));
            Double b = r2 ? number(row.path("max").path("metadataSize")) : 0d;
            if (a == null || b == null) return null;
            total += a + b;
        }
        return total;
    }
    private static Instant storageObserved(Map<String, JsonNode> rows, String storage) {
        if (rows == null) return null;
        Instant oldest = null;
        for (JsonNode row : rows.values()) {
            if (storage != null && !storage.equals(row.path("dimensions").path("storageClass").asText())) continue;
            try {
                Instant time = Instant.parse(row.path("dimensions").path("datetime").asText());
                if (oldest == null || time.isBefore(oldest)) oldest = time;
            } catch (RuntimeException error) { return null; }
        }
        return oldest;
    }
    private static void addResources(List<ResourceUsage> out, JsonNode workers, JsonNode d1, JsonNode r2,
            Map<String, JsonNode> buckets, Map<String, JsonNode> databases) {
        if (workers != null) for (JsonNode row : workers) out.add(new ResourceUsage("Workers",
                row.path("dimensions").path("scriptName").asText(""), number(row.path("sum").path("requests")),
                scale(number(row.path("sum").path("cpuTimeUs")), .001), null, null, null, number(row.path("sum").path("errors"))));
        Set<String> usedDatabases = new HashSet<>();
        if (d1 != null) for (JsonNode row : d1) {
            String id = row.path("dimensions").path("databaseId").asText("");
            usedDatabases.add(id);
            out.add(new ResourceUsage("D1", id, null, null, number(row.path("sum").path("rowsRead")),
                    number(row.path("sum").path("rowsWritten")), databases == null || !databases.containsKey(id) ? null
                            : number(databases.get(id).path("max").path("databaseSizeBytes")), null));
        }
        if (databases != null) for (var entry : databases.entrySet()) {
            if (!usedDatabases.contains(entry.getKey())) out.add(new ResourceUsage("D1", entry.getKey(),
                    null, null, null, null, number(entry.getValue().path("max").path("databaseSizeBytes")), null));
        }
        Map<String, Double> bucketRequests = new TreeMap<>();
        if (r2 != null) for (JsonNode row : r2) {
            String name = row.path("dimensions").path("bucketName").asText("");
            String storage = row.path("dimensions").path("storageClass").asText("");
            Double count = number(row.path("sum").path("requests"));
            if (count != null) bucketRequests.merge((name.isBlank() ? "계정 공통 작업" : name) + " · " + storage, count, Double::sum);
        }
        if (buckets != null) for (JsonNode row : buckets.values()) {
            String storage = row.path("dimensions").path("storageClass").asText("");
            String name = row.path("dimensions").path("bucketName").asText("") + " · " + storage;
            Double a = number(row.path("max").path("payloadSize")), b = number(row.path("max").path("metadataSize"));
            out.add(new ResourceUsage("R2", name, bucketRequests.remove(name), null, null, null, a == null || b == null ? null : a + b, null));
        }
        bucketRequests.forEach((name, count) -> out.add(new ResourceUsage("R2", name, count, null, null, null, null, null)));
    }
    private UsageMetric legacy(List<CostMetric> metrics, String id, long included, String unit) {
        Double used = metrics.stream().filter(m -> m.id().equals(id)).findFirst().orElseThrow().used();
        return UsageMetric.of(used == null ? 0 : used.longValue(), included, unit);
    }
    private UsagePeriod period(Instant now) {
        LocalDate today = LocalDate.ofInstant(now, ZoneOffset.UTC);
        YearMonth month = YearMonth.from(today);
        LocalDate start = month.atDay(Math.min(billingCycleDay, month.lengthOfMonth()));
        if (today.isBefore(start)) { month = month.minusMonths(1); start = month.atDay(Math.min(billingCycleDay, month.lengthOfMonth())); }
        YearMonth next = month.plusMonths(1);
        return new UsagePeriod(start.atStartOfDay().toInstant(ZoneOffset.UTC),
                next.atDay(Math.min(billingCycleDay, next.lengthOfMonth())).atStartOfDay().toInstant(ZoneOffset.UTC));
    }
    private record CacheEntry(CloudflareUsageResponse response, Instant expiresAt) { }
    private record UsagePeriod(Instant start, Instant end) { }
}
