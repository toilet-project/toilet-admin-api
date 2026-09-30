package com.example.toiletadmin.apiusage;

import static com.example.toiletadmin.apiusage.UsageModels.*;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Duration;
import java.time.Instant;

public final class UsagePricing {
    public static final long MAX_QUANTITY = 1_000_000_000_000L;
    private UsagePricing() {}

    // Tier boundaries use total monthly volume, including the free portion.
    public static BigDecimal cost(Metric metric, long quantity, boolean includeFree) {
        if (quantity < 0 || quantity > MAX_QUANTITY) throw new IllegalArgumentException("Invalid quantity");
        if (metric.unlimited()) return BigDecimal.ZERO;
        long lower = includeFree ? metric.free() : 0;
        BigDecimal cost = BigDecimal.ZERO;
        for (Tier tier : metric.tiers()) {
            long upper = tier.through() == null ? MAX_QUANTITY : tier.through();
            long units = Math.max(0, Math.min(quantity, upper) - lower);
            if (units > 0) {
                if (tier.price() == null) return null; // Negotiated pricing, never invent a quote.
                cost = cost.add(tier.price().multiply(BigDecimal.valueOf(units))
                        .divide(BigDecimal.valueOf(metric.priceUnit()), 8, RoundingMode.HALF_UP));
            }
            if (quantity <= upper) break;
            lower = upper;
        }
        return cost.setScale(2, RoundingMode.HALF_UP);
    }

    public static Long project(long used, Instant start, Instant end, Instant asOf) {
        long elapsed = Duration.between(start, asOf).getSeconds();
        if (elapsed < 86400 || !asOf.isBefore(end)) return null;
        long total = Duration.between(start, end).getSeconds();
        return Math.min(MAX_QUANTITY, BigDecimal.valueOf(used).multiply(BigDecimal.valueOf(total))
                .divide(BigDecimal.valueOf(elapsed), 0, RoundingMode.CEILING).longValueExact());
    }
}
