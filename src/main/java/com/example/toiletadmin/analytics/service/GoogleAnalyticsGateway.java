package com.example.toiletadmin.analytics.service;

import com.example.toiletadmin.analytics.dto.GoogleAnalyticsReportResponse.AnalyticsData;
import com.example.toiletadmin.analytics.dto.GoogleAnalyticsReportResponse.RealtimeMetrics;
import java.time.LocalDate;
import java.util.Map;

public interface GoogleAnalyticsGateway {
    boolean isConfigured();
    String propertyHash();
    FetchResult<AnalyticsData> fetchReport(AnalyticsDateRange range);
    FetchResult<RealtimeMetrics> fetchRealtime();
    FetchResult<DailyAnalyticsArchive> fetchDailyArchive(LocalDate start, LocalDate end);

    record FetchResult<T>(T data, Map<String, Integer> quotaRemaining) { }
}
