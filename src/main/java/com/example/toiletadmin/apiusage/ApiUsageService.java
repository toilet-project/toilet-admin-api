package com.example.toiletadmin.apiusage;

import static com.example.toiletadmin.apiusage.UsageModels.*;
import java.math.BigDecimal;
import java.time.*;
import java.util.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Service
public class ApiUsageService {
    private final UsageCatalog catalog;
    private final UsageSnapshotReader snapshots;
    private final GoogleUsageClient google;
    private final NaverUsageClient naver;
    private final Clock clock;
    private final Map<String, Snapshot> lastGood = new HashMap<>();
    private Report cached;

    @Autowired
    public ApiUsageService(UsageCatalog catalog, UsageSnapshotReader snapshots, GoogleUsageClient google, NaverUsageClient naver) {
        this(catalog, snapshots, google, naver, Clock.systemUTC());
    }
    ApiUsageService(UsageCatalog catalog, UsageSnapshotReader snapshots, GoogleUsageClient google, NaverUsageClient naver, Clock clock) {
        this.catalog = catalog; this.snapshots = snapshots; this.google = google; this.naver=naver; this.clock = clock;
    }
    public synchronized Report report() {
        Instant now = clock.instant();
        if (cached != null && now.isBefore(cached.checkedAt().plusSeconds(300))) return cached;
        var services = new ArrayList<ServiceUsage>();
        for (var service : catalog.get().services()) services.add(read(service, now));
        cached = new Report(now, catalog.get().verifiedAt(), services);
        return cached;
    }
    private ServiceUsage read(UsageModels.Service service, Instant now) {
        var month = YearMonth.from(now.atZone(ZoneId.of(service.timeZone())));
        Instant start = month.atDay(1).atStartOfDay(ZoneId.of(service.timeZone())).toInstant();
        Instant end = month.plusMonths(1).atDay(1).atStartOfDay(ZoneId.of(service.timeZone())).toInstant();
        String status = service.active() ? "unconfigured" : "inactive";
        String message = service.active() ? "사용량 연결이 필요합니다. 요금표와 예상 요금 계산은 이용할 수 있습니다." : "현재 사용하지 않는 서비스입니다.";
        Snapshot data = null;
        Snapshot reference = null;
        if (service.active()) {
            try {
                Snapshot supplied = snapshots.read(service.id());
                if (supplied != null && YearMonth.parse(supplied.month()).isBefore(month)) supplied = null;
                if (supplied != null && supplied.source().contains("콘솔 확인값")) {
                    validate(supplied, month.toString(), start, now, service);
                    reference = supplied;
                } else data = supplied;
                if (data == null) data = google.read(service, start, now);
                if (data == null) data = naver.read(service, start, now);
                if (data != null) {
                    validate(data, month.toString(), start, now, service);
                    lastGood.put(service.id(), data);
                    status = data.source().contains("콘솔 확인값") ? "manual" : "connected";
                    message = status.equals("manual") ? "공급자 콘솔에서 확인한 실제 수치입니다. 자동 갱신되지 않으며 마지막 확인 시각을 확인해 주세요."
                            : "최근 집계 기준입니다. 실제 청구 금액과 차이가 있을 수 있습니다.";
                } else if (reference != null) {
                    status = "reference-only";
                    message = "자동 집계가 연결되지 않았습니다. 콘솔 확인값은 참고자료에서 확인할 수 있습니다.";
                }
            } catch (GoogleUsageClient.NoUsageData | NaverUsageClient.NoUsageData ignored) {
                status = "no-data";
                message = "조회 연결은 정상이며 이 달의 요청 지표가 아직 없습니다. 사용량 0건을 의미하지는 않습니다.";
            } catch (Exception ignored) {
                // Provider responses and credential paths must not escape into public errors or logs.
                data = lastGood.get(service.id());
                if (data != null && !data.month().equals(month.toString())) data = null;
                status = data == null ? "error" : "stale";
                message = data == null ? "사용량을 읽지 못했습니다. 연결 권한과 집계 설정을 확인해 주세요." : "새 집계를 읽지 못해 마지막으로 확인한 수치를 표시합니다.";
            }
        }
        long staleMinutes=service.id().equals("naver") ? 4320 : data != null && data.source().contains("콘솔 확인값") ? 1440 : 120;
        if (data != null && Duration.between(data.asOf(), now).toMinutes() > staleMinutes) {
            status = "stale";
            message = "공급자별 정상 반영 시간을 넘겼습니다. 마지막 집계 시각을 확인해 주세요.";
        }
        var values = new ArrayList<MetricUsage>();
        for (Metric metric : service.metrics()) {
            Counter counter = data == null ? null : data.metrics().get(metric.id());
            Long used = counter == null ? null : counter.used();
            Long projected = used == null ? null : UsagePricing.project(used, start, end, data.asOf());
            boolean daily = metric.period().equals("day");
            Long overage = used == null ? null : metric.unlimited() ? Long.valueOf(0) : daily ? counter.billableUsed() : Long.valueOf(Math.max(0, used - metric.free()));
            BigDecimal cost = used == null ? null : daily ? (overage == null ? null : UsagePricing.cost(metric, overage, false)) : UsagePricing.cost(metric, used, true);
            Long billedProjection = overage == null || data == null ? null : UsagePricing.project(overage, start, end, data.asOf());
            BigDecimal projectedCost = projected == null ? null : daily ? (billedProjection == null ? null : UsagePricing.cost(metric, billedProjection, false)) : UsagePricing.cost(metric, projected, true);
            values.add(new MetricUsage(metric, used, projected, overage, cost, projectedCost));
        }
        if (data != null && values.stream().anyMatch(m -> m.used() == null) && status.equals("connected")) {
            status = "partial";
            message = "일부 항목만 집계되었습니다. 미집계 항목은 합계에서 제외됩니다.";
        }
        return new ServiceUsage(service, status, message, data == null ? null : data.source(),
                data == null ? null : data.scope(), data == null ? null : data.asOf(), start, end, values,
                data == null ? null : UsageBilling.calculate(data.billing(), start, end, now, ZoneId.of(service.timeZone())), reference);
    }
    static void validate(Snapshot data, String month, Instant start, Instant now, UsageModels.Service service) {
        if (!month.equals(data.month()) || data.asOf() == null || data.asOf().isBefore(start)
                || data.asOf().isAfter(now) || data.source() == null || data.source().isBlank()
                || data.scope() == null || data.scope().isBlank() || data.metrics() == null || data.metrics().isEmpty())
            throw new IllegalArgumentException("Invalid snapshot");
        for (var entry : data.metrics().entrySet()) {
            if (service.metrics().stream().noneMatch(m -> m.id().equals(entry.getKey()))) throw new IllegalArgumentException("Unknown metric");
            var value = entry.getValue();
            if (value == null || value.used() < 0 || value.used() > UsagePricing.MAX_QUANTITY
                    || value.billableUsed() != null && (value.billableUsed() < 0 || value.billableUsed() > value.used()))
                throw new IllegalArgumentException("Invalid counter");
        }
        UsageBilling.validate(data.billing(), start, now);
    }
    public Estimate estimate(String metricId, long quantity, boolean includeFree) {
        for (var service : catalog.get().services()) for (var metric : service.metrics()) {
            if (metric.id().equals(metricId)) return new Estimate(service.currency(), quantity,
                    metric.unlimited() ? quantity : includeFree ? Math.min(quantity, metric.free()) : 0,
                    metric.unlimited() ? 0 : Math.max(0, quantity - (includeFree ? metric.free() : 0)),
                    UsagePricing.cost(metric, quantity, includeFree), metric.period());
        }
        throw new IllegalArgumentException("Unknown metric");
    }
}
