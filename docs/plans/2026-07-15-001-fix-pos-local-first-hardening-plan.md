---
title: "fix: POS local-first hardening — data-loss, liveness, and trust-boundary gaps"
type: fix
status: active
date: 2026-07-15
deepened: 2026-07-15
---

# fix: POS local-first hardening — data-loss, liveness, and trust-boundary gaps

## Summary

A nine-pass audit of the local-first POS stack found the event-sourced core sound (single-mutation exactly-once ingest, durable-commit-before-ack, monotonic per-cursor ordering) but exposed clustered gaps in the seams around it. This plan closes them in three independently-shippable phases: **Phase 0** stops active silent-failure paths (unauthenticated cross-tenant reads/writes, and offline sales that vanish with no record); **Phase 1** hardens liveness and convergence (batch-poisoning, unbounded ledger growth, wedged cursors, local/server conflict divergence); **Phase 2** tightens the client→server trust boundary (server-side re-pricing, idempotency keys, clock trust, money typing). Each phase lands as one integration PR from its own worktree, and each phase's finish line is an **opened, mergeable PR** (green `bun run pr:athena`, review-clean, no conflicts with `origin/main`).

This plan was strengthened by a four-lens review pass (security, money/payments, Convex backend correctness, plan quality) whose blocking findings are integrated below — most notably a re-specification of U3 (Convex has no partial-transaction rollback, so the original "catch-and-continue" approach was infeasible) and the discovery of a second unauthorized public surface (`customers.ts`).

---

## Problem Frame

The POS runs local-first on in-store terminals with flaky connectivity: sales append to an IndexedDB event log, project into React, and drain to Convex via a backoff scheduler. For an offline cash system the failure that matters most is "money changed hands but the record is gone or wrong." The audit found several paths that produce exactly that outcome — a validation-rejected offline sale dropped with no conflict record, unbounded ledger growth that eventually blocks selling, and a server that trusts terminal-supplied prices, totals, and clocks without independent recomputation. Separately, two public surfaces (`register.getState`, and all of `customers.ts`) perform cross-tenant reads/writes with no authorization. None of these are failures of the event-sourcing core; they are gaps in the validation, purge, convergence, authorization, and trust seams around it.

---

## Unit ↔ Audit-Label Map

The nine-pass audit used letter labels; this plan uses stable U-IDs. Mapping for cross-reference:

| U-ID | Audit label | Theme |
|------|-------------|-------|
| U1 | E1 + E2 | Authorize `register.getState` + `openDrawer` |
| U2 | A2 | Rejected financial events → manager-visible conflict |
| U3 | B2 | Per-event projection isolation (validate-before-write) |
| U4 | B1 | Bounded local ledger (evidence-gated purge) |
| U5 | B3/B4 | Stuck/held cursor escalation + truthful sync status |
| U6 | C1 | Local review resolution round-trips to server |
| U7 | D2 | Server-side re-pricing + override audit |
| U8 | D3 | Idempotency key across completion + register cash |
| U9 | D1 | Server-derived/clamped `occurredAt`/`operatingDate` |
| U10 | D4 | Money as integer minor units + finish pesewas migration |
| U11 | E1-adjacent | Authorize `customers.ts` (PII + writes) |

---

## Requirements

- R1. No completed offline sale (money collected) may leave the sync pipeline without either a canonical transaction or a manager-visible conflict record.
- R2. No authenticated user may read or mutate POS state (including customer PII) for a store/organization they do not belong to.
- R3. A single malformed or unprojectable event must not stall or discard an entire register session's sync stream, and must never commit a partially-projected sale.
- R4. The local event ledger must have a bounded, safe purge path so an all-day terminal cannot grow into a quota-exceeded sell-block.
- R5. When the server records a conflict, terminal and server must converge on resolution state; a locally-cleared review must not leave the server conflict permanently open.
- R6. Sale line prices and totals recorded server-side must be validated against catalog authority on every completion path, and any deviation (override/discount) must be authorized and attributable in an append-only audit.
- R7. Completing a sale must be idempotent across client retries on every completion path, including drawer cash effects.
- R8. Business timestamps and operating-date attribution must not be silently corruptible by terminal clock skew.
- R9. Money must be represented and validated as integer minor units end to end, including cash-drawer fields.

---

## Scope Boundaries

- Not rewriting the event-sourcing core, the sync-contract event shapes, or the authority/revision (CAS) model — these are sound and out of scope.
- Not changing the offline-first posture (no online-only fallback sell path is introduced).
- Not addressing the Paystack/MTN webhook signature gaps found in the storefront/online payment path — real, but they belong to the storefront checkout surface, not the in-store POS local-first flow this plan targets. Tracked separately (see Deferred to Follow-Up Work).
- Not implementing offline PIN lockout / cashier auto-lock or backend error-tracking (Sentry) in these three phases.

### Deferred to Follow-Up Work

- **A1 — authority-cutover wipe telemetry review** (explicitly dropped from active scope by request): confirm via `deletedEventCount` telemetry whether the one-time #642 cutover lost events; add a lint guard forbidding unconditional event deletion without a drain-first precondition. Separate investigation ticket.
- **Storefront payment-webhook hardening** (Paystack HMAC verification, amount verification, MTN callback auth): separate PR against the storefront/http surface.
- **Terminal security hardening** (offline PIN attempt-limiting, cashier inactivity auto-lock).
- **Backend observability** (Convex-side error tracking + cron dead-letter/alerting) — the force-multiplier that makes A2/B2/B3-class failures visible fleet-wide; strong candidate to pull forward as its own initiative.
- **C4 — finalized-lineage repair re-reconciliation** (repair applies a late sale to a closed register without recomputing its signed-off closeout): scoped follow-up in the cash-controls domain.
- **Storefront/POS reservation unification** (online decrements shared counter; POS holds invisible to storefront): inventory-domain follow-up.

---

## Context & Research

### Relevant Code and Patterns

- **Ingest/projection engine** — `packages/athena-webapp/convex/pos/application/sync/ingestLocalEvents.ts` (batch driver, sequence gate, `rejected`/`held` handling, cursor advance at `advanceAcceptedThroughSequence`), `projectLocalEvents.ts` (per-type projectors: `projectSaleCompleted` runs `validateSaleCompletedInputs`/`resolveSaleRegisterAndSession`/`validateSaleInventory` *before* the `persist*` write steps; `createConflict`, `resolveExistingSaleProjection`), `projectionPolicies.ts`, `infrastructure/repositories/localSyncRepository.ts` (`resolveConflictsForEvent` resolves conflicts; the write primitives). Single Convex mutation = one serializable OCC transaction with **no savepoints and no partial rollback** — a caught mid-projection throw does not undo prior `ctx.db` writes.
- **Conflict surface** — `convex/pos/application/sync/registerSessionSyncReview.ts` (`classifyRegisterSessionSyncReview` already has a dead `server_rejected` branch at ~:159), schema `convex/schemas/pos/posLocalSyncConflict.ts` (closed `conflictType` union `duplicate_local_id | inventory | payment | permission`; `status` union `needs_review | resolved`; `details: v.record(v.string(), v.any())`).
- **Authorization pattern to mirror** — `convex/pos/public/transactions.ts` resolves `store` → `requireAuthenticatedAthenaUserWithCtx` → `requireOrganizationMemberRoleWithCtx(store.organizationId)`; helper `requirePosTransactionStoreAccess`. Central helpers in `convex/lib/athenaUserAuth.ts`. Unauthorized surfaces: `getRegisterState.ts` (behind `register.getState`), `register.openDrawer` (authentication-only, no org check), and **all of `convex/pos/public/customers.ts`** (13 endpoints, zero auth at any layer). Deliberate non-IDOR exception: `terminalAppSessions.ts` authorizes via terminal-proof secret + `validatePosAppAccount` org check — do not add a redundant guard there.
- **Override/approval precedent** — `completeTransaction.ts` already uses the approval framework (`ApprovalRequirement`, `buildVoidApprovalRequirement` → `requiredRole: "manager"`, `inline_manager_proof`/`async_request`). This is the exact precedent for U7's price-override authority.
- **Client local store / scheduler** — `packages/athena-webapp/src/lib/pos/infrastructure/local/posLocalStore.ts` (`appendEvent`, `clearLocalReviewEvents` sets `locally_resolved` with no server call, `resetRegisterOperationalStateForAuthorityCutover`, `assertCanClearIndexedDbPosLocalStore` authority/presence checks), `syncScheduler.ts`, `usePosLocalSyncRuntime.ts`, `posLocalLedgerPolicy.ts` (`assessPosLocalLedgerRetention` — dead code, classifies `settled_unreferenced` vs `review_required`/`unsettled_sync`; no store-day input), `syncStatus.ts` (`isLocallySettledSyncStatus` counts `locally_resolved` as settled — the divergence vector), `components/pos/register/POSRegisterView.tsx` (chip styling).
- **Completion / pricing / money** — `convex/pos/application/commands/completeTransaction.ts` (`calculateCanonicalTransactionTotals` at ~:737 sums client `item.price`, `roundStoredAmount = Number(amount.toFixed(2))` at ~:733; two `recordRegisterSessionSale` call sites at ~:1199 and ~:2622 that omit `idempotencyKey`; void path passes it at ~:1833). Two public completion paths: `completeTransaction` (`transactions.ts:417`) and `createTransactionFromSession` (`transactions.ts:868`). Offline sale projection **already re-prices**: `projectLocalEvents.ts` ~:3926 computes `expectedUnitPrice = provisional.importedPrice ?? sku.netPrice ?? sku.price` and raises a non-blocking price review conflict on mismatch. Money schemas: `convex/schemas/pos/posTransaction.ts`, `posSession.ts`, and cash-drawer `convex/schemas/operations/registerSession.ts` (`openingFloat`/`expectedCash`/`countedCash`/`variance`, plus `closeoutRecords[]`), and `posLocalSyncContractValidators.ts` cash fields — all unconstrained `v.number()`. `convex/lib/currency.ts` (`toPesewas`/`toDisplayAmount`); `convex/migrations/migrateAmountsToPesewas.ts` (covers only online-order/checkout/sku tables — **no POS tables**; `onlineOrder.amount`/`paymentDue` conversions commented out; `productSku` heuristic `if (price < 10_000) skip`).
- **Server store-day derivation** — `convex/reporting/operatingPeriods.ts` `resolveReportingFinancialPeriod` derives `operatingDate` from versioned store timezone authority + schedule windows (returns `missing/invalid_timezone_authority`). It currently has **no callers under `pos/` or `operations/`** — U9 must thread it (or its inputs) into ingest.

### Institutional Learnings

- Search `docs/solutions/` for prior POS sync, closeout, and read-amplification notes before touching those surfaces (per AGENTS.md `## solutions`). Recurring fix classes (read amplification #591/#623/#657, terminal/register recovery #598/#602/#642, EOD/closeout #588–#599, duplicate POS-session sales #595, sync-replay #633/#637) indicate design-level fragility around exactly these seams.

### External References

- None required; this is internal hardening with strong local patterns to mirror (the offline path already implements the idempotency, re-pricing, and conflict discipline the online path lacks). External research skipped.

---

## Key Technical Decisions

- **Reuse the existing conflict rail, don't invent a new one.** A2/B2 route failures through the existing `posLocalSyncConflict` `needs_review` surface (via `createConflict` / `resolveConflictsForEvent`) and wire up the already-present-but-dead `server_rejected` classifier branch by adding that literal to the `conflictType` union — so managers see them in one place.
- **U3 is validate-before-write, not catch-and-continue.** Convex mutations are one OCC transaction with no partial rollback; catching a projector throw *after* a write would commit a corrupted half-sale. The fix makes projection **total** for data-shaped failures: every currently-throwing data condition is checked *before the first `ctx.db` write* for that event and returns `status: "conflicted"` instead of throwing. Genuine infra errors still abort the whole mutation for a real retry.
- **Extend the offline idempotency/re-pricing discipline to the online path.** The offline path is the *template*, not a fix target: it already dedups via `localTransactionId` and re-prices via `importedPrice ?? netPrice ?? price`. The online path must inherit both, with the behavior difference made explicit (offline flags-and-projects because money already moved; online hard-rejects pre-commit when no authorized override).
- **Server recomputes, client proposes.** Pricing (U7) and clock/operating-date (U9): the server derives the authoritative value from its own state (catalog price basis; store-day window from `operatingPeriods.ts`) and validates the client value as a proposal.
- **Purge is opt-in and evidence-gated.** U4 activates `assessPosLocalLedgerRetention` and deletes only events classified `settled_unreferenced` AND past a store-day/rollover boundary (a new input the classifier lacks today), composed with the authority/cashier-presence/protected-record checks from `assertCanClearIndexedDbPosLocalStore` — but **not** its `events.length > 0` whole-DB refusal, which would always block a selective purge.
- **Schema constraints over runtime-only rounding.** U10 moves money integrality into schema validators across POS *and* cash-drawer tables, and finishes the pesewas migration for the POS tables it never covered before any constraint is flipped.
- **Each phase is one integration PR from its own worktree**, finish line = opened + mergeable PR. Phase 2 units that share `completeTransaction.ts` (U7/U8/U9) are implemented sequentially in the same worktree; U10 (schema/migration) is parallelizable within Phase 2.

---

## Open Questions

### Resolved During Planning

- *U3 mechanism* — validate-before-write returning `conflicted`, NOT try/catch-and-continue. Convex has no partial rollback, so a caught post-write throw commits a corrupted partial sale (reviewer-confirmed). Only a projector proven to perform no writes before it can throw may be wrapped.
- *U2 surface vs retry* — surface as `needs_review` conflict using the `server_rejected` literal; a validation-rejected financial event cannot be auto-corrected. Cursor still advances on rejected (liveness preserved; confirmed at `advanceAcceptedThroughSequence`).
- *U7 reject vs flag* — online hard-rejects an unauthorized price deviation pre-commit; an authorized override (mirroring `buildVoidApprovalRequirement`) completes with an append-only audit. Offline keeps its flag-and-project review conflict (money already moved).
- *U10 migration scope* — fresh deterministic migration for the POS tables (`posTransaction`, `posTransactionItem`, `posSession`, `registerSession`) which were never migrated, not verification-only; replace the `< 10_000` heuristic and commented-out online-order conversions with a deterministic rule before flipping any constraint.
- *U4 guard reuse* — reuse only the authority/presence/protected checks, not the `events.length > 0` refusal.

### Deferred to Implementation

- Exact `occurredAt` skew-tolerance window and the ingest behavior when a store lacks timezone authority (`missing/invalid_timezone_authority`) — reject vs. fall back to terminal value with a flag (U9).
- The precise deterministic rule for disambiguating legacy cedis vs pesewas POS rows (U10) — determined against real data shape during characterization.
- Whether U5's stuck-`held` escalation reuses an existing conflict kind or adds a new signal — resolved against `registerSessionSyncReview` classification.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

Event lifecycle today vs. after this plan (per register-session cursor):

```
pending --drain--> [single Convex ingest mutation, no partial rollback]
                     |-- valid ---------------> projected  (canonical write + mapping)      [OK today]
                     |-- business/perm/dup ----> conflicted (needs_review)                  [OK today]
                     |-- envelope/payload -----> rejected  (cursor advances, NO record)     [U2: also add conflict]
                     |-- data throw AFTER write-> whole batch aborts, cursor stuck          [U3: validate BEFORE
                     |                                                                        first write -> conflicted;
                     |                                                                        never commit partial sale]
                     |-- gap / held -----------> held (successor stalls indefinitely)       [U5: escalate + surface]

local review clear: needs_review --> locally_resolved (counted as settled locally)          [U6: also resolve server
                                                                                              conflict via resolveConflictsForEvent]
local ledger: append-only, no purge --> [U4: purge settled_unreferenced past rollover]
```

Trust boundary (Phase 2): for each completion path (`completeTransaction` AND `createTransactionFromSession`), server derives authoritative `{unitPrice basis = importedPrice ?? netPrice ?? price; occurredAt/operatingDate from server store-day; amounts as integer pesewas}`, validates the client proposal, dedups on a client-stable idempotency token *before* minting the transaction, and records an append-only override audit when an authorized deviation is accepted.

---

## Implementation Units

### Phase 0 — Stop the bleed (one integration PR, worktree `fix/pos-phase0-data-loss-authz`)

- U1. **Authorize `register.getState` and `register.openDrawer`, sweep sibling POS queries** *(audit E1+E2)*

**Goal:** Close two cross-tenant IDOR holes in `register.ts`: `getState` has no authorization at all (reads another tenant's terminal state, active cashier, open register session, held cart contents); `openDrawer` is authentication-only (any authenticated user from any org can open a drawer on a target store given valid terminal/staff IDs, corrupting cash-control attribution).

**Requirements:** R2

**Dependencies:** None

**Files:**
- Modify: `packages/athena-webapp/convex/pos/public/register.ts` (`getState` wrapper) and `packages/athena-webapp/convex/pos/application/commands/register.ts` (`openDrawer` command — add org-membership, ~:64)
- Reference (no change expected): `packages/athena-webapp/convex/pos/application/queries/getRegisterState.ts`
- Reference pattern: `packages/athena-webapp/convex/pos/public/transactions.ts` (`requirePosTransactionStoreAccess`), `convex/lib/athenaUserAuth.ts`
- Test: `packages/athena-webapp/convex/pos/public/register.test.ts` (create) and the `openDrawer` command test

**Approach:**
- For `getState`: resolve `store` from `storeId`, then apply `requireAuthenticatedAthenaUserWithCtx` → `requireOrganizationMemberRoleWithCtx(store.organizationId)` before delegating.
- For `openDrawer`: add the same `requireOrganizationMemberRoleWithCtx(store.organizationId)` check (it currently calls only `requireAuthenticatedAthenaUserWithCtx`), keeping the existing resource-consistency checks.
- Sweep `terminals.ts`, `catalog.ts`, `sync.ts`, `posRecoveryCodes.ts` per-endpoint (auth-ref count < endpoint count in several, so presence-grep is insufficient) for the same omission. If the sweep finds more than a couple of same-shape omissions, split them into their own unit rather than growing U1. Do **not** touch `terminalAppSessions.ts` (deliberate terminal-proof + `validatePosAppAccount` exception — adding a guard there would be wrong). `customers.ts` is handled by U11.

**Execution note:** Test-first — write failing cross-org access tests for both `getState` and `openDrawer` before adding guards.

**Test scenarios:**
- Authorization: a user from a different org passing a valid foreign `storeId` is denied `getState` (IDOR regression).
- Authorization: a foreign-org user cannot `openDrawer` on a target store's terminal (attribution-integrity regression).
- Happy path: an org member reads state / opens a drawer successfully.
- Authorization: unauthenticated caller denied on both.
- Edge case: non-existent `storeId` yields clean not-found/denied, not a leak.

**Verification:** Both `getState` and `openDrawer` reject cross-org callers; same-org still works; sweep documented (fixed or ticketed).

---

- U11. **Authorize the `customers.ts` public surface (PII + writes)** *(audit E1-adjacent)*

**Goal:** Close a fully-unauthorized public surface: all 13 endpoints in `convex/pos/public/customers.ts` (search, get-by-id, create, update, stats, transactions, links) have zero authorization at any layer. `getCustomerById` returns full PII (name, email, phone, address, `totalSpent`, transaction history) keyed only by `customerId`; the create/update mutations are unauthenticated cross-tenant writes.

**Requirements:** R2

**Dependencies:** None (co-shipped in Phase 0)

**Files:**
- Modify: `packages/athena-webapp/convex/pos/public/customers.ts` (all endpoints)
- Modify: `packages/athena-webapp/convex/pos/application/queries/searchCustomers.ts` and `application/commands/assignCustomer.ts` (and sibling customer query/command modules) — add store/org scoping
- Test: `packages/athena-webapp/convex/pos/public/customers.test.ts` (create)

**Approach:**
- Apply the standard `requireAuthenticatedAthenaUserWithCtx` → `requireOrganizationMemberRoleWithCtx(store.organizationId)` guard to every endpoint, resolving the store from `storeId`. For `getCustomerById`/`getCustomerTransactions` (keyed by `customerId`, no store arg today), scope the read to the caller's store/org — resolve the customer's store and verify membership, or require a `storeId` arg and verify the customer belongs to it. Ensure no endpoint returns or mutates a customer outside the caller's org.

**Execution note:** Test-first — cross-org denial tests for a read (PII leak) and a write (create/update) before adding guards.

**Test scenarios:**
- Authorization: foreign-org user cannot `searchCustomers`/`getCustomerById` for a store they don't belong to (PII-leak regression).
- Authorization: foreign-org user cannot `createCustomer`/`updateCustomer` against another store (cross-tenant write regression).
- Happy path: an org member performs each operation for their own store.
- Edge case: `getCustomerById` for a customer in another org is denied even with a valid `customerId`.
- Authorization: unauthenticated caller denied on all.

**Verification:** No `customers.ts` endpoint reads or writes across org boundaries; PII is store/org-scoped.

---

- U2. **Rejected financial sync events become manager-visible conflicts** *(audit A2)*

**Goal:** Stop silent loss of completed offline sales. Today an envelope/payload/reference validation failure marks the event `rejected`, advances the cursor, and writes no `posLocalSyncConflict` — a cash sale can vanish with the drawer left short and nobody notified.

**Requirements:** R1

**Dependencies:** None

**Files:**
- Modify: `packages/athena-webapp/convex/pos/application/sync/ingestLocalEvents.ts` (the `rejected` branch)
- Modify: `packages/athena-webapp/convex/schemas/pos/posLocalSyncConflict.ts` (add a `server_rejected` literal to the `conflictType` union — this wires up the already-present-but-dead classifier branch)
- Modify/reference: `packages/athena-webapp/convex/pos/application/sync/registerSessionSyncReview.ts` (`classifyRegisterSessionSyncReview` already handles `server_rejected` ~:159) and the conflict query feeding the review UI
- Test: `packages/athena-webapp/convex/pos/application/sync/ingestLocalEvents.test.ts`

**Approach:**
- When a `rejected` event is money-bearing (`sale_completed` with payments), also create a `posLocalSyncConflict` with `conflictType: "server_rejected"` (`needs_review`), carrying `localEventId`, register session, amount, and rejection reason in `details` (the `v.record` field supports this). Keep cursor-advance behavior (liveness). Non-financial rejects (malformed telemetry) may keep today's silent-reject to avoid conflict-spam — scope the new conflict to money-bearing events.
- Add/confirm a query + review-surface entry listing rejected financial events for reconciliation.

**Execution note:** Test-first — assert a `sale_completed` with non-reconciling totals produces a `server_rejected` `needs_review` conflict, not a silent drop.

**Patterns to follow:** existing `createConflict` call sites in `projectLocalEvents.ts` and the conflict dedup in `localSyncRepository.ts`.

**Test scenarios:**
- Error path: `sale_completed` whose totals don't reconcile → event `rejected` AND a `server_rejected` conflict exists with the reason.
- Error path: `sale_completed` with a payment missing its timestamp → conflict created.
- Replay/idempotency: re-sending the same rejected event does not create duplicate conflicts (reuse conflict dedup).
- Edge case: a non-financial malformed event does not spawn a conflict (no spam).
- Audit: the conflict carries localEventId / register session / amount / reason for reconciliation.

**Verification:** No money-bearing event exits ingest as a bare `rejected` with no conflict; rejected financial events appear in the review surface.

---

### Phase 1 — Liveness & convergence (one integration PR, worktree `fix/pos-phase1-liveness-convergence`)

- U3. **Make projection total for data-shaped failures (validate before first write → conflict)** *(audit B2)*

**Goal:** A single event whose projector currently *throws* after it has already written (e.g. sale session + sale record inserted, then a mapping-collision / normalized-id-null / authority-revision throw) must not (a) abort the whole batch and wedge the register's sync stream, nor (b) — the trap in the naive fix — commit a corrupted half-projected sale. Convex has no partial-transaction rollback, so catching a post-write throw and continuing would commit the partial writes.

**Requirements:** R3

**Dependencies:** None (independent of Phase 0)

**Files:**
- Modify: `packages/athena-webapp/convex/pos/application/sync/projectLocalEvents.ts` (move every currently-throwing data condition ahead of the first `ctx.db` write in each projector; return `conflicted` instead)
- Modify: `packages/athena-webapp/convex/pos/application/sync/ingestLocalEvents.ts` (batch driver: a `conflicted` event does not abort; cursor advances; only genuine infra errors abort)
- Reference: throw sites in `registerMappingAuthorityRevision.ts`, `localSyncRepository.ts`, and `projectLocalEvents.ts` (`requireNormalizedCloudId`, store-day-not-configured, unsupported-type, `assertNever`)
- Test: `packages/athena-webapp/convex/pos/application/sync/ingestLocalEvents.test.ts`, `projectLocalEvents.test.ts`

**Approach:**
- Audit each projector's write span. `projectSaleCompleted` already front-loads `validateSaleCompletedInputs`/`resolveSaleRegisterAndSession`/`validateSaleInventory` before the `persist*` steps; the work is to move the *post-first-write* throw conditions (normalized-id nulls, mapping-authority collisions, store-day-missing, unsupported-type) into pre-write validation that returns a `needs_review`/`conflicted` result. A bad event then produces **zero** canonical writes plus a conflict; good events in the batch commit; the cursor advances.
- A `try/catch` around a projector is acceptable ONLY where that projector is proven to perform no `ctx.db` writes before any point it can throw. Otherwise the condition must become pre-write validation.
- Classify genuine infra errors (DB failure) distinctly — those still throw and abort the mutation for a real client retry (no false conflict).

**Execution note:** Characterization-first — capture current batch-abort-on-throw behavior, then change it. Include a test asserting that a data-shaped failure leaves **zero committed rows** for that event (not merely that the batch survives).

**Test scenarios:**
- Error path: a batch where event k hits a mapping-collision condition → events 1..k-1 and k+1..N commit, event k is `conflicted` with zero canonical rows written for it, cursor advances.
- Error path (the critical one): a condition that today throws *after* the sale session/record insert produces **no** committed transaction/session/inventory rows for event k.
- Edge case: a simulated infra/DB error still aborts the whole mutation (no false conflict; client retries).
- Idempotency: reprocessing after the conflict does not double-apply surrounding events.
- Happy path: an all-valid batch is unaffected.

**Verification:** One poison event neither wedges the stream nor commits a partial sale; it becomes a zero-write conflict.

---

- U4. **Bounded local ledger — evidence-gated purge at a safe boundary** *(audit B1)*

**Goal:** The IndexedDB event ledger grows unbounded all day (no purge/rollover exists); a high-volume terminal eventually hits `quota_exceeded` on `appendEvent`, which blocks selling. The retention classifier that would fix this is dead code.

**Requirements:** R4

**Dependencies:** None

**Files:**
- Modify: `packages/athena-webapp/src/lib/pos/infrastructure/local/posLocalLedgerPolicy.ts` (activate `assessPosLocalLedgerRetention`; add a store-day/rollover-boundary input, which it lacks today)
- Modify: `packages/athena-webapp/src/lib/pos/infrastructure/local/posLocalStore.ts` (add an evidence-gated selective purge op composing the classifier with the authority/cashier-presence/protected-record checks from `assertCanClearIndexedDbPosLocalStore` — but NOT its `events.length > 0` whole-DB refusal, which would always block a selective purge)
- Modify: the caller that triggers purge at a safe idle/rollover boundary (`posLocalStoreMaintenance.ts` / `usePosLocalSyncRuntime.ts` / `posLocalStorageHealth.ts`)
- Test: `packages/athena-webapp/src/lib/pos/infrastructure/local/posLocalLedgerPolicy.test.ts`, and the store's bounded-operations test

**Approach:**
- Purge an event only when `assessPosLocalLedgerRetention` classifies it `settled_unreferenced` (server-acked / `synced` or `locally_resolved`, not `review_required`/`unsettled_sync`/`upload_deferred`, no activity/workflow/receipt dependency) AND it is older than the current active register-session / store-day boundary (new input).
- Never run while unsynced/protected/active-cashier-presence records exist (reuse the authority/presence/protected portion of `assertCanClearIndexedDbPosLocalStore`).
- Trigger at a safe idle/rollover boundary, not mid-sale; emit a health/log signal with the purge count (no silent bulk delete).

**Execution note:** Test-first for the classifier extension (pure function); characterization for the store op guard.

**Test scenarios:**
- Happy path: `settled_unreferenced` past-boundary events are purged; ledger shrinks.
- Safety: an unsynced event is never purged.
- Safety: a `synced` event still referenced (open conflict / drawer-authority block / activity dependency) is never purged.
- Safety: purge refuses when active cashier presence / protected records exist.
- Edge case: nothing purgeable → no-op.
- Observability: purge count surfaced (not silent).

**Verification:** An all-day terminal's ledger is bounded across a rollover; no unsynced or referenced event is ever deleted.

---

- U5. **Escalate stuck/held cursors and stop treating `locally_resolved` as silently settled** *(audit B3/B4)*

**Goal:** A `held` successor of a `needs_review` precursor wedges foreground auto-drain indefinitely, and the sync status treats `locally_resolved` (and an operable register) as settled so a cashier gets no signal that prior sales still need reconciliation.

**Requirements:** R3, R5 (partial)

**Dependencies:** None (complements U3 on the server; shares status surface with U6)

**Files:**
- Modify: `packages/athena-webapp/src/lib/pos/infrastructure/local/syncStatus.ts` (`isLocallySettledSyncStatus` treats `locally_resolved` as settled ~:122 — the divergence vector; and the review-count derivation ~:135) and `packages/athena-webapp/src/components/pos/register/POSRegisterView.tsx` (confirm and fix the "ready"-styling mask)
- Modify: `packages/athena-webapp/src/lib/pos/infrastructure/local/syncScheduler.ts` / `usePosLocalSyncRuntime.ts` (held-successor path)
- Possibly modify: `packages/athena-webapp/convex/pos/application/sync/ingestLocalEvents.ts` or `registerSessionSyncReview.ts` (server-side stuck-gap escalation)
- Test: `syncStatus.test.ts`, `syncScheduler.test.ts`

**Approach:**
- Make an outstanding review truthful in the chip: an unresolved/`needs_review` (and a `locally_resolved` not yet server-confirmed — see U6) renders as an attention state, not success "ready", while the register stays operable. Verify the exact "ready" styling location in `POSRegisterView.tsx` during implementation.
- Give a `held` successor of a stuck review precursor a path forward: include the precursor in an escalation drain, or escalate a long-`held` gap to a visible conflict/manager action so the cursor is not silently stuck forever. Prefer reusing the review classification over a new UI.

**Execution note:** Characterization-first on scheduler wedge behavior and the status derivation.

**Test scenarios:**
- Error path: a `held` event whose precursor is `needs_review` surfaces an actionable state instead of looping silently.
- UI: an outstanding review renders as review-needed, not success "ready", with the register operable.
- Convergence: a `locally_resolved` event not yet server-confirmed does not read as fully settled (ties to U6).
- Happy path: a fully-synced register shows "ready".
- Edge case: a transient `held` that resolves next drain does not false-alarm.

**Verification:** No silent indefinite wedge; cashiers see when prior sales need review.

---

- U6. **Round-trip local review resolution to the server** *(audit C1)*

**Goal:** `clearLocalReviewEvents` moves ANY `needs_review` event to `locally_resolved` (treated as settled locally) but never tells the server, which still holds the `posLocalSyncConflict` as `needs_review`. Terminal shows "clear" while the server shows an open conflict — the two never converge.

**Requirements:** R5

**Dependencies:** U5 (shares the status surface; integrate after)

**Files:**
- Modify: `packages/athena-webapp/src/lib/pos/infrastructure/local/posLocalStore.ts` / `terminalRecoveryCommands.ts` (local clear path emits a server resolution call; only mark `locally_resolved` after server ack, else reconcile next sync)
- Add: an authorization-checked resolve mutation in `packages/athena-webapp/convex/pos/application/sync/registerSessionSyncReview.ts` (or a public wrapper) built on the existing `resolveConflictsForEvent` primitive in `localSyncRepository.ts`
- Test: `convex/pos/application/sync/registerSessionSyncReview.test.ts` (create) and the client store/recovery test

**Approach:**
- On local resolve, round-trip a server resolution that transitions the `posLocalSyncConflict` to `resolved` via `resolveConflictsForEvent`, authorization-checked with an explicit role: the POS org role (`requireOrganizationMemberRoleWithCtx(["full_admin","pos_only"])`) at minimum, or `manager` if the conflict class warrants it (pick one explicitly — do not invent a third notion). Mark the event `locally_resolved` only after server ack; otherwise leave it `needs_review` to reconcile on next sync.
- Note the current local clear is broader than "uploaded `register.opened`" — it clears any `needs_review` — so scope the server round-trip to match the events that are actually clearable.

**Execution note:** Test-first for the server resolve mutation including the authz path.

**Test scenarios:**
- Happy path: local resolve → server conflict transitions to `resolved`; both converge.
- Authorization: a caller without the chosen review role cannot resolve the server conflict.
- Failure path: server resolution fails/offline → event stays `needs_review` (not falsely settled); reconciles next sync.
- Idempotency: resolving an already-`resolved` conflict is a safe no-op.
- Audit: server-side resolution is attributable (who/when).

**Verification:** No terminal can show a conflict cleared while the server still lists it open.

---

### Phase 2 — Trust boundary (one integration PR, worktree `fix/pos-phase2-trust-boundary`)

- U7. **Server-side re-pricing (both paths) + append-only override audit** *(audit D2)*

**Goal:** Both online completion paths recompute totals from client-supplied `item.price` and only check internal arithmetic; the authoritative catalog price is never compared. A stale-catalog or tampered terminal sells at an arbitrary price with no attribution. The offline path already re-prices — it is the template, not a fix target.

**Requirements:** R6

**Dependencies:** None (shares `completeTransaction.ts` with U8/U9 — sequence within the Phase 2 worktree)

**Files:**
- Modify: `packages/athena-webapp/convex/pos/application/commands/completeTransaction.ts` — `calculateCanonicalTransactionTotals` (~:737) and BOTH the direct (`completeTransaction`, ~:997) and session (`createTransactionFromSession`, ~:2400) paths
- Modify: the reporting-ingress write sites so the server-derived price flows into `posTransactionItem.unitPrice/totalPrice` (~:1276, ~:2730) AND the reporting line `unitPriceMinor/totalAmountMinor/grossAmountMinor` (~:1336, ~:2818) AND transaction `subtotal/total`
- Add: an append-only price-override audit (reuse `operationalEvent` or the lifecycle-journal rail; do not invent a new table). Mirror the `buildVoidApprovalRequirement` approval pattern for override authority (`requiredRole: "manager"`).
- Reference: offline basis `projectLocalEvents.ts` ~:3926 (`importedPrice ?? netPrice ?? price`)
- Test: `packages/athena-webapp/convex/pos/application/commands/completeTransaction.test.ts`

**Approach:**
- Compute the canonical line from the catalog price **basis `provisional.importedPrice ?? sku.netPrice ?? sku.price`** (matching the offline path exactly — comparing bare `sku.price` would spuriously reject legitimate net-priced/provisional-import lines that project fine offline). Confirm the unit of the catalog field and avoid comparing cedis against pesewas (this overlaps U10; U7 lands first, so handle the unit explicitly here).
- If the client line matches the derived basis → proceed. If it differs and the actor carries override authority (mirror `buildVoidApprovalRequirement`) → accept and write an append-only override audit (actor, sku, catalog basis, charged price, delta, reason). If it differs with no override authority → **hard-reject** (this is the online behavior; offline keeps its flag-and-project review conflict because money already moved).
- Cover provisional-import lines explicitly. Apply to both completion paths so terminals cannot bypass via the session path.

**Execution note:** Test-first — write the tamper-rejection and override-audit tests first.

**Test scenarios:**
- Happy path: client price equals derived basis → completes, no override audit.
- Tamper/error: client price below basis, no override authority → rejected (both direct and session paths).
- Override: authorized manager discount → completes AND an append-only audit records the delta/actor.
- Basis correctness: a net-priced / provisional-import line prices against `importedPrice ?? netPrice ?? price`, not bare `sku.price`, and is not spuriously rejected.
- Parity: reporting `*Minor` fields and transaction totals reflect the server-derived price, not the client value.
- Edge case: missing SKU price / deactivated product → explicit handling, not silent client-trust.

**Verification:** No sale on either path records a line price the server did not derive or an authorized actor did not explicitly override with an audit trail; reporting reflects the derived price.

---

- U8. **Idempotency token across both completion paths + register cash effect** *(audit D3)*

**Goal:** The online completion mutations accept no idempotency token and always mint a new transaction number; a non-deduped resubmit creates a second sale, second stock decrement, and — because `recordRegisterSessionSale` omits the `idempotencyKey` the void path uses — double drawer cash. The offline path already solves this via `localTransactionId`.

**Requirements:** R7

**Dependencies:** None (shares `completeTransaction.ts`/`registerSessions.ts` — sequence within Phase 2 worktree)

**Files:**
- Modify: `packages/athena-webapp/convex/pos/public/transactions.ts` — accept a client-stable idempotency token on BOTH `completeTransaction` (:417) and `createTransactionFromSession` (:868)
- Modify: `packages/athena-webapp/convex/pos/application/commands/completeTransaction.ts` — dedup on the token **before** `createPosTransaction`/`generateTransactionNumber` (~:1156); pass the same token as `idempotencyKey` to both `recordRegisterSessionSale` call sites (~:1199, ~:2622)
- Modify (confirm): `packages/athena-webapp/convex/operations/registerSessions.ts` — `recordRegisterSessionSale` threads the key through `recordedTransactionKeys` exactly like the void path
- Modify: client completion gateway in `packages/athena-webapp/src/lib/pos/...` to generate/send the token where the online paths are used
- Test: `completeTransaction.test.ts`, `registerSessions.test.ts`

**Approach:**
- Accept a client-generated stable idempotency token. Dedup the transaction **mint** on it (return the existing transaction on replay, mirroring `resolveExistingSaleProjection`) — keying off the freshly-minted `transactionId` would produce a new key per retry and dedup nothing, since a sale has no stable server id before mint (unlike the void path which keys off an existing `transaction._id`). Thread the same token into `recordRegisterSessionSale` so the drawer cash increment is guarded by `recordedTransactionKeys`.
- Ensure the online token namespace cannot double-record a sale that also arrives via the offline `localTransactionId` path (prefer a shared/derivable token).

**Execution note:** Test-first — assert double-submit yields one transaction, one stock decrement, one cash delta, on both completion paths.

**Test scenarios:**
- Idempotency: two `completeTransaction` calls with the same token → one `posTransaction`, one inventory decrement, one register cash delta.
- Idempotency: same for `createTransactionFromSession`.
- Integration: register `expectedCash` incremented exactly once under retry.
- Edge case: missing token → defined behavior (reject or server-derive), not silent double-charge risk.
- Cross-path: a sale recorded online then arriving offline (or vice versa) is not double-recorded.

**Verification:** No completion path can double-charge cash or double-decrement stock under client retry.

---

- U9. **Server-derived/clamped `occurredAt` and `operatingDate`** *(audit D1)*

**Goal:** Every event's `occurredAt` and the `operatingDate`/day-window are taken from the terminal clock and trusted (server checks only finite/positive and a date regex). A skewed/backdated terminal books sales into the wrong operating day and computes closeout variance against terminal-provided dates.

**Requirements:** R8

**Dependencies:** None (shares completion/ingest surface)

**Files:**
- Modify: `packages/athena-webapp/convex/pos/application/sync/ingestLocalEvents.ts` (`occurredAt` validation ~:603, `operatingDate` validation ~:802, and the window taken from the `register.opened` payload ~:656) and the sale/open/close projectors that persist them
- Thread in: `packages/athena-webapp/convex/reporting/operatingPeriods.ts` `resolveReportingFinancialPeriod` (server store-day derivation from versioned timezone authority + schedule) — currently has no `pos/` callers, so U9 wires its inputs (timezone authority + schedule) into the ingest mutation
- Test: `ingestLocalEvents.test.ts` and any operating-date attribution test

**Approach:**
- Derive `operatingDate` server-side from the store-day window (`resolveReportingFinancialPeriod`) or validate the terminal-supplied date against that window, correcting/rejecting out-of-window values. Clamp/annotate `occurredAt` against server time with a bounded skew tolerance; when terminal time is implausible, record server time as authoritative and flag the divergence. Preserve legitimate offline lag — distinguish "old but plausible" from "skewed/backdated".
- Define behavior when the store lacks timezone authority (`missing/invalid_timezone_authority` from `resolveReportingFinancialPeriod`): reject, or fall back to the terminal value with an explicit flag — decide at implementation and document. Note that clamping shifts the value feeding closeout variance and reporting fingerprints (intended, downstream effect).

**Execution note:** Characterization-first — capture current attribution, then constrain, to avoid misattributing legitimate offline-lag sales.

**Test scenarios:**
- Happy path: a plausibly-timed offline sale keeps its `occurredAt` and lands in the correct operating day.
- Error path: a wildly future/backdated `occurredAt` is clamped/flagged, not trusted verbatim.
- Edge case: a legitimate long-offline sale (created hours ago) is still attributed correctly, not falsely clamped.
- Edge case: `operatingDate` outside the server store-day window is corrected/rejected.
- Edge case: store lacking timezone authority → the defined fallback/rejection behavior (not silent terminal-trust).
- Boundary: sale near local midnight attributes to the correct store-day.

**Verification:** Operating-day attribution and sale timestamps cannot be silently corrupted by terminal clock skew.

---

- U10. **Money as integer minor units in schema (POS + cash drawer) + finish POS pesewas migration** *(audit D4)*

**Goal:** Money fields are unconstrained `v.number()` (float-capable) across POS *and* cash-drawer tables; rounding is enforced only in code. The pesewas migration never covered the POS tables at all, and its online-order coverage is half-done/heuristic. A float can still be written by any mutation, and legacy POS rows may be in cedis.

**Requirements:** R9

**Dependencies:** None (parallelizable within Phase 2 — does not touch `completeTransaction.ts` control flow)

**Files:**
- Modify: `packages/athena-webapp/convex/schemas/pos/posTransaction.ts`, `posSession.ts`, payment amount schemas, AND `packages/athena-webapp/convex/schemas/operations/registerSession.ts` (`openingFloat`/`expectedCash`/`countedCash`/`variance` + `closeoutRecords[]`), and the cash fields in `posLocalSyncContractValidators.ts` — apply a shared integer-minor-unit validator
- Modify: `packages/athena-webapp/convex/migrations/migrateAmountsToPesewas.ts` — add deterministic POS-table migration (`posTransaction`, `posTransactionItem`, `posSession`, `registerSession`); replace the `< 10_000` heuristic and the commented-out `onlineOrder.amount`/`paymentDue` conversions with a deterministic rule; add an idempotent completion/verification marker
- Align: float-producing writers to integer arithmetic — `roundStoredAmount = Number(amount.toFixed(2))` and `totalsMatch`/`roundMoney` (`completeTransaction.ts` ~:733/:755) become no-ops-at-best / wrong-at-worst once amounts are integer pesewas
- Reference: `packages/athena-webapp/convex/lib/currency.ts`
- Test: schema/validator tests; a migration verification test
- Coordinate: `bun run pre-commit:generated-artifacts` (Convex `_generated` refresh)

**Approach:**
- Characterize the current money representation of existing `posTransaction`/`posTransactionItem`/`posSession`/`registerSession` rows FIRST (they were never migrated to pesewas). Add a deterministic POS-table migration where legacy cedis rows exist, with an idempotent completion marker; do not use the `< 10_000` heuristic (it mis-reads a legitimately cheap cedis item as pesewas). Only after the migration is complete and verified, flip the schema money fields to an integer-minor-unit validator across POS and cash-drawer tables. Audit and align float-producing code paths to integer arithmetic.

**Execution note:** Characterization-first on current data shape; verify the migration ran to completion before flipping the schema constraint to avoid rejecting existing rows.

**Test scenarios:**
- Happy path: a valid integer-pesewas amount writes successfully (POS and drawer fields).
- Error path: a fractional amount is rejected by the schema validator (POS and drawer fields).
- Migration: a legacy cedis POS row is converted deterministically (no double-conversion, no skip of a cheap cedis item).
- Migration idempotency: re-running does not double-convert; the completion marker is honored.
- Verification: the completion marker records the migration ran to completion for POS tables.
- Regression: drawer `variance = countedCash − expectedCash` stays correct under integer arithmetic.

**Verification:** No POS or cash-drawer money field can hold a float; the POS pesewas migration has a verifiable completion state; no dual-represented rows remain.

---

## System-Wide Impact

- **Interaction graph:** Phase 0 concentrates in public authz wrappers; Phase 1 in the ingest mutation + client scheduler/store; Phase 2 in the completion command + money schema. The offline sale-projection path and the online completion path must stay consistent for U7/U8/U9 — a fix on one path that misses the other leaves a bypass.
- **Error propagation:** U2/U3 convert silent drops and batch aborts into `needs_review`/`conflicted` records — the review surface must render the new (money-bearing-scoped) conflict volume without overwhelming managers.
- **State lifecycle risks:** U3 must never commit a partial sale; U4 purge and U6 resolution must be strictly evidence-gated to avoid deleting/settling something still in flight.
- **API surface parity:** U7/U8/U9 must apply to BOTH `completeTransaction` and `createTransactionFromSession` (and stay consistent with the offline projection), or terminals bypass the guard.
- **Unchanged invariants:** The event-sourcing core (single-mutation exactly-once, monotonic cursor, durable-commit-before-ack), the authority/revision CAS model, and the sync-contract event shapes are explicitly unchanged; new work sits at the validation/purge/convergence/authorization/trust seams around them.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| U3 done as naive catch-and-continue commits a corrupted partial sale (Convex has no partial rollback) | Re-specified as validate-before-first-write → `conflicted`; test asserts zero committed rows for a data-failed event; only no-write projectors may be try/caught. |
| U3's per-event isolation swallows a genuine infra error, hiding real outages | Classify infra vs data-shaped conditions; infra still aborts the mutation for a real retry; DB-failure test. |
| U1/U11 miss another unauthorized public surface | Per-endpoint sweep (not presence-grep) across `terminals.ts`/`catalog.ts`/`sync.ts`/`posRecoveryCodes.ts`; `customers.ts` given its own unit; `terminalAppSessions.ts` documented as a deliberate exception. |
| U4 purge deletes an acked-but-referenced event, or the reused guard always blocks | Gate on `settled_unreferenced` AND not-referenced AND past-boundary; reuse only the authority/presence/protected checks, not `events.length > 0`; per-case safety tests; surface counts. |
| U7 rejects legitimate net-priced/provisional/discount sales | Basis `importedPrice ?? netPrice ?? price` (matches offline); override-with-audit via the void-approval framework; hard-reject only without authority; explicit basis tests. |
| U8 keys the cash effect off the freshly-minted id and dedups nothing | Client-stable token dedups the mint pre-`createPosTransaction` and guards the cash effect with the same key; both completion paths covered. |
| U9 clamping misattributes legitimate long-offline sales, or store lacks timezone authority | Distinguish "old but plausible" from "skewed"; characterization-first; defined behavior for `missing/invalid_timezone_authority`. |
| U10 schema constraint rejects existing float/cedis POS rows on deploy | POS tables were never migrated — characterize + deterministic POS migration + completion marker BEFORE flipping the constraint; include cash-drawer schema. |
| Phase 2 units all touch `completeTransaction.ts` and conflict at integration | Implement U7/U8/U9 sequentially in the single Phase 2 worktree; U10 parallelizable; one integration PR. |
| Prod-backend POS E2E runs on PRs against a live store | Confirm the E2E fixture store is disposable and runs are cleaned; flag if these changes affect it. |

---

## Documentation / Operational Notes

- After each phase merges, refresh graphify (`bun run graphify:rebuild`) per AGENTS.md and any POS docs whose standing behavior changed (conflict surface, purge, re-pricing, authz).
- If a phase changes durable POS behavior materially, add a `docs/solutions/` note per the repo's `ce-compound` contract (recurring bug classes here justify durable learnings).
- Delivery sensor for every phase: `bun run pr:athena` (PR-equivalent gate); targeted Vitest per unit via `bun run test -- <path> -t "<name>"` from `packages/athena-webapp`; `bun run pre-commit:generated-artifacts` when Convex modules/schema change (esp. U10).

---

## Phased Delivery

Each phase's finish line is an **opened, mergeable PR**: green `bun run pr:athena`, review-loop clean (unanimous reviewer approval, no unresolved actionable threads), and no conflicts with `origin/main`. Per user scope, the phases are not auto-merged — they are delivered as mergeable PRs.

### Phase 0 — Stop the bleed (worktree `fix/pos-phase0-data-loss-authz`)
- U1 (register authz: getState + openDrawer), U11 (customers.ts authz), U2 (rejected-sale conflict). Highest severity, smallest surface. One integration PR.

### Phase 1 — Liveness & convergence (worktree `fix/pos-phase1-liveness-convergence`)
- U3 (validate-before-write projection isolation), U4 (ledger purge), U5 (stuck/held escalation + truthful status), U6 (local-resolve round-trip). One integration PR. Sequence U6 after U5 (shared status surface).

### Phase 2 — Trust boundary (worktree `fix/pos-phase2-trust-boundary`)
- U7 (re-pricing + override audit), U8 (idempotency), U9 (clock/operating-date), U10 (money schema + migration). One integration PR. Sequence U7/U8/U9 (shared `completeTransaction.ts`); U10 parallelizable.

---

## Sources & References

- Origin: nine-pass POS stack audit (this session) — backend domain, payments, cash-controls, inventory coupling, frontend resilience, cross-cutting, and three local-first deep-dives (ingest/projection engine, authority/replication, local store & convergence) — plus a four-lens plan review (security, money/payments, Convex backend correctness, plan quality).
- Related code: `packages/athena-webapp/convex/pos/**`, `packages/athena-webapp/src/lib/pos/**`, `packages/athena-webapp/convex/operations/**`, `packages/athena-webapp/convex/schemas/pos/**`, `packages/athena-webapp/convex/schemas/operations/registerSession.ts`, `packages/athena-webapp/convex/reporting/operatingPeriods.ts`, `packages/athena-webapp/convex/migrations/migrateAmountsToPesewas.ts`.
- Related prior work (recurring fix classes): #591/#623/#657 read amplification, #633/#637 sync replay/contract, #642 register authority replication, #595 duplicate POS-session sales, #588–#599 EOD/closeout.
