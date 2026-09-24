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
}
