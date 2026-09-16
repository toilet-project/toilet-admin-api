package com.example.toiletadmin.analytics.dto;

import java.time.Instant;

public record ServiceAnalyticsStatusResponse(
        boolean configured,
        String status,
        Instant checkedAt,
        Instant lastAttemptAt,
        Instant lastSuccessfulAt,
        Instant nextScheduledAt,
        String message,
        int rawEventRetentionDays,
        int correctionWindowDays
) { }
