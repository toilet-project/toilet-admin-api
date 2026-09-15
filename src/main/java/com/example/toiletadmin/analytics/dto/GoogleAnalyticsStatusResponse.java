package com.example.toiletadmin.analytics.dto;

import java.time.Instant;
import java.util.Map;

public record GoogleAnalyticsStatusResponse(
        boolean configured,
        String status,
        Instant checkedAt,
        Instant lastAttemptAt,
        Instant lastSuccessfulAt,
        Instant nextScheduledAt,
        String message,
        String dashboardUrl,
        Map<String, Integer> quotaRemaining
) { }
