package com.example.toiletadmin.analytics.service;

import static org.assertj.core.api.Assertions.*;
import com.example.toiletadmin.analytics.dto.AnalyticsExploreResponse;
import java.time.*;
import java.util.*;
import javax.sql.DataSource;
import org.h2.jdbcx.JdbcDataSource;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.*;

/** Counts actual aggregate SQL executions against the same disposable data, not production timings. */
class AnalyticsExploreCostTest {
    private static final Clock CLOCK=Clock.fixed(Instant.parse("2026-09-24T03:30:00Z"),ZoneOffset.UTC);
    private static final class CountingJdbc extends JdbcTemplate {
        int aggregateQueries;
        CountingJdbc(DataSource ds){super(ds);}
        @Override public <T> List<T> query(PreparedStatementCreator statement,RowMapper<T> mapper) {
            aggregateQueries++;
            return super.query(statement,mapper);
        }
    }
    private AnalyticsExploreService service(CountingJdbc jdbc) {
        var summaries=new ServiceAnalyticsRepository(jdbc){@Override public boolean schemaReady(){return true;}};
        return new AnalyticsExploreService(new AnalyticsExploreRepository(jdbc),summaries,CLOCK);
    }
    @Test void scopedJourneyMatchesFullResultsWithLessInitialSqlAndNoExtraTotalScans() {
        var ds=new JdbcDataSource();ds.setURL("jdbc:h2:mem:"+UUID.randomUUID()+";MODE=MySQL;DB_CLOSE_DELAY=-1");
        var jdbc=new CountingJdbc(ds);AnalyticsPreviewServer.createSchema(jdbc);AnalyticsPreviewServer.seed(jdbc,CLOCK);
        record Scenario(String range,Map<String,String> filters,boolean excludeBots,int fullQueries,int overviewQueries){}
        var scenarios=List.of(new Scenario("today",Map.of(),true,38,14),new Scenario("7d",Map.of(),true,36,12),
                new Scenario("7d",Map.of("source","none","device","mobile"),false,36,12));
        for(var scenario:scenarios) {
            // Warm identical SQL before recording local elapsed times; no timing assertion or production claim.
            service(jdbc).explore(scenario.range(),null,null,scenario.filters(),scenario.excludeBots());
            jdbc.aggregateQueries=0;long start=System.nanoTime();
            var full=service(jdbc).explore(scenario.range(),null,null,scenario.filters(),scenario.excludeBots());
            long fullNanos=System.nanoTime()-start;int fullQueries=jdbc.aggregateQueries;
            assertThat(fullQueries).isEqualTo(scenario.fullQueries());
            jdbc.aggregateQueries=0;var scoped=service(jdbc);start=System.nanoTime();
            var overview=scoped.explore(scenario.range(),null,null,scenario.filters(),scenario.excludeBots(),"overview");
            long overviewNanos=System.nanoTime()-start;int overviewQueries=jdbc.aggregateQueries;
            assertThat(overviewQueries).isEqualTo(scenario.overviewQueries());
            assertThat(overview.current()).isEqualTo(full.current());assertThat(overview.previous()).isEqualTo(full.previous());
            assertThat(overview.trend()).isEqualTo(full.trend());assertThat(overview.botFilter()).isEqualTo(full.botFilter());
            for(String type:overview.dimensions().keySet()) {
                assertThat(overview.dimensions().get(type)).isEqualTo(full.dimensions().get(type));
                assertThat(overview.previousDimensions().get(type)).isEqualTo(full.previousDimensions().get(type));
            }
            for(String view:List.of("quality","content","acquisition","behavior","audience"))
                scoped.explore(scenario.range(),null,null,scenario.filters(),scenario.excludeBots(),view);
            AnalyticsExploreResponse completed=scoped.explore(scenario.range(),null,null,scenario.filters(),scenario.excludeBots());
            assertThat(completed).isEqualTo(full);
            assertThat(jdbc.aggregateQueries).isEqualTo(fullQueries);
            int beforeHit=jdbc.aggregateQueries;
            assertThat(scoped.explore(scenario.range(),null,null,scenario.filters(),scenario.excludeBots(),"overview")).isSameAs(completed);
            assertThat(jdbc.aggregateQueries).isEqualTo(beforeHit);
            System.out.printf(Locale.ROOT,"SYNTHETIC_COST range=%s filters=%s excludeBots=%s fullSql=%d overviewSql=%d allTabsSql=%d fullMs=%.1f overviewMs=%.1f%n",
                    scenario.range(),scenario.filters(),scenario.excludeBots(),fullQueries,overviewQueries,jdbc.aggregateQueries,fullNanos/1e6,overviewNanos/1e6);
        }
    }
}
