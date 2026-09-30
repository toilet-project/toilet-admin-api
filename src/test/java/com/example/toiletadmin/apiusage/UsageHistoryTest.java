package com.example.toiletadmin.apiusage;

import static com.example.toiletadmin.apiusage.UsageModels.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

class UsageHistoryTest {
    final UsageCatalog catalog=new UsageCatalog(new ObjectMapper());
    final UsageSnapshotReader snapshots=mock(UsageSnapshotReader.class);
    final GoogleUsageClient google=mock(GoogleUsageClient.class);
    final NaverUsageClient naver=mock(NaverUsageClient.class);
    final UsageHistoryStore store=mock(UsageHistoryStore.class);
    final Instant now=Instant.parse("2026-10-05T10:00:00Z");
    UsageHistoryTest() throws Exception {}
    Snapshot sample(String month,String at,long used) { return new Snapshot(month,Instant.parse(at),"Monitoring","project-one",Map.of("maps-sdk",new Counter(used,null))); }
    UsageHistoryService subject() { return new UsageHistoryService(catalog,snapshots,google,naver,store,Clock.fixed(now,ZoneOffset.UTC)); }
    @Test void fullMonthsAreStoredAndCachedButMissingIsNotZero() throws Exception {
        var value=sample("2026-09","2026-10-01T07:00:00Z",56);
        when(google.readMonth(any(),eq(Instant.parse("2026-09-01T07:00:00Z")),eq(value.asOf()),eq(now))).thenReturn(value);
        var service=subject(); var report=service.history("google-maps");
        assertThat(report.months()).hasSize(5);
        assertThat(report.months().getFirst().status()).isEqualTo("unavailable");
        assertThat(report.months().getFirst().metrics()).isEmpty();
        assertThat(report.months().getLast().status()).isEqualTo("complete");
        verify(store).save("google-maps",value);
        assertThat(service.history("google-maps")).isSameAs(report);
    }
    @Test void partialArchivesNeverBecomeCompleteJustBecauseTheMonthEnded() throws Exception {
        var partial=sample("2026-09","2026-09-30T03:00:00Z",50);
        when(store.find("google-maps","2026-09")).thenReturn(partial);
        when(google.readMonth(any(),any(),any(),any())).thenThrow(new GoogleUsageClient.NoUsageData());
        assertThat(subject().history("google-maps").months().getLast().status()).isEqualTo("partial");
    }
    @Test void providerErrorsAndInvalidArchivesCannotLeakDataOrInventTotals() throws Exception {
        when(store.find("google-maps","2026-09")).thenReturn(sample("2026-08","2026-09-01T07:00:00Z",999));
        var result=subject().history("google-maps").months().getLast();
        assertThat(result.status()).isEqualTo("error"); assertThat(result.metrics()).isEmpty();
        assertThatThrownBy(()->subject().history("../private")).isInstanceOf(IllegalArgumentException.class);
    }
    @Test void reportingDelayAndMonthBoundaryInvalidateCache() throws Exception {
        var clock=new ApiUsageTest.MutableClock(Instant.parse("2026-10-01T10:00:00Z"));
        var full=sample("2026-09","2026-10-01T07:00:00Z",56);
        when(store.find("google-maps","2026-09")).thenReturn(full);
        var service=new UsageHistoryService(catalog,snapshots,google,naver,store,clock);
        assertThat(service.history("google-maps").months().getLast().status()).isEqualTo("provisional");
        clock.time=Instant.parse("2026-11-01T10:00:00Z");
        assertThat(service.history("google-maps").months().getLast().month()).isEqualTo("2026-10");
    }
    @Test void googleRetentionRejectsTruncatedOldMonthsBeforeAnyRequest() throws Exception {
        var actual=new GoogleUsageClient(new ObjectMapper(),"sample-project","configured","","","","","") {
            @Override protected Long query(String p,String filter,Instant start,Instant end) { throw new AssertionError("Old month must not be queried"); }
        };
        var sdk=catalog.get().services().stream().filter(s->s.id().equals("google-maps")).findFirst().orElseThrow();
        assertThat(actual.readMonth(sdk,Instant.parse("2026-08-01T07:00:00Z"),Instant.parse("2026-09-01T07:00:00Z"),now)).isNull();
    }
    @Test void scheduledHistoryCollectorStoresAutomaticTranslationInsteadOfConsoleReference() throws Exception {
        var manual=new Snapshot("2026-10",now,"Google 결제 콘솔 확인값","청구 계정",
                Map.of("translation-characters",new Counter(900000,null)));
        var automatic=new Snapshot("2026-10",now.minusSeconds(3600),"Google Cloud Monitoring","NMT 입력 문자",
                Map.of("translation-characters",new Counter(910000,null)));
        when(snapshots.read("google-translation")).thenReturn(manual);
        when(google.read(argThat(s -> s.id().equals("google-translation")),any(),eq(now))).thenReturn(automatic);
        subject().collectRecent();
        verify(store).save("google-translation",automatic);
        verify(store,never()).save("google-translation",manual);
    }
    @Test void monthlyHistoryDoesNotPromoteConsoleReferenceIntoMonitoring() throws Exception {
        var manual=new Snapshot("2026-09",Instant.parse("2026-09-30T04:05:00Z"),"Google 결제 콘솔 확인값","청구 계정",
                Map.of("translation-characters",new Counter(900000,null)));
        when(store.find("google-translation","2026-09")).thenReturn(manual);
        when(snapshots.readMonth("google-translation","2026-09")).thenReturn(manual);
        var result=subject().history("google-translation").months().getLast();
        assertThat(result.status()).isEqualTo("unavailable");
        assertThat(result.metrics()).isEmpty();
        verify(store,never()).save("google-translation",manual);
    }
    @Test void scheduledCollectorPreservesCurrentCountersForFutureMonthRollover() throws Exception {
        var current=sample("2026-10","2026-10-05T09:00:00Z",10);
        when(google.read(argThat(s->s.id().equals("google-maps")),any(),any())).thenReturn(current);
        subject().collectRecent();
        verify(store).save("google-maps",current);
    }
}
