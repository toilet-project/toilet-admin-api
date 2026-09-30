package com.example.toiletadmin.apiusage;

import static com.example.toiletadmin.apiusage.UsageModels.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

class ApiUsageTest {
    private final ObjectMapper mapper = new ObjectMapper();
    private final UsageCatalog catalog = new UsageCatalog(mapper);
    private final UsageSnapshotReader reader = mock(UsageSnapshotReader.class);
    private final GoogleUsageClient google = mock(GoogleUsageClient.class);
    private final NaverUsageClient naver = mock(NaverUsageClient.class);
    private final Instant now = Instant.parse("2026-09-16T07:00:00Z");
    ApiUsageTest() throws Exception {}
    private Metric metric(String id) { return catalog.get().services().stream().flatMap(s -> s.metrics().stream()).filter(m -> m.id().equals(id)).findFirst().orElseThrow(); }
    private ServiceUsage service(Report report,String id) { return report.services().stream().filter(s -> s.definition().id().equals(id)).findFirst().orElseThrow(); }
    private Snapshot sample(String month, Instant asOf, Map<String,Counter> metrics) { return new Snapshot(month,asOf,"test counter","test scope",metrics); }
    private ApiUsageService subject(Clock clock) { return new ApiUsageService(catalog,reader,google,naver,clock); }

    @Test void freeAllowanceAndGoogleVolumeTiers() {
        var price = metric("places-autocomplete");
        assertThat(UsagePricing.cost(price,10000,true)).isEqualByComparingTo("0");
        assertThat(UsagePricing.cost(price,100000,true)).isEqualByComparingTo("254.70");
        assertThat(UsagePricing.cost(price,200000,true)).isEqualByComparingTo("481.70");
        assertThat(UsagePricing.cost(price,5001000,true)).isEqualByComparingTo("5412.91");
        assertThat(UsagePricing.cost(price,200000,false)).isEqualByComparingTo("510");
        assertThat(UsagePricing.cost(metric("places-details"),11000,true)).isEqualByComparingTo("5");
    }
    @Test void translationCountsCharactersAndNegotiatedRatesStayUnknown() {
        assertThat(UsagePricing.cost(metric("translation-characters"),500000,true)).isEqualByComparingTo("0");
        assertThat(UsagePricing.cost(metric("translation-characters"),1500000,true)).isEqualByComparingTo("20");
        assertThat(UsagePricing.cost(metric("translation-characters"),1000000001,true)).isNull();
    }
    @Test void sdkFreeAndDailyKakaoQuote() {
        assertThat(UsagePricing.cost(metric("maps-sdk"),900000000,true)).isEqualByComparingTo("0");
        assertThat(UsagePricing.cost(metric("kakao-keyword"),100100,true)).isEqualByComparingTo("200");
        assertThat(UsagePricing.cost(metric("naver-map"),6001000,true)).isEqualByComparingTo("100");
        assertThatThrownBy(() -> UsagePricing.cost(metric("maps-sdk"),-1,true)).isInstanceOf(IllegalArgumentException.class);
    }
    @Test void projectionUsesObservedTimeAndHandlesLeapMonthAndDst() {
        assertThat(UsagePricing.project(1450,Instant.parse("2024-02-01T00:00:00Z"),Instant.parse("2024-03-01T00:00:00Z"),Instant.parse("2024-02-15T12:00:00Z"))).isEqualTo(2900L);
        assertThat(UsagePricing.project(15000,Instant.parse("2026-03-01T08:00:00Z"),Instant.parse("2026-04-01T07:00:00Z"),Instant.parse("2026-03-16T07:00:00Z"))).isEqualTo(31045L);
        assertThat(UsagePricing.project(100,now,now.plusSeconds(86400*30),now.plusSeconds(3600))).isNull();
    }
    @Test void missingConnectionsAreNeverPresentedAsZero() {
        var report = subject(Clock.fixed(now,ZoneOffset.UTC)).report();
        assertThat(report.services()).hasSize(5);
        assertThat(service(report,"naver").status()).isEqualTo("unconfigured");
        assertThat(service(report,"google-places").metrics()).allSatisfy(m -> { assertThat(m.used()).isNull(); assertThat(m.estimatedCost()).isNull(); });
        assertThat(report.services()).noneMatch(s -> s.definition().id().contains("public"));
    }
    @Test void kakaoMonthlyTotalsDoNotPretendDailyFreeAllowancesAreMonthly() throws Exception {
        when(reader.read("kakao")).thenReturn(sample("2026-09",now,Map.of("kakao-keyword",new Counter(900000,null))));
        var result = service(subject(Clock.fixed(now,ZoneOffset.UTC)).report(),"kakao");
        assertThat(result.status()).isEqualTo("partial");
        var value = result.metrics().get(1);
        assertThat(value.used()).isEqualTo(900000);
        assertThat(value.estimatedCost()).isNull();
        assertThat(value.projectedCost()).isNull();
    }
    @Test void verifiedDailyOverageCountsCanEstimateKakaoCosts() throws Exception {
        when(reader.read("kakao")).thenReturn(sample("2026-09",now,Map.of("kakao-keyword",new Counter(900000,1000L))));
        var value = service(subject(Clock.fixed(now,ZoneOffset.UTC)).report(),"kakao").metrics().get(1);
        assertThat(value.estimatedCost()).isEqualByComparingTo("2000");
    }
    @Test void snapshotValidationRejectsFuturePreviousMonthAndNegativeCounts() throws Exception {
        var definition = catalog.get().services().get(3);
        var start = Instant.parse("2026-09-01T07:00:00Z");
        assertThatThrownBy(() -> ApiUsageService.validate(sample("2026-08",now,Map.of("places-autocomplete",new Counter(1,null))),"2026-09",start,now,definition)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> ApiUsageService.validate(sample("2026-09",now.plusSeconds(1),Map.of("places-autocomplete",new Counter(1,null))),"2026-09",start,now,definition)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> ApiUsageService.validate(sample("2026-09",now,Map.of("places-autocomplete",new Counter(-1,null))),"2026-09",start,now,definition)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> ApiUsageService.validate(sample("2026-09",now,Map.of("places-autocomplete",new Counter(10,11L))),"2026-09",start,now,definition)).isInstanceOf(IllegalArgumentException.class);
    }
    @Test void cacheFallbackExpiresAtMonthBoundary() throws Exception {
        var clock = new MutableClock(now);
        when(reader.read("google-places")).thenReturn(sample("2026-09",now,Map.of("places-autocomplete",new Counter(200000,null),"places-details",new Counter(15000,null))));
        var subject = subject(clock);
        assertThat(service(subject.report(),"google-places").status()).isEqualTo("connected");
        assertThat(service(subject.report(),"google-places").metrics().getFirst().projected()).isEqualTo(400000L);
        verify(reader,times(1)).read("google-places");
        when(reader.read("google-places")).thenThrow(new IllegalStateException("secret must not appear"));
        clock.time = now.plusSeconds(600);
        var stale = service(subject.report(),"google-places");
        assertThat(stale.status()).isEqualTo("stale"); assertThat(stale.message()).doesNotContain("secret");
        clock.time = Instant.parse("2026-10-01T08:00:00Z");
        var nextMonth = service(subject.report(),"google-places");
        assertThat(nextMonth.status()).isEqualTo("error"); assertThat(nextMonth.metrics().getFirst().used()).isNull();
    }
    @Test void emptyGoogleSeriesIsUnknownButObservedZeroIsZero() {
        var empty = mapper.readTree("{\"timeSeries\":[]}");
        assertThat(GoogleUsageClient.count(empty,now.minusSeconds(3600),now)).isNull();
        var zero = mapper.readTree("""
                {"timeSeries":[{"points":[{"interval":{"startTime":"2026-09-16T06:00:00Z","endTime":"2026-09-16T07:00:00Z"},"value":{"int64Value":"0"}}]}]}
                """);
        assertThat(GoogleUsageClient.count(zero,now.minusSeconds(3600),now)).isZero();
        assertThatThrownBy(() -> GoogleUsageClient.count(zero,now.minusSeconds(60),now)).isInstanceOf(IllegalArgumentException.class);
    }
    @Test void invalidAndUnknownEstimatesAreRejected() {
        var controller = new ApiUsageController(subject(Clock.fixed(now,ZoneOffset.UTC)));
        assertThat(controller.estimate("places-details",-1,true).getStatusCode().value()).isEqualTo(400);
        assertThat(controller.estimate("unknown",1,true).getStatusCode().value()).isEqualTo(400);
        assertThat(controller.estimate("places-details",1000000000001L,true).getStatusCode().value()).isEqualTo(400);
    }
    @Test void expiredManualMonthDoesNotBlockAutomaticCurrentMonthReads() throws Exception {
        when(reader.read("google-places")).thenReturn(sample("2026-08",now.minusSeconds(86400*30),Map.of("places-autocomplete",new Counter(100,null))));
        when(google.read(argThat(s->s.id().equals("google-places")),any(),eq(now))).thenReturn(sample("2026-09",now,Map.of("places-autocomplete",new Counter(5,null),"places-details",new Counter(5,null))));
        var result=service(subject(Clock.fixed(now,ZoneOffset.UTC)).report(),"google-places");
        assertThat(result.status()).isEqualTo("connected");
        assertThat(result.metrics().getFirst().used()).isEqualTo(5);
    }
    static class MutableClock extends Clock {
        Instant time; MutableClock(Instant time) { this.time = time; }
        public ZoneId getZone() { return ZoneOffset.UTC; }
        public Clock withZone(ZoneId zone) { return this; }
        public Instant instant() { return time; }
    }
}
