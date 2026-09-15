package com.example.toiletadmin.analytics.service;

import com.example.toiletadmin.analytics.dto.ServiceAnalyticsRealtimeResponse;
import com.example.toiletadmin.analytics.dto.ServiceAnalyticsReportResponse;
import com.example.toiletadmin.analytics.dto.ServiceAnalyticsReportResponse.AnalyticsData;
import com.example.toiletadmin.analytics.dto.ServiceAnalyticsReportResponse.RealtimeMetrics;
import com.example.toiletadmin.analytics.dto.ServiceAnalyticsReportResponse.TrendPoint;
import com.example.toiletadmin.analytics.dto.ServiceAnalyticsStatusResponse;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Service
public class ServiceAnalyticsService {

    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");
    private final ServiceAnalyticsRepository repository;
    private final Clock clock;

    @Autowired
    public ServiceAnalyticsService(ServiceAnalyticsRepository repository) {
        this(repository, Clock.systemUTC());
    }

    ServiceAnalyticsService(ServiceAnalyticsRepository repository, Clock clock) {
        this.repository = repository;
        this.clock = clock;
    }

    public ServiceAnalyticsReportResponse overview() {
        AnalyticsDateRange today = AnalyticsDateRange.resolve("today", null, null);
        ServiceAnalyticsReportResponse report = report(today);
        return report.withRealtime(realtime().data());
    }

    public ServiceAnalyticsReportResponse report(AnalyticsDateRange range) {
        Instant now = clock.instant();
        try {
            if (!repository.schemaReady()) return ServiceAnalyticsReportResponse.unavailable(
                    "NOT_CONFIGURED", range.label(), now, "자체 분석 저장소 배포를 기다리고 있습니다.");
            var current = repository.summary(range.start(), range.end());
            var previous = repository.summary(range.previousStart(), range.previousEnd());
            List<TrendPoint> trend = completeTrend(range.start(), range.end(), repository.trend(range.start(), range.end()));
            var data = new AnalyticsData(current, previous, change(current.activeUsers(), previous.activeUsers()),
                    RealtimeMetrics.empty(), trend,
                    repository.dimensions("PAGE", range.start(), range.end(), 7),
                    repository.dimensions("CHANNEL", range.start(), range.end(), 6),
                    repository.dimensions("SOURCE", range.start(), range.end(), 6),
                    repository.dimensions("DEVICE", range.start(), range.end(), 4),
                    repository.dimensions("OS", range.start(), range.end(), 6),
                    repository.dimensions("BROWSER", range.start(), range.end(), 6),
                    repository.dimensions("COUNTRY", range.start(), range.end(), 5),
                    repository.dimensions("CITY", range.start(), range.end(), 5),
                    repository.dimensions("EVENT_DETAIL", range.start(), range.end(), 8));
            Instant calculated = repository.lastCalculatedAt();
            String status = current.activeUsers() == 0 && current.views() == 0 ? "NO_DATA" : freshness(calculated, now);
            String message = "NO_DATA".equals(status) ? "선택한 기간에 수집된 이용 데이터가 없습니다."
                    : "급똥 서버에서 직접 집계한 이용 현황입니다.";
            return new ServiceAnalyticsReportResponse(true, status, range.label(), now, calculated,
                    "STALE".equals(status), message, data);
        } catch (RuntimeException exception) {
            return ServiceAnalyticsReportResponse.unavailable("QUERY_ERROR", range.label(), now,
                    "자체 분석 데이터를 조회하지 못했습니다.");
        }
    }

    public ServiceAnalyticsRealtimeResponse realtime() {
        Instant now = clock.instant();
        try {
            if (!repository.schemaReady()) return ServiceAnalyticsRealtimeResponse.unavailable(
                    "NOT_CONFIGURED", now, "자체 분석 저장소 배포를 기다리고 있습니다.");
            RealtimeMetrics data = repository.realtime(now.minus(Duration.ofMinutes(30)));
            Instant lastEvent = repository.lastEventAt();
            String status = data.events() == 0 ? "NO_DATA" : "UP";
            return new ServiceAnalyticsRealtimeResponse(true, status, now, lastEvent, false,
                    data.events() == 0 ? "최근 30분간 수집된 이벤트가 없습니다." : "최근 30분 실시간 집계입니다.", data);
        } catch (RuntimeException exception) {
            return ServiceAnalyticsRealtimeResponse.unavailable("QUERY_ERROR", now, "실시간 집계를 조회하지 못했습니다.");
        }
    }

    public ServiceAnalyticsStatusResponse status() {
        Instant now = clock.instant();
        try {
            if (!repository.schemaReady()) return new ServiceAnalyticsStatusResponse(false, "NOT_CONFIGURED", now,
                    null, null, nextDaily(now), "자체 분석 저장소 배포를 기다리고 있습니다.", 35, 14);
            Instant calculated = repository.lastCalculatedAt();
            Instant lastEvent = repository.lastEventAt();
            String status = calculated == null ? "WAITING_FOR_DATA" : freshness(calculated, now);
            String message = calculated == null ? "첫 일별 집계를 기다리고 있습니다."
                    : "개별 이벤트는 35일 보관하고 최근 14일을 매일 02:30에 다시 집계합니다.";
            return new ServiceAnalyticsStatusResponse(true, status, now, calculated, lastEvent, nextDaily(now),
                    message, 35, 14);
        } catch (RuntimeException exception) {
            return new ServiceAnalyticsStatusResponse(false, "QUERY_ERROR", now, null, null, nextDaily(now),
                    "자체 분석 저장소 상태를 확인하지 못했습니다.", 35, 14);
        }
    }

    private static Double change(long current, long previous) {
        if (previous == 0) return current == 0 ? null : 100d;
        return (current - previous) * 100d / previous;
    }

    private static String freshness(Instant value, Instant now) {
        return value != null && value.isAfter(now.minus(Duration.ofMinutes(15))) ? "UP" : "STALE";
    }

    private static Instant nextDaily(Instant now) {
        ZonedDateTime current = now.atZone(SEOUL);
        ZonedDateTime next = current.toLocalDate().atTime(2, 30).atZone(SEOUL);
        if (!next.isAfter(current)) next = next.plusDays(1);
        return next.toInstant();
    }

    private static List<TrendPoint> completeTrend(LocalDate start, LocalDate end, List<TrendPoint> rows) {
        Map<String, TrendPoint> indexed = new LinkedHashMap<>();
        rows.forEach(row -> indexed.put(row.date(), row));
        List<TrendPoint> result = new ArrayList<>();
        for (LocalDate date = start; !date.isAfter(end); date = date.plusDays(1)) {
            result.add(indexed.getOrDefault(date.toString(), new TrendPoint(date.toString(), 0, 0, 0, 0, 0)));
        }
        return result;
    }
}
