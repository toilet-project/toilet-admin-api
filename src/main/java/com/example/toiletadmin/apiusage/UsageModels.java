package com.example.toiletadmin.apiusage;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;

public final class UsageModels {
    private UsageModels() {}
    public record Catalog(String verifiedAt, List<Service> services) {}
    public record Service(String id, String name, String badge, String description, boolean active,
                          String currency, String timeZone, String consoleUrl, String pricingUrl,
                          List<String> notes, List<Metric> metrics) {}
    public record Metric(String id, String name, String unit, String period, long free, boolean unlimited,
                         long priceUnit, List<Tier> tiers) {}
    public record Tier(Long through, BigDecimal price) {}
    /** Cumulative totals from periodStart through asOf, never a rolling window. */
    public record Snapshot(String month, Instant asOf, String source, String scope,
                           Map<String, Counter> metrics, BillingSnapshot billing) {
        public Snapshot(String month, Instant asOf, String source, String scope, Map<String, Counter> metrics) {
            this(month, asOf, source, scope, metrics, null);
        }
    }
    /** Provider billing currency only. Promotional balance belongs to the shared billing account. */
    public record BillingSnapshot(String currency, Instant asOf, String source, String scope,
            BigDecimal grossCost, BigDecimal freeTierSavings, BigDecimal promotionalCreditApplied,
            BigDecimal netCost, BigDecimal creditTotal, BigDecimal creditRemaining,
            java.time.LocalDate creditExpiresOn, String accountState) {}
    public record BillingUsage(BillingSnapshot observed, BigDecimal creditUsed,
            BigDecimal projectedUsageCost, BigDecimal projectedAdditionalCost,
            BigDecimal projectedCreditUse, BigDecimal projectedCreditRemaining,
            BigDecimal projectedUncoveredCost, BigDecimal projectedPayable, String forecastMessage) {}
    public record Counter(long used, Long billableUsed) {}
    public record MetricUsage(Metric definition, Long used, Long projected, Long overage,
                              BigDecimal estimatedCost, BigDecimal projectedCost) {}
    public record ServiceUsage(Service definition, String status, String message, String source,
                               String scope, Instant asOf, Instant periodStart, Instant periodEnd,
                               List<MetricUsage> metrics, BillingUsage billing, Snapshot reference) {}
    public record Report(Instant checkedAt, String pricingVerifiedAt, List<ServiceUsage> services) {}
    public record Estimate(String currency, long quantity, long freeApplied, long overage,
                           BigDecimal cost, String period) {}
}
