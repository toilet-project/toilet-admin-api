package com.example.toiletadmin.analytics.service;

import com.google.analytics.data.v1beta.BatchRunReportsRequest;
import com.google.analytics.data.v1beta.BatchRunReportsResponse;
import com.google.analytics.data.v1beta.BetaAnalyticsDataClient;
import com.google.analytics.data.v1beta.BetaAnalyticsDataSettings;
import com.google.analytics.data.v1beta.DateRange;
import com.google.analytics.data.v1beta.Dimension;
import com.google.analytics.data.v1beta.Metric;
import com.google.analytics.data.v1beta.PropertyQuota;
import com.google.analytics.data.v1beta.Row;
import com.google.analytics.data.v1beta.RunRealtimeReportRequest;
import com.google.analytics.data.v1beta.RunRealtimeReportResponse;
import com.google.analytics.data.v1beta.RunReportRequest;
import com.google.analytics.data.v1beta.RunReportResponse;
import com.google.api.gax.core.FixedCredentialsProvider;
import com.google.auth.oauth2.GoogleCredentials;
import com.example.toiletadmin.analytics.dto.GoogleAnalyticsReportResponse.AnalyticsData;
import com.example.toiletadmin.analytics.dto.GoogleAnalyticsReportResponse.DimensionRow;
import com.example.toiletadmin.analytics.dto.GoogleAnalyticsReportResponse.RealtimeMetrics;
import com.example.toiletadmin.analytics.dto.GoogleAnalyticsReportResponse.SummaryMetrics;
import com.example.toiletadmin.analytics.dto.GoogleAnalyticsReportResponse.TrendPoint;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class GoogleAnalyticsDataClient implements GoogleAnalyticsGateway, DisposableBean {

    private static final String ANALYTICS_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
    private final boolean enabled;
    private final String propertyId;
    private final String credentialsFile;
    private volatile BetaAnalyticsDataClient client;

    public GoogleAnalyticsDataClient(
            @Value("${google.analytics.enabled:false}") boolean enabled,
            @Value("${google.analytics.property-id:}") String propertyId,
            @Value("${google.analytics.credentials-file:}") String credentialsFile
    ) {
        this.enabled = enabled;
        this.propertyId = propertyId == null ? "" : propertyId.trim().replaceFirst("^properties/", "");
        this.credentialsFile = credentialsFile == null ? "" : credentialsFile.trim();
    }

    @Override
    public boolean isConfigured() {
        return enabled && !propertyId.isBlank() && !credentialsFile.isBlank();
    }

    @Override
    public String propertyHash() {
        if (propertyId.isBlank()) return "0".repeat(64);
        try {
            byte[] value = MessageDigest.getInstance("SHA-256").digest(propertyId.getBytes(StandardCharsets.UTF_8));
            return java.util.HexFormat.of().formatHex(value);
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }

    @Override
    public FetchResult<AnalyticsData> fetchReport(AnalyticsDateRange range) {
        BatchRunReportsResponse primary = dataClient().batchRunReports(BatchRunReportsRequest.newBuilder()
                .setProperty(propertyName())
                .addRequests(summaryRequest(range))
                .addRequests(request(range, List.of("date"), List.of(
                        "activeUsers", "newUsers", "sessions", "screenPageViews", "keyEvents"), 100))
                .addRequests(request(range, List.of("pagePath", "pageTitle"), List.of(
                        "screenPageViews", "activeUsers", "userEngagementDuration", "keyEvents"), 50))
                .addRequests(request(range, List.of("sessionDefaultChannelGroup"), List.of(
                        "sessions", "activeUsers", "keyEvents"), 30))
                .addRequests(request(range, List.of("sessionSourceMedium"), List.of(
                        "sessions", "activeUsers", "keyEvents"), 30))
                .build());

        BatchRunReportsResponse audience = dataClient().batchRunReports(BatchRunReportsRequest.newBuilder()
                .setProperty(propertyName())
                .addRequests(request(range, List.of("deviceCategory"), List.of("activeUsers", "sessions"), 20))
                .addRequests(request(range, List.of("operatingSystem"), List.of("activeUsers", "sessions"), 30))
                .addRequests(request(range, List.of("browser"), List.of("activeUsers", "sessions"), 30))
                .addRequests(request(range, List.of("country"), List.of("activeUsers", "sessions"), 50))
                .addRequests(request(range, List.of("city"), List.of("activeUsers", "sessions"), 50))
                .build());

        BatchRunReportsResponse behavior = dataClient().batchRunReports(BatchRunReportsRequest.newBuilder()
                .setProperty(propertyName())
                .addRequests(request(range, List.of("eventName"), List.of("eventCount", "totalUsers", "keyEvents"), 100))
                .build());

        List<RunReportResponse> p = primary.getReportsList();
        List<RunReportResponse> a = audience.getReportsList();
        RunReportResponse summaryReport = reportAt(p, 0);
        SummaryMetrics current = summary(summaryReport, "current");
        SummaryMetrics previous = summary(summaryReport, "previous");
        Double change = previous.activeUsers() == 0 ? null
                : (current.activeUsers() - previous.activeUsers()) * 100.0 / previous.activeUsers();
        AnalyticsData data = new AnalyticsData(
                current,
                previous,
                change,
                RealtimeMetrics.empty(),
                trend(reportAt(p, 1)),
                topRows(reportAt(p, 2), List.of("pagePath", "pageTitle"), "screenPageViews"),
                topRows(reportAt(p, 3), List.of("sessionDefaultChannelGroup"), "sessions"),
                topRows(reportAt(p, 4), List.of("sessionSourceMedium"), "sessions"),
                topRows(reportAt(a, 0), List.of("deviceCategory"), "activeUsers"),
                topRows(reportAt(a, 1), List.of("operatingSystem"), "activeUsers"),
                topRows(reportAt(a, 2), List.of("browser"), "activeUsers"),
                topRows(reportAt(a, 3), List.of("country"), "activeUsers"),
                topRows(reportAt(a, 4), List.of("city"), "activeUsers"),
                topRows(reportAt(behavior.getReportsList(), 0), List.of("eventName"), "eventCount")
        );
        Map<String, Integer> quota = quota(reportAt(p, 0).getPropertyQuota());
        return new FetchResult<>(data, quota);
    }

    @Override
    public FetchResult<RealtimeMetrics> fetchRealtime() {
        RunRealtimeReportResponse response = dataClient().runRealtimeReport(RunRealtimeReportRequest.newBuilder()
                .setProperty(propertyName())
                .addMetrics(metric("activeUsers"))
                .addMetrics(metric("screenPageViews"))
                .addMetrics(metric("eventCount"))
                .addMetrics(metric("keyEvents"))
                .setReturnPropertyQuota(true)
                .build());
        Row row = response.getRowsList().isEmpty() ? Row.getDefaultInstance() : response.getRows(0);
        RealtimeMetrics data = new RealtimeMetrics(value(row, 0), value(row, 1), value(row, 2), value(row, 3));
        return new FetchResult<>(data, quota(response.getPropertyQuota()));
    }

    private RunReportRequest summaryRequest(AnalyticsDateRange range) {
        return RunReportRequest.newBuilder()
                .addDateRanges(DateRange.newBuilder().setName("current").setStartDate(range.start().toString())
                        .setEndDate(range.end().toString()).build())
                .addDateRanges(DateRange.newBuilder().setName("previous").setStartDate(range.previousStart().toString())
                        .setEndDate(range.previousEnd().toString()).build())
                .addMetrics(metric("activeUsers"))
                .addMetrics(metric("newUsers"))
                .addMetrics(metric("sessions"))
                .addMetrics(metric("screenPageViews"))
                .addMetrics(metric("engagedSessions"))
                .addMetrics(metric("keyEvents"))
                .addMetrics(metric("userEngagementDuration"))
                .setReturnPropertyQuota(true)
                .build();
    }

    private RunReportRequest request(AnalyticsDateRange range, List<String> dimensions, List<String> metrics, int limit) {
        RunReportRequest.Builder builder = RunReportRequest.newBuilder()
                .addDateRanges(DateRange.newBuilder().setStartDate(range.start().toString())
                        .setEndDate(range.end().toString()).build())
                .setLimit(limit)
                .setReturnPropertyQuota(true);
        dimensions.forEach(value -> builder.addDimensions(Dimension.newBuilder().setName(value).build()));
        metrics.forEach(value -> builder.addMetrics(metric(value)));
        return builder.build();
    }

    private Metric metric(String name) {
        return Metric.newBuilder().setName(name).build();
    }

    private SummaryMetrics summary(RunReportResponse response, String dateRangeName) {
        int rowIndex = 0;
        if (response.getRowsCount() > 1) {
            for (int index = 0; index < response.getRowsCount(); index++) {
                if (dateRangeName.equals(response.getRows(index).getDimensionValues(0).getValue())) {
                    rowIndex = index;
                    break;
                }
            }
        } else if ("previous".equals(dateRangeName) && response.getRowsCount() < 2) {
            return SummaryMetrics.empty();
        }
        if (response.getRowsCount() == 0) return SummaryMetrics.empty();
        Row row = response.getRows(rowIndex);
        long active = value(row, 0);
        long sessions = value(row, 2);
        long engaged = value(row, 4);
        double duration = decimal(row, 6);
        return new SummaryMetrics(active, value(row, 1), sessions, value(row, 3), engaged, value(row, 5),
                sessions == 0 ? 0 : engaged * 1.0 / sessions,
                active == 0 ? 0 : duration / active);
    }

    private List<TrendPoint> trend(RunReportResponse response) {
        List<TrendPoint> result = new ArrayList<>();
        for (Row row : response.getRowsList()) {
            String raw = row.getDimensionValues(0).getValue();
            String date = raw != null && raw.matches("\\d{8}")
                    ? raw.substring(0, 4) + "-" + raw.substring(4, 6) + "-" + raw.substring(6) : raw;
            result.add(new TrendPoint(date, value(row, 0), value(row, 1), value(row, 2), value(row, 3), value(row, 4)));
        }
        result.sort(Comparator.comparing(TrendPoint::date));
        return List.copyOf(result);
    }

    private List<DimensionRow> topRows(RunReportResponse response, List<String> dimensions, String primaryMetric) {
        Map<String, Integer> metricIndexes = indexes(response.getMetricHeadersList().stream().map(header -> header.getName()).toList());
        List<DimensionRow> result = new ArrayList<>();
        for (Row row : response.getRowsList()) {
            String key = row.getDimensionValuesCount() > 0 ? clean(row.getDimensionValues(0).getValue()) : "(not set)";
            String second = row.getDimensionValuesCount() > 1 ? clean(row.getDimensionValues(1).getValue()) : "";
            String label = dimensions.contains("pageTitle") && !second.isBlank() && !"(not set)".equals(second) ? second : key;
            String detail = dimensions.contains("pageTitle") ? key : second;
            long active = metric(row, metricIndexes, "activeUsers");
            long views = metric(row, metricIndexes, "screenPageViews");
            long sessions = metric(row, metricIndexes, "sessions");
            long events = metric(row, metricIndexes, "eventCount");
            long keyEvents = metric(row, metricIndexes, "keyEvents");
            double duration = metricDecimal(row, metricIndexes, "userEngagementDuration");
            result.add(new DimensionRow(key, label, detail, active, views, sessions, events, keyEvents,
                    active == 0 ? 0 : duration / active));
        }
        result.sort(Comparator.comparingLong((DimensionRow row) -> switch (primaryMetric) {
            case "screenPageViews" -> row.views();
            case "sessions" -> row.sessions();
            case "eventCount" -> row.eventCount();
            default -> row.activeUsers();
        }).reversed());
        return List.copyOf(result.stream().limit(12).toList());
    }

    private Map<String, Integer> indexes(List<String> names) {
        Map<String, Integer> result = new HashMap<>();
        for (int index = 0; index < names.size(); index++) result.put(names.get(index), index);
        return result;
    }

    private long metric(Row row, Map<String, Integer> indexes, String name) {
        Integer index = indexes.get(name);
        return index == null ? 0 : value(row, index);
    }

    private double metricDecimal(Row row, Map<String, Integer> indexes, String name) {
        Integer index = indexes.get(name);
        return index == null ? 0 : decimal(row, index);
    }

    private long value(Row row, int index) {
        return Math.round(decimal(row, index));
    }

    private double decimal(Row row, int index) {
        if (index < 0 || index >= row.getMetricValuesCount()) return 0;
        try {
            return Double.parseDouble(row.getMetricValues(index).getValue());
        } catch (NumberFormatException exception) {
            return 0;
        }
    }

    private String clean(String value) {
        return value == null || value.isBlank() ? "(not set)" : value;
    }

    private RunReportResponse reportAt(List<RunReportResponse> reports, int index) {
        return reports.size() > index ? reports.get(index) : RunReportResponse.getDefaultInstance();
    }

    private Map<String, Integer> quota(PropertyQuota value) {
        if (value == null || PropertyQuota.getDefaultInstance().equals(value)) return Map.of();
        Map<String, Integer> result = new LinkedHashMap<>();
        result.put("tokensPerDay", value.getTokensPerDay().getRemaining());
        result.put("tokensPerHour", value.getTokensPerHour().getRemaining());
        result.put("concurrentRequests", value.getConcurrentRequests().getRemaining());
        result.put("serverErrorsPerProjectPerHour", value.getServerErrorsPerProjectPerHour().getRemaining());
        return Map.copyOf(result);
    }

    private String propertyName() {
        return "properties/" + propertyId;
    }

    private BetaAnalyticsDataClient dataClient() {
        if (!isConfigured()) throw new IllegalStateException("Google Analytics Data API is not configured");
        BetaAnalyticsDataClient current = client;
        if (current != null) return current;
        synchronized (this) {
            if (client != null) return client;
            Path path = Path.of(credentialsFile).toAbsolutePath().normalize();
            if (!Files.isRegularFile(path)) throw new IllegalStateException("Google Analytics credentials file is unavailable");
            try (InputStream input = Files.newInputStream(path)) {
                GoogleCredentials credentials = GoogleCredentials.fromStream(input).createScoped(ANALYTICS_SCOPE);
                BetaAnalyticsDataSettings settings = BetaAnalyticsDataSettings.newBuilder()
                        .setCredentialsProvider(FixedCredentialsProvider.create(credentials))
                        .build();
                client = BetaAnalyticsDataClient.create(settings);
                return client;
            } catch (IOException exception) {
                throw new IllegalStateException("Google Analytics client initialization failed", exception);
            }
        }
    }

    @Override
    public void destroy() {
        BetaAnalyticsDataClient current = client;
        if (current != null) current.close();
    }
}
