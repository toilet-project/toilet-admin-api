package com.example.toiletadmin.apiusage;

import static com.example.toiletadmin.apiusage.UsageModels.*;
import static org.assertj.core.api.Assertions.*;
import java.math.BigDecimal;
import java.time.*;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

class UsageBillingTest {
    final Instant start = Instant.parse("2026-09-01T00:00:00Z"), end = Instant.parse("2026-10-01T00:00:00Z"), now = Instant.parse("2026-09-16T00:00:00Z");
    BillingSnapshot sample(String account, String balance, LocalDate expiry) {
        return new BillingSnapshot("KRW", now, "console", "shared account",
                new BigDecimal("1000"), new BigDecimal("100"), new BigDecimal("900"), BigDecimal.ZERO,
                new BigDecimal("2000"), new BigDecimal(balance), expiry, account);
    }
    BillingUsage calculate(BillingSnapshot b) { return UsageBilling.calculate(b,start,end,now,ZoneOffset.UTC); }
    @Test void forecastSubtractsMonthlyAllowanceAndCurrentBalanceOnlyOnce() {
        var b = sample("paid","1100",LocalDate.parse("2026-12-21"));
        UsageBilling.validate(b,start,now);
        var result = calculate(b);
        assertThat(result.projectedUsageCost()).isEqualByComparingTo("1900");
        assertThat(result.projectedAdditionalCost()).isEqualByComparingTo("1000");
        assertThat(result.projectedCreditUse()).isEqualByComparingTo("1000");
        assertThat(result.projectedCreditRemaining()).isEqualByComparingTo("100");
        assertThat(result.projectedPayable()).isZero();
        assertThat(result.creditUsed()).isEqualByComparingTo("900");
    }
    @Test void exhaustedPaidAndFreeTrialAccountsHaveDifferentPaymentOutcomes() {
        var paid = calculate(sample("paid","200",LocalDate.parse("2026-12-21")));
        assertThat(paid.projectedPayable()).isEqualByComparingTo("800");
        var trial = calculate(sample("free-trial","200",LocalDate.parse("2026-12-21")));
        assertThat(trial.projectedUncoveredCost()).isEqualByComparingTo("800");
        assertThat(trial.projectedPayable()).isZero();
        assertThat(trial.forecastMessage()).contains("자동 결제되지", "중단");
        assertThat(calculate(sample("unknown","200",LocalDate.parse("2026-12-21"))).projectedPayable()).isNull();
    }
    @Test void expiredUnknownAndStaleCreditsDoNotPromiseFutureDiscounts() {
        assertThat(calculate(sample("paid","1100",LocalDate.parse("2026-09-20"))).projectedPayable()).isNull();
        assertThat(calculate(sample("paid","1100",null)).projectedPayable()).isNull();
        assertThat(UsageBilling.calculate(sample("paid","1100",LocalDate.parse("2026-12-21")),start,end,now.plusSeconds(86400),ZoneOffset.UTC).projectedPayable()).isNull();
    }
    @Test void invalidAmountsAndUnreconciledReportsFailClosed() {
        assertThatThrownBy(() -> UsageBilling.validate(sample("paid","2001",null),start,now)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> UsageBilling.validate(sample("paid","-1",null),start,now)).isInstanceOf(IllegalArgumentException.class);
        var b = sample("paid","1100",null);
        var mismatch = new BillingSnapshot(b.currency(),b.asOf(),b.source(),b.scope(),b.grossCost(),b.freeTierSavings(),BigDecimal.ZERO,b.netCost(),b.creditTotal(),b.creditRemaining(),null,b.accountState());
        assertThatThrownBy(() -> UsageBilling.validate(mismatch,start,now)).isInstanceOf(IllegalArgumentException.class);
    }
    @Test void legacySnapshotsRemainCompatibleAndBillingRoundTrips() {
        var mapper = new ObjectMapper();
        Snapshot legacy = mapper.readValue("{\"month\":\"2026-09\",\"asOf\":\"2026-09-16T00:00:00Z\",\"source\":\"console\",\"scope\":\"test\",\"metrics\":{}}",Snapshot.class);
        assertThat(legacy.billing()).isNull();
        var full = new Snapshot(legacy.month(),legacy.asOf(),legacy.source(),legacy.scope(),legacy.metrics(),sample("paid","1100",LocalDate.parse("2026-12-21")));
        assertThat(mapper.readValue(mapper.writeValueAsString(full),Snapshot.class)).isEqualTo(full);
    }
    @Test void nativeSdkQueriesConsumedApiWithoutAddingPlacesTraffic() throws Exception {
        var mapper = new ObjectMapper();
        var sdk = new UsageCatalog(mapper).get().services().stream().filter(s -> s.id().equals("google-maps")).findFirst().orElseThrow();
        var google = new GoogleUsageClient(mapper,"sample-project","configured","","","","","") {
            @Override protected Long query(String project,String filter,Instant from,Instant through) {
                assertThat(filter).contains("serviceruntime.googleapis.com/api/request_count", "consumed_api", "maps-android-backend", "maps-ios-backend").doesNotContain("places.googleapis.com");
                return 56L;
            }
        };
        assertThat(google.read(sdk,start,now).metrics().get("maps-sdk").used()).isEqualTo(56);
    }
}
