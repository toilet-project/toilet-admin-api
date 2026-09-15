package com.example.toiletadmin.analytics.service;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

public record DailyAnalyticsArchive(
        List<DailySummary> summaries,
        List<DailyBreakdown> breakdowns,
        int apiRequestCount
) {
    public DailyAnalyticsArchive {
        summaries = List.copyOf(summaries);
        breakdowns = List.copyOf(breakdowns);
    }

    public int storedRowCount() {
        return summaries.size() + breakdowns.size();
    }

    public record DailySummary(LocalDate reportDate, ArchiveMetrics metrics) { }

    public record DailyBreakdown(
            LocalDate reportDate,
            BreakdownType type,
            String value,
            String label,
            String detail,
            ArchiveMetrics metrics
    ) { }

    public enum BreakdownType {
        PAGE,
        CHANNEL,
        SOURCE_MEDIUM,
        DEVICE,
        OS,
        BROWSER,
        COUNTRY,
        CITY,
        EVENT
    }

    public record ArchiveMetrics(
            long activeUsers,
            long totalUsers,
            long newUsers,
            long sessions,
            long engagedSessions,
            long views,
            long eventCount,
            BigDecimal keyEvents,
            BigDecimal engagementSeconds
    ) {
        public static ArchiveMetrics empty() {
            return new ArchiveMetrics(0, 0, 0, 0, 0, 0, 0, BigDecimal.ZERO, BigDecimal.ZERO);
        }
    }
}
