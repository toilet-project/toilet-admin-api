# API usage and estimated cost

## Scope

The workspace menu places **API 사용량** immediately below Cloudflare. Automatically collected services appear as monitoring cards: Naver Maps, native Google Maps SDK, Places API (New), and Translation NMT. Kakao Maps/Local and manually checked Translation values appear in a collapsed reference section. Public restroom data APIs are excluded. Naver's production and test applications have confirmed Dynamic Map usage in its console (2026-09-30); the earlier source-only inactive assumption was corrected. Every service has a provider dashboard link beside its card actions or reference entry for direct checking.

Cards prioritize current usage, projected month-end usage, and free-quota utilization per API. Unlimited-free and no-free-allowance metrics have no invented percentage. Daily quotas use the projected daily average, never monthly total divided by a daily allowance. Kakao's app-wide monthly comparison includes only the displayed Maps/Local subset and is labeled accordingly. The detail panel keeps current credit information, rate tables, and a hypothetical cost calculator in collapsed disclosures; paid-cost trends are no longer shown.

## Data and credentials

Read-only routes behind the existing admin ingress:

- `GET /api/admin/v1/api-usage`
- `GET /api/admin/v1/api-usage/estimate?metric=places-autocomplete&quantity=200000&includeFree=true`
- `GET /api/admin/v1/api-usage/history?service=kakao`

The page uses the existing ADMIN sign-in check. The ingress must retain the existing Cloudflare Access restrictions; do not expose the application port publicly. No credentials or raw upstream responses are returned by these routes.

Google reads use `roles/monitoring.viewer` and OAuth `monitoring.read`. Configure:

| Setting | Meaning |
| --- | --- |
| `API_USAGE_GOOGLE_PROJECT_ID` | Project containing the monitored requests |
| `API_USAGE_GOOGLE_CREDENTIALS_FILE` | Absolute path to a protected service-account JSON file; preferred for local use |
| `API_USAGE_GOOGLE_CREDENTIALS_BASE64` | Alternative base64-encoded JSON supplied through the deployment Secret; base64 itself is **not encryption** |
| `API_USAGE_SNAPSHOT_DIRECTORY` | Optional directory of cumulative monthly JSON exports described below |
| `API_USAGE_MANUAL_SNAPSHOTS_BASE64` | Optional protected bundle of verified current and historical manual snapshots for deployments without a mounted directory |
| `API_USAGE_GOOGLE_MAPS_FILTER` | Optional Monitoring filter override for native SDK requests |
| `API_USAGE_GOOGLE_AUTOCOMPLETE_FILTER` | Optional filter override for autocomplete requests |
| `API_USAGE_GOOGLE_DETAILS_FILTER` | Optional filter override for place details requests |

File credentials take priority over the base64 setting. Never commit either credential form. In the deployment workflow, the project ID is a repository variable and the credential is an encrypted repository Secret named exactly as the settings above. GitHub resolves these into the existing protected `.env`/Docker deployment path. Credentials are retained in the protected rollback configuration, just like the existing database/Cloudflare credentials. Installing this configuration does not itself authorize a production deployment.

Places filters use `maps.googleapis.com/service/v2/request_count` and resource `maps.googleapis.com/Api`, restricted to `places.googleapis.com` and respectively `google.maps.places.v1.Places.AutocompletePlaces` / `google.maps.places.v1.Places.GetPlace`. Native SDK instead uses `serviceruntime.googleapis.com/api/request_count` with resource `consumed_api`, restricted to `maps-android-backend.googleapis.com` and `maps-ios-backend.googleapis.com`. Both families were verified against the actual project on 2026-09-30 KST: SDK traffic exists only in Consumed API. Never add the two metric families together. If no series are provided the UI shows a working read connection with **집계 대기**, not zero.

Monitoring data is summed in complete hourly intervals, with an additional five-minute allowance for provider ingestion. Thus a page refresh every five minutes does **not** mean live billing: the observation cutoff can be up to 65 minutes behind now. All pages display the actual cutoff. Cache lifetime is five minutes; no UI control bypasses it. Pagination is bounded and any incomplete response is rejected. Errors retain only the last good data for the same month. Older than two hours is marked stale for Google automated readings; Naver daily Billing has a 72-hour threshold. Console references always retain their capture timestamps and never become monitoring data.

## Provider exports

Kakao has no confirmed public statistics read API. Translation request counts cannot substitute for billed characters. A provider export or instrumented application counter can be supplied through a protected, read-only mounted directory. Console-confirmed snapshots are displayed **only as reference** and do not replace automatic readings. NMT characters use the translation project’s `serviceruntime.googleapis.com/quota/rate/net_usage` metric with `metric.labels.quota_metric="translate.googleapis.com/default"`. LLM has no content quota, so its input/output remain unknown in monitoring until a billing export or complete server counter is automated.

Write one file per service (`kakao.json`, `google-places.json`, `google-translation.json`) atomically. Export totals must cover the **entire current provider month from day one**. A counter started partway through the month cannot be labeled a complete monthly total. Missing keys remain unknown; an explicitly measured zero is valid. An automatically collected counter may supply monitoring data; a snapshot whose source says `콘솔 확인값` remains a reference and automatic Monitoring takes priority.

For the existing Docker deployment, verified manual snapshots can instead be supplied through the encrypted GitHub repository Secret `API_USAGE_MANUAL_SNAPSHOTS_BASE64`. The secret contains base64-encoded JSON shaped as `{ "current": { "kakao": <snapshot>, "google-translation": <snapshot> }, "history": { "kakao": { "2026-08": <snapshot> } } }`. Base64 is transport encoding, not encryption; keep the source JSON and encoded value out of Git. Protected mounted files take priority over entries in this bundle. Current-month entries are rejected after the provider month changes. Historical manual imports remain labeled by source and do not make the service automatically monitored.

Example shape (synthetic, never copy into production as actual usage):

```json
{
  "month": "2026-09",
  "asOf": "2026-09-16T07:00:00Z",
  "source": "검증된 월 누계 내보내기",
  "scope": "집계 범위와 누락 여부를 기재",
  "metrics": {
    "translation-characters": { "used": 680000, "billableUsed": null }
  }
}
```

`asOf` must not be in the future or before the provider month. Previous-month, malformed, negative, oversized, and unknown-metric snapshots are rejected. Use the metric IDs in `src/main/resources/api-usage-catalog.json`. For Kakao, `billableUsed` is optional but required for a money estimate: it must be the verified paid count after BOTH daily and shared monthly allowances, not `month total - daily allowance`. Monthly projections of those paid counts follow their observed average and cannot predict changing quota eligibility. The hypothetical Kakao calculator quotes **one day**, with a checkbox to remove the daily allowance when already exhausted/ineligible.

An eventual Places Worker export must label its counters as **reserved attempts**, including failures and cancellations. Do not relabel them as successful or billable requests. The current implementation uses Google request metrics for Places instead.

## Pricing and estimate assumptions

Verified 2026-09-30:

- [Google Maps Platform pricing](https://developers.google.com/maps/billing-and-pricing/pricing): native Maps SDK is unlimited free. Autocomplete Requests and Place Details Essentials each have 10,000 monthly free events. Tier boundaries apply to total monthly events; rates apply progressively, per 1,000 events. Scope and field masks must still match the catalog.
- [Kakao quota/pricing](https://developers.kakao.com/docs/ko/getting-started/quota) and [Kakao Maps eligibility](https://developers.kakao.com/docs/ko/kakaomap/common): daily per-API allowances coexist with a shared monthly quota; additional activated apps may have no free allowance.
- [Naver official rates](https://m.ncloud.com/charge/price/ko) and [Maps transition notice](https://www.ncloud.com/support/notice/all/1965?page=2): the representative account allowance applies to the standalone Maps product. Legacy AI NAVER API does not receive that allowance.
- [Translation pricing](https://cloud.google.com/products/translate/pricing): NMT Basic/Advanced share up to $10 monthly credit, equivalent to 500,000 characters at the public $20/million rate. More than one billion characters requires a quote and is left unknown.
- [Google Monitoring](https://developers.google.com/maps/reporting-and-monitoring/monitoring): requests are operational metrics, not billing ledger records.

Google free allowances are shared at billing-account scope. The estimate assumes the displayed service can use the entire published allowance. Project-only monitoring can understate costs if other projects consumed the allowance. Errors and request counting can also differ from chargeable units. The per-metric public-rate estimates exclude trial credits, subscriptions, other projects, discounts, tax, and currency conversion. A separately verified billing snapshot can supply account credit adjustments to the card and summary; neither view is an invoice.

Projection uses cumulative usage divided by elapsed seconds at `asOf`, multiplied by seconds in the provider month (Pacific time for Google, Seoul for Kakao/Naver). It is withheld for the first 24 hours. All timestamps displayed to the administrator are KST; provider month boundaries are stated separately. Forecasts are uncapped trends and do not model service throttles or configured Worker hard limits.

## Verification / preview

```text
gradlew test --tests '*apiusage*'
gradlew apiUsagePreview
gradlew apiUsagePreview -PpreviewPort=8194 -PpreviewMode=live
```

The preview is test-classpath-only, listens on 127.0.0.1, stops after one hour, and labels sample data explicitly. Live mode reads the configured Google and Naver credentials and makes read-only requests. Preview authentication substitutions are confined to that test server and never packaged in the production jar.

Meaningful tests cover progressive billing, free allowance boundaries, unavailable negotiated rates, leap months/DST, unknown versus zero, Kakao daily/monthly semantics, invalid exports, cache reuse, stale recovery, and month rollover.

## Verified provider connections (2026-09-30 KST)

- Naver: `API_USAGE_NAVER_CREDENTIALS_FILE` or `API_USAGE_NAVER_CREDENTIALS_BASE64` contains `{accessKey,secretKey}` for the approved `NCP_BILLING_VIEWER` subaccount. It signs only the fixed official daily Billing GET endpoint. Only standalone MAPS product records for Dynamic Map and Geocoding are included; legacy AI NAVER and API HUB are excluded. The common last complete day across application series sets the forecast cutoff. Unknown meters, incomplete pages, duplicate daily records, fractional/non-numeric quantities, and partial days fail closed.
- Translation: `API_USAGE_GOOGLE_TRANSLATION_PROJECT_ID` selects its separate project using the existing Monitoring Viewer account. Its deployment variable is independent of the Maps project. NMT quota characters are operational usage, not a final billing ledger; the actual server also uses Translation LLM, whose input/output each cost $10/million and are never inferred from request count. Missing LLM counters keep the total cost unknown.
- Kakao: six Maps/Local metrics include web/native SDK, keyword, address, coordinate, and region conversion. The verified console monthly export is private, current-month-only, and prominently labeled manual. All paid counters were confirmed zero in the console for the observed period.

## Authenticated public preview

`preview/api-usage-gateway.mjs` uses the existing tested preview authentication pattern on `/admin-api-usage`, with the exact new API-domain exchange path `/__api-usage-preview-auth`. Both routes are isolated from service endpoints. ADMIN is checked against the existing API for every protected request. State-bound encrypted tickets travel only in a POST; session cookies are host-only, HttpOnly, Secure, 15-minute max. The preview expires within 24 hours. Google/Naver keys remain local; the Worker receives only a random gateway token and session encryption key. The origin listens on loopback, requires the gateway token on every route, and permits GET only. Production code/containers are not deployed by this preview.

`node --test tests/api-usage-preview-gateway.test.mjs` covers anonymous/non-admin access, revoked sessions, malformed exchanges, path restrictions, and expiry.

The review preview can use a complete September Google Billing console SKU export, including NMT input and LLM input/output, as a protected manual reference. Its capture timestamp and manual status stay visible in the reference section. Automatic NMT quota readings remain in monitoring; automatic complete LLM billing import remains unavailable. Private balances and billing account identifiers are never catalog constants.

## Billing and promotional credits

An optional `billing` object in the same private snapshot provides `currency`, `asOf`, `source`, `scope`, `grossCost`, `freeTierSavings`, `promotionalCreditApplied`, `netCost`, `creditTotal`, `creditRemaining`, `creditExpiresOn` (ISO date), and `accountState` (`free-trial`, `paid`, `unknown`). Amounts are positive magnitudes, reconciled as gross minus free savings minus promotional credits equals net, within provider display rounding (1 KRW / 0.02 USD). All six amounts must be known and nonnegative; an absent object leaves account credits unknown. Existing snapshots remain compatible.

An automatically sourced billing object could be shown in a monitored card and its detail view. Console-confirmed billing objects are reference-only; their last observed credit balance and deduction are shown with a capture timestamp. Per-SKU public pricing and the calculator retain their own currency and explicitly exclude promotional credits. No FX conversion or per-SKU duplication of a shared credit balance is performed.

Monthly billing projection extrapolates observed gross cost, subtracts the already-applied monthly free benefit once, and applies the remaining shared credit **only to additional future cost**. It assumes no additional credit consumption by other services. Credits expiring before month end, unknown expiry, observations older than 24 hours, or less than one day of observations withhold the financial forecast. Unknown account status withholds the payable amount. A paid account shows uncovered cost as payable; an unupgraded free-trial account shows no automatic payment, with uncovered usage and possible service suspension explained separately. These are trend scenarios, not invoices or guarantees. See [Google trial terms](https://docs.cloud.google.com/free/docs/free-cloud-features) and [credit reporting](https://docs.cloud.google.com/billing/docs/how-to/reports/savings-and-credits).

Console observations remain manual and show their capture time. Monitoring Viewer access alone does not provide automatic Billing credit balances. Google Cloud Billing export to BigQuery is currently disabled for the connected account; enabling it would be a separate setup and its cost and credit records would arrive with provider delay. No new billing permission or paid account upgrade is performed.

## Monthly usage history (quota-first UI)

The history endpoint returns five previous provider-calendar months; the UI adds the current month to form a six-month chart and table. Each API metric is compared separately. Current month-to-date actual usage and month-end projection are distinct; projected month-end versus prior full month is explicitly labeled expected growth. Full past month versus previous full month is actual usage growth. A measured zero baseline displays new usage rather than infinite growth. Missing data stays unknown. Source or scope changes, partial months, and the first three days after month-end withhold comparisons.

The page places **모아보기** and **월별 사용량** tabs beside the title and omits the former summary tiles and overview notice. All automatically monitored service cards use the Google Cloud Translation card height; longer contents scroll within the card while the observation footer stays visible. Each card has a direct provider dashboard link to the left of 상세보기. Reference-only Kakao has a provider dashboard link in its reference entry. A metric's detail link selects the monthly tab and the matching service/metric.

Production uses the existing database with `api_usage_monthly_snapshots`, a monthly service-keyed observation table managed by the project's existing Hibernate schema policy. Counters and provenance are stored without credentials, provider raw labels or billing balances. A six-hour scheduled collector saves automatic current observations and reads the previous month again; current-month console snapshots are ignored by this collector. This preserves complete monthly metrics before [Google's six-week retention for these metric families](https://docs.cloud.google.com/monitoring/quotas#data_retention) elapses. A query whose month starts before that retention window is withheld, even if the API might return a truncated tail. Stored partial months are never automatically promoted to full totals. Monthly backfill rechecks the provider ingestion window; past totals remain subject to provider corrections.

[Naver's daily Billing API](https://api.ncloud-docs.com/docs/platform-costandusage-getcontractusagelistbydaily) is read one month per request, with an inclusive final date and exclusive internal cutoff. Complete daily observations must reach the end of the month to qualify for comparison. No rows do not imply zero. Confirmed manual monthly imports can be placed at `API_USAGE_SNAPSHOT_DIRECTORY/history/<service>/<YYYY-MM>.json`, with `asOf` equal to the exclusive month end for a full month. Keep scope wording stable for comparable datasets; dates belong in month/asOf, not scope. Manual imports still require provider evidence.

The loopback preview uses private atomic JSON archives via `API_USAGE_PREVIEW_HISTORY_DIRECTORY` instead of any production DB. Its collector runs only while the temporary preview process is running. Production deployment is required for the production scheduled collector; this change does not deploy it. Existing previous-month manual snapshots no longer block the new month's automatic provider reads.

The current review includes verified August Kakao web maps, keyword, address and coordinate usage. Unobserved native and region-conversion series remain unknown. Operational API usage is a supporting growth indicator; batch jobs, testing, cache behavior and retries may change it independently of active users.

Verification includes daily/monthly quota semantics, unknown/zero/unlimited treatment, prior-zero growth, mixed-source/partial-month comparisons, retention boundaries, month rollover, historical cache behavior, persistence across repository instances, and the unchanged ADMIN gate for the new read endpoint.
