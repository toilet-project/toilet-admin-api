package com.example.toiletadmin.analytics.service;

import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Separate statistics-only classifier export. No DB, raw log, ledger or security-setting access. */
@Service
public class AutomationStatisticsService {
    private static final Set<String> KINDS=Set.of("UA_SIGNAL","PATTERN_INFERRED");
    private static final Set<String> REASONS=Set.of("UA_SIGNAL","DISTRIBUTED_PASSIVE_PROFILE","KNOWN_BULK_CLIENT");
    private static final Set<String> JOB_STATES=Set.of("plan","ready","partial","error");
    private final String directory;
    private final Clock clock;
    private final JsonMapper mapper=JsonMapper.builder().build();

    @Autowired public AutomationStatisticsService(@Value("${operations.origin-bots-directory:}") String directory) {
        this(directory,Clock.systemUTC());
    }
    AutomationStatisticsService(String directory,Clock clock) {this.directory=directory;this.clock=clock;}
    public record Job(String applyMode,boolean ledgerEnabled,String lastCompletedAt,long intervalSeconds,String ruleVersion) { }
    public record Coverage(String from,String to,long totalEvents,long matchedEvents,long eligibleSessions,
                           long classifiedSessions,long flaggedEvents,long unmatchedEvents,long ambiguousEvents,long unaccountedEvents) { }
    public record Row(String day,String classification,String reason,long events,long views,long sessions) { }
    public record Report(String status,String message,String from,String to,String generatedAt,boolean partial,Job job,Coverage coverage,List<Row> rows,
                         List<OfficialCrawlerCatalog.Source> officialSources) { }

    public Report report(String range,String from,String to) {
        var query=AnalyticsExploreQuery.resolve(range,from,to,Map.of(),clock);
        if(directory.isBlank())return empty("DISABLED","통계 자동화 분류 작업이 아직 연결되지 않았습니다. 0건을 뜻하지 않습니다.",query);
        try {
            JsonNode data=loadExport();
            if(data.path("schema").asInt()!=1 || !data.path("source").asText().equals("automation-statistics")
                    || !data.path("daily").isArray() || data.path("daily").size()>10000)throw new IllegalArgumentException();
            Instant generated=Instant.parse(data.path("generatedAt").asText());
            JsonNode j=data.path("job"),c=data.path("coverage");
            String state=data.path("status").asText(),version=j.path("ruleVersion").asText(),mode=j.path("applyMode").asText();
            long interval=count(j,"intervalSeconds");
            if(!JOB_STATES.contains(state) || !Set.of("plan","apply","run").contains(mode)
                    || !version.matches("[a-zA-Z0-9._-]{1,64}") || interval<60 || interval>3600)throw new IllegalArgumentException();
            String completed=optionalInstant(data,"lastCompletedAt",generated);
            if(state.equals("ready") && (completed==null || mode.equals("plan") || !j.path("ledgerEnabled").asBoolean()))throw new IllegalArgumentException();
            Job job=new Job(mode,j.path("ledgerEnabled").asBoolean(),completed,interval,version);
            LocalDate periodFrom=LocalDate.parse(data.path("period").path("from").asText()),periodTo=LocalDate.parse(data.path("period").path("to").asText());
            if(periodFrom.isAfter(periodTo) || periodTo.isAfter(generated.atZone(AnalyticsExploreQuery.SEOUL).toLocalDate()))throw new IllegalArgumentException();
            long total=count(c,"totalEvents"),matched=count(c,"matchedEvents"),unmatched=count(c,"unmatchedEvents"),ambiguous=count(c,"ambiguousEvents");
            Coverage coverage=new Coverage(periodFrom.toString(),periodTo.toString(),total,matched,count(c,"eligibleSessions"),
                    count(c,"classifiedSessions"),count(c,"flaggedEvents"),unmatched,ambiguous,total-matched-unmatched-ambiguous);
            if(coverage.matchedEvents()>coverage.totalEvents() || coverage.flaggedEvents()>coverage.totalEvents()
                    || coverage.classifiedSessions()>coverage.totalEvents()
                    || coverage.matchedEvents()+coverage.unmatchedEvents()+coverage.ambiguousEvents()>coverage.totalEvents())throw new IllegalArgumentException();
            List<Row> rows=new ArrayList<>();
            Set<String> seen=new java.util.HashSet<>();
            for(JsonNode row:data.path("daily")) {
                LocalDate day=LocalDate.parse(row.path("date").asText());
                String kind=row.path("classification").asText(),reason=row.path("reasonKey").asText();
                long events=count(row,"events"),views=count(row,"views"),sessions=count(row,"sessions");
                if(!KINDS.contains(kind) || !REASONS.contains(reason) || kind.equals("UA_SIGNAL")!=reason.equals("UA_SIGNAL") || views>events || sessions>events
                        || day.isAfter(generated.atZone(AnalyticsExploreQuery.SEOUL).toLocalDate())
                        || !seen.add(day+"|"+kind+"|"+reason))throw new IllegalArgumentException();
                if(!day.isBefore(query.from()) && !day.isAfter(query.to()))rows.add(new Row(day.toString(),kind,reason,events,views,sessions));
            }
            long age=Duration.between(generated,clock.instant()).getSeconds();
            if(age< -60)throw new IllegalArgumentException();
            boolean partial=state.equals("partial") || query.from().isBefore(periodFrom) || query.to().isAfter(periodTo)
                    || coverage.unmatchedEvents()>0 || coverage.ambiguousEvents()>0 || coverage.unaccountedEvents()>0;
            String status=age>Math.max(900,interval*3)?"STALE":state.toUpperCase(java.util.Locale.ROOT);
            String message=switch(status) {
                case "READY" -> "자동화로 분류한 이벤트는 일반 통계의 기본 봇 제외 조건에서 분리합니다. 접속·검색·화면 이용은 제한하지 않습니다.";
                case "PLAN" -> "분류 결과를 검토 중입니다. 운영 통계에 아직 반영되지 않은 계획 집계입니다.";
                case "ERROR","PARTIAL" -> "최근 분류 작업의 오류 또는 부분 기록이 있습니다. 마지막 집계와 적용 범위를 확인하세요.";
                default -> "분류 작업 갱신이 지연됐습니다. 마지막 집계를 표시하며 신규 방문의 분류 완료를 보증하지 않습니다.";
            };
            return new Report(status,message,query.from().toString(),query.to().toString(),generated.toString(),partial,job,coverage,List.copyOf(rows),
                    OfficialCrawlerCatalog.read(directory,data.path("officialSources"),mapper,clock.instant()));
        } catch(java.nio.file.NoSuchFileException ignored) {
            return empty("NOT_READY","자동화 분류 집계 연결을 기다리고 있습니다. 기존 통계의 분류 결과를 0건으로 해석하지 마세요.",query);
        } catch(Exception ignored) {
            return empty("UNAVAILABLE","자동화 통계 집계를 읽지 못했습니다. 분류 0건이나 작업 완료를 뜻하지 않습니다.",query);
        }
    }
    private static long count(JsonNode node,String name) {
        JsonNode value=node.path(name);
        if(!value.isIntegralNumber() || !value.canConvertToLong())throw new IllegalArgumentException();
        long n=value.asLong();if(n<0 || n>1_000_000_000_000L)throw new IllegalArgumentException();return n;
    }
    private static String optionalInstant(JsonNode node,String name,Instant generated) {
        if(node.path(name).isMissingNode() || node.path(name).isNull())return null;
        Instant value=Instant.parse(node.path(name).asText());
        if(value.isAfter(generated.plusSeconds(60)))throw new IllegalArgumentException();return value.toString();
    }
    protected JsonNode loadExport() throws Exception {
        Path file=Path.of(directory).resolve("automation-statistics.json");
        if(!Files.exists(file,LinkOption.NOFOLLOW_LINKS))throw new java.nio.file.NoSuchFileException("automation-statistics.json");
        if(!Files.isRegularFile(file,LinkOption.NOFOLLOW_LINKS))throw new IllegalArgumentException();
        try(var stream=Files.newInputStream(file,LinkOption.NOFOLLOW_LINKS)) {
            byte[] bytes=stream.readNBytes(4_000_001);
            if(bytes.length>4_000_000)throw new IllegalArgumentException();return mapper.readTree(bytes);
        }
    }
    private Report empty(String status,String message,AnalyticsExploreQuery q) {
        return new Report(status,message,q.from().toString(),q.to().toString(),null,true,null,null,List.of(),OfficialCrawlerCatalog.read(directory,null,mapper,clock.instant()));
    }
}
