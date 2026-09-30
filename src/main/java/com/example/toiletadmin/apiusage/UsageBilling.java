package com.example.toiletadmin.apiusage;

import static com.example.toiletadmin.apiusage.UsageModels.*;
import java.math.*;
import java.time.*;
import java.util.Set;

/** Forecasts this service's incremental cost against one shared balance, never against each SKU. */
final class UsageBilling {
    private UsageBilling() {}
    static void validate(BillingSnapshot b, Instant start, Instant now) {
        if (b == null) return;
        if (!Set.of("KRW", "USD").contains(b.currency()) || b.asOf() == null || b.asOf().isBefore(start)
                || b.asOf().isAfter(now) || b.source() == null || b.source().isBlank()
                || b.scope() == null || b.scope().isBlank() || b.accountState() == null
                || !Set.of("free-trial", "paid", "unknown").contains(b.accountState()))
            throw new IllegalArgumentException("Invalid billing observation");
        for (var amount : new BigDecimal[]{b.grossCost(), b.freeTierSavings(), b.promotionalCreditApplied(),
                b.netCost(), b.creditTotal(), b.creditRemaining()}) {
            if (amount == null || amount.signum() < 0 || amount.compareTo(BigDecimal.valueOf(UsagePricing.MAX_QUANTITY)) > 0)
                throw new IllegalArgumentException("Invalid billing amount");
        }
        var tolerance = new BigDecimal(b.currency().equals("KRW") ? "1" : "0.02");
        if (b.grossCost().subtract(b.freeTierSavings()).subtract(b.promotionalCreditApplied()).subtract(b.netCost()).abs().compareTo(tolerance) > 0
                || b.freeTierSavings().compareTo(b.grossCost()) > 0 || b.creditRemaining().compareTo(b.creditTotal()) > 0
                || b.accountState().equals("free-trial") && b.netCost().signum() != 0)
            throw new IllegalArgumentException("Inconsistent billing totals");
    }
    static BillingUsage calculate(BillingSnapshot b, Instant start, Instant end, Instant now, ZoneId zone) {
        if (b == null) return null;
        BigDecimal used = b.creditTotal().subtract(b.creditRemaining());
        long elapsed = Duration.between(start, b.asOf()).getSeconds();
        String unavailable = elapsed < 86400 ? "하루 이상의 청구 집계가 있어야 월말을 예상할 수 있습니다."
                : Duration.between(b.asOf(), now).toHours() >= 24 ? "크레딧 확인값이 오래되어 월말 결제액 계산을 보류했습니다."
                : b.creditExpiresOn() == null ? "크레딧 만료일 확인 후 월말 결제액을 계산할 수 있습니다."
                : b.creditExpiresOn().isBefore(end.atZone(zone).toLocalDate()) ? "월말 전에 크레딧이 만료되어 월말 결제액 계산을 보류했습니다." : null;
        if (unavailable != null) return new BillingUsage(b, used, null, null, null, null, null, null, unavailable);
        // Keep the already-applied monthly free allowance fixed; do not prorate it or subtract it twice.
        var projected = b.grossCost().multiply(BigDecimal.valueOf(Duration.between(start, end).getSeconds()))
                .divide(BigDecimal.valueOf(elapsed), 2, RoundingMode.HALF_UP).max(b.grossCost())
                .subtract(b.freeTierSavings()).max(BigDecimal.ZERO);
        var additional = projected.subtract(b.grossCost().subtract(b.freeTierSavings())).max(BigDecimal.ZERO);
        var creditUse = additional.min(b.creditRemaining());
        var remaining = b.creditRemaining().subtract(creditUse);
        var uncovered = additional.subtract(creditUse);
        BigDecimal payable = switch (b.accountState()) {
            case "free-trial" -> BigDecimal.ZERO;
            case "paid" -> b.netCost().add(uncovered);
            default -> null;
        };
        String message = "이 달 평균 사용 추세 · 다른 서비스의 추가 크레딧 사용 없음 · 세금 제외. "
                + (b.accountState().equals("free-trial") ? "현재 무료 체험 계정으로 자동 결제되지 않습니다. 크레딧 소진·기간 만료 시 업그레이드 전까지 서비스가 중단될 수 있습니다."
                : b.accountState().equals("paid") ? "확인된 잔액을 앞으로 발생할 비용에 한 번만 적용했습니다." : "계정의 결제 상태가 확인되지 않아 결제액을 확정할 수 없습니다.");
        return new BillingUsage(b, used, projected, additional, creditUse, remaining, uncovered, payable, message);
    }
}
