package com.example.toiletadmin.cloudflare.service;

import com.example.toiletadmin.cloudflare.dto.CloudflareMonitoringResponse;
import com.example.toiletadmin.cloudflare.dto.CloudflareMonitoringResponse.*;
import com.example.toiletadmin.cloudflare.service.CloudflareAnalyticsClient.Dataset;
import com.example.toiletadmin.cloudflare.service.CloudflareAnalyticsClient.MonitorDataset;
import java.time.*;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Supplier;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;

/** On-demand, bounded, read-only analytics. No R2 writes, scheduled jobs, or external notifications. */
@Service
public class CloudflareMonitoringService {
    private final CloudflareAnalyticsClient client;
    private final boolean enabled;
    private final long cacheSeconds;
    private final String domain, bucket;
    private final Clock clock;
    private CloudflareMonitoringResponse cached;
    private RefreshHealth latestRefresh;
    @Autowired
    public CloudflareMonitoringService(CloudflareAnalyticsClient client,
            @Value("${cloudflare.analytics.enabled:false}") boolean enabled,
            @Value("${cloudflare.analytics.cache-seconds:300}") long cacheSeconds,
            @Value("${cloudflare.analytics.monitor-domain:geupddong.com}") String domain,
            @Value("${cloudflare.analytics.monitor-cache-bucket:geupddong-next-production-cache}") String bucket) {
        this(client, enabled, cacheSeconds, domain, bucket, Clock.systemUTC());
    }
    CloudflareMonitoringService(CloudflareAnalyticsClient client, boolean enabled, long cacheSeconds,
            String domain, String bucket, Clock clock) {
        this.client=client; this.enabled=enabled; this.cacheSeconds=Math.max(30,cacheSeconds);
        this.domain=domain; this.bucket=bucket; this.clock=clock;
    }
    public synchronized CloudflareMonitoringResponse getMonitoring() {
        Instant now=clock.instant();
        if(cached!=null && now.isBefore(cached.checkedAt().plusSeconds(cacheSeconds))) return cached;
        // End on a completed hour to avoid comparing an incomplete hour with a full one.
        Instant end=now.minusSeconds(900).truncatedTo(ChronoUnit.HOURS), start=end.minusSeconds(86400);
        Map<String,Supplier<?>> queries=new LinkedHashMap<>();
        queries.put("r2",()->r2(client.queryMonitor(MonitorDataset.R2_HOURS,start.minusSeconds(86400),end),start,end));
        queries.put("writes",()->writes(client.queryCacheWrites(bucket,start,end),bucket));
        queries.put("workers",()->workers(client.queryMonitor(MonitorDataset.WORKERS_HEALTH,start,end)));
        queries.put("d1",()->databases(client.queryMonitor(MonitorDataset.D1_HEALTH,start,end)));
        queries.put("storage",()->storage(client.queryDataset(Dataset.D1_STORAGE,start.minusSeconds(86400),end),start));
        queries.put("traffic",()->traffic(client.queryTraffic(domain,start,end),domain));
        queries.put("objects",()->objects(client.queryDataset(Dataset.DO_REQUESTS,start,end),client.queryDataset(Dataset.DO_TIME,start,end)));
        queries.put("refresh",()->refreshRuns(client.queryRefreshRuns()));
        Map<String,Section<?>> sections=new LinkedHashMap<>();
        if(enabled && client.isConfigured()) {
            try(var executor=Executors.newVirtualThreadPerTaskExecutor()) {
                Map<String,CompletableFuture<Section<?>>> pending=new LinkedHashMap<>();
                queries.forEach((key,query)->pending.put(key,CompletableFuture.supplyAsync(()->read(query),executor)));
                pending.forEach((key,future)->{
                    var section=future.join();
                    sections.put(key,key.equals("refresh")?refreshSection(section):section);
                });
            }
        } else queries.keySet().forEach(key->sections.put(key,unavailable()));
        long ok=sections.values().stream().filter(s->s.status().equals("OK")).count();
        cached=new CloudflareMonitoringResponse(ok==0?"UNAVAILABLE":ok==sections.size()?"OK":"PARTIAL",now,start,end,
                Collections.unmodifiableMap(sections));
        return cached;
    }
    private Section<?> refreshSection(Section<?> section) {
        if (!section.status().equals("OK") || !(section.data() instanceof RefreshHealth incoming)) return section;
        if (latestRefresh != null && !latestRefresh.runs().isEmpty()) {
            RefreshRun previous = latestRefresh.runs().getFirst();
            RefreshRun current = incoming.runs().isEmpty() ? null : incoming.runs().getFirst();
            if (current == null || current.startedAt().isBefore(previous.startedAt())
                    || (current.url().equals(previous.url()) && current.updatedAt().isBefore(previous.updatedAt()))) {
                return new Section<>("UNAVAILABLE", "GitHub 실행 목록이 최근 확인한 기록보다 오래되어 최신 상태를 확인할 수 없습니다.", null);
            }
        }
        latestRefresh = incoming;
        return new Section<>("OK", "GitHub 공개 실행 기록 · 최근 5개", incoming);
    }
    private static Section<?> read(Supplier<?> query) {
        try { return new Section<>("OK","Cloudflare Analytics 추정치 · 완료된 최근 24시간",query.get()); }
        catch(RuntimeException error) { return unavailable(); }
    }
    private static Section<?> unavailable() {
        return new Section<>("UNAVAILABLE","조회 권한·수집 범위·응답을 확인해야 합니다. 0건으로 간주하지 않습니다.",null);
    }
    static double num(JsonNode node) {
        if(!node.isNumber() || !Double.isFinite(node.asDouble()) || node.asDouble()<0) throw new IllegalArgumentException();
        return node.asDouble();
    }
    private static Double optional(JsonNode node) { return node.isNull() || node.isMissingNode() ? null : num(node); }
    private static Double millis(JsonNode node) { Double n=optional(node); return n==null?null:n/1000; }
    private static String required(JsonNode node) { String s=node.asText("");if(s.isBlank())throw new IllegalArgumentException();return s; }
    private static void array(JsonNode rows) { if(rows==null || !rows.isArray())throw new IllegalArgumentException(); }
    static R2Health r2(JsonNode rows,Instant start,Instant end) {
        array(rows);
        Map<Instant,double[]> hours=new TreeMap<>();
        for(Instant t=start.minusSeconds(86400);t.isBefore(end);t=t.plusSeconds(3600)) hours.put(t,new double[7]);
        for(JsonNode row:rows) {
            JsonNode d=row.path("dimensions"); Instant at=Instant.parse(required(d.path("datetimeHour")));
            double[] h=hours.get(at);if(h==null)throw new IllegalArgumentException();
            String action=required(d.path("actionType"));required(d.path("storageClass"));
            int code=(int)num(d.path("responseStatusCode"));double n=num(row.path("sum").path("requests"));
            // Reuse the exact pricing classification, including free authentication failures.
            String category=CloudflareUsageService.billingClass(action,code);
            if(category.equals("A"))h[0]+=n;if(category.equals("B"))h[1]+=n;
            if(action.equals("PutObject"))h[2]+=n;
            if(action.equals("GetObject") && code>=200 && code<300)h[3]+=n;
            if(action.equals("GetObject") && code==404)h[4]+=n;
            if(code>=500 && code<600)h[5]+=n;
        }
        List<R2Hour> current=new ArrayList<>(); double previous=0,puts=0,ok=0,missing=0,errors=0;
        for(var entry:hours.entrySet()) {
            double[] h=entry.getValue();
            if(entry.getKey().isBefore(start)) {previous+=h[2];continue;}
            puts+=h[2];ok+=h[3];missing+=h[4];errors+=h[5];
            current.add(new R2Hour(entry.getKey(),h[0],h[1],h[2],h[3],h[4],h[5]));
        }
        return new R2Health(current,puts,previous,hours.get(end.minusSeconds(3600))[2],hours.get(end.minusSeconds(7200))[2],ok,missing,errors);
    }
    static CacheWrites writes(Map<String,JsonNode> rows,String bucket) {
        if(rows==null)throw new IllegalArgumentException();
        Map<String,String> labels=Map.of("source","원본 데이터","body","언어별 화면 본문","framework","페이지 캐시",
                "cells","지도 셀","clusters","지도 클러스터","regions","지역 마커");
        List<CacheWrite> result=new ArrayList<>();double known=0,success=0;
        for(String key:List.of("body","source","framework","cells","clusters","regions")) {
            double[] counts=writeCounts(rows.get(key));known+=counts[0];success+=counts[1];
            result.add(new CacheWrite(key,labels.get(key),CloudflareAnalyticsClient.CACHE_PREFIXES.get(key),counts[0],counts[1]));
        }
        double[] total=writeCounts(rows.get("total"));
        // Independent adaptive samples can disagree; never invent a negative or zero remainder.
        result.add(new CacheWrite("other","기타 / 새 경로","",total[0]>=known?total[0]-known:null,total[1]>=success?total[1]-success:null));
        return new CacheWrites(bucket,total[0],result);
    }
    private static double[] writeCounts(JsonNode rows) {
        array(rows);double total=0,ok=0;
        for(JsonNode row:rows) {double n=num(row.path("sum").path("requests"));int code=(int)num(row.path("dimensions").path("responseStatusCode"));total+=n;if(code>=200&&code<300)ok+=n;}
        return new double[]{total,ok};
    }
    static List<WorkerHealth> workers(JsonNode rows) {
        array(rows);List<WorkerHealth> result=new ArrayList<>();
        for(JsonNode row:rows) {
            JsonNode sum=row.path("sum"),q=row.path("quantiles");
            result.add(new WorkerHealth(required(row.path("dimensions").path("scriptName")),num(sum.path("requests")),num(sum.path("errors")),
                    num(sum.path("cpuTimeUs"))/1000,millis(q.path("cpuTimeP95")),millis(q.path("requestDurationP95"))));
        }
        result.sort(Comparator.comparingDouble(WorkerHealth::cpuMs).reversed());return result;
    }
    static List<DatabaseHealth> databases(JsonNode rows) {
        array(rows);List<DatabaseHealth> result=new ArrayList<>();
        for(JsonNode row:rows) {
            JsonNode sum=row.path("sum");
            result.add(new DatabaseHealth(required(row.path("dimensions").path("databaseId")),num(sum.path("readQueries"))+num(sum.path("writeQueries")),
                    num(sum.path("rowsRead")),num(sum.path("rowsWritten")),optional(row.path("quantiles").path("queryBatchTimeMsP95"))));
        }
        result.sort(Comparator.comparingDouble(DatabaseHealth::rowsRead).reversed());return result;
    }
    static List<StorageGrowth> storage(JsonNode rows,Instant start) {
        array(rows);Map<String,TreeMap<Instant,Double>> dbs=new TreeMap<>();
        for(JsonNode row:rows) {
            JsonNode d=row.path("dimensions");String id=required(d.path("databaseId"));Instant at=Instant.parse(required(d.path("datetime")));
            dbs.computeIfAbsent(id,k->new TreeMap<>()).put(at,num(row.path("max").path("databaseSizeBytes")));
        }
        List<StorageGrowth> result=new ArrayList<>();
        dbs.forEach((id,samples)->{var latest=samples.lastEntry();var before=samples.floorEntry(start);
            result.add(new StorageGrowth(id,latest.getValue(),latest.getKey(),before==null?null:before.getValue(),before==null?null:before.getKey()));});
        return result;
    }
    static TrafficHealth traffic(JsonNode rows,String domain) {
        array(rows);double total=0,hits=0,edge=0,origin=0,bots=0;Map<String,Double> caches=new TreeMap<>(),categories=new TreeMap<>();
        for(JsonNode row:rows) {
            double n=num(row.path("count"));JsonNode d=row.path("dimensions");
            String cache=required(d.path("cacheStatus"));
            if(!d.path("verifiedBotCategory").isString())throw new IllegalArgumentException();
            String bot=d.path("verifiedBotCategory").asText();
            int e=(int)num(d.path("edgeResponseStatus")),o=(int)num(d.path("originResponseStatus"));
            total+=n;caches.merge(cache,n,Double::sum);
            if(cache.equalsIgnoreCase("hit"))hits+=n;
            if(e>=500&&e<600)edge+=n;if(o>=500&&o<600)origin+=n;
            if(!bot.isBlank()) {bots+=n;categories.merge(bot,n,Double::sum);}
        }
        return new TrafficHealth(domain,total,hits,edge,origin,bots,caches,categories);
    }
    static ObjectHealth objects(JsonNode invocations,JsonNode periodic) {
        Double requests=CloudflareUsageService.sum(invocations,"requests"),errors=CloudflareUsageService.sum(invocations,"errors"),
                cpu=CloudflareUsageService.sum(periodic,"exceededCpuErrors"),memory=CloudflareUsageService.sum(periodic,"exceededMemoryErrors"),internal=CloudflareUsageService.sum(periodic,"fatalInternalErrors");
        if(requests==null||errors==null||cpu==null||memory==null||internal==null)throw new IllegalArgumentException();
        return new ObjectHealth(requests,errors,cpu,memory,internal);
    }
    static RefreshHealth refreshRuns(JsonNode rows) {
        array(rows);List<RefreshRun> runs=new ArrayList<>();Instant success=null;
        for(JsonNode row:rows) {
            String status=required(row.path("status")),conclusion=row.path("conclusion").asText("");
            Instant started=Instant.parse(required(row.path("created_at"))),updated=Instant.parse(required(row.path("updated_at")));
            long id=row.path("id").asLong();if(id<=0||updated.isBefore(started))throw new IllegalArgumentException();
            if(status.equals("completed")&&conclusion.equals("success")&&(success==null||updated.isAfter(success)))success=updated;
            runs.add(new RefreshRun(status,conclusion,started,updated,"https://github.com/toilet-project/toilet-web/actions/runs/"+id));
        }
        runs.sort(Comparator.comparing(RefreshRun::startedAt).reversed());
        return new RefreshHealth(success,runs);
    }
}
