package com.example.toiletadmin.cloudflare.dto;

import java.time.Instant;
import java.util.List;

public record CloudflareUsageResponse(
        boolean available,
        String status,
        String planLabel,
        Instant checkedAt,
        Instant lastSuccessfulAt,
        Instant usagePeriodStart,
        Instant usagePeriodEnd,
        String dashboardUrl,
        UsageMetric workersRequests,
        UsageMetric d1RowsRead,
        UsageMetric r2StorageBytes,
        String message,
        List<CostMetric> metrics,
        List<ResourceUsage> resources,
        List<OperationUsage> r2Operations,
        CostSummary costSummary,
        Instant measurementEnd
) {
    public CloudflareUsageResponse(boolean available, String status, String planLabel, Instant checkedAt,
            Instant lastSuccessfulAt, Instant usagePeriodStart, Instant usagePeriodEnd, String dashboardUrl,
            UsageMetric workersRequests, UsageMetric d1RowsRead, UsageMetric r2StorageBytes, String message) {
        this(available, status, planLabel, checkedAt, lastSuccessfulAt, usagePeriodStart, usagePeriodEnd,
                dashboardUrl, workersRequests, d1RowsRead, r2StorageBytes, message,
                List.of(), List.of(), List.of(), null, checkedAt);
    }
    public record CostMetric(String id, String label, String service, Double used, double included,
            String unit, String status, String periodKind, Double estimatedOverageUsd,
            Double projectedUsage, Double projectedOverageUsd, String rateLabel, String note,
            String sourceUrl, Instant measuredAt) { }
    public record ResourceUsage(String service, String name, Double requests, Double cpuMs,
            Double rowsRead, Double rowsWritten, Double storageBytes, Double errors) { }
    public record OperationUsage(String action, String storageClass, String billingClass, long requests) { }
    public record CostSummary(Double observedSubtotalUsd, Double projectedSubtotalUsd, double baseFeeUsd,
            int pricedMetrics, int unpricedMetrics, String note) { }
    public record UsageMetric(long used, long limit, int usedPercent, String unit) {
        public static UsageMetric of(long used, long limit, String unit) {
            long rounded = limit <= 0 ? 0 : Math.round(used * 100.0 / limit);
            int percent = (int) Math.min(Integer.MAX_VALUE, rounded);
            return new UsageMetric(used, limit, percent, unit);
        }
    }
}
