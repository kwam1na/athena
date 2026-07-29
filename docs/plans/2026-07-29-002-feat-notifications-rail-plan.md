---
title: "feat: Centralized admin notifications rail"
type: feat
status: active
date: 2026-07-29
---

# feat: Centralized admin notifications rail

## Summary

Build a platform notifications rail — intent ledger, code-owned kind registry, subscription-based audience resolution, and a leased delivery ledger drained by an immediate dispatch plus a safety-net sweeper — then port the three existing ad hoc admin email flows (register closeout, EOD daily manager report, POS terminal health) onto it. Future communications become one registry entry plus one template; call sites emit an intent and never touch email again.

---

## Problem Frame

Admin emails are bolted onto call sites: three flows each hand-roll recipient loops over a hardcoded `ADMIN_EMAILS` constant, duplicate the MailerSend fetch, and invent their own dedupe (marker fields patched onto domain rows). Register closeout alerts are lost forever on a single failed send; nothing sends in non-prod so the pipeline is unexercised outside production; there is no per-store or per-role routing. Each new communication repeats all of this.

---

## Requirements

- R1. Domain code emits a notification intent (kind + subject refs + dedupe key) and has no knowledge of channels, recipients, templates, or transport.
- R2. Adding a new communication requires only a registry entry (and template); no dispatch/transport changes.
- R3. Audience is resolved from data (`notificationSubscription`: org x optional store x category x channel), with `ADMIN_EMAILS` as fallback only when the org has zero subscription rows for that category — so behavior is unchanged pre-seed. Once rows exist, an empty filtered match (all disabled, or all scoped to another store) is an intentionally empty audience, not a fallback trigger: the intent is suppressed (`no_recipients`). Disabling every subscription in a category therefore does silence it.
- R4. Deliveries are individually ledgered with lease tokens, attempt caps, exponential backoff, and provider idempotency keys — no silent loss, no double-send.
- R5. Dispatch is hybrid: immediate `runAfter(0)` on emit for every kind (no urgency tiering), plus one sweeper cron that recovers stale leases, due retries, and undispatched intents.
- R6. Content is rendered at send time from fresh data via the existing payload queries; an unsendable payload (deleted/resolved subject) suppresses the delivery instead of sending stale content.
- R7. The environment gate lives in the transport: prod sends normally; non-prod redirects to `NOTIFICATIONS_DEV_RECIPIENT` or records the delivery as `suppressed` (never a false `sent`) — the full pipeline runs in every environment.
- R8. A delivery that terminally fails records an `operationalEvent` (a permanently unsendable admin alert is itself an operational event).
- R9. The three existing flows are ported with their current payload queries and templates unchanged; legacy per-flow dedupe markers, admin loops, and the `automationNotificationDelivery` writers are retired. The legacy markers stay *readable* for one release as cutover guards (see U7, U8) so batches replayed across the deploy boundary do not re-alert — this ended up being three guarded lanes, not two: the POS marker reads in U7 plus an EOD action-required read of the legacy `automationNotificationDelivery` ledger in U8. EOD applied/prepared sends stay unguarded because the pre-rail path never ledgered those.
- R10. The in-app channel is schema-supported (channel enum, `readAt`) but stubbed — no UI, no in-app deliveries created yet.

---

## Scope Boundaries

- No subscription-management UI; subscriptions are seeded by an internal mutation and edited via data tools.
- No porting of customer-facing email (order emails, verification codes, discounts) or the WhatsApp customer-messaging module.
- The manual admin actions `sendMostRecentDailyManagerReport` and `sendDailyManagerReportsForDateRange` (explicit recipient, on-demand) stay outside the rail.
- `ADMIN_EMAILS` is not deleted — it remains the resolution fallback and is still used by `sendNewOrderAdminEmail`.
- No per-kind subscription overrides (category granularity only; the schema leaves room for a later optional `kind` column).

### Deferred to Follow-Up Work

- In-app notification inbox UI reading `notificationDelivery` rows with `readAt`: future iteration.
- Porting remaining admin-ish emails (new-order admin email, walkthrough notifications): future iteration.
- Per-kind subscription overrides and a subscriptions admin surface: future iteration.

---

## Context & Research

### Relevant Code and Patterns

- `packages/athena-webapp/convex/marketing/walkthroughRequestNotifications.ts` — the proven delivery state machine (lease token, backoff, idempotency key, stale-lease recovery cron) this rail generalizes.
- `packages/athena-webapp/convex/reports/` + `convex/crons.ts` "reports sweep" — the emit → queue-mark → single-sweeper architecture the rail mirrors ("the ONE cron" pattern).
- `packages/athena-webapp/convex/operations/dailyManagerReportEmail.ts` — existing `automationNotificationDelivery` reserve/mark helpers (superseded), payload queries (kept).
- `packages/athena-webapp/convex/operations/registerCloseoutVarianceEmail.ts`, `posTerminalHealthAlertEmail.ts` — payload queries kept; admin-loop senders retired.
- `packages/athena-webapp/convex/pos/public/sync.ts` (`scheduleRegisterCloseoutNotifications`), `convex/pos/application/commands/terminals.ts` (heartbeat health alert), `convex/operations/dailyOperationsAutomation.ts` — the three emit call sites.
- `packages/athena-webapp/convex/operations/operationalEvents.ts` (`recordOperationalEventWithCtx`) — audit rail reused for terminal failures.
- `packages/athena-webapp/convex/emails/` — React Email templates, reused unchanged; rendered function-call style (no JSX) as walkthrough notifications already do.

### Institutional Learnings

- `docs/solutions/architecture-patterns/athena-eod-automation-manager-report-emails-2026-07-04.md` — keep lifecycle mutations pure; email I/O belongs in actions; explicit outcome policy for which EOD results notify. The rail preserves this: emit inside the mutation, send inside the dispatch action.
- Repo lint contract: no `.collect()` in queries, explicit table names on `db.get/patch/delete/replace` — all rail queries use bounded `.take()` over indexes.

---

## Key Technical Decisions

- Hybrid dispatch (immediate `runAfter(0)` + sweeper safety net) over sweeper-only: closeout variance alerts need near-real-time; the sweeper guarantees eventual delivery. (User-confirmed.)
- Render-at-send over snapshot-at-emit: retries hours later reflect current data; payload queries double as "still sendable?" checks — a null return means genuinely unsendable and suppresses, while a throw is treated as a transient fault and retried. (User-confirmed.)
- Per-category subscriptions (`cash_controls`, `eod`, `system_health`) over per-kind: right configuration grain to start. (User-confirmed.)
- Stage gate in transport, not call sites: staging exercises the entire pipeline. (User-confirmed.)
- Terminal delivery failures record an `operationalEvent`; in-app channel stubbed at schema level. (User-confirmed.)
- Reserving a delivery IS leasing it: rows are born `in_flight` with a lease token; no separate pending state. Retry eligibility lives in `retryable_failure` + `nextAttemptAt`.
- Timeouts classify as `retryable_failure` rather than the walkthrough module's `outcome_unknown`: the provider call is idempotency-keyed by delivery id, so ambiguous outcomes are safe to retry without operator triage.
- `ADMIN_EMAILS` fallback inside audience resolution removes any deploy-ordering dependency on seeding; it only fires when an org has no subscription rows at all for the category, not when a filtered match comes up empty.
- Notification rail is separate from `operationalEvent` (not a projection of it); emitters may record both side by side.

---

## Open Questions

### Resolved During Planning

- Does the new `convex/notifications` folder trip the harness contract preflight?: No — the registry indexes app scenarios, not all folders; preflight passes with the folder added.
- Does the rail need a capability-catalog entry?: No — internal-only functions; the catalog classifies public writes.
- What happens to `automationNotificationDelivery`?: Table and schema stay (historic prod rows); all writers removed; marked deprecated.

### Deferred to Implementation

- Exact backoff floor for the sweeper's re-dispatch of stale leases: tune from walkthrough constants during implementation.
- Whether the EOD emit loop needs per-store error isolation beyond the existing automation error handling: observe under test.

---

## Output Structure

    packages/athena-webapp/convex/
      schemas/notifications.ts          # three table schemas + validators
      notifications/
        deliveryPolicy.ts               # pure: attempts, backoff, classification, dedupe keys
        registry.ts                     # code-owned kind catalog (4 kinds)
        transport.ts                    # single MailerSend wrapper + stage gate
        emit.ts                         # emitNotificationWithCtx + internalMutation wrapper
        dispatch.ts                     # reserve / complete / dispatchIntent
        sweeper.ts                      # safety-net cron mutation
        seed.ts                         # subscription backfill from ADMIN_EMAILS

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```mermaid
sequenceDiagram
    participant D as Domain mutation
    participant I as notificationIntent
    participant R as reserveIntentDeliveries (mutation)
    participant A as dispatchIntent (action)
    participant T as transport (MailerSend)
    participant L as notificationDelivery
    participant S as sweeper (cron 5m prod / 60m elsewhere)

    D->>I: emit(kind, subject, payload) — no-op on dedupeKey hit
    D-->>A: scheduler.runAfter(0), unconditionally (no urgency/batched split)
    A->>R: reserve
    R->>L: lease per recipient x channel (born in_flight, leaseToken)
    R-->>A: leased batch + payload
    A->>A: registry.prepareEmail(fresh payload) — null ⇒ suppress; throw ⇒ retry with backoff
    A->>T: send (Idempotency-Key: deliveryId, 15s timeout)
    T-->>A: classified result (stage gate applied)
    A->>L: complete(leaseToken) — sent | retryable(backoff) | terminal(+operationalEvent)
    S->>L: stale leases → retryable/terminal; due retries → re-dispatch
    S->>I: pending intents older than 60s → dispatch
```

---

## Implementation Units

- U1. **Notification tables and schema registration**

**Goal:** Land `notificationIntent`, `notificationSubscription`, `notificationDelivery` with their indexes.

**Requirements:** R1, R3, R4, R10

**Dependencies:** None

**Files:**
- Create: `packages/athena-webapp/convex/schemas/notifications.ts`
- Modify: `packages/athena-webapp/convex/schema.ts`

**Approach:**
- Intent status `pending | dispatched | suppressed`; delivery status `in_flight | sent | retryable_failure | terminal_failure | outcome_unknown | suppressed`; channel enum includes `in_app` (stubbed) and delivery carries `readAt` for the future inbox.
- Indexes: intent `by_dedupeKey` / `by_status_and_emittedAt` / `by_storeId_and_emittedAt`; delivery `by_dedupeKey` / `by_intentId` / `by_status_and_leaseExpiresAt` / `by_status_and_nextAttemptAt`; subscription `by_organizationId_and_category` / `by_recipientEmail`.

**Patterns to follow:** `convex/schemas/automation.ts`, walkthrough attempt indexes in `convex/schema.ts`.

**Test scenarios:**
- Test expectation: none — schema-only; exercised through U3-U5 convexTest suites against the real schema.

**Verification:** Schema typechecks; convex codegen accepts the tables.

---

- U2. **Delivery policy and email transport**

**Goal:** Pure delivery mechanics module plus the single MailerSend wrapper owning the environment gate.

**Requirements:** R4, R7

**Dependencies:** None

**Files:**
- Create: `packages/athena-webapp/convex/notifications/deliveryPolicy.ts`
- Create: `packages/athena-webapp/convex/notifications/transport.ts`
- Test: `packages/athena-webapp/convex/notifications/deliveryPolicy.test.ts`
- Test: `packages/athena-webapp/convex/notifications/transport.test.ts`

**Approach:**
- Policy: MAX 4 attempts, a per-recipient scaled lease (base + per-recipient allowance, capped), exponential backoff capped at 24h (the cap is reachable in the general formula), HTTP classification (2xx sent; 408/429/5xx/timeout retryable; other 4xx terminal), normalized-recipient dedupe-key recipes with percent-encoded key components so client-supplied strings (POS `localEventId`) can't forge collisions. No Convex imports.
- At `MAX_DELIVERY_ATTEMPTS = 4`, only the first three backoff values are ever produced in practice — 1m, 2m, 4m — since the attempt cap terminalizes the delivery before the exponent grows large enough to approach the 24h ceiling.
- Transport: bearer auth, `Idempotency-Key` from delivery id, 15s `AbortSignal.timeout`, returns a classified result (never a raw `Response`). Non-prod: redirect to `NOTIFICATIONS_DEV_RECIPIENT` when set, else return a `suppressed` result without calling the provider.

**Execution note:** Test-first — the classification table and gate branches are enumerable up front.

**Patterns to follow:** `classifyDeliveryResult` / `nextBackoffMs` in `convex/marketing/walkthroughRequestNotifications.ts`.

**Test scenarios:**
- Happy path: 200 → sent; classification table covers 408/429/500/404/timeout.
- Edge case: backoff formula caps at 24h for large attempt inputs; attempt 1 floor is 60s; at `MAX_DELIVERY_ATTEMPTS` only 1m/2m/4m are ever exercised by the dispatch/sweeper paths.
- Error path: non-prod without dev recipient → suppressed without fetch; non-prod with dev recipient → fetch targets the override, not the real recipient.
- Happy path: prod sends to the real recipient with idempotency key present.

**Verification:** Both test files pass; no fetch occurs in suppressed mode.

---

- U3. **Kind registry and emit API**

**Goal:** Code-owned catalog of the four kinds and the one function domain code calls.

**Requirements:** R1, R2, R5, R6

**Dependencies:** U1, U2

**Files:**
- Create: `packages/athena-webapp/convex/notifications/registry.ts`
- Create: `packages/athena-webapp/convex/notifications/emit.ts`
- Test: `packages/athena-webapp/convex/notifications/registry.test.ts`
- Test: `packages/athena-webapp/convex/notifications/rail.test.ts` (end-to-end suite; covers emit alongside dispatch and sweeper)

**Approach:**
- Registry entries: kind, category, channels, `dedupeKey(payload)`, `prepareEmail(ctx, payload)` that calls the existing internal payload queries via `internal.*` references (no module imports — avoids cycles) and renders existing templates function-call style. There is no urgency/batched split — every kind dispatches immediately; the sweeper is the only backstop for anything the immediate path drops.
- Kinds: `pos.terminal_health` (system_health), `register.closeout_variance` / `register.closeout_match` (cash_controls), `eod.daily_manager_report` (eod; action-required dedupe = store+date only, preserving today's once-per-store-day guarantee).
- `emitNotificationWithCtx(MutationCtx)`: registry lookup → dedupeKey → no-op on existing intent → resolve org from store when absent → insert → unconditional `runAfter(0, dispatchIntent)`. Plus an `emitNotification` internalMutation for callers in actions.
- Non-throwing lookup (`findNotificationKind`) is used on the dispatch/sweep side: a kind that was renamed or removed by a later deploy terminalizes the intent (`suppressedReason: "unknown_kind"`, plus an operational event) instead of throwing on every sweep forever. The throwing lookup (`getNotificationKind`) stays for emit time, where an unknown kind is a caller bug that should fail loudly.

**Test scenarios:**
- Happy path: emit inserts an intent and schedules dispatch.
- Edge case: second emit with the same payload is a no-op (one intent row).
- Error path: unknown kind throws at emit time.
- Happy path: each kind's dedupeKey recipe produces the documented shape (unit-level, no db).

**Verification:** convexTest suite passes; registry exposes exactly four kinds.

---

- U4. **Dispatch pipeline**

**Goal:** Reserve-lease-render-send-complete, with audience resolution and the operational-event hook.

**Requirements:** R3, R4, R6, R8

**Dependencies:** U1, U2, U3

**Files:**
- Create: `packages/athena-webapp/convex/notifications/dispatch.ts`
- Test: `packages/athena-webapp/convex/notifications/rail.test.ts` (end-to-end suite; covers `reserveIntentDeliveries`, `completeDelivery`, and `dispatchIntent`)

**Approach:**
- `reserveIntentDeliveries` (internalMutation): resolve subscriptions for (org, category) via bounded `.take()` (recording an operational event and truncating rather than silently dropping subscribers if the 200-row cap is exceeded), filter enabled + email + store match; fall back to `ADMIN_EMAILS` only when the org has zero subscription rows for the category — never when the filtered match is empty, which instead suppresses the intent (`no_recipients`); per recipient insert-or-release delivery to `in_flight` with fresh leaseToken and attemptCount+1, using a lease duration that scales with recipient count (base + per-recipient, capped) since a batch sends serially; skip sent/terminal/suppressed, live leases, and at-cap rows; terminalize any stranded delivery whose recipient dropped out of the current audience (`recipient_unsubscribed`); mark intent dispatched. An intent whose kind is unknown (renamed/removed) is suppressed (`unknown_kind`) with an operational event instead of throwing.
- `completeDelivery` (internalMutation): leaseToken-guarded transitions; on `terminal_failure` record `operationalEvent` (`notification_delivery_failed`, subject from intent, actorType automation) via `recordOperationalEventWithCtx`.
- `dispatchIntent` (internalAction): reserve → `prepareEmail` once. A **null** return means the subject is genuinely no longer sendable and suppresses the batch + intent (`payload_unavailable`), no send attempted. A **throw** is treated as a transient fault (read limit, OCC, momentarily missing row) and stays retryable with backoff instead of suppressing — collapsing the two would let one flaky query permanently silence an alert. Then send each via transport → complete; schedule one `runAfter(minBackoff)` re-dispatch when any result is retryable.

**Execution note:** Test-first for lease-guard and suppression behavior.

**Patterns to follow:** `lease`/`complete`/`deliver` in walkthrough notifications; `recordOperationalEventWithCtx` in `convex/operations/operationalEvents.ts`.

**Test scenarios:**
- Happy path: intent + subscription rows → one delivery per recipient, sent, intent dispatched.
- Happy path: zero subscription rows for the category → ADMIN_EMAILS fallback recipients.
- Edge case: org-level subscription (no storeId) matches any store; store-scoped row only matches its store; disabled rows excluded; duplicate emails collapse to one delivery.
- Edge case: every subscription in the category disabled (rows exist, filtered match is empty) → intent suppressed `no_recipients`, no ADMIN_EMAILS fallback.
- Edge case: re-dispatch after success creates no new deliveries (delivery dedupeKey).
- Error path: `prepareEmail` returns null → deliveries and intent suppressed, no send.
- Error path: `prepareEmail` throws → deliveries retried with backoff (not suppressed), up to the attempt cap.
- Error path: complete with wrong leaseToken is a no-op.
- Integration: retryable provider result → delivery `retryable_failure` with `nextAttemptAt`; terminal result → `terminal_failure` and an `operationalEvent` row exists.

**Verification:** convexTest suite passes with transport mocked at the fetch layer.

---

- U5. **Sweeper, cron, and subscription seed**

**Goal:** The safety net and the audience backfill.

**Requirements:** R3, R4, R5

**Dependencies:** U4

**Files:**
- Create: `packages/athena-webapp/convex/notifications/sweeper.ts`
- Create: `packages/athena-webapp/convex/notifications/seed.ts`
- Modify: `packages/athena-webapp/convex/crons.ts`
- Test: `packages/athena-webapp/convex/notifications/rail.test.ts` (end-to-end suite; covers `sweep` and `seedAdminSubscriptions`)

**Approach:**
- Each of the sweeper's three phases (stale leases, due retries, stale pending intents) runs against its own batch-capped (25) budget rather than a shared one, so a backlog in one phase can't starve the others to zero work on a tick; the return value surfaces a backlog flag per phase (`staleLeaseBacklog`, `retryBacklog`, `pendingIntentBacklog`) when a phase hit its cap. Expired `in_flight` → `retryable_failure` with backoff, or `terminal_failure` + operational event at the attempt cap; due `retryable_failure` → re-schedule `dispatchIntent` per distinct intent; `pending` intents older than 60s → dispatch, tracked by a `sweepAttempts` counter on the intent (written in the sweeper's own transaction so it survives a reserve that throws and rolls back) — an intent that has sat unreserved for longer than `INTENT_ABANDON_AFTER_MS` (6h, wall-clock from the later of `emittedAt`/`requeuedAt`) is abandoned (`suppressedReason: "dispatch_unrecoverable"`) with an operational event, rather than sitting at the head of the pending queue forever; `sweepAttempts` is a diagnostic counter only and no longer drives abandonment (a pickup count would give each environment a different grace period, since sweep cadence differs per environment). `requeueAbandonedIntent` is the dashboard-only recovery path for an abandoned intent: it resets status to `pending`, clears `suppressedReason`, zeroes `sweepAttempts`, and stamps `requeuedAt` to restart the clock while preserving `emittedAt` as history. One cron ("the ONE cron of the notifications layer"), running every 5 minutes in prod and every 60 minutes in other environments.
- Seed: idempotent internalMutation inserting email subscriptions for all three categories from `ADMIN_EMAILS` per organization. It must be invoked manually from the Convex dashboard — there is no cron or migration entry that runs it automatically.

**Test scenarios:**
- Happy path: expired lease under cap → retryable with future `nextAttemptAt`.
- Edge case: expired lease at attempt cap → terminal + operational event.
- Happy path: due retryable and stale pending intent each get a dispatch scheduled; per-phase batch cap respected.
- Edge case: nothing eligible → no-op.
- Edge case: a pending intent that sits unreserved past `INTENT_ABANDON_AFTER_MS` is abandoned with reason `dispatch_unrecoverable` and an operational event.
- Happy path: seed run twice inserts each subscription once.

**Verification:** convexTest suite passes; crons file registers the sweep.

---

- U6. **Port POS terminal health alerts**

**Goal:** First caller on the rail, end-to-end validation.

**Requirements:** R1, R9

**Dependencies:** U3, U4

**Files:**
- Modify: `packages/athena-webapp/convex/pos/application/commands/terminals.ts`
- Modify: `packages/athena-webapp/convex/operations/posTerminalHealthAlertEmail.ts`
- Test: existing terminals/heartbeat test files as affected

**Approach:** Replace the `runAfter(sendPosTerminalHealthAlertToAdmins)` call with `emitNotificationWithCtx`; delete the admin-loop sender and internalAction; keep `getPosTerminalHealthAlertPayload`.

**Test scenarios:**
- Integration: heartbeat crossing into a degraded condition creates a `pos.terminal_health` intent (and still records the existing operational event).
- Edge case: repeat heartbeat with the same transition does not create a second intent.

**Verification:** Affected suites pass; no references to the deleted sender remain.

---

- U7. **Port register closeout variance and match emails**

**Goal:** Replace marker-field dedupe and gated scheduling with emits; fix the lost-alert failure mode.

**Requirements:** R1, R7, R9

**Dependencies:** U3, U4

**Files:**
- Modify: `packages/athena-webapp/convex/pos/public/sync.ts`
- Modify: `packages/athena-webapp/convex/operations/registerCloseoutVarianceEmail.ts`
- Test: `packages/athena-webapp/convex/pos/public/sync` closeout-notification tests as affected

**Approach:** Keep event-to-session matching; drop the `varianceNotificationScheduledAt` and `closeoutNotificationLocalEventId` *writes* (intent dedupe replaces them; schema fields remain for historic rows) while still *reading* both for one release as cutover guards, so a closeout the pre-rail path already reported is not re-alerted; a closeout under variance review must never fall through to the all-clear match branch; delete `shouldScheduleRegisterCloseoutNotifications`; delete both admin-loop senders and internalActions; keep both payload queries and formatting helpers.

**Test scenarios:**
- Happy path: closeout with a fresh variance review emits `register.closeout_variance` keyed by approvalRequestId.
- Happy path: clean close emits `register.closeout_match` keyed by session+localEventId.
- Edge case: replayed sync upload emits no duplicate intents.
- Edge case: session recloses under a new localEventId → new match intent.
- Integration: no writes to the legacy marker fields occur.

**Verification:** Sync suites pass; grep confirms no marker writes remain.

---

- U8. **Port EOD daily manager report sends and retire legacy delivery ledger writers**

**Goal:** EOD automation emits intents; the old reserve/mark path is removed.

**Requirements:** R1, R6, R7, R9

**Dependencies:** U3, U4

**Files:**
- Modify: `packages/athena-webapp/convex/operations/dailyOperationsAutomation.ts`
- Modify: `packages/athena-webapp/convex/operations/dailyManagerReportEmail.ts`
- Test: `packages/athena-webapp/convex/operations/dailyManagerReportEmail.test.ts`, automation suites as affected

**Approach:** Send loop becomes an emit loop (status in payload; automationRunId for action-required); delete `shouldSendScheduledDailyManagerReports`; remove reserve/mark internalMutations, dedupe helper, `sendDailyManagerReportToAdminsForDateWithCtx` and its internalAction; keep payload queries, metric builders, and the two manual actions; mark `automationNotificationDelivery` deprecated (no writers). Cutover guard: the action-required (skipped/failed) branch checks `wasActionRequiredNotifiedBeforeRail` (reads the legacy `automationNotificationDelivery` ledger) before emitting, since this automation re-runs hourly and would otherwise re-alert a store-day the pre-rail path already sent; applied/prepared sends are not guarded because the pre-rail path never ledgered those. Safe to delete once no pre-deploy store-day remains open — `operatingDate` strings are never reused, so the guard can only ever match pre-cutover days.

**Test scenarios:**
- Happy path: applied/prepared/skipped/failed automation results emit intents with correct statuses; completed-classified skips emit nothing (explicit outcome policy preserved).
- Edge case: action-required dedupe is once per store+date across re-runs with different automationRunIds.
- Happy path: registry prepare branches to the right payload query per status; missing action-required run payload suppresses.
- Integration: manual explicit-recipient actions still send outside the rail.

**Verification:** Automation and report suites pass; `automationNotificationDelivery` has no remaining writers.

---

- U9. **Docs and agent-docs refresh**

**Goal:** Repo documentation reflects the new rail as standing platform behavior.

**Requirements:** R2 (discoverability of the extension point)

**Dependencies:** U1-U8

**Files:**
- Modify: `packages/athena-webapp/docs/agent/architecture.md` (and regenerated agent docs via pre-commit)
- Create: `docs/solutions/architecture-patterns/` note per delivery-gate requirements

**Approach:** Document the emit → registry → dispatch → sweeper shape, the four kinds, subscription model and fallback, and the transport gate; the delivery gate additionally requires a solutions note and landed-change report for a branch this size.

**Test scenarios:**
- Test expectation: none — documentation; validated by the delivery gate's doc checks.

**Verification:** `bun run pr:athena` documentation checks pass.

---

## System-Wide Impact

- **Interaction graph:** Three mutation call sites change from scheduling send actions to emitting intents; one new cron joins `crons.ts`; `operationalEvent` gains a new eventType (`notification_delivery_failed`).
- **Error propagation:** Send failures no longer throw inside fire-and-forget scheduled actions; they land as ledgered delivery states with retries, and only terminal failures surface (as operational events).
- **State lifecycle risks:** Legacy marker fields stop being written but remain in schema for historic rows; `automationNotificationDelivery` becomes read-only legacy data.
- **API surface parity:** Manual explicit-recipient report actions intentionally keep their existing behavior outside the rail.
- **Integration coverage:** convexTest suites cover emit-through-complete against the real schema with fetch mocked; staging now exercises the full pipeline (transport-suppressed).
- **Unchanged invariants:** Payload queries, templates, subjects, and the EOD outcome policy (which results notify) are unchanged; POS sync ingestion semantics unchanged apart from removed marker writes.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Behavior change: non-prod now runs the pipeline | Transport suppresses provider calls unless `NOTIFICATIONS_DEV_RECIPIENT` is set; suppressed sends are marked and inspectable |
| Double-send during migration window | Intent dedupe keys mirror existing guards; provider idempotency key per delivery; action-required keeps once-per-store-day semantics |
| Render-at-send shows different content on retry | Intended; payload queries acting as sendability checks suppress no-longer-valid alerts |
| Sweeper/dispatch race on the same delivery | Lease tokens gate completion; reserve skips live leases |
| Large branch trips delivery gate | U9 plans the required solutions note + landed-change report; fingerprint stamped commit-first-then-amend |

---

## Sources & References

- Origin: conversation-approved design (this session); no upstream brainstorm doc.
- Related code: `convex/marketing/walkthroughRequestNotifications.ts`, `convex/operations/dailyManagerReportEmail.ts`, `convex/reports/sweeper.ts`, `convex/crons.ts`
- Related learnings: `docs/solutions/architecture-patterns/athena-eod-automation-manager-report-emails-2026-07-04.md`
