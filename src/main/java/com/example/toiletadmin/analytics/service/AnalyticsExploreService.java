package com.example.toiletadmin.analytics.service;

import com.example.toiletadmin.analytics.dto.AnalyticsExploreResponse;
import com.example.toiletadmin.analytics.dto.AnalyticsExploreResponse.*;
import com.example.toiletadmin.analytics.dto.ServiceAnalyticsReportResponse.SummaryMetrics;
import java.time.*;
import java.util.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
public class AnalyticsExploreService {
    private static final List<String> DIMENSIONS=List.of("page","source","channel","device","os","browser","country","city","event","screen","client","evidence","entry","navigation");
    private static final Map<String,String> LEGACY_DIMENSIONS=Map.ofEntries(
            Map.entry("page","PAGE"),Map.entry("source","SOURCE"),Map.entry("channel","CHANNEL"),
            Map.entry("device","DEVICE"),Map.entry("os","OS"),Map.entry("browser","BROWSER"),
            Map.entry("country","COUNTRY"),Map.entry("city","CITY"),Map.entry("event","EVENT_DETAIL"),
            Map.entry("client","CLIENT_CONTEXT"),Map.entry("evidence","CLIENT_EVIDENCE"),
            Map.entry("entry","ACQUISITION_EVIDENCE"),Map.entry("navigation","ENTRY_NAVIGATION"));
    private static final String TRUNCATED_NOTICE="항목이 많은 목록은 최대 500개까지 표시합니다. 기간·필터를 좁혀 추가 항목을 확인하세요.";
    private record Scope(List<String> dimensions,boolean flows,boolean clues) {
        static Scope resolve(String view) {
            Set<String> requested=new HashSet<>(List.of("page","source","country","client"));
            switch(view) {
                case "all" -> requested.addAll(DIMENSIONS);
                case "overview","quality" -> { }
                case "content" -> requested.add("screen");
                case "acquisition" -> requested.addAll(List.of("channel","evidence","entry","navigation"));
                case "behavior" -> requested.add("event");
                case "audience" -> requested.addAll(List.of("device","os","browser","city"));
                default -> throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"조회할 분석 화면을 확인해 주세요.");
            }
            return new Scope(DIMENSIONS.stream().filter(requested::contains).toList(),
                    view.equals("all")||view.equals("behavior"),view.equals("all")||view.equals("acquisition"));
        }
    }
    private final AnalyticsExploreRepository repository;
    private final ServiceAnalyticsRepository summaries;
    private final Clock clock;
    private record Cached(Instant expires,AnalyticsExploreQuery query,AnalyticsExploreResponse response,boolean flowsLoaded,boolean cluesLoaded) {
        boolean covers(Scope scope) {
            return scope.dimensions().stream().filter(type->response.detailed()||LEGACY_DIMENSIONS.containsKey(type)).allMatch(response.dimensions()::containsKey)
                    && (!scope.flows()||flowsLoaded) && (!scope.clues()||cluesLoaded);
        }
    }
    private final Map<String,Cached> cache=new LinkedHashMap<>();
    @Autowired
    public AnalyticsExploreService(AnalyticsExploreRepository repository,ServiceAnalyticsRepository summaries) {
        this(repository,summaries,Clock.systemUTC());
    }
    AnalyticsExploreService(AnalyticsExploreRepository repository,ServiceAnalyticsRepository summaries,Clock clock) {
        this.repository=repository; this.summaries=summaries; this.clock=clock;
    }
    // Admin-only, small bounded cache. Refreshing a tab must not fan out raw scans.
    public synchronized AnalyticsExploreResponse explore(String range,String from,String to,Map<String,String> filters) {
        return explore(range,from,to,filters,true);
    }
    public synchronized AnalyticsExploreResponse explore(String range,String from,String to,Map<String,String> filters,boolean excludeBots) {
        return explore(range,from,to,filters,excludeBots,"all");
    }
    public synchronized AnalyticsExploreResponse explore(String range,String from,String to,Map<String,String> filters,boolean excludeBots,String view) {
        Scope scope=Scope.resolve(view);
        var q=AnalyticsExploreQuery.resolve(range,from,to,filters,clock,excludeBots);
        String key=q.from()+"|"+q.to()+"|"+q.until().getEpochSecond()/60+"|"+new TreeMap<>(q.filters())+"|"+excludeBots;
        Cached stored=cache.get(key);
        if(stored!=null && stored.expires().isAfter(clock.instant())) {
            if(stored.covers(scope)) return stored.response();
            try {
                AnalyticsExploreResponse response=expand(stored,scope);
                cache.put(key,new Cached(stored.expires(),stored.query(),response,stored.flowsLoaded()||scope.flows(),stored.cluesLoaded()||scope.clues()));
                return response;
            } catch(RuntimeException error) { throw unavailable(); }
        }
        if(!summaries.schemaReady()) throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"분석 저장소를 준비하고 있습니다.");
        try {
            q=q.withBotClassification(repository.botClassificationAvailable()).withClientContext(repository.clientContextAvailable()).withEntryEvidence(repository.entryEvidenceAvailable());
            AnalyticsExploreResponse response=build(q,scope);
            cache.entrySet().removeIf(e->!e.getValue().expires().isAfter(clock.instant()));
            if(cache.size()>=32) cache.remove(cache.keySet().iterator().next());
            cache.put(key,new Cached(clock.instant().plusSeconds(60),q,response,scope.flows(),scope.clues()));
            return response;
        } catch (ResponseStatusException error) { throw error; }
        catch(RuntimeException error) { throw unavailable(); }
    }
    private static ResponseStatusException unavailable() {
        return new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"상세 분석 조회가 지연되고 있습니다. 잠시 후 다시 시도해 주세요.");
    }
    private AnalyticsExploreResponse expand(Cached stored,Scope scope) {
        var r=stored.response(); var q=stored.query();
        Map<String,List<Row>> dimensions=new LinkedHashMap<>(r.dimensions()),prior=new LinkedHashMap<>(r.previousDimensions());
        boolean truncated=appendDimensions(q,scope.dimensions(),dimensions,prior,r.detailed(),r.comparisonAvailable())||r.quality().rowsTruncated();
        List<Flow> flows=r.detailed()&&scope.flows()&&!stored.flowsLoaded()?repository.flows(q):r.flows();
        EntryClues clues=r.detailed()&&scope.clues()&&!stored.cluesLoaded()?repository.entryClues(q):r.entryClues();
        var quality=r.quality(); List<String> notices=new ArrayList<>(r.notices());
        if(truncated&&!notices.contains(TRUNCATED_NOTICE)) notices.add(TRUNCATED_NOTICE);
        return new AnalyticsExploreResponse(r.generatedAt(),r.from(),r.to(),r.previousFrom(),r.previousTo(),r.cutoff(),r.hourly(),r.detailed(),r.comparisonAvailable(),
                r.comparisonNote(),r.visitorDefinition(),r.current(),r.previous(),r.trend(),r.previousTrend(),dimensions,prior,flows,
                new Quality(quality.unknownPageViews(),quality.unattributedSessions(),quality.internalSessions(),quality.duplicateStarts(),truncated,quality.lastCalculatedAt(),quality.lastEventAt()),
                notices,r.filters(),r.botFilter(),clues);
    }
    private boolean appendDimensions(AnalyticsExploreQuery q,List<String> requested,Map<String,List<Row>> dimensions,Map<String,List<Row>> prior,boolean detailed,boolean compare) {
        boolean truncated=false;
        for(String type:requested) {
            if(dimensions.containsKey(type)) continue;
            if(detailed) {
                List<Row> rows=repository.dimension(type,q); truncated|=rows.size()>AnalyticsExploreRepository.ROW_LIMIT;
                dimensions.put(type,rows.stream().limit(AnalyticsExploreRepository.ROW_LIMIT).toList());
                if(compare) prior.put(type,repository.dimension(type,q.previous()).stream().limit(AnalyticsExploreRepository.ROW_LIMIT).toList());
            } else if(LEGACY_DIMENSIONS.containsKey(type)) {
                var rows=summaries.dimensions(LEGACY_DIMENSIONS.get(type),q.from(),q.to(),AnalyticsExploreRepository.ROW_LIMIT+1);
                truncated|=rows.size()>AnalyticsExploreRepository.ROW_LIMIT;
                dimensions.put(type,rows.stream().limit(AnalyticsExploreRepository.ROW_LIMIT).map(r->new Row(r.key(),new Metrics(r.activeUsers(),r.sessions(),r.views(),r.eventCount(),r.keyEvents(),(long)(r.averageEngagementSeconds()*r.activeUsers()),0,0,0,0))).toList());
            }
        }
        return truncated;
    }
    private AnalyticsExploreResponse build(AnalyticsExploreQuery q,Scope scope) {
        LocalDate today=clock.instant().atZone(AnalyticsExploreQuery.SEOUL).toLocalDate();
        LocalDate retained=today.minusDays(34);
        boolean detailed=!q.from().isBefore(retained);
        if(!detailed && !q.filters().isEmpty()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"상세 필터는 최근 35일 이내에서 사용할 수 있습니다.");
        if(!detailed && !q.excludeBots()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"봇 포함 조회는 원본이 보관된 최근 35일 이내에서 사용할 수 있습니다.");
        LocalDate first=repository.firstEventDate();
        boolean compare=detailed && !q.previousFrom().isBefore(retained) && first!=null && !q.previousFrom().isBefore(first);
        List<String> notices=new ArrayList<>();
        notices.add("방문자는 접속망·브라우저 기반 추정치입니다. 여러 날 조회 시 일별 추정 방문자를 합산하며 동일인이 중복될 수 있습니다.");
        notices.add("체류 시간은 과거 수집 방식의 영향을 받습니다. 화면 활성 시간 수집 개선 전 기록에는 백그라운드 시간이 포함될 수 있습니다.");
        notices.add("직접 접속·확인 불가는 출처가 전달되지 않은 방문을 포함합니다. 접속 지역은 네트워크 기준이며 실제 위치·국적이 아닙니다.");
        notices.add("방문한 페이지 필터는 해당 페이지를 조회한 세션 전체의 유입과 행동을 보여줍니다. 주요 행동 건수에는 결과 선택·주변 검색·제보 시작·제출·로그인·리뷰 제출이 포함되며 모두 성공 건수라는 뜻은 아닙니다.");
        if(first!=null && q.from().isBefore(first)) notices.add("보관 중인 첫 이벤트는 "+first+"입니다. 그 이전 구간은 기록 없음으로 표시합니다.");
        notices.add("접속 환경은 브라우저가 전달한 앱·브라우저 표시 기준입니다. 카카오톡·LINE에서 열렸어도 유입 게시글·대화방이나 실제 방문자를 특정하지 않습니다. 일반 브라우저 역시 사람임을 보증하지 않습니다.");
        notices.add("유입 채널·소스의 ‘앱 · 출처 미확인’은 출처 없이 열린 방문 중 앱 표시가 확인된 기록입니다. 실제 추천 출처가 확인된 방문은 원래 채널·소스를 유지하며, 출처 확인 불가 합계에는 이 앱 방문도 포함됩니다.");
        notices.add("접속 환경 확인 근거: 요청에서 확인은 신규 기록, 로그 대조로 보완은 보관 로그와 정확히 일치한 과거 기록입니다. 미분류·기록 없음은 추정해서 채우지 않습니다.");
        notices.add("로그가 일부만 남은 세션은 확인된 이벤트만 보완합니다. 접속 환경 필터는 해당 유형으로 분류된 기록에 적용됩니다.");
        notices.add("미확인 유입 단서는 같은 환경·첫 진입 화면을 묶은 합계입니다. 새로고침·뒤로가기·열린 화면 재시작은 신규 수집 이후만 확인되며 주소 직접 입력·즐겨찾기·출처를 숨긴 링크는 서로 구별할 수 없습니다. 기기나 이용 행동만으로 사람·봇을 단정하지 않습니다.");
        if (!q.clientContextAvailable()) notices.add("접속 환경 수집 준비 중입니다. 기존 방문·유입 통계는 그대로 조회됩니다.");
        List<Point> daily; List<Point> trend; List<Point> prevTrend=List.of();
        Metrics current; Metrics previous=null;
        Map<String,List<Row>> dimensions=new LinkedHashMap<>(), prior=new LinkedHashMap<>();
        List<Flow> flows=List.of();
        long[] quality=new long[4]; boolean truncated=false;
        if(detailed) {
            daily=repository.daily(q); current=sum(daily);
            trend=complete(q,q.hourly()?repository.hourly(q):daily,first);
            if(compare) { var p=q.previous(); var previousDaily=repository.daily(p); previous=sum(previousDaily);prevTrend=complete(p,p.hourly()?repository.hourly(p):previousDaily,first); }
            if(scope.flows()) flows=repository.flows(q);
            quality=repository.quality(q);
        } else {
            notices.add("이 기간은 일별 집계로 조회합니다. 시간대·세부 필터·이용 흐름은 원본 이벤트가 보관된 최근 35일에 제공됩니다.");
            notices.add("일별 집계에는 출처와 접속 환경의 조합이 보관되지 않아 유입 채널·소스의 앱별 세분화는 제공하지 않습니다. 접속 환경 목록은 별도로 확인할 수 있습니다.");
            current=metric(summaries.summary(q.from(),q.to()));
            trend=summaries.trend(q.from(),q.to()).stream().map(p->new Point(p.date(),new Metrics(p.activeUsers(),p.sessions(),p.views(),0,p.keyEvents(),0,0,0,0,0))).toList();
            notices.add("일별 접속 환경 집계는 수집·로그 보완이 된 날짜에만 제공됩니다. 오래된 미기록 구간은 복원할 수 없습니다.");
        }
        truncated=appendDimensions(q,scope.dimensions(),dimensions,prior,detailed,compare);
        if(truncated) notices.add(TRUNCATED_NOTICE);
        long[] coverage=detailed?repository.trafficCoverage(q):new long[3];
        String botNote=!detailed?"35일 이전을 포함한 기간은 봇 제외 일별 집계만 제공합니다. 과거 미분류 기록은 재판별할 수 없습니다."
                : !q.botClassificationAvailable()?"봇 분류 수집 전 기록입니다. 과거 봇 기록은 복원하거나 재판별할 수 없어 전환해도 수치가 같습니다."
                : coverage[1]+coverage[0]==0 && coverage[2]>0?"이 기간은 봇 분류 수집 전 기록만 있어 전환해도 수치가 같습니다. 과거 기록은 재판별할 수 없습니다."
                : (coverage[0]==0?"이 기간·필터에 분류된 봇 이벤트가 없어 전환해도 수치가 같습니다."
                    : "봇으로 표시된 분석 이벤트 "+coverage[0]+"건을 "+(q.excludeBots()?"제외합니다.":"포함합니다."))
                  +(coverage[2]>0?" 분류 전 기록 "+coverage[2]+"건은 판별할 수 없어 유지합니다.":"");
        notices.add(botNote);
        notices.add("봇 제외는 요청의 브라우저 정보에 나타난 자동화 신호 기준이며, 사람임을 보증하지 않습니다. 직접 접속·확인 불가를 일괄 제외하지 않습니다. 봇 접근 탭의 서버 요청 수와 분석 이벤트는 별도 지표입니다. 기존 수집 단계에서 버린 봇 이벤트는 포함 조회로 복구되지 않습니다.");
        boolean ongoing=q.to().equals(today);
        String comparisonNote=compare?(ongoing?"이전 기간의 같은 시각까지 비교합니다.":"바로 앞의 동일한 일수와 비교합니다."):
                "이전 기간의 상세 기록이 충분하지 않아 증감률을 표시하지 않습니다.";
        return new AnalyticsExploreResponse(clock.instant(),q.from().toString(),q.to().toString(),q.previousFrom().toString(),q.previousTo().toString(),
                q.until().atZone(AnalyticsExploreQuery.SEOUL).toLocalDateTime().toString(),q.hourly()&&detailed,detailed,compare,comparisonNote,
                q.from().equals(q.to())?"일일 추정 방문자":"일별 추정 방문자 합계",current,previous,trend,prevTrend,dimensions,prior,flows,
                new Quality(quality[0],quality[1],quality[2],quality[3],truncated,summaries.lastCalculatedAt(),summaries.lastEventAt()),notices,q.filters(),
                new BotFilter(q.excludeBots(),q.botClassificationAvailable(),detailed,coverage[0],coverage[1],coverage[2],botNote),
                detailed&&scope.clues()?repository.entryClues(q):new EntryClues(false,q.entryEvidenceAvailable(),false,List.of()));
    }
    private static Metrics metric(SummaryMetrics x) {
        return new Metrics(x.activeUsers(),x.sessions(),x.views(),0,x.keyEvents(),(long)(x.averageEngagementSeconds()*x.activeUsers()),0,0,0,0);
    }
    private static Metrics sum(List<Point> points) { return points.stream().map(Point::metrics).reduce(Metrics.zero(),Metrics::plus); }
    private static List<Point> complete(AnalyticsExploreQuery q,List<Point> rows,LocalDate first) {
        Map<String,Metrics> indexed=new HashMap<>(); rows.forEach(p->indexed.put(p.key(),p.metrics()));
        List<Point> points=new ArrayList<>();
        if(q.hourly()) {
            for(int hour=0;hour<24;hour++) {
                String key=String.format("%02d:00",hour);
                boolean future=!q.from().atTime(hour,0).atZone(AnalyticsExploreQuery.SEOUL).toInstant().isBefore(q.until());
                points.add(new Point(key,future?null:indexed.getOrDefault(key,Metrics.zero())));
            }
        } else for(LocalDate day=q.from();!day.isAfter(q.to());day=day.plusDays(1)) {
            String key=day.toString(); points.add(new Point(key,first!=null&&day.isBefore(first)?null:indexed.getOrDefault(key,Metrics.zero())));
        }
        return points;
    }
}
