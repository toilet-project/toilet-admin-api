package com.example.toiletadmin.analytics.service;

import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;

public record AnalyticsDateRange(
        String label,
        LocalDate start,
        LocalDate end,
        LocalDate previousStart,
        LocalDate previousEnd,
        String cacheKey,
        boolean persistent
) {
    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");

    public static AnalyticsDateRange resolve(String value, String from, String to) {
        LocalDate today = LocalDate.now(SEOUL);
        String range = value == null || value.isBlank() ? "7d" : value.trim().toLowerCase();
        if ("today".equals(range) || "1d".equals(range)) return fixed("today", today, today, "OVERVIEW_TODAY");
        if ("30d".equals(range)) return fixed("30d", today.minusDays(29), today, "DETAIL_30D");
        if ("custom".equals(range)) {
            LocalDate start = LocalDate.parse(from);
            LocalDate end = LocalDate.parse(to);
            long days = ChronoUnit.DAYS.between(start, end) + 1;
            if (days < 1 || days > 93 || end.isAfter(today)) throw new IllegalArgumentException("조회 기간은 오늘까지 최대 93일입니다.");
            LocalDate previousEnd = start.minusDays(1);
            return new AnalyticsDateRange("custom", start, end, previousEnd.minusDays(days - 1), previousEnd,
                    "CUSTOM_" + start + "_" + end, false);
        }
        return fixed("7d", today.minusDays(6), today, "DETAIL_7D");
    }

    private static AnalyticsDateRange fixed(String label, LocalDate start, LocalDate end, String key) {
        long days = ChronoUnit.DAYS.between(start, end) + 1;
        LocalDate previousEnd = start.minusDays(1);
        return new AnalyticsDateRange(label, start, end, previousEnd.minusDays(days - 1), previousEnd, key, true);
    }
}
