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
    private static final List<String> DIMENSIONS=List.of("page","source","channel","device","os","browser","country","city","event","screen");
    private final AnalyticsExploreRepository repository;
    private final ServiceAnalyticsRepository summaries;
    private final Clock clock;
    private record Cached(Instant expires,AnalyticsExploreResponse response) { }
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
        var q=AnalyticsExploreQuery.resolve(range,from,to,filters,clock,excludeBots);
        String key=q.from()+"|"+q.to()+"|"+q.until().getEpochSecond()/60+"|"+new TreeMap<>(q.filters())+"|"+excludeBots;
        Cached stored=cache.get(key);
        if(stored!=null && stored.expires().isAfter(clock.instant())) return stored.response();
        if(!summaries.schemaReady()) throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"분석 저장소를 준비하고 있습니다.");
        try {
            AnalyticsExploreResponse response=build(q.withBotClassification(repository.botClassificationAvailable()));
            cache.entrySet().removeIf(e->!e.getValue().expires().isAfter(clock.instant()));
            if(cache.size()>=32) cache.remove(cache.keySet().iterator().next());
            cache.put(key,new Cached(clock.instant().plusSeconds(60),response));
            return response;
        } catch (ResponseStatusException error) { throw error; }
        catch(RuntimeException error) { throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"상세 분석 조회가 지연되고 있습니다. 잠시 후 다시 시도해 주세요."); }
    }
    private AnalyticsExploreResponse build(AnalyticsExploreQuery q) {
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
        List<Point> daily; List<Point> trend; List<Point> prevTrend=List.of();
        Metrics current; Metrics previous=null;
        Map<String,List<Row>> dimensions=new LinkedHashMap<>(), prior=new LinkedHashMap<>();
        List<Flow> flows=List.of();
        long[] quality=new long[4]; boolean truncated=false;
        if(detailed) {
            daily=repository.daily(q); current=sum(daily);
            trend=complete(q,q.hourly()?repository.hourly(q):daily,first);
            if(compare) { var p=q.previous(); var previousDaily=repository.daily(p); previous=sum(previousDaily);prevTrend=complete(p,p.hourly()?repository.hourly(p):previousDaily,first); }
            for(String type:DIMENSIONS) {
                List<Row> rows=repository.dimension(type,q); truncated|=rows.size()>AnalyticsExploreRepository.ROW_LIMIT;
                dimensions.put(type,rows.stream().limit(AnalyticsExploreRepository.ROW_LIMIT).toList());
                if(compare) prior.put(type,repository.dimension(type,q.previous()).stream().limit(AnalyticsExploreRepository.ROW_LIMIT).toList());
            }
            flows=repository.flows(q);quality=repository.quality(q);
        } else {
            notices.add("이 기간은 일별 집계로 조회합니다. 시간대·세부 필터·이용 흐름은 원본 이벤트가 보관된 최근 35일에 제공됩니다.");
            current=metric(summaries.summary(q.from(),q.to()));
            trend=summaries.trend(q.from(),q.to()).stream().map(p->new Point(p.date(),new Metrics(p.activeUsers(),p.sessions(),p.views(),0,p.keyEvents(),0,0,0,0,0))).toList();
            Map<String,String> legacy=Map.of("page","PAGE","source","SOURCE","channel","CHANNEL","device","DEVICE","os","OS","browser","BROWSER","country","COUNTRY","city","CITY","event","EVENT_DETAIL");
            for(var entry:legacy.entrySet()) {
                var rows=summaries.dimensions(entry.getValue(),q.from(),q.to(),501);
                truncated|=rows.size()>500;
                dimensions.put(entry.getKey(),rows.stream().limit(500).map(r->new Row(r.key(),new Metrics(r.activeUsers(),r.sessions(),r.views(),r.eventCount(),r.keyEvents(),(long)(r.averageEngagementSeconds()*r.activeUsers()),0,0,0,0))).toList());
            }
        }
        if(truncated) notices.add("항목이 많은 목록은 최대 500개까지 표시합니다. 기간·필터를 좁혀 추가 항목을 확인하세요.");
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
                new BotFilter(q.excludeBots(),q.botClassificationAvailable(),detailed,coverage[0],coverage[1],coverage[2],botNote));
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
