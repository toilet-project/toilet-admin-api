package com.example.toiletadmin.cloudflare.service;

import com.example.toiletadmin.cloudflare.dto.CloudflareUsageResponse;
import com.example.toiletadmin.cloudflare.dto.CloudflareUsageResponse.UsageMetric;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.ZoneOffset;
import java.util.HashSet;
import java.util.Set;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;

@Slf4j
@Service
public class CloudflareUsageService {

    private final CloudflareAnalyticsClient client;
    private final boolean enabled;
    private final Duration cacheDuration;
    private final String planLabel;
    private final int billingCycleDay;
    private final long workersRequestIncluded;
    private final long d1RowsReadIncluded;
    private final long r2StorageByteIncluded;
    private final String dashboardUrl;
    private final Clock clock;
    private volatile CacheEntry cache;
    private volatile CloudflareUsageResponse lastSuccessfulUsage;

    @Autowired
    public CloudflareUsageService(
            CloudflareAnalyticsClient client,
            @Value("${cloudflare.analytics.enabled:false}") boolean enabled,
            @Value("${cloudflare.analytics.cache-seconds:300}") long cacheSeconds,
            @Value("${cloudflare.analytics.plan-label:Workers Paid}") String planLabel,
            @Value("${cloudflare.analytics.billing-cycle-day:29}") int billingCycleDay,
            @Value("${cloudflare.analytics.workers-request-included:10000000}") long workersRequestIncluded,
            @Value("${cloudflare.analytics.d1-rows-read-included:25000000000}") long d1RowsReadIncluded,
            @Value("${cloudflare.analytics.r2-storage-byte-included:10000000000}") long r2StorageByteIncluded,
            @Value("${cloudflare.analytics.dashboard-url:https://dash.cloudflare.com/}") String dashboardUrl
    ) {
        this(client, enabled, cacheSeconds, planLabel, billingCycleDay, workersRequestIncluded, d1RowsReadIncluded,
                r2StorageByteIncluded, dashboardUrl, Clock.systemUTC());
    }

    CloudflareUsageService(
            CloudflareAnalyticsClient client,
            boolean enabled,
            long cacheSeconds,
            String planLabel,
            int billingCycleDay,
            long workersRequestIncluded,
            long d1RowsReadIncluded,
            long r2StorageByteIncluded,
            String dashboardUrl,
            Clock clock
    ) {
        this.client = client;
        this.enabled = enabled;
        this.cacheDuration = Duration.ofSeconds(Math.max(cacheSeconds, 30));
        this.planLabel = planLabel;
        this.billingCycleDay = Math.max(1, Math.min(31, billingCycleDay));
        this.workersRequestIncluded = workersRequestIncluded;
        this.d1RowsReadIncluded = d1RowsReadIncluded;
        this.r2StorageByteIncluded = r2StorageByteIncluded;
        this.dashboardUrl = dashboardUrl;
        this.clock = clock;
    }

    public CloudflareUsageResponse getUsage() {
        Instant now = clock.instant();
        CacheEntry current = cache;
        if (current != null && now.isBefore(current.expiresAt())) return current.response();
        synchronized (this) {
            current = cache;
            if (current != null && now.isBefore(current.expiresAt())) return current.response();
            CloudflareUsageResponse response = refresh(now);
            cache = new CacheEntry(response, now.plus(cacheDuration));
            return response;
        }
    }

    private CloudflareUsageResponse refresh(Instant now) {
        UsagePeriod period = usagePeriod(now);
        if (!enabled || !client.isConfigured()) {
            return unavailable(now, period, "Cloudflare Analytics 연동 설정이 필요합니다.");
        }
        try {
            LocalDate periodStartDate = LocalDate.ofInstant(period.start(), ZoneOffset.UTC);
            LocalDate currentDate = LocalDate.ofInstant(now, ZoneOffset.UTC);
            JsonNode root = client.query(period.start(), now, periodStartDate, currentDate, now.minus(Duration.ofDays(2)));
            if (root == null || root.path("errors").size() > 0) {
                throw new IllegalStateException("Cloudflare GraphQL 응답에 오류가 포함되었습니다.");
            }
            JsonNode accounts = root.path("data").path("viewer").path("accounts");
            if (!accounts.isArray() || accounts.isEmpty()) {
                throw new IllegalStateException("Cloudflare 계정 분석 데이터를 찾지 못했습니다.");
            }
            JsonNode account = accounts.get(0);
            long workers = sum(account.path("workersInvocationsAdaptive"), "requests");
            long d1RowsRead = sum(account.path("d1AnalyticsAdaptiveGroups"), "rowsRead");
            long r2StorageBytes = latestStorageByBucket(account.path("r2StorageAdaptiveGroups"));
            UsageMetric workersMetric = UsageMetric.of(workers, workersRequestIncluded, "requests");
            UsageMetric d1Metric = UsageMetric.of(d1RowsRead, d1RowsReadIncluded, "rows");
            UsageMetric r2Metric = UsageMetric.of(r2StorageBytes, r2StorageByteIncluded, "bytes");
            int maximum = Math.max(workersMetric.usedPercent(), Math.max(d1Metric.usedPercent(), r2Metric.usedPercent()));
            String status = maximum >= 80 ? "WARN" : "UP";
            String message = maximum >= 100 ? "월 포함량을 초과한 항목이 있어 과금 여부를 확인해야 합니다."
                    : maximum >= 80 ? "월 포함량의 80% 이상 사용한 항목이 있습니다."
                    : "모든 항목이 월 포함량의 80% 미만입니다.";
            CloudflareUsageResponse response = new CloudflareUsageResponse(true, status, planLabel, now, now,
                    period.start(), period.end(), dashboardUrl,
                    workersMetric, d1Metric, r2Metric, message);
            lastSuccessfulUsage = response;
            return response;
        } catch (RuntimeException exception) {
            log.warn("Cloudflare Analytics usage lookup failed: {}", exception.getClass().getSimpleName());
            return unavailable(now, period, "Cloudflare 이용량을 확인하지 못했습니다.");
        }
    }

    private long sum(JsonNode rows, String field) {
        if (!rows.isArray()) return 0;
        long total = 0;
        for (JsonNode row : rows) total += numberValue(row.path("sum").path(field));
        return total;
    }

    private long latestStorageByBucket(JsonNode rows) {
        if (!rows.isArray()) return 0;
        Set<String> buckets = new HashSet<>();
        long total = 0;
        for (JsonNode row : rows) {
            JsonNode bucketNode = row.path("dimensions").path("bucketName");
            String bucket = bucketNode.isTextual() ? bucketNode.asText() : "";
            if (buckets.add(bucket)) {
                JsonNode maximum = row.path("max");
                total += numberValue(maximum.path("payloadSize")) + numberValue(maximum.path("metadataSize"));
            }
        }
        return total;
    }

    private long numberValue(JsonNode node) {
        return node.isNumber() ? node.asLong() : 0;
    }

    private UsagePeriod usagePeriod(Instant now) {
        LocalDate today = LocalDate.ofInstant(now, ZoneOffset.UTC);
        YearMonth month = YearMonth.from(today);
        LocalDate startDate = month.atDay(Math.min(billingCycleDay, month.lengthOfMonth()));
        if (today.isBefore(startDate)) {
            month = month.minusMonths(1);
            startDate = month.atDay(Math.min(billingCycleDay, month.lengthOfMonth()));
        }
        YearMonth nextMonth = month.plusMonths(1);
        LocalDate endDate = nextMonth.atDay(Math.min(billingCycleDay, nextMonth.lengthOfMonth())).minusDays(1);
        return new UsagePeriod(startDate.atStartOfDay().toInstant(ZoneOffset.UTC),
                endDate.atStartOfDay().toInstant(ZoneOffset.UTC));
    }

    private CloudflareUsageResponse unavailable(Instant now, UsagePeriod period, String message) {
        CloudflareUsageResponse previous = lastSuccessfulUsage;
        return new CloudflareUsageResponse(false, "UNAVAILABLE", planLabel, now,
                previous == null ? null : previous.lastSuccessfulAt(), period.start(), period.end(), dashboardUrl,
                previous == null ? UsageMetric.of(0, workersRequestIncluded, "requests") : previous.workersRequests(),
                previous == null ? UsageMetric.of(0, d1RowsReadIncluded, "rows") : previous.d1RowsRead(),
                previous == null ? UsageMetric.of(0, r2StorageByteIncluded, "bytes") : previous.r2StorageBytes(),
                previous == null ? message : message + " 마지막 성공 조회값을 표시합니다.");
    }

    private record CacheEntry(CloudflareUsageResponse response, Instant expiresAt) { }

    private record UsagePeriod(Instant start, Instant end) { }
}
