# Statistics-only automation classification

This host job separates inferred automation from ordinary analytics by changing only the existing `service_analytics_event.traffic_class` from `UNFLAGGED` to `BOT`. It does not change Nginx, Cloudflare, request handling, rate limits, cookies, authentication, challenges, or visitor access. Existing API, admin and batch queries already exclude `BOT` from ordinary statistics. The companion read-only aggregate file supplies a separate admin bot statistics pane.

**This directory prepares `stats-pattern-v2-candidate`; it has not been installed or applied.** Preparing it does not update the deployed v1 job. First run `--plan`, inspect its counts, then review an explicit apply invocation. Standard-library Python 3.9+ only. Docker access is required to read the existing running API/MySQL configuration; credentials remain in memory and are passed to MySQL through the process environment, never command arguments or reports. No new production table/column is created.

## Candidate policy for review

The candidate retains the ten observed desktop templates (Chrome 118–120, Firefox 120–121, Edge 119–120 on the observed Windows/macOS combinations) and the previously investigated exact network plus Chrome 145/Linux profile. It adds a separate proposed mobile rule for Chrome 147–151.0.0.0 on Android/iOS, with reason `DISTRIBUTED_MOBILE_PASSIVE_PROFILE`. It is **pattern inference**, not operator authentication or proof of malicious intent. Public crawler-IP list membership/nonmembership is not an inference criterion. Public lists cover particular operators, not all bots.

For a desktop full-UA monthly cohort, the global seven-calendar-day population must contain at least 20 started sessions across 20 network identities, at least 95% Direct/unattributed entry, at least 90% passive single-view sessions, and at least 90% starts since the reviewed November 19 onset. The separate sustained-mobile thresholds require at least 50 starts across 50 network identities, at least 99% Direct/unattributed, at least 95% passive single-view sessions, at least 95% zero-engagement passive single-view sessions, and at least 24 hours between the earliest and latest first start. Zero-engagement passive sessions are a subset of passive sessions, not an independent second signal. The full seven-calendar-day cohort remains the denominator; there is no mobile cohort onset-ratio condition. Full-UA templates are grouped using monthly HMACs; normalized browser version alone never supplies cohort identity.

The mobile rule selects individual sessions only on or after `2026-11-20T20:19:16.221517+09:00`. This timestamp is the beginning of the follow-up review scope, not an asserted attack start. Earlier same-UA sessions remain in the global cohort denominator and are never selected by the mobile rule.

Both distributed rules additionally require each selected session to have exactly one start, exactly one view, no app context, no event outside `session_start`/`page_view`/`engagement` (including no scroll or screen event), no reload/history/continuation entry, at most 30 engagement seconds, Direct/unattributed entry on all events, and at least 35 minutes since its last event. Mobile sessions additionally require exactly zero total engagement seconds; any positive recorded time preserves the individual session. Later positive time restores only mobile-owned events, including when their original start has expired from retention. Earlier desktop visits stay unflagged. The historical exact-network/profile rule uses the same session safeguards and permits zero views; it does not generalize to other networks or browser versions. The desktop and historical-network engagement rules remain unchanged.

Profiles outside the desktop, mobile and exact prior-network rules remain review-only. A new family requires a policy review and a new pinned policy digest. Neither country, Direct entry, browser version, short engagement nor failure to match a published IP list is sufficient on its own. The deployed v1 policy continues to leave the mobile family review-only until a candidate is separately approved and installed.

The cohort window rolls with host KST date: today minus six days at midnight through the job snapshot. All retained events sharing the session hash protect a session, including activity across midnight. Classifier-owned BOT events remain in cohort populations, so previous successful classification cannot erase the denominator required by future runs. Original BOT/legacy/mixed sessions, ambiguous or missing log mappings, apps and sessions with functional activity are preserved. Later functional/app/reentry/multiview or other contrary evidence restores only classifier-owned events to their original `UNFLAGGED` value, including retained sessions older than the seven-day cohort window.

## Evidence, safety and retention

- Nginx accepted analytics POST records are matched using the current API's exact monthly network/full-UA HMAC algorithm, including its textual IPv6 behavior. Matching attributes a network/UA/month cohort; it is not a person or a one-to-one HTTP request/event link.
- Raw source IPs, full UAs and raw URLs are parsed in host memory only. Private SQLite retains existing visitor/session hashes, monthly UA-only/network HMACs, normalized profiles, source-file cursors and event-ID ledger fingerprints. It is mode 0600 inside a mode 0700 directory and is never mounted into admin. Aggregate JSON is safe for the existing read-only exports mount and contains no such identities.
- Plain/gzip rotation, inode changes, size truncation, head and cursor-anchor replacement are handled conservatively. A partial final line is retried. Parse failures or unfinished scans prevent any new classification. Time limits bound scan work; timer bootstrap can span multiple cursor checkpoints. Source errors stay partial rather than being silently discarded.
- An exclusive process lock prevents overlapping mutations. Each small transaction locks exact retained date/session ranges through the existing date/session index, rechecks the complete event set including new cross-day activity, and updates only exact pre-ledgered event IDs. Lock wait is limited to two seconds. Every original value is `UNFLAGGED`; original BOT events never enter the ledger.
- SQLite FULL-synchronous write-ahead records and a rollup outbox commit before MySQL writes. Prepared states are reconciled against current immutable fingerprints/classes after a crash. Matching BOT rows become applied; unchanged UNFLAGGED rows are not assumed applied. Restore/rollback intents also reconcile after a crash. Conflicts stop the job.
- A failed later batch can leave earlier committed batches applied: the ledger and outbox make this visible/recoverable, and reruns are conditional and idempotent. No-op runs create no empty ledger batches. Explicit rollback suppresses reclassification of the reverted sessions during retention.
- Historical daily summary/dimension rows are refreshed using the deployed application's existing 15-dimension aggregation SQL in `refresh_rollups.py`. The durable outbox is retried immediately after recovery, even when a later source scan fails. Raw events are not deleted. This does not change the application's existing analytics response-cache lifetime (up to 60 seconds).
- Identity metadata/ledger retention follows 35 days of source event time. A ledger record expires only after its event is outside retention and absent from the current retained source read. The package never deletes production event records. Export errors preserve the previous successful counts and `lastCompletedAt` while marking the job failed/stale.

## Read-only preparation

Copy `classifier.py`, `origin_parser.py`, and `refresh_rollups.py` to the same private host package directory, or use the audit runner to inject them in memory. `origin_parser.py` is the parser/normalized-UA subset of the previously reviewed `evidence/origin_audit.py`.

```sh
python3 classifier.py --plan --cutoff '2026-11-20T16:22:14.573622+09:00'
python3 -m unittest discover -s operations/analytics-classifier -p 'test_*.py'
```

`--check` and `--plan` open existing SQLite read-only and use an in-memory copy for scan/checkpoints. They run MySQL inside read-only transactions, write nothing on the host, and print only aggregate JSON. Their `--export` option does not publish a preview. Preserve the exact cutoff and review `policyDigest`, `planDigest`, coverage, selected/review-only counts, desktop exclusion partition and per-cohort aggregate evidence. Existing private state is optional for a first full-log plan.

## Explicit application (requires review)

After review, supply the **exact** reviewed plan digest and cutoff. Recompute a plan if activity or the selected event set has changed. Source mappings are checkpointed before the condition is checked; analytics writes require a complete scan and matching digest.

```sh
python3 classifier.py --apply --apply-approved \
  --cutoff 'REVIEWED_KST_CUTOFF' --approve-plan REVIEWED_PLAN_DIGEST \
  --export /var/snap/docker/common/geupddong-origin-bots/exports/automation-statistics.json
```

For a reviewed batch rollback, obtain its opaque batch ID from the private `batches` ledger, inspect a read-only rollback plan, then supply its digest with `--apply --apply-approved` and the same cutoff. It only restores owned unchanged BOT event IDs. A rollback crash that left rows BOT requires retry; recovery never assumes the rollback committed.

```sh
python3 classifier.py --plan --rollback-batch BATCH_ID --cutoff REVIEWED_KST_CUTOFF
python3 classifier.py --apply --apply-approved --rollback-batch BATCH_ID \
  --cutoff REVIEWED_KST_CUTOFF --approve-plan ROLLBACK_PLAN_DIGEST
```

## Timer preparation

The supplied unit is deliberately separate from the origin crawler collector. It runs every five minutes, with low CPU/I/O priority, 512 MiB RSS limit, 240-second wall limit and restricted host filesystem writes. Its `--expected-policy` pins the exact reviewed policy digest. It reads running container configuration; Docker access already implies host administrative authority. No network registry fetch is needed.

The target mini PC runs Docker through Snap; the unit depends on `snap.docker.dockerd.service`. Its unrelated `docker.service` is masked. Verify the unit against the target host before starting it.

After authorization, prepare root-owned `/opt/geupddong-analytics-classifier` (0755), private `/var/lib/geupddong-analytics-classifier` (0700), and the existing export directory. Copy the three source files and reviewed service/timer units; verify their SHA-256 checksums; run `systemd-analyze verify` and the explicit initial plan/apply. Only then enable/start the timer. Stop/disable this timer to pause future classification; raw source evidence and existing classifications remain available for reviewed rollback.

The admin monitor reads only `automation-statistics.json` from its existing read-only exports mount. `status:plan` is a preview; `ready` contains actual current ledger-owned counts within the advertised period. `daily` separates `PATTERN_INFERRED` from original `UA_SIGNAL`. The latter name means the API's preexisting BOT classification and does not authenticate a provider. Groups always declare `providerIdentity:UNVERIFIED`. `reviewOnly` counts stay in ordinary analytics until separately reviewed. A `ready` result reports rollup refresh status; errors keep the last completed snapshot visible.

Diagnostic `policyEvidence.cohorts` also covers mobile and other unreviewed full-UA cohorts, with normalized browser profiles, family-specific global thresholds, reviewed-family status and session-safeguard counts. It reports the largest 1,000 cohorts, with explicit total/reported/omitted cohort and started-session counts; no raw IP, UA or identity hash is exported. Identical normalized profiles can describe separate full-UA cohorts. `reviewedMobilePartition` reports mutually exclusive selected/preserved categories, including review-scope timing, positive engagement and insufficient cohort evidence; detailed cohort conditions expose zero-passive share and the observed first-start span. This diagnostic cap and output do not change the pinned selection policy. `reviewOnly` is the closed, passive, unselected subset whose current events are all `UNFLAGGED`; it excludes already-owned BOT sessions and does not require the engagement-time bound. `classifiedSessions` instead counts owned BOT starts inside the advertised period (plus proposed inventory in plan mode), even if their current cohort is below threshold.
