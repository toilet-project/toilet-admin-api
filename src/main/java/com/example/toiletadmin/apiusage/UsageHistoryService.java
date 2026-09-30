package com.example.toiletadmin.apiusage;

import static com.example.toiletadmin.apiusage.UsageModels.*;
import java.time.*;
import java.util.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

@Service
public class UsageHistoryService {
    public record Month(String month,String status,String message,Instant asOf,String source,String scope,Map<String,Counter> metrics) {}
    public record History(String serviceId,Instant checkedAt,List<Month> months) {}
    private final UsageCatalog catalog;
    private final UsageSnapshotReader snapshots;
    private final GoogleUsageClient google;
    private final NaverUsageClient naver;
    private final UsageHistoryStore store;
    private final Clock clock;
    private final Map<String,History> cache=new HashMap<>();
    @Autowired
    public UsageHistoryService(UsageCatalog catalog,UsageSnapshotReader snapshots,GoogleUsageClient google,NaverUsageClient naver,UsageHistoryStore store) {
        this(catalog,snapshots,google,naver,store,Clock.systemUTC());
    }
    UsageHistoryService(UsageCatalog catalog,UsageSnapshotReader snapshots,GoogleUsageClient google,NaverUsageClient naver,UsageHistoryStore store,Clock clock) {
        this.catalog=catalog; this.snapshots=snapshots; this.google=google; this.naver=naver; this.store=store; this.clock=clock;
    }
    public synchronized History history(String id) {
        var service=catalog.get().services().stream().filter(s->s.id().equals(id)).findFirst().orElseThrow(IllegalArgumentException::new);
        Instant now=clock.instant();
        var month=YearMonth.from(now.atZone(ZoneId.of(service.timeZone())));
        var cached=cache.get(id);
        if(cached!=null && now.isBefore(cached.checkedAt().plusSeconds(3600))
                && cached.months().getLast().month().equals(month.minusMonths(1).toString())) return cached;
        List<Month> rows=new ArrayList<>();
        for(int back=5;back>=1;back--) rows.add(read(service,month.minusMonths(back),now));
        var result=new History(id,now,List.copyOf(rows)); cache.put(id,result); return result;
    }
    private Month read(UsageModels.Service service,YearMonth month,Instant now) {
        var zone=ZoneId.of(service.timeZone());
        var start=month.atDay(1).atStartOfDay(zone).toInstant();
        var end=month.plusMonths(1).atDay(1).atStartOfDay(zone).toInstant();
        Snapshot data=null;
        String message="확인된 월 집계가 없습니다. 0건을 뜻하지 않습니다.";
        boolean failed=false;
        try {
            var saved=store.find(service.id(),month.toString());
            if(saved!=null) ApiUsageService.validate(saved,month.toString(),start,end,service);
            data=saved;
            // Recheck newly ended months during the provider's reporting delay window.
            if(data==null || data.asOf().isBefore(end) || now.isBefore(end.plus(Duration.ofDays(3)))) {
                Snapshot fresh=snapshots.readMonth(service.id(),month.toString());
                if(fresh==null) fresh=google.readMonth(service,start,end,now);
                if(fresh==null) fresh=naver.readMonth(service,start,end);
                if(fresh!=null) {
                    ApiUsageService.validate(fresh,month.toString(),start,end,service);
                    if(data==null || !fresh.asOf().isBefore(data.asOf())) {
                        data=fresh;
                        try { store.save(service.id(),fresh); }
                        catch(Exception ignored) { message="조회한 수치를 장기 보관하지 못했습니다. 저장 상태를 확인해 주세요."; }
                    }
                }
            }
        } catch(GoogleUsageClient.NoUsageData | NaverUsageClient.NoUsageData ignored) {
            // Absence must stay unknown; provider retention and no use are not distinguishable.
        } catch(Exception ignored) { failed=true; message="월별 사용량 조회를 완료하지 못했습니다."; }
        if(data==null) return new Month(month.toString(),failed?"error":"unavailable",message,null,null,null,Map.of());
        boolean complete=data.asOf().equals(end);
        String status=complete ? now.isBefore(end.plus(Duration.ofDays(3))) ? "provisional" : "complete" : "partial";
        if(failed) status="stale";
        return new Month(month.toString(),status,message.startsWith("조회한") || failed ? message : complete ? "월 전체 기간 조회값 · 공급자 정정 가능" : "월 일부 기간만 확인되어 전월 증감 계산에서 제외됩니다.",data.asOf(),data.source(),data.scope(),data.metrics());
    }
    /** Preserve monthly totals before Google's short retention expires, without a browser visit. */
    @Scheduled(initialDelayString="PT1M",fixedDelayString="PT6H")
    public synchronized void collectRecent() {
        Instant now=clock.instant();
        for(var service:catalog.get().services()) {
            var zone=ZoneId.of(service.timeZone());
            var month=YearMonth.from(now.atZone(zone));
            var start=month.atDay(1).atStartOfDay(zone).toInstant();
            try {
                Snapshot current=snapshots.read(service.id());
                if(current!=null && YearMonth.parse(current.month()).isBefore(month)) current=null;
                if(current==null) current=google.read(service,start,now);
                if(current==null) current=naver.read(service,start,now);
                if(current!=null) { ApiUsageService.validate(current,month.toString(),start,now,service); store.save(service.id(),current); }
            } catch(Exception ignored) { /* An unavailable provider must not erase stored observations. */ }
            read(service,month.minusMonths(1),now);
        }
        cache.clear();
    }
}
