package com.example.toiletadmin.analytics.dto;

import com.example.toiletadmin.analytics.dto.ServiceAnalyticsReportResponse.RealtimeMetrics;
import java.time.Instant;

public record ServiceAnalyticsRealtimeResponse(
        boolean available,
        String status,
        Instant fetchedAt,
        Instant lastSuccessfulAt,
        boolean stale,
        String message,
        RealtimeMetrics data
) {
    public static ServiceAnalyticsRealtimeResponse unavailable(String status, Instant now, String message) {
        return new ServiceAnalyticsRealtimeResponse(false, status, now, null, false, message,
                RealtimeMetrics.empty());
    }

    public ServiceAnalyticsRealtimeResponse asStale(String nextStatus, Instant now, String nextMessage) {
        return new ServiceAnalyticsRealtimeResponse(false, nextStatus, now, lastSuccessfulAt, true, nextMessage,
                data);
    }
}
