package com.example.toiletadmin.analytics.dto;

import java.time.Instant;
import java.util.List;

public record ServiceAnalyticsReportResponse(
        boolean available,
        String status,
        String range,
        Instant fetchedAt,
        Instant lastSuccessfulAt,
        boolean stale,
        String message,
        AnalyticsData data
) {
    public static ServiceAnalyticsReportResponse unavailable(String status, String range, Instant now, String message) {
        return new ServiceAnalyticsReportResponse(false, status, range, now, null, false, message,
                AnalyticsData.empty());
    }

    public ServiceAnalyticsReportResponse asStale(String nextStatus, Instant now, String nextMessage) {
        return new ServiceAnalyticsReportResponse(false, nextStatus, range, now, lastSuccessfulAt, true, nextMessage,
                data);
    }

    public ServiceAnalyticsReportResponse withRealtime(RealtimeMetrics realtime) {
        return new ServiceAnalyticsReportResponse(available, status, range, fetchedAt, lastSuccessfulAt, stale,
                message, data.withRealtime(realtime));
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
