package com.example.toiletadmin.analytics.service;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import com.example.toiletadmin.analytics.dto.AnalyticsExploreResponse.*;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.*;

class AnalyticsExploreServiceTest {
    private final AnalyticsExploreRepository repo=mock(AnalyticsExploreRepository.class);
    private final ServiceAnalyticsRepository summaries=mock(ServiceAnalyticsRepository.class);
    private final Clock clock=Clock.fixed(Instant.parse("2026-09-24T03:30:00Z"),ZoneOffset.UTC);
    private final AnalyticsExploreService service=new AnalyticsExploreService(repo,summaries,clock);
    @BeforeEach void setup(){
        when(summaries.schemaReady()).thenReturn(true);
        when(repo.firstEventDate()).thenReturn(LocalDate.of(2026,9,15));
        when(repo.daily(any())).thenReturn(List.of());when(repo.hourly(any())).thenReturn(List.of());
        when(repo.dimension(anyString(),any())).thenReturn(List.of());when(repo.flows(any())).thenReturn(List.of());
        when(repo.quality(any())).thenReturn(new long[4]);
        when(repo.trafficCoverage(any())).thenReturn(new long[3]);
        when(repo.entryClues(any())).thenReturn(new EntryClues(true,false,false,List.of()));
    }
    @Test void futureHoursAreNotZerosAndSameQueryIsCached(){
        var r=service.explore("today",null,null,Map.of());
        assertThat(r.comparisonAvailable()).isTrue();assertThat(r.hourly()).isTrue();
        assertThat(r.trend()).hasSize(24);assertThat(r.trend().get(12).metrics()).isNotNull();
        assertThat(r.trend().get(13).metrics()).isNull();
        assertThat(service.explore("today",null,null,Map.of())).isSameAs(r);
        verify(repo,times(1)).quality(any());
    }
    @Test void incompleteComparisonIsUnavailableInsteadOfInventingZeroBaseline(){
        var r=service.explore("7d",null,null,Map.of());
        assertThat(r.previous()).isNull();assertThat(r.comparisonAvailable()).isFalse();
        assertThat(r.visitorDefinition()).isEqualTo("일별 추정 방문자 합계");
    }
    @Test void oldDetailedFiltersAreRejectedRatherThanSilentlyIgnored(){
        assertThatThrownBy(()->service.explore("custom","2026-08-01","2026-08-31",Map.of("device","mobile"))).hasMessageContaining("400");
        verify(repo,never()).daily(any());
    }
    @Test void botModeHasSeparateCacheAndHistoricalClassificationIsNotInvented(){
        when(repo.trafficCoverage(any())).thenReturn(new long[]{0,0,25});
        var excluded=service.explore("today",null,null,Map.of(),true);
        var included=service.explore("today",null,null,Map.of(),false);
        assertThat(included).isNotSameAs(excluded);
        assertThat(excluded.botFilter().excludeBots()).isTrue();
        assertThat(included.botFilter().excludeBots()).isFalse();
        assertThat(included.botFilter().legacyEvents()).isEqualTo(25);
        assertThat(included.botFilter().note()).contains("재판별");
        assertThat(service.explore("today",null,null,Map.of(),false)).isSameAs(included);
        assertThatThrownBy(()->service.explore("custom","2026-08-01","2026-08-31",Map.of(),false)).hasMessageContaining("봇 포함 조회");
    }
    @Test void explainsUnchangedNumbersWhenThereAreNoClassifiedBotEvents(){
        when(repo.botClassificationAvailable()).thenReturn(true);
        when(repo.trafficCoverage(any())).thenReturn(new long[]{0,10,5});
        var r=service.explore("today",null,null,Map.of(),true);
        assertThat(r.botFilter().note()).contains("수치가 같습니다", "분류 전 기록 5건");
    }
    @Test void displaysActualBotEventCountInsteadOfServerRequestCount(){
        when(repo.botClassificationAvailable()).thenReturn(true);
        when(repo.trafficCoverage(any())).thenReturn(new long[]{7,10,0});
        assertThat(service.explore("today",null,null,Map.of(),true).botFilter().note()).contains("7건을 제외");
        assertThat(service.explore("today",null,null,Map.of(),false).botFilter().note()).contains("7건을 포함");
    }
    @Test void overviewLoadsOnlyDropdownDimensionsAndTabsAddMissingWorkOnce(){
        var overview=service.explore("today",null,null,Map.of(),true,"overview");
        assertThat(overview.dimensions()).containsOnlyKeys("page","source","country","client");
        verify(repo,times(8)).dimension(anyString(),any());
        verify(repo,never()).flows(any());verify(repo,never()).entryClues(any());
        assertThat(service.explore("today",null,null,Map.of(),true,"quality")).isSameAs(overview);
        service.explore("today",null,null,Map.of(),true,"content");
        verify(repo,times(10)).dimension(anyString(),any());
        var acquisition=service.explore("today",null,null,Map.of(),true,"acquisition");
        verify(repo,times(18)).dimension(anyString(),any());verify(repo).entryClues(any());
        assertThat(acquisition.entryClues().available()).isTrue();
        var behavior=service.explore("today",null,null,Map.of(),true,"behavior");
        verify(repo,times(20)).dimension(anyString(),any());verify(repo).flows(any());
        assertThat(service.explore("today",null,null,Map.of(),true,"behavior")).isSameAs(behavior);
        var all=service.explore("today",null,null,Map.of());
        assertThat(all.dimensions()).hasSize(14);assertThat(all.previousDimensions()).hasSize(14);
        verify(repo,times(28)).dimension(anyString(),any());
        verify(repo,times(2)).daily(any());verify(repo).quality(any());verify(repo).trafficCoverage(any());
        verify(repo).flows(any());verify(repo).entryClues(any());
        assertThat(all.generatedAt()).isEqualTo(overview.generatedAt());
        assertThat(all.current()).isEqualTo(overview.current());assertThat(all.trend()).isEqualTo(overview.trend());
        assertThat(all.previous()).isEqualTo(overview.previous());assertThat(all.previousTrend()).isEqualTo(overview.previousTrend());
    }
    @Test void invalidViewDoesNotTouchTheStore(){
        assertThatThrownBy(()->service.explore("today",null,null,Map.of(),true,"unknown")).hasMessageContaining("400");
        verifyNoInteractions(repo,summaries);
    }
    @Test void failedExpansionKeepsLastGoodCacheAndCanBeRetried(){
        var overview=service.explore("today",null,null,Map.of(),true,"overview");
        when(repo.flows(any())).thenThrow(new IllegalStateException("private SQL details"));
        assertThatThrownBy(()->service.explore("today",null,null,Map.of(),true,"behavior"))
                .hasMessageContaining("503").hasMessageNotContaining("private SQL details");
        assertThat(service.explore("today",null,null,Map.of(),true,"overview")).isSameAs(overview);
        doReturn(List.of()).when(repo).flows(any());
        var retried=service.explore("today",null,null,Map.of(),true,"behavior");
        assertThat(retried.dimensions()).containsKey("event");
        verify(repo).quality(any());
    }
    @Test void expansionUsesFrozenCutoffAndDoesNotExtendExpiry(){
        var now=new java.util.concurrent.atomic.AtomicReference<>(Instant.parse("2026-09-24T03:30:00Z"));
        Clock moving=new Clock(){public ZoneId getZone(){return ZoneOffset.UTC;}public Clock withZone(ZoneId z){return this;}public Instant instant(){return now.get();}};
        var cached=new AnalyticsExploreService(repo,summaries,moving);
        var first=cached.explore("today",null,null,Map.of(),true,"overview");
        now.set(now.get().plusSeconds(50));
        var expanded=cached.explore("today",null,null,Map.of(),true,"behavior");
        assertThat(expanded.cutoff()).isEqualTo(first.cutoff());
        verify(repo).flows(argThat(q->q.until().equals(Instant.parse("2026-09-24T03:30:00Z"))));
        now.set(now.get().plusSeconds(11));
        var refreshed=cached.explore("today",null,null,Map.of(),true,"overview");
        assertThat(refreshed.generatedAt()).isNotEqualTo(first.generatedAt());
        assertThat(refreshed.dimensions()).doesNotContainKey("event");verify(repo,times(2)).quality(any());
    }
    @Test void filtersAndBotModeCannotReuseAnotherQueriesDimensions(){
        var base=service.explore("today",null,null,Map.of(),true,"overview");
        var filtered=service.explore("today",null,null,Map.of("source","naver"),true,"content");
        var bots=service.explore("today",null,null,Map.of(),false,"behavior");
        assertThat(filtered).isNotSameAs(base);assertThat(bots).isNotSameAs(base);
        assertThat(base.dimensions()).doesNotContainKeys("screen","event");
        verify(repo,times(3)).quality(any());
    }
    @Test void extendingHistoricalCutoffCacheDoesNotRenewItsSixtySecondLifetime(){
        var now=new java.util.concurrent.atomic.AtomicReference<>(Instant.parse("2026-09-24T03:30:00Z"));
        Clock moving=new Clock(){public ZoneId getZone(){return ZoneOffset.UTC;}public Clock withZone(ZoneId z){return this;}public Instant instant(){return now.get();}};
        var cached=new AnalyticsExploreService(repo,summaries,moving);
        var first=cached.explore("yesterday",null,null,Map.of(),true,"overview");
        now.set(now.get().plusSeconds(50));
        cached.explore("yesterday",null,null,Map.of(),true,"content");
        now.set(now.get().plusSeconds(11));
        var refreshed=cached.explore("yesterday",null,null,Map.of(),true,"overview");
        assertThat(refreshed.generatedAt()).isNotEqualTo(first.generatedAt());
        assertThat(refreshed.dimensions()).doesNotContainKey("screen");verify(repo,times(2)).quality(any());
    }
    @Test void historicalScopesUseDailyDimensionsWithoutInventingScreenOrFlowData(){
        when(summaries.summary(any(),any())).thenReturn(new com.example.toiletadmin.analytics.dto.ServiceAnalyticsReportResponse.SummaryMetrics(0,0,0,0,0,0,0,0));
        when(summaries.trend(any(),any())).thenReturn(List.of());
        when(summaries.dimensions(anyString(),any(),any(),anyInt())).thenReturn(List.of());
        var overview=service.explore("custom","2026-08-01","2026-08-31",Map.of(),true,"overview");
        assertThat(overview.detailed()).isFalse();assertThat(overview.dimensions()).hasSize(4);
        assertThat(service.explore("custom","2026-08-01","2026-08-31",Map.of(),true,"content")).isSameAs(overview);
        var all=service.explore("custom","2026-08-01","2026-08-31",Map.of());
        assertThat(all.dimensions()).hasSize(13).doesNotContainKey("screen");
        assertThat(all.entryClues().available()).isFalse();assertThat(all.flows()).isEmpty();
        verify(summaries,times(13)).dimensions(anyString(),any(),any(),anyInt());verify(repo,never()).dimension(anyString(),any());
    }
    @Test void addedDimensionKeepsTruncationWarningAndLimit(){
        var rows=java.util.stream.IntStream.range(0,501).mapToObj(i->new Row("event"+i,Metrics.zero())).toList();
        when(repo.dimension(eq("event"),any())).thenReturn(rows);
        service.explore("today",null,null,Map.of(),true,"overview");
        var r=service.explore("today",null,null,Map.of(),true,"behavior");
        assertThat(r.dimensions().get("event")).hasSize(500);assertThat(r.quality().rowsTruncated()).isTrue();
        assertThat(r.notices().stream().filter(n->n.contains("최대 500개"))).hasSize(1);
    }
    @Test void simultaneousTabsShareBaseAndDoNotRepeatDimensions() throws Exception {
        try(var executor=java.util.concurrent.Executors.newFixedThreadPool(3)) {
            var work=List.<java.util.concurrent.Callable<Object>>of(
                    ()->service.explore("today",null,null,Map.of(),true,"overview"),
                    ()->service.explore("today",null,null,Map.of(),true,"acquisition"),
                    ()->service.explore("today",null,null,Map.of(),true,"behavior"));
            for(var task:executor.invokeAll(work)) task.get();
        }
        verify(repo).quality(any());verify(repo,times(18)).dimension(anyString(),any());
        verify(repo).flows(any());verify(repo).entryClues(any());
    }
}
