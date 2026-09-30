package com.example.toiletadmin.cloudflare.service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Duration;
import java.time.Instant;

/** Public Standard/Paid rates, not an invoice. No FX, credits or tax are inferred. */
final class CloudflareCostCalculator {
    private CloudflareCostCalculator() { }
    static Double overage(Double used, double included, double billingUnit, double unitPrice, boolean roundUp) {
        if (used == null || !Double.isFinite(used) || used < 0) return null;
        BigDecimal excess = BigDecimal.valueOf(used).subtract(BigDecimal.valueOf(included)).max(BigDecimal.ZERO);
        BigDecimal units = excess.divide(BigDecimal.valueOf(billingUnit), roundUp ? 0 : 12,
                roundUp ? RoundingMode.CEILING : RoundingMode.HALF_UP);
        return units.multiply(BigDecimal.valueOf(unitPrice)).setScale(6, RoundingMode.HALF_UP).doubleValue();
    }
    static Double project(Double used, Instant start, Instant observedEnd, Instant endExclusive) {
        long elapsed = Duration.between(start, observedEnd).getSeconds();
        long full = Duration.between(start, endExclusive).getSeconds();
        if (used == null || elapsed < 86400 || elapsed > full || full <= 0) return null;
        return used * full / elapsed;
    }
}
