package com.example.toiletadmin.analytics.dto;

import com.example.toiletadmin.analytics.dto.GoogleAnalyticsReportResponse.RealtimeMetrics;
import java.time.Instant;
import java.util.Map;

public record GoogleAnalyticsRealtimeResponse(
        boolean available,
        String status,
        Instant fetchedAt,
        Instant lastSuccessfulAt,
        boolean stale,
        String message,
        RealtimeMetrics data,
        Map<String, Integer> quotaRemaining
) {
    public static GoogleAnalyticsRealtimeResponse unavailable(String status, Instant now, String message) {
        return new GoogleAnalyticsRealtimeResponse(false, status, now, null, false, message,
                RealtimeMetrics.empty(), Map.of());
    }

    public GoogleAnalyticsRealtimeResponse asStale(String nextStatus, Instant now, String nextMessage) {
        return new GoogleAnalyticsRealtimeResponse(false, nextStatus, now, lastSuccessfulAt, true, nextMessage,
                data, quotaRemaining);
    }
}
