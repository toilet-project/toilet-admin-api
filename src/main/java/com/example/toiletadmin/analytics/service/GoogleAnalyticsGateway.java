package com.example.toiletadmin.analytics.service;

import com.example.toiletadmin.analytics.dto.GoogleAnalyticsReportResponse.AnalyticsData;
import com.example.toiletadmin.analytics.dto.GoogleAnalyticsReportResponse.RealtimeMetrics;
import java.util.Map;

public interface GoogleAnalyticsGateway {
    boolean isConfigured();
    String propertyHash();
    FetchResult<AnalyticsData> fetchReport(AnalyticsDateRange range);
    FetchResult<RealtimeMetrics> fetchRealtime();

    record FetchResult<T>(T data, Map<String, Integer> quotaRemaining) { }
}
