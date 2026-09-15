package com.example.toiletadmin.analytics.dto;

import java.time.Instant;
import java.util.List;
import java.util.Map;

public record GoogleAnalyticsReportResponse(
        boolean available,
        String status,
        String range,
        Instant fetchedAt,
        Instant lastSuccessfulAt,
        boolean stale,
        String message,
        AnalyticsData data,
        Map<String, Integer> quotaRemaining
) {
    public static GoogleAnalyticsReportResponse unavailable(String status, String range, Instant now, String message) {
        return new GoogleAnalyticsReportResponse(false, status, range, now, null, false, message,
                AnalyticsData.empty(), Map.of());
    }

    public GoogleAnalyticsReportResponse asStale(String nextStatus, Instant now, String nextMessage) {
        return new GoogleAnalyticsReportResponse(false, nextStatus, range, now, lastSuccessfulAt, true, nextMessage,
                data, quotaRemaining);
    }

    public GoogleAnalyticsReportResponse withRealtime(RealtimeMetrics realtime) {
        return new GoogleAnalyticsReportResponse(available, status, range, fetchedAt, lastSuccessfulAt, stale,
                message, data.withRealtime(realtime), quotaRemaining);
    }

    public record AnalyticsData(
            SummaryMetrics current,
            SummaryMetrics previous,
            Double activeUsersChangePercent,
            RealtimeMetrics realtime,
            List<TrendPoint> trend,
            List<DimensionRow> pages,
            List<DimensionRow> channels,
            List<DimensionRow> sources,
            List<DimensionRow> devices,
            List<DimensionRow> operatingSystems,
            List<DimensionRow> browsers,
            List<DimensionRow> countries,
            List<DimensionRow> cities,
            List<DimensionRow> events
    ) {
        public static AnalyticsData empty() {
            return new AnalyticsData(SummaryMetrics.empty(), SummaryMetrics.empty(), null, RealtimeMetrics.empty(),
                    List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of());
        }

        public AnalyticsData withRealtime(RealtimeMetrics value) {
            return new AnalyticsData(current, previous, activeUsersChangePercent, value, trend, pages, channels,
                    sources, devices, operatingSystems, browsers, countries, cities, events);
        }
    }

    public record SummaryMetrics(
            long activeUsers,
            long newUsers,
            long sessions,
            long views,
            long engagedSessions,
            long keyEvents,
            double engagementRate,
            double averageEngagementSeconds
    ) {
        public static SummaryMetrics empty() {
            return new SummaryMetrics(0, 0, 0, 0, 0, 0, 0, 0);
        }
    }

    public record RealtimeMetrics(long activeUsers, long views, long events, long keyEvents) {
        public static RealtimeMetrics empty() {
            return new RealtimeMetrics(0, 0, 0, 0);
        }
    }

    public record TrendPoint(
            String date,
            long activeUsers,
            long newUsers,
            long sessions,
            long views,
            long keyEvents
    ) { }

    public record DimensionRow(
            String key,
            String label,
            String detail,
            long activeUsers,
            long views,
            long sessions,
            long eventCount,
            long keyEvents,
            double averageEngagementSeconds
    ) { }
}
