package com.example.toiletadmin.cloudflare.service;
import static org.assertj.core.api.Assertions.assertThat;
import java.time.Instant;
import org.junit.jupiter.api.Test;

class CloudflareCostCalculatorTest {
    @Test void r2OnlyRoundsBillableExcessAndAppliesAllowanceOnce() {
        assertThat(CloudflareCostCalculator.overage(1_000_000d,1_000_000,1_000_000,4.5,true)).isZero();
        assertThat(CloudflareCostCalculator.overage(1_000_001d,1_000_000,1_000_000,4.5,true)).isEqualTo(4.5);
        assertThat(CloudflareCostCalculator.overage(1_540_330d,1_000_000,1_000_000,4.5,true)).isEqualTo(4.5);
        assertThat(CloudflareCostCalculator.overage(2_000_001d,1_000_000,1_000_000,4.5,true)).isEqualTo(9);
    }
    @Test void workersCpuIsProportionalAndUnknownIsNotFree() {
        assertThat(CloudflareCostCalculator.overage(56_000_000d,30_000_000,1_000_000,.02,false)).isEqualTo(.52);
        assertThat(CloudflareCostCalculator.overage(null,30_000_000,1_000_000,.02,false)).isNull();
        assertThat(CloudflareCostCalculator.overage(Double.NaN,0,1,1,false)).isNull();
        assertThat(CloudflareCostCalculator.overage(-1d,0,1,1,false)).isNull();
    }
    @Test void forecastRequiresOneDayAndUsesActualCycleLength() {
        Instant start=Instant.parse("2026-09-29T00:00:00Z"), end=Instant.parse("2026-10-29T00:00:00Z");
        assertThat(CloudflareCostCalculator.project(100d,start,start.plusSeconds(86399),end)).isNull();
        assertThat(CloudflareCostCalculator.project(100d,start,start.plusSeconds(86400),end)).isEqualTo(3000);
        assertThat(CloudflareCostCalculator.project(100d,start,end.plusSeconds(1),end)).isNull();
    }
}
