package com.example.toiletadmin.analytics.service;

import static org.assertj.core.api.Assertions.*;
import com.example.toiletadmin.analytics.dto.AnalyticsExploreResponse.*;
import java.time.*;
import java.util.*;
import java.sql.Timestamp;
import org.h2.jdbcx.JdbcDataSource;
import org.junit.jupiter.api.*;
import org.springframework.jdbc.core.JdbcTemplate;

class AnalyticsExploreRepositoryTest {
    private JdbcTemplate jdbc;
    private AnalyticsExploreRepository repository;
    private static final Clock CLOCK=Clock.fixed(Instant.parse("2026-09-24T03:30:00Z"),ZoneOffset.UTC);
    @BeforeEach void setup(){
        var ds=new JdbcDataSource();ds.setURL("jdbc:h2:mem:"+UUID.randomUUID()+";MODE=MySQL;DB_CLOSE_DELAY=-1");jdbc=new JdbcTemplate(ds);
        jdbc.execute("""
            CREATE TABLE service_analytics_event(event_id BIGINT AUTO_INCREMENT PRIMARY KEY,
             occurred_at TIMESTAMP,occurred_date DATE,event_name VARCHAR(40),page_key VARCHAR(120),
             channel_key VARCHAR(40),source_key VARCHAR(80),device_type VARCHAR(20),os_family VARCHAR(30),
             browser_family VARCHAR(30),country_code VARCHAR(2),city_name VARCHAR(80),visitor_hash BINARY(32),
             session_hash BINARY(32),engagement_seconds INTEGER,result_count_bucket VARCHAR(16),event_detail VARCHAR(40),
             success_status BOOLEAN,key_event BOOLEAN)
            """);repository=new AnalyticsExploreRepository(jdbc);
    }
    private void event(String at,String name,int visitor,int session,String source,String page,String detail,Boolean success,int engagement){
        var instant=Instant.parse(at);byte[] v=new byte[32],s=new byte[32];v[0]=(byte)visitor;s[0]=(byte)session;
        jdbc.update("INSERT INTO service_analytics_event(occurred_at,occurred_date,event_name,page_key,channel_key,source_key,device_type,os_family,browser_family,country_code,city_name,visitor_hash,session_hash,engagement_seconds,result_count_bucket,event_detail,success_status,key_event) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                Timestamp.from(instant),java.sql.Date.valueOf(instant.atZone(ZoneId.of("Asia/Seoul")).toLocalDate()),name,page,"none".equals(source)?"Direct":"Organic Search",source,"mobile","iOS","Safari","KR","Seoul",v,s,engagement,"0",detail,success,false);
    }
    private AnalyticsExploreQuery query(String range,Map<String,String> filters){return AnalyticsExploreQuery.resolve(range,null,null,filters,CLOCK);}
    @Test void sessionStartsAndVisitorDaysAreNotEventCounts(){
        event("2026-09-23T01:00:00Z","session_start",1,1,"naver","/","",null,0);
        event("2026-09-24T01:00:00Z","session_start",1,2,"naver","/","",null,0);
        event("2026-09-24T01:01:00Z","page_view",1,2,"naver","/","",null,0);
        event("2026-09-24T01:02:00Z","engagement",1,2,"naver","/","",null,20);
        var days=repository.daily(query("7d",Map.of()));
        assertThat(days).hasSize(2);assertThat(days.stream().mapToLong(p->p.metrics().visitors()).sum()).isEqualTo(2);
        var row=repository.dimension("source",query("today",Map.of())).getFirst();
        assertThat(row.metrics().sessions()).isEqualTo(1);assertThat(row.metrics().events()).isEqualTo(3);
        assertThat(row.metrics().engagementSeconds()).isEqualTo(20);
        assertThat(repository.dimension("page",query("today",Map.of())).getFirst().metrics().views()).isEqualTo(1);
    }
    @Test void filtersAreBoundParametersAndHourCutoffIsKoreanLocalTime(){
        event("2026-09-24T01:00:00Z","page_view",1,1,"naver","/","",null,0);
        event("2026-09-24T04:00:00Z","page_view",2,2,"google","/","",null,0);
        var points=repository.hourly(query("today",Map.of("source","naver")));
        assertThat(points).hasSize(1);assertThat(points.getFirst().key()).isEqualTo("10:00");
        assertThat(repository.daily(query("today",Map.of("source","' OR 1=1 --")))).isEmpty();
        assertThat(repository.daily(query("today",Map.of())).getFirst().metrics().views()).isEqualTo(1);
    }
    @Test void funnelRequiresSameSessionOrderAndExplicitSuccess(){
        event("2026-09-24T01:00:00Z","report_submit",1,1,"naver","/","",true,0);
        event("2026-09-24T01:01:00Z","report_start",1,1,"naver","/","",null,0);
        event("2026-09-24T01:02:00Z","report_submit",1,1,"naver","/","",false,0);
        event("2026-09-24T01:03:00Z","report_start",2,2,"naver","/","",null,0);
        event("2026-09-24T01:04:00Z","report_submit",2,2,"naver","/","",true,0);
        event("2026-09-24T01:05:00Z","report_submit",3,3,"naver","/","",true,0);
        var flow=repository.flows(query("today",Map.of())).get(1);
        assertThat(flow.steps()).extracting(Step::sessions).containsExactly(2L,1L);
        var eventRow=repository.dimension("event",query("today",Map.of())).stream().filter(r->r.key().equals("report_submit")).findFirst().orElseThrow();
        assertThat(eventRow.metrics().successes()).isEqualTo(3);assertThat(eventRow.metrics().failures()).isEqualTo(1);
    }
    @Test void yesterdayComparisonStopsAtTheSameTimeAndRangeIsValidated(){
        var q=query("today",Map.of());assertThat(q.previousUntil()).isEqualTo(Instant.parse("2026-09-23T03:30:00Z"));
        assertThatThrownBy(()->query("invalid",Map.of())).hasMessageContaining("400");
        assertThatThrownBy(()->query("today",Map.of("password","x"))).hasMessageContaining("400");
        assertThatThrownBy(()->AnalyticsExploreQuery.resolve("custom","2026-09-25","2026-09-25",Map.of(),CLOCK)).hasMessageContaining("400");
    }
    @Test void visitedPageFilterIncludesItsSessionAcquisitionAndLaterBehavior(){
        event("2026-09-24T01:00:00Z","session_start",1,1,"naver","/","",null,0);
        event("2026-09-24T01:01:00Z","page_view",1,1,"naver","/toilet/:id","",null,0);
        event("2026-09-24T01:02:00Z","report_start",1,1,"naver","/","",null,0);
        event("2026-09-24T01:03:00Z","report_submit",1,1,"naver","/","",true,0);
        event("2026-09-24T01:04:00Z","session_start",2,2,"google","/","",null,0);
        var query=query("today",Map.of("page","/toilet/:id"));
        var metrics=repository.daily(query).getFirst().metrics();
        assertThat(metrics.sessions()).isEqualTo(1);assertThat(metrics.events()).isEqualTo(4);
        assertThat(repository.dimension("source",query)).extracting(Row::key).containsExactly("naver");
        assertThat(repository.flows(query).get(1).steps()).extracting(Step::sessions).containsExactly(1L,1L);
    }
    @Test void duplicateStartQualityDoesNotInflateAcquisition(){
        event("2026-09-24T01:00:00Z","session_start",1,1,"none","/other","",null,0);
        event("2026-09-24T01:01:00Z","session_start",1,1,"none","/other","",null,0);
        event("2026-09-24T01:02:00Z","page_view",1,1,"none","/other","",null,0);
        assertThat(repository.quality(query("today",Map.of()))).containsExactly(1,1,0,1);
    }
    @Test void botExclusionAppliesToMetricsDimensionsFlowsPageSessionsAndRealtime(){
        assertThat(repository.botClassificationAvailable()).isFalse();
        jdbc.execute("ALTER TABLE service_analytics_event ADD COLUMN traffic_class VARCHAR(16) NOT NULL DEFAULT 'LEGACY'");
        assertThat(repository.botClassificationAvailable()).isTrue();
        for(int i=1;i<=3;i++) {
            event("2026-09-24T01:00:00Z","session_start",i,i,"none","/","",null,0);
            event("2026-09-24T01:01:00Z","page_view",i,i,"none","/toilet/:id","",null,0);
            event("2026-09-24T01:02:00Z","report_start",i,i,"none","/","",null,0);
            event("2026-09-24T01:03:00Z","report_submit",i,i,"none","/","",true,0);
        }
        jdbc.update("UPDATE service_analytics_event SET traffic_class='BOT' WHERE event_id>8");
        jdbc.update("UPDATE service_analytics_event SET traffic_class='UNFLAGGED' WHERE event_id<=4");
        var q=query("today",Map.of("page","/toilet/:id")).withBotClassification(true);
        assertThat(repository.daily(q).getFirst().metrics().views()).isEqualTo(2);
        assertThat(repository.daily(q.includingBots()).getFirst().metrics().views()).isEqualTo(3);
        assertThat(repository.dimension("source",q).getFirst().metrics().sessions()).isEqualTo(2);
        assertThat(repository.flows(q).get(1).steps()).extracting(Step::sessions).containsExactly(2L,2L);
        assertThat(repository.flows(q.includingBots()).get(1).steps()).extracting(Step::sessions).containsExactly(3L,3L);
        assertThat(repository.trafficCoverage(q)).containsExactly(4,4,4);
        assertThat(repository.hourly(q).getFirst().metrics().visitors()).isEqualTo(2);
        assertThat(repository.quality(q)[1]).isEqualTo(2);
        var summaries=new ServiceAnalyticsRepository(jdbc);
        assertThat(summaries.realtime(Instant.parse("2026-09-24T00:00:00Z")).views()).isEqualTo(2);
        assertThat(summaries.realtime(Instant.parse("2026-09-24T00:00:00Z"),false).views()).isEqualTo(3);
        // A bot-only page must not qualify other rows sharing the same (untrusted) session.
        jdbc.update("UPDATE service_analytics_event SET traffic_class='BOT' WHERE event_name='page_view'");
        assertThat(repository.daily(q)).isEmpty();
        assertThat(repository.daily(q.includingBots())).isNotEmpty();
    }
}
