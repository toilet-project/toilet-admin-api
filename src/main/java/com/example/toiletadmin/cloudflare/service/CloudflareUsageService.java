package com.example.toiletadmin.cloudflare.service;

import com.example.toiletadmin.cloudflare.dto.CloudflareUsageResponse;
import com.example.toiletadmin.cloudflare.dto.CloudflareUsageResponse.UsageMetric;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
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
    private final long workersDailyLimit;
    private final long d1RowsReadDailyLimit;
    private final long r2StorageByteLimit;
    private final String dashboardUrl;
    private final Clock clock;
    private volatile CacheEntry cache;
    private volatile CloudflareUsageResponse lastSuccessfulUsage;

    @Autowired
    public CloudflareUsageService(
            CloudflareAnalyticsClient client,
            @Value("${cloudflare.analytics.enabled:false}") boolean enabled,
            @Value("${cloudflare.analytics.cache-seconds:300}") long cacheSeconds,
            @Value("${cloudflare.analytics.workers-daily-limit:100000}") long workersDailyLimit,
            @Value("${cloudflare.analytics.d1-rows-read-daily-limit:5000000}") long d1RowsReadDailyLimit,
            @Value("${cloudflare.analytics.r2-storage-byte-limit:10737418240}") long r2StorageByteLimit,
            @Value("${cloudflare.analytics.dashboard-url:https://dash.cloudflare.com/}") String dashboardUrl
    ) {
        this(client, enabled, cacheSeconds, workersDailyLimit, d1RowsReadDailyLimit,
                r2StorageByteLimit, dashboardUrl, Clock.systemUTC());
    }

    CloudflareUsageService(
            CloudflareAnalyticsClient client,
            boolean enabled,
            long cacheSeconds,
            long workersDailyLimit,
            long d1RowsReadDailyLimit,
            long r2StorageByteLimit,
            String dashboardUrl,
            Clock clock
    ) {
        this.client = client;
        this.enabled = enabled;
        this.cacheDuration = Duration.ofSeconds(Math.max(cacheSeconds, 30));
        this.workersDailyLimit = workersDailyLimit;
        this.d1RowsReadDailyLimit = d1RowsReadDailyLimit;
        this.r2StorageByteLimit = r2StorageByteLimit;
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
        Instant dailyResetAt = nextUtcMidnight(now);
        if (!enabled || !client.isConfigured()) {
            return unavailable(now, dailyResetAt, "Cloudflare Analytics 연동 설정이 필요합니다.");
        }
        try {
            LocalDate utcDate = LocalDate.ofInstant(now, ZoneOffset.UTC);
            Instant dayStart = utcDate.atStartOfDay().toInstant(ZoneOffset.UTC);
            JsonNode root = client.query(dayStart, now, utcDate, now.minus(Duration.ofDays(2)));
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
            UsageMetric workersMetric = UsageMetric.of(workers, workersDailyLimit, "requests");
            UsageMetric d1Metric = UsageMetric.of(d1RowsRead, d1RowsReadDailyLimit, "rows");
            UsageMetric r2Metric = UsageMetric.of(r2StorageBytes, r2StorageByteLimit, "bytes");
            int maximum = Math.max(workersMetric.usedPercent(), Math.max(d1Metric.usedPercent(), r2Metric.usedPercent()));
            String status = maximum >= 100 ? "DOWN" : maximum >= 80 ? "WARN" : "UP";
            String message = maximum >= 100 ? "한도에 도달한 항목이 있습니다."
                    : maximum >= 80 ? "한도의 80% 이상 사용한 항목이 있습니다."
                    : "모든 항목이 한도의 80% 미만입니다.";
            CloudflareUsageResponse response = new CloudflareUsageResponse(true, status, now, now, dailyResetAt, dashboardUrl,
                    workersMetric, d1Metric, r2Metric, message);
            lastSuccessfulUsage = response;
            return response;
        } catch (RuntimeException exception) {
            log.warn("Cloudflare Analytics usage lookup failed: {}", exception.getClass().getSimpleName());
            return unavailable(now, dailyResetAt, "Cloudflare 이용량을 확인하지 못했습니다.");
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

    private Instant nextUtcMidnight(Instant now) {
        return LocalDate.ofInstant(now, ZoneOffset.UTC).plusDays(1).atStartOfDay().toInstant(ZoneOffset.UTC);
    }

    private CloudflareUsageResponse unavailable(Instant now, Instant dailyResetAt, String message) {
        CloudflareUsageResponse previous = lastSuccessfulUsage;
        return new CloudflareUsageResponse(false, "UNAVAILABLE", now,
                previous == null ? null : previous.lastSuccessfulAt(), dailyResetAt, dashboardUrl,
                previous == null ? UsageMetric.of(0, workersDailyLimit, "requests") : previous.workersRequests(),
                previous == null ? UsageMetric.of(0, d1RowsReadDailyLimit, "rows") : previous.d1RowsRead(),
                previous == null ? UsageMetric.of(0, r2StorageByteLimit, "bytes") : previous.r2StorageBytes(),
                previous == null ? message : message + " 마지막 성공 조회값을 표시합니다.");
    }

    private record CacheEntry(CloudflareUsageResponse response, Instant expiresAt) { }
}
