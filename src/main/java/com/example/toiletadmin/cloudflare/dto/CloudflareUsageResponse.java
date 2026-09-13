package com.example.toiletadmin.cloudflare.dto;

import java.time.Instant;

public record CloudflareUsageResponse(
        boolean available,
        String status,
        Instant checkedAt,
        Instant lastSuccessfulAt,
        Instant dailyResetAt,
        String dashboardUrl,
        UsageMetric workersRequests,
        UsageMetric d1RowsRead,
        UsageMetric r2StorageBytes,
        String message
) {
    public record UsageMetric(long used, long limit, int usedPercent, String unit) {
        public static UsageMetric of(long used, long limit, String unit) {
            int percent = limit <= 0 ? 0 : (int) Math.min(100, Math.round(used * 100.0 / limit));
            return new UsageMetric(used, limit, percent, unit);
        }
    }
}
