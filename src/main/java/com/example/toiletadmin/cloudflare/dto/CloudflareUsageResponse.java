package com.example.toiletadmin.cloudflare.dto;

import java.time.Instant;

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
        String message
) {
    public record UsageMetric(long used, long limit, int usedPercent, String unit) {
        public static UsageMetric of(long used, long limit, String unit) {
            long rounded = limit <= 0 ? 0 : Math.round(used * 100.0 / limit);
            int percent = (int) Math.min(Integer.MAX_VALUE, rounded);
            return new UsageMetric(used, limit, percent, unit);
        }
    }
}
