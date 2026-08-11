---
title: "feat: Scheduled report verification sweep with discrepancy alerting"
type: feat
status: active
date: 2026-08-10
---

# feat: Scheduled report verification sweep with discrepancy alerting

## Summary

Wire the existing independent reporting verifier (`packages/athena-webapp/convex/reports/verify.ts`) into the automation stack: a cron-driven per-store sweep that verifies settled day folds and the current week against source domains, records every outcome durably in a new verification-run table plus the scheduled-run ledger, and emits a new email notification kind when an *unexplained* discrepancy arises. Email is gated off at launch (record-only rollout); voids, blind-spot fields, and truncation are classified as record-only outcomes, never emailed.

---

## Problem Frame

`reports/verify.ts` is a 2,000-line independent second opinion on the reporting pipeline — it recomputes day and week totals directly from domain tables, deliberately reading different columns than the fold — and it has already caught two real defects that a fully green test suite missed. But it is `internalQuery`-only: no cron runs it, no alert fires on a diff, and its `unverifiedFields` output has no consumer (an explicitly documented half-landed fix). Discrepancies between folded reports and source truth currently go undetected until a human notices.

---

## Requirements

- R1. A scheduled sweep runs day-level and week-level verification per store on a regular cadence without operator involvement.
- R2. Every verification run records a durable outcome — including clean runs, partial runs, errors, and skips — never fire-and-forget.
- R3. A new notification kind on the notifications rail emails subscribed recipients when an unexplained discrepancy arises; clean runs are silent.
- R4. Alerting distinguishes "checked and wrong" from "could not check": `unverifiedFields`, `truncated`, and weekly `unavailable`/`incomplete` outcomes are never presented as discrepancies.
- R5. Differences fully explained by documented verifier conventions (void sign convention) or KNOWN BLIND SPOTS (`unitsReturned`, POS line refunds, quarantined/foreign-currency facts) are recorded with a classification but never emailed.
- R6. Alerts fire once per discrepancy streak and re-arm after a clean run; a changed difference fingerprint on an already-alerted subject re-alerts once.
- R7. The sweep itself is observable: a store whose verification cannot complete for N consecutive ticks escalates via an operational event (the verifier being wedged must not be silent).
- R8. Email delivery is gated off at initial deploy; the sweep runs record-only until classification quality is observed against production, then email is enabled without a code change.

---

## Scope Boundaries

- No auto-repair or auto-refold — repair remains a human action using existing paths (`foldVersionRepair`, `weeklyRepair`, reseed).
- No fixes to verify.ts's KNOWN BLIND SPOTS or the void sign convention (see Deferred).
- No statistical/baseline anomaly detection.
- No new notification channels (in-app, WhatsApp) — email only, like the existing six kinds.
- No enrollment of other unledgered cron families in the scheduled-run ledger.
- No backfill verification of deep history — the sweep verifies a bounded trailing window.

### Deferred to Follow-Up Work

- Reconcile the fold/verifier void sign convention inside `verify.ts` so raw `matches` becomes trustworthy: future iteration, prerequisite for removing the void suppression classification.
- Size the five remaining `VERIFY_MAX_DOCS_PER_DOMAIN` ceilings against measured production volume (the 2026-08-03 solution doc flags them as unchecked); scheduled sweeps will exercise them daily and likely surface truncation.
- Retention/compaction job for verification-run rows (and the rail's known intent/delivery retention gap).

---

## Context & Research

### Relevant Code and Patterns

- `packages/athena-webapp/convex/reports/verify.ts` — plain-ctx helpers `verifyDayWithCtx`, `verifyCurrentWeekWithCtx` are directly reusable; `verifyStoreSummaryWithCtx` (400-day walk) is too heavy for a per-tick sweep.
- `packages/athena-webapp/convex/operations/owedDailyCloseSweep.ts` — the shape to imitate: derived owed set (never stored), bounded per-tick batch, once-per-streak escalation (`recordOwedDailyCloseStaleEscalation`), offset cadence to observe rather than race the primary.
- `packages/athena-webapp/convex/reports/sweeper.ts` — pacing constants style (`SWEEP_MARK_SCAN_LIMIT`, `SWEEP_DIRTY_BATCH`), reseed guard, fail-closed `REPORTS_SWEEP_STORE_ALLOWLIST` idiom, thin `internalMutation` delegating to a `WithCtx` function.
- `packages/athena-webapp/convex/automation/scheduledRunLedger.ts` — window bucketing, runKey idempotency, `bestEffortRecordScheduledRunEvidence`; enrollment requires adding the `SCHEDULED_CRON_INTERVAL_MINUTES` entry (the `cronFamily` union derives from it via `keyof typeof`) kept consistent with the interval registered in `crons.ts`.
- `packages/athena-webapp/convex/notifications/registry.ts` — a kind = registry entry (category, structural dedupeKey, `prepareEmail` fresh-read with throw=retry / null=suppress) + payload internalQuery in `operations/*Email.ts` + template in `emails/` with exported preview props.
- `packages/athena-webapp/convex/crons.ts` + `crons.test.ts` — STAGE-branched registration; source-text test assertions per cron.
- Test seeders: `packages/athena-webapp/convex/reports/reseedTestSupport.ts` (`seedStore`, `seedPosSale`, `seedPaymentAllocation`, …) already used by `verify.test.ts`.

### Institutional Learnings

- `docs/solutions/logic-errors/athena-verifier-payment-lane-capacity-and-unverified-is-not-mismatched-2026-08-03.md` — "unverified is not mismatched"; this feature is the missing consumer of `unverifiedFields`; ceilings must be sized with arithmetic recorded beside the constant; one `.paginate()` per execution.
- `docs/solutions/architecture/athena-reporting-read-optimized-redesign-2026-07-28.md` — verify against sources, not the pipeline; never let a gate pass vacuously; declarative liveness (crashed sweep leaves work for the next tick).
- `docs/solutions/architecture-patterns/athena-admin-notifications-rail-2026-07-29.md` — emit in-transaction, structural dedupe, throw-vs-null discipline, operational event on suppression, `ADMIN_EMAILS` fallback only on zero subscription rows.
- `docs/solutions/design-patterns/athena-layered-containment-for-reporting-and-sync-failures-2026-08-09.md` — every retry loop needs a threshold at which it becomes a report; escalation fires once per streak and re-arms; fallback writes use a different write path than the failed layer.
- `docs/solutions/logic-errors/athena-reports-fold-version-refold-and-store-currency-source-2026-08-02.md` (+ 2026-08-05, 2026-08-03 provenance doc) — never add a second writer to a sweeper-owned projection: verification state lives in its own table, not on `reportDay`; `certifiedFoldRevision` detects staleness.
- `docs/solutions/architecture/athena-automation-foundation-2026-06-08.md` — record both action and inaction; disabled/observe-first by default.

---

## Key Technical Decisions

- **Separate verification-run table, never fields on `reportDay`**: avoids a second writer on a sweeper-owned projection and the fold-version/refold rollout family entirely.
- **Action orchestrator, not one big mutation**: the sweep entry is an action that pages subjects and runs verification per subject via bounded queries, so one subject's byte-ceiling blowup is contained and recorded as `error` instead of wedging the whole tick (learned from the sweeper's documented wedge).
- **Selection is revision-driven, not calendar-driven**: verify a day only when it is settled (not open, not dirty-marked, store not reseeding) and its `certifiedFoldRevision` is newer than the last recorded verification for that subject — clean days are not re-verified every tick, refolds re-enqueue naturally, repair → re-verify falls out for free.
- **Classification layer between verify and alerting**: a pure function maps raw verify results to outcomes `clean | partial | mismatch | truncated | unavailable | error`, and partitions differences into `unexplained` vs `explained` (void-convention, blind-spot fields). Only `mismatch` with unexplained differences is alertable.
- **Streak + fingerprint alert state on the run table**: alert fires on streak start; re-arm is an explicit write on a clean run (not dedupeKey expiry); a changed difference fingerprint re-alerts once. Partial runs do not clear a mismatch streak unless the previously-differing fields were actually checked and clean. The run row carries a **re-arm epoch counter** (incremented on each re-arm) that participates in the notification dedupeKey — the rail's dedupe is a permanent unique lookup, so without the epoch a recurring identical discrepancy after a clean run would be silently swallowed.
- **Revision-gating accepts a scoped blindness, mitigated by age-based re-verify**: a source-domain write that lands without a dirty mark or refold (post-fold source drift) would be invisible to a strictly revision-gated sweep — the very defect class the verifier exists for. Mitigation: in addition to revision-driven selection, a low-frequency age-based re-verify re-checks the most recent M settled days on a slow cadence (constant sized with the other budgets), bounding the detection latency for drift without re-paying full verification every tick.
- **Email gate is data/env, not code**: the notification kind ships wired but emission is guarded by an explicit enablement gate, mirroring the automation-foundation observe-first convention (R8).
- **`scheduledRunLedger` for run evidence, not `automationFoundation`**: no per-store policy modes are needed for an alert-only sweep; the lighter ledger fits (per repo research).

---

## Open Questions

### Resolved During Planning

- Void-convention false positives: suppress in the sweep (record-only classification); verifier sign fix deferred — user decision.
- Rollout: record-only first, email enabled after observing production classification — user decision.
- Blind-spot fields: never email, always record with classification — analyst default, consistent with void decision.
- Execution shape: action orchestrator per owed-close pattern — avoids the byte-ceiling wedge.
- Weekly variant dispositions, fully enumerated: `unavailable(missing_projection)` on a non-allowlisted store — expected, record-only. `unavailable(missing_schedule | missing_timezone | missing_day_fold)` on an allowlisted folding store — config/pipeline defect, one escalation per streak. `unavailable(schedule_history_cap | no_scheduled_dates)` and `incomplete(source_cap_exceeded | inventory_remediation_in_progress)` — expected capacity/transient states, record-only (mirroring truncation).

### Deferred to Implementation

- Exact per-tick budgets (days per store, stores per tick) and cadence: pick from measured verify read cost during implementation; start conservative (hourly-class, not 5-minute-class) and record the arithmetic beside the constants per the 2026-08-03 learning.
- Whether the day-selection query needs a new index on the verification-run table beyond the subject key: decided when the query is written.
- The R7 consecutive-incomplete escalation threshold N: chosen alongside the per-tick budgets with the same recorded sizing arithmetic.
- Notification category: reuse `system_health` vs add a new category — decide when writing the registry entry; a new category touches the TS union, the schema validator, and subscription seeding.

---

## Implementation Units

- U1. **Verification-run table and outcome model**

**Goal:** Durable per-subject verification state: outcome, classification, difference fingerprint, streak/alert state, `certifiedFoldRevision` verified.

**Requirements:** R2, R6

**Dependencies:** None

**Files:**
- Create: `packages/athena-webapp/convex/schemas/reports/verificationRuns.ts`
- Modify: `packages/athena-webapp/convex/schema.ts`, `packages/athena-webapp/convex/schemas/reports/index.ts`
- Test: covered via U2/U3 tests (validator-only module)

**Approach:**
- One row per subject (store × operatingDate for days; store × cycleStartDate for weeks), upserted per verification — not append-only per tick (retention concern from flow analysis).
- Carries: outcome union, explained/unexplained difference summary, fingerprint, streak count, last-alerted fingerprint, re-arm epoch counter (incremented on each clean-run re-arm; participates in the U5 dedupeKey), verified `certifiedFoldRevision` (absent for pre-stamping legacy days), timestamps.
- Doc-comment states identity/idempotency per `notificationIntentSchema` convention.
- Index on subject key; secondary index only if U3's selection query needs it.

**Patterns to follow:** `packages/athena-webapp/convex/schemas/automation.ts` (`scheduledRunLedgerSchema`), `schemas/reports/derived.ts`.

**Test scenarios:** Test expectation: none — validator-only schema module; behavior covered by U2/U3.

**Verification:** Schema typechecks; table registered with indexes; no writes to `reportDay`.

---

- U2. **Result classification layer (pure)**

**Goal:** Deterministic mapping from raw `VerifyDayResult` / `VerifyCurrentWeekResult` to outcome + explained/unexplained difference partition + fingerprint.

**Requirements:** R4, R5, R6

**Dependencies:** None (parallel with U1)

**Files:**
- Create: `packages/athena-webapp/convex/reports/verificationClassify.ts`
- Test: `packages/athena-webapp/convex/reports/verificationClassify.test.ts`

**Approach:**
- Pure module, no Convex imports (mirrors `foldDay.ts` discipline).
- Outcomes: `clean | partial | mismatch | truncated | unavailable | error`. `truncated` is its own outcome, never a mismatch (expected is a lower bound). `matches:true` + `unverifiedFields` → `partial`. Weekly `incomplete` results (`source_cap_exceeded`, `inventory_remediation_in_progress`) also classify as `partial` — could-not-fully-check, never alertable (R4).
- Explained partition: differences attributable to the void sign convention and the blind-spot field list (`unitsReturned`, refund lanes, quarantine/foreign-currency flags read from day `flags`); a mismatch whose differences are all explained is recorded as `mismatch` with zero unexplained differences → not alertable.
- Fingerprint: stable hash over unexplained difference set (fields + deltas).
- Streak transition rules live here: clean clears; partial clears only if previously-differing fields were checked clean; changed fingerprint marks re-alertable.

**Patterns to follow:** `reports/foldDay.ts` (pure, deterministic); three-state semantics from `verify.ts` header docs.

**Test scenarios:**
- Happy path: clean result → `clean`, empty fingerprint, streak cleared.
- Happy path: unexplained revenue difference → `mismatch`, alertable, stable fingerprint across identical re-runs.
- Edge case: `matches:true` + non-empty `unverifiedFields` → `partial`, never alertable.
- Edge case: `truncated:true` (forced `matches:false`) → `truncated`, never alertable.
- Edge case: day containing only void-explained differences → `mismatch` with zero unexplained differences, not alertable.
- Edge case: blind-spot-only differences (`unitsReturned`) → explained, not alertable.
- Edge case: mixed explained + unexplained differences → alertable, fingerprint covers only the unexplained subset.
- Edge case: weekly `unavailable(missing_projection)` vs `unavailable(missing_schedule)` classified as expected vs config-defect variants.
- Error path: partial run does NOT clear a mismatch streak when the differing field was withheld; DOES clear when that field was checked clean.
- Edge case: same subject, changed fingerprint → re-alertable exactly once per new fingerprint.

**Verification:** All classification transitions covered by table-driven tests; no Convex/Date imports.

---

- U3. **Verification sweep orchestrator**

**Goal:** The scheduled entry point: page allowlisted stores, select stale-verified settled days plus the current week, run verification per subject with error containment, upsert run rows, drive streak/alert state, escalate wedged runners.

**Requirements:** R1, R2, R6, R7

**Dependencies:** U1, U2

**Files:**
- Create: `packages/athena-webapp/convex/reports/verificationSweep.ts`
- Test: `packages/athena-webapp/convex/reports/verificationSweep.test.ts`

**Approach:**
- Action orchestrator (owed-close shape) with a thin scheduled entry; per-subject verification through bounded internal queries so one subject's failure is recorded as `error` without killing the tick.
- Day selection: last N operating dates where the day is not open, has no pending `reportDirtyDay` mark, store is not mid-reseed (copy the sweeper's reseed guard), and `certifiedFoldRevision` > last verified revision. A settled day whose `reportDay` has **no** `certifiedFoldRevision` (pre-stamping legacy fold — the schema documents "never revision 0") is selected if no run row exists, verified once, and recorded with an absent verified-revision marker; any subsequently stamped revision re-selects it. `dayStatus:"missing"` with pending dirty marks → defer; missing and quiet → verify (real "never folded" discrepancy class).
- Age-based re-verify lane: on a slow cadence, re-verify the most recent M settled days regardless of revision, bounding detection latency for post-fold source drift (see Key Technical Decisions).
- Weekly: `verifyCurrentWeekWithCtx` per store, gated on staleness — run only when `reportWeekCurrent.materializedAt` (recorded on the weekly run row) has advanced since the last weekly verification for that store. Ungated, the weekly path re-runs up to a full week of day-weight source scans per store per tick and would dominate the read budget.
- Budgets: bounded days-per-store and stores-per-tick constants in `SWEEP_*` style, with sizing arithmetic in comments; carry-over via selection (unverified stale subjects picked up next tick — declarative liveness, no cursors to wedge).
- Runner liveness: per-store consecutive-incomplete counter; at threshold, emit one operational event (`reports.verification_wedged` style) per streak, re-armed on success — owed-close escalation pattern.
- Alert emission: when a subject transitions to alertable (new streak or new fingerprint) AND the email gate is enabled, emit via `emitNotificationWithCtx` inside the run-row-upsert mutation's transaction (U5 kind). Record-only mode records the same transition without emitting.

**Patterns to follow:** `operations/owedDailyCloseSweep.ts` (derived work set, streak escalation), `reports/sweeper.ts` (allowlist, reseed guard, pacing constants, `WithCtx` testability).

**Test scenarios:**
- Happy path: settled certified day with unexplained mismatch → run row upserted, streak=1, alert transition recorded.
- Happy path: clean re-verify after repair (revision bumped) → outcome clean, streak cleared, re-armed.
- Edge case: open day and dirty-marked day are skipped; mid-reseed store fully skipped.
- Edge case: day already verified at current `certifiedFoldRevision` is not re-verified.
- Edge case: store outside allowlist → distinct not-available handling, no source-domain reads.
- Edge case: newly allowlisted store with unfolded backlog → days without `reportDay` rows and pending marks are deferred, not alerted.
- Error path: verify throws for one subject → that subject records `error`, remaining subjects in the tick still process.
- Error path: N consecutive incomplete ticks for a store → exactly one operational event; success re-arms; next streak escalates again.
- Integration: mismatch transition with email gate ON emits exactly one notification intent (convexTest, seeders from `reseedTestSupport.ts`); with gate OFF emits none but records the transition.
- Integration: same persistent mismatch across two sweeps → one intent total (streak suppression); changed fingerprint → second intent.

**Verification:** Sweep completes within budgets on seeded multi-store data; every subject touched has a run row; no path leaves a permanently silent failure.

---

- U4. **Cron registration and scheduled-run ledger enrollment**

**Goal:** Schedule the sweep and make it observable in the run ledger.

**Requirements:** R1, R2

**Dependencies:** U3

**Files:**
- Modify: `packages/athena-webapp/convex/crons.ts`, `packages/athena-webapp/convex/automation/scheduledRunLedger.ts`
- Test: `packages/athena-webapp/convex/crons.test.ts`, `packages/athena-webapp/convex/automation/scheduledRunLedger.test.ts`

**Approach:**
- STAGE-branched registration with a doc-comment on crash semantics; cadence hourly-class offset from the reports sweep and daily-operations automation (observe, don't race — owed-close precedent). Exact minute/interval decided at implementation with sizing arithmetic.
- Enroll the new cron family: add the `SCHEDULED_CRON_INTERVAL_MINUTES` entry (the `cronFamily` union derives from it via `keyof typeof`), kept consistent with the registered interval (window math depends on agreement).
- Sweep records one system-scope summary row + per-store rows via `bestEffortRecordScheduledRunEvidence`.

**Patterns to follow:** `crons.ts` owed-daily-close-sweep block; `storeFront/checkoutSession.ts` ledger recording (~line 220).

**Test scenarios:**
- Happy path: crons.test.ts source-text block asserts cron name, function path, and STAGE-branched schedule strings.
- Edge case: ledger window/runKey derivation for the new family (interval constant agreement).
- Error path: ledger recording failure does not fail the sweep (best-effort swallow).

**Verification:** Cron registered and asserted; ledger rows appear per tick in tests.

---

- U5. **Notification kind, payload query, and email template**

**Goal:** `reports.verification_discrepancy` (name indicative) on the notifications rail: registry entry, fresh-read payload query, react-email template. Wired but gated off at deploy.

**Requirements:** R3, R4, R8

**Dependencies:** U1, U2 (payload reads run rows); U3 emits it

**Files:**
- Modify: `packages/athena-webapp/convex/notifications/registry.ts`, `packages/athena-webapp/convex/schemas/notifications.ts` (only if a new category), `packages/athena-webapp/convex/notifications/seed.ts` (subscription seeding if new category)
- Create: `packages/athena-webapp/convex/operations/reportVerificationAlertEmail.ts`, `packages/athena-webapp/convex/emails/ReportVerificationAlert.tsx`
- Test: `packages/athena-webapp/convex/notifications/registry.test.ts` (extend), `packages/athena-webapp/convex/emails/ReportVerificationAlert.test.tsx`

**Approach:**
- Payload carries refs only (storeId, subject kind, subject key, fingerprint) — never rendered content.
- Structural dedupeKey over kind + store + subject + fingerprint + re-arm epoch (from the run row). The rail's dedupe is a permanent unique lookup with no expiry, so the epoch component is what lets a re-armed streak with an identical fingerprint alert again; streak logic in U3 decides when to emit at all.
- `prepareEmail` fresh-reads the run row via the payload query; returns null if the subject is no longer in an alertable state (subject resolved between emit and send); throws on transient read failure. It does NOT re-run live verification (a day verify is many bounded scans — too heavy for send time; the run row is the source of truth).
- Template renders unexplained differences as "checked and wrong", lists withheld/unverified fields separately as "not checked" (R4 — this is the missing `unverifiedFields` consumer), links to the reports workspace.
- Email gate: explicit enablement check in U3's emit path (env allowlist in the sweeper's `REPORTS_SWEEP_STORE_ALLOWLIST` idiom), so enabling email is a config change, not a deploy.

**Patterns to follow:** `notifications/registry.ts` `register.closeout_variance` entry; `operations/registerCloseoutVarianceEmail.ts`; `emails/RegisterCloseoutVarianceAlert.tsx` (+ exported preview props convention).

**Test scenarios:**
- Happy path: registry entry — dedupeKey composition, subject line, template render from preview props.
- Happy path: prepareEmail returns rendered email for an alertable run row.
- Edge case: subject resolved (clean) between emit and send → prepareEmail returns null (suppress), suppression records an operational event per rail convention.
- Edge case: template renders unverified fields under a distinct "not checked" section, never in the differences list.
- Error path: payload query transient failure → prepareEmail throws (retry), not null.
- Integration: rail end-to-end emit→dispatch→delivery for the new kind (extend `rail.test.ts` pattern), including `ADMIN_EMAILS` fallback only on zero subscription rows.

**Verification:** Kind registered and covered in registry tests; template has preview props; no email leaves while the gate is off.

---

## System-Wide Impact

- **Interaction graph:** New cron → action → internal queries/mutations; emits into the existing notifications rail; writes operational events on wedge/suppression. No changes to fold, ingest, or existing sweeper behavior.
- **Error propagation:** Per-subject containment in U3; ledger recording is best-effort; prepareEmail throw-vs-null discipline preserves rail retry semantics.
- **State lifecycle risks:** Run-row upsert must be idempotent per (subject, revision); re-arm is an explicit write, not key expiry — flap (mismatch→clean→mismatch) must produce exactly two alerts, not zero or three.
- **API surface parity:** No public mutations added (all internal) — avoids the three-registry capability wiring gate; confirm at implementation that everything stays internal.
- **Integration coverage:** convexTest end-to-end for sweep→run row→intent, and rail delivery for the new kind.
- **Unchanged invariants:** `reportDay`/`reportSkuDay` remain single-writer (fold sweeper only); verify.ts read semantics untouched; existing six notification kinds unaffected.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Verify read weight breaches execution ceilings on high-volume stores | Action orchestration with per-subject containment; conservative budgets with recorded sizing arithmetic; `error` outcome + wedge escalation instead of silent re-breach |
| Misclassification emails false positives and burns alert credibility | Record-only rollout (R8); email enabled only after observing production classification; voids/blind spots/truncation never email |
| Sweeps surface truncation in the five unsized `VERIFY_MAX_DOCS_PER_DOMAIN` domains | Expected and safe: `truncated` is a distinct non-alert outcome; ceiling sizing is an explicit deferred follow-up |
| Alert flap under repeated refolds of the same day | Revision-driven selection re-verifies only on new revisions; fingerprint + explicit re-arm bounds emails per state change |
| New cron family window math drifts from registered interval | Single-source the interval constant; ledger test asserts agreement |

---

## Documentation / Operational Notes

- Rollout order: deploy record-only → observe run rows/ledger for a representative period → size/adjust budgets → enable email gate (config change) → announce the new subscription category to admins if one was added.
- Delivery gate (`bun run pr:athena`): change will exceed the solution-note threshold — budget a `docs/solutions/` note and `docs/reports/*.html` landed-change report; follow commit → fingerprint → amend ordering.
- Production dry run is a delivery step (2026-08-03 learning): both prior verifier defects were invisible to a green suite.

---

## Sources & References

- Related code: `packages/athena-webapp/convex/reports/verify.ts`, `reports/sweeper.ts`, `operations/owedDailyCloseSweep.ts`, `automation/scheduledRunLedger.ts`, `notifications/registry.ts`
- Institutional learnings: see Context & Research
- Architecture doc: `docs/solutions/architecture/athena-reporting-read-optimized-redesign-2026-07-28.md`
