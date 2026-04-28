---
title: test: Harden POS session workflow coverage
type: test-spec
status: proposed
date: 2026-04-28
---

# test: Harden POS session workflow coverage

## Summary

Add comprehensive regression coverage for the POS session workflow from cashier sign-in through drawer gating, session start/resume/hold/recovery, cart and payment mutation, customer attribution, checkout completion, trace recording, and stale-client failure handling. This is a test-only hardening pass unless implementation discovers an uncovered production bug; any behavior change should be isolated and documented as a follow-up fix.

## Problem Frame

POS is a production-critical workflow with several invariants that must hold beyond the visible register UI. Existing coverage already protects important slices: drawer binding on item mutation, closeout-blocked UI, payment checkout-state ordering, trace milestones, and profile-backed customer attribution. The surface is still broad enough that gaps can hide in transitions between those slices: bootstrap decisions, stale clients, recovery binding, cashier/session ownership, payment/cart races, checkout register-session attribution, and customer state preservation.

This spec gives another agent a concrete test implementation plan. It should be implemented characterization-first: capture expected current behavior before changing production code. If a proposed test fails because the code is wrong, keep the test, fix the smallest production bug needed, and record the bug in handoff.

## Requirements

- R1. Every POS sale mutation path must require an active cashier-owned session and a POS-usable matching drawer where the operation mutates sale, cart, payment, or checkout state.
- R2. Drawer startup, recovery, closeout-blocked, and stale-client states must be differentiated at both command and presentation boundaries.
- R3. Session lifecycle transitions must preserve cart, customer, payment, drawer, cashier, expiration, and trace state according to the transition being performed.
- R4. Checkout completion must create the transaction, inventory/accounting side effects, register-session sale record, and POS trace events only after drawer and payment preconditions pass.
- R5. Payment and cart sync must be race-resistant through `checkoutStateVersion` and must not resurrect stale checkout snapshots.
- R6. Customer attribution must preserve `customerProfileId` as the canonical identity when available and must not clear cart, payments, cashier, or drawer state.
- R7. Operator-facing failures should be normalized through existing command-result and POS operator-message paths, not raw thrown text.
- R8. The focused POS validation slice in `packages/athena-webapp/docs/agent/testing.md` must remain accurate after adding tests.

## Scope Boundaries

- Do not redesign POS behavior, customer attribution, checkout, traces, cash controls, or drawer lifecycle.
- Do not introduce browser E2E coverage unless a missing behavior cannot be honestly tested with existing Vitest/unit harnesses.
- Do not edit generated Convex artifacts unless a real public Convex API signature changes.
- Do not broaden this into storefront checkout, expense sessions, stock operations, or service-case payment workflows.
- Do not clean up unrelated legacy POS tests unless they directly block the new coverage.

## Existing Context

### Code Surfaces

- Backend session command service: `packages/athena-webapp/convex/pos/application/commands/sessionCommands.ts`
- Public POS session mutations and queries: `packages/athena-webapp/convex/inventory/posSessions.ts`
- POS session item public mutations: `packages/athena-webapp/convex/inventory/posSessionItems.ts`
- Transaction completion: `packages/athena-webapp/convex/pos/application/commands/completeTransaction.ts`
- Register state query: `packages/athena-webapp/convex/pos/application/queries/getRegisterState.ts`
- Drawer/session state policy: `packages/athena-webapp/shared/registerSessionStatus.ts`
- Register view-model: `packages/athena-webapp/src/lib/pos/presentation/register/useRegisterViewModel.ts`
- Register UI state types/selectors: `packages/athena-webapp/src/lib/pos/presentation/register/registerUiState.ts`, `packages/athena-webapp/src/lib/pos/presentation/register/selectors.ts`
- Convex client gateways: `packages/athena-webapp/src/lib/pos/infrastructure/convex/sessionGateway.ts`, `packages/athena-webapp/src/lib/pos/infrastructure/convex/registerGateway.ts`, `packages/athena-webapp/src/lib/pos/infrastructure/convex/commandGateway.ts`
- Register shell and drawer gate UI: `packages/athena-webapp/src/components/pos/register/POSRegisterView.tsx`, `packages/athena-webapp/src/components/pos/register/RegisterDrawerGate.tsx`, `packages/athena-webapp/src/components/pos/SessionManager.tsx`, `packages/athena-webapp/src/components/pos/session/HeldSessionsList.tsx`

### Existing Tests To Extend

- `packages/athena-webapp/convex/pos/application/sessionCommands.test.ts`
- `packages/athena-webapp/convex/inventory/posSessions.trace.test.ts`
- `packages/athena-webapp/convex/pos/application/completeTransaction.test.ts`
- `packages/athena-webapp/convex/pos/application/getRegisterState.test.ts`
- `packages/athena-webapp/convex/operations/registerSessions.trace.test.ts`
- `packages/athena-webapp/src/lib/pos/presentation/register/useRegisterViewModel.test.ts`
- `packages/athena-webapp/src/lib/pos/infrastructure/convex/sessionGateway.test.ts`
- `packages/athena-webapp/src/lib/pos/infrastructure/convex/registerGateway.test.ts`
- `packages/athena-webapp/src/components/pos/register/POSRegisterView.test.tsx`
- `packages/athena-webapp/src/components/pos/SessionManager.test.tsx`
- `packages/athena-webapp/src/components/pos/session/HeldSessionsList.test.tsx`

### Institutional Learnings

- `docs/solutions/logic-errors/athena-pos-drawer-invariants-at-command-boundaries-2026-04-24.md`: UI gates are ergonomics; Convex command boundaries must enforce drawer invariants.
- `docs/solutions/logic-errors/athena-pos-customer-profile-attribution-compatibility-2026-04-25.md`: POS attribution should carry `customerProfileId` as canonical identity while preserving POS compatibility fields.

## Test Implementation Units

### U1. Session Command Boundary Matrix

**Goal:** Expand command-service coverage so every session command proves its preconditions and side-effect boundaries.

**Files:**
- Extend: `packages/athena-webapp/convex/pos/application/sessionCommands.test.ts`
- Production under test: `packages/athena-webapp/convex/pos/application/commands/sessionCommands.ts`

**Test scenarios:**
- Start session requires a normalized register number when no terminal register number can be resolved.
- Start session trims register numbers and binds to the terminal's configured register number over an incoming stale argument.
- Start session rejects an explicitly provided drawer from another store.
- Start session rejects an explicitly provided drawer with missing terminal identity.
- Start session reuses same-terminal active empty session without auto-holding it, while binding a valid drawer if missing.
- Start session auto-holds same-terminal active non-empty session and preserves customer/payment metadata when returning the existing session id.
- Resume session rejects active cashier sessions on other terminals before mutating the held session.
- Resume session binds only to a POS-usable drawer matching the held session's terminal/register identity.
- Bind recovery is idempotent for the same drawer and does not refresh expiration or mutate unrelated fields.
- Bind recovery rejects an already-bound different drawer without changing cart items, customer metadata, payments, or expiration.
- Hold session accepts active or held modifiable sessions only for the owning cashier and does not refresh expiration.
- Add/update/remove item all reject missing, closed, closing, mismatched-terminal, mismatched-register, and mismatched-store drawer bindings before inventory calls.
- Inventory hold acquire/adjust/release failures return `inventoryUnavailable` and do not patch the session expiration or trace item milestones.
- Trace recording failures remain best-effort for start, hold, resume, auto-hold, item add/update, and item removal.

**Acceptance:** The fake repository asserts no side-effect calls happen after failed preconditions: no item writes, no inventory calls, no session expiration refresh, and no trace calls unless the operation has already committed.

### U2. Public Session Mutation and Race Coverage

**Goal:** Prove browser-callable Convex mutations enforce the same invariants as the command service, including stale-client and checkout-state ordering paths.

**Files:**
- Extend: `packages/athena-webapp/convex/inventory/posSessions.trace.test.ts`
- Consider extending if item public mutation coverage is separate: `packages/athena-webapp/convex/inventory/posSessionItems.ts`
- Production under test: `packages/athena-webapp/convex/inventory/posSessions.ts`

**Test scenarios:**
- `updateSession` preserves `customerProfileId` and records `customerLinked` when profile id changes from empty to populated.
- `updateSession` records `customerUpdated` when only name/email/phone changes under the same profile id.
- `updateSession` records `customerCleared` when both profile id and customer info are cleared.
- `updateSession` treats completed, voided, and expired sessions owned by the same cashier as no-op metadata updates, with no trace writes.
- `updateSession` rejects cashier mismatch, missing session, completed by another cashier, and expired by another cashier with safe command-result errors.
- `syncSessionCheckoutState` ignores stale versions and does not write payments, expiration, or trace events.
- `syncSessionCheckoutState` accepts strictly newer versions and records payment-added, payment-updated, payment-removed, and payments-cleared trace data.
- `syncSessionCheckoutState` rejects missing, closed, closing, mismatched-terminal, mismatched-register, and mismatched-store drawer bindings before patching payments.
- `releaseSessionInventoryHoldsAndDeleteItems` ignores stale clear-cart versions after newer payment state.
- `releaseSessionInventoryHoldsAndDeleteItems` deletes items, releases all held SKU quantities, clears payments, records `cartCleared`, and advances the checkout version only when drawer binding is valid.
- `releaseSessionInventoryHoldsAndDeleteItems` rejects missing, closed, closing, mismatched-terminal, mismatched-register, and mismatched-store drawer bindings before deleting items or releasing holds.
- `voidSession` releases inventory holds aggregated per SKU, marks the session void, keeps item audit records, and records a void trace.
- `voidSession` handles empty sessions without release calls and still records a void lifecycle.
- Expiration cleanup does not overwrite existing void/completed trace identity and releases only eligible session statuses.

**Acceptance:** Tests assert exact `CommandResult` shape (`kind`, `code`, safe message) for expected user errors and assert stale writes leave the in-memory session unchanged.

### U3. Register State and Bootstrap Decisions

**Goal:** Cover the query/application layer that decides whether POS should require cashier auth, open drawer setup, recover a sale, resume a held sale, or start selling.

**Files:**
- Extend: `packages/athena-webapp/convex/pos/application/getRegisterState.test.ts`
- Extend: `packages/athena-webapp/src/lib/pos/application/bootstrapRegister.test.ts`
- Production under test: `packages/athena-webapp/convex/pos/application/queries/getRegisterState.ts`, `packages/athena-webapp/src/lib/pos/application/useCases/bootstrapRegister.ts`

**Test scenarios:**
- No terminal returns the existing terminal-unavailable phase without querying session-specific state.
- Terminal with no cashier returns `requiresCashier`.
- Open or active register session plus no active POS session returns `readyToStart`.
- Closing register session is visible enough for closeout-blocked UI but never sets `canStartSession` or `canResumeSession`.
- Active POS session with valid open drawer returns `active`.
- Active POS session missing `registerSessionId` returns a recoverable active state that the view-model can gate.
- Held session plus POS-usable drawer returns `resumable`.
- Held session plus missing or closing drawer returns `resumable` data but with start/resume disabled by `bootstrapRegister`.
- Expired active/held sessions are ignored or marked expired according to current query behavior.
- When both active and held candidates exist, active session wins for the same cashier/terminal.

**Acceptance:** `bootstrapRegister` tests cover every phase and every `canStartSession` / `canResumeSession` boolean combination.

### U4. Register View-Model Workflow Coverage

**Goal:** Exercise the POS register view-model as the user-facing orchestrator, especially around hidden race and recovery paths.

**Files:**
- Extend: `packages/athena-webapp/src/lib/pos/presentation/register/useRegisterViewModel.test.ts`
- Production under test: `packages/athena-webapp/src/lib/pos/presentation/register/useRegisterViewModel.ts`

**Test scenarios:**
- Cashier authentication requests bootstrap and does not start a session until active store, terminal, cashier, and usable drawer are available.
- Missing drawer initial setup disables product entry, cart actions, and checkout completion, and exposes drawer gate state with opening-float validation.
- Drawer open success clears drawer input/error state, requests bootstrap, and does not clear cashier.
- Drawer open failure maps backend text through `toOperatorMessage` and keeps the gate open.
- Closeout-blocked state disables sale controls and exposes no drawer submit path.
- Active session without drawer binding shows recovery gate and attempts exactly one bind request per active session/drawer pair.
- Recovery bind success requests bootstrap and preserves cart, customer, and payment local state.
- Recovery bind failure resets the bind request key so the cashier can retry after state changes.
- Mismatched drawer binding surfaces the different-drawer operator message and blocks product, cart, payment, and checkout actions.
- Product add creates a session only when no active session exists and a usable drawer is present.
- Product add reuses active session id when present and does not call `startSession`.
- Quantity update to zero calls remove item; positive quantity calls add/update; malformed item without sku metadata is rejected client-side.
- Clear cart increments checkout state version, calls release/delete mutation, clears local payments only on success, and preserves customer/cashier.
- Payment add/update/remove/clear syncs the latest combined payment snapshot and uses monotonically increasing checkout versions.
- Payment sync is skipped while drawer recovery is required.
- Clearing the last cart item clears pending payments through the checkout-state mutation.
- Hold current session first persists metadata, then holds; hold failure leaves local draft state intact.
- Starting a new session auto-holds a non-empty active sale before starting, and does not start if hold fails.
- Resuming a held session auto-holds a different non-empty active sale first, resets local payments, and preserves cashier.
- Cashier sign-out holds non-empty active sale, voids empty active sale, and clears local state only on success.
- Navigate back holds non-empty active sale or voids empty active sale before navigating.
- Session expiration timeout clears cashier and local draft state and requests bootstrap.
- Completion persists metadata first, then completes with the current payment ref snapshot and active totals.
- Completion failure keeps the sale editable and maps the message through the operator copy path.
- Completion success sets completed order number/data, preserves receipt snapshot, and allows `onStartNewTransaction` to reset draft state while keeping cashier.
- Customer commit queues sequential updates and drops stale writes when the component unmounts or active session changes.
- Customer clear commits empty customer info without clearing cart, payments, cashier, drawer gate state, or product search.

**Acceptance:** View-model tests assert command call order where order matters, local state after success/failure, and that blocked UI actions do not call Convex mutations.

### U5. Convex Gateway and Error-Normalization Coverage

**Goal:** Ensure browser gateways normalize POS command results consistently and do not leak raw Convex failures.

**Files:**
- Extend: `packages/athena-webapp/src/lib/pos/infrastructure/convex/sessionGateway.test.ts`
- Extend: `packages/athena-webapp/src/lib/pos/infrastructure/convex/registerGateway.test.ts`
- Production under test: `packages/athena-webapp/src/lib/pos/infrastructure/convex/sessionGateway.ts`, `packages/athena-webapp/src/lib/pos/infrastructure/convex/registerGateway.ts`, `packages/athena-webapp/src/lib/errors/runCommand.ts`, `packages/athena-webapp/src/lib/errors/operatorMessages.ts`

**Test scenarios:**
- Session actions return `kind: "ok"` with payload for start/resume/bind/update/sync/clear/remove success.
- Session actions return `kind: "user_error"` for Convex command-result failures and preserve safe business messages.
- Thrown Convex errors normalize to `kind: "unexpected_error"` and are suitable for generic operator handling.
- Active session mapper carries `registerSessionId`, `customerProfileId`, customer display fields, payments, checkout state version, totals, and cart item identity.
- Held session mapper carries trace id, hold reason, customer profile summary, totals, and cart item identity.
- Register gateway distinguishes usable `open`/`active` active drawer from `closing` closeout-blocked drawer data.
- Operator message mapping includes start, resume, recovery, modifying, completing, duplicate drawer, and different-drawer messages.

**Acceptance:** No browser gateway test imports Convex server-only modules outside existing accepted test seams.

### U6. Component-Level Register Shell Coverage

**Goal:** Prove the rendered POS shell routes the view-model states to the correct UI and hides controls during unsafe states.

**Files:**
- Extend: `packages/athena-webapp/src/components/pos/register/POSRegisterView.test.tsx`
- Extend: `packages/athena-webapp/src/components/pos/SessionManager.test.tsx`
- Extend: `packages/athena-webapp/src/components/pos/session/HeldSessionsList.test.tsx`
- Production under test: `packages/athena-webapp/src/components/pos/register/POSRegisterView.tsx`, `packages/athena-webapp/src/components/pos/register/RegisterDrawerGate.tsx`, `packages/athena-webapp/src/components/pos/SessionManager.tsx`, `packages/athena-webapp/src/components/pos/session/HeldSessionsList.tsx`

**Test scenarios:**
- POS register renders auth dialog when cashier is missing and does not render selling controls.
- Drawer gate state renders instead of product entry, cart, checkout, and session controls.
- Recovery drawer gate renders recovery copy, inline errors, opening controls, and sign-out action.
- Closeout-blocked drawer gate renders Cash Controls guidance and sign-out action, with no opening-float input, notes field, or open-drawer button.
- Selling state renders customer strip/panel, product entry, cart, checkout, cashier card, and session panel.
- Completed transaction state hides product entry until starting a new transaction and shows completed checkout/receipt data.
- Expense workflow mode does not accidentally render POS checkout/session controls.
- Held sessions list renders trace links when present, customer summary when present, empty state when absent, and disables resume/void actions while the caller reports pending state if that pattern exists.
- Session manager disables start-new-session while an active sale is already active and enables hold only when cart draft exists.

**Acceptance:** Component tests stay presentation-focused and mock the view-model; orchestration behavior remains in U4.

### U7. Checkout Completion and Register-Session Attribution

**Goal:** Deepen transaction completion tests around drawer binding, payment validation, inventory/accounting side effects, and transaction/session linkage.

**Files:**
- Extend: `packages/athena-webapp/convex/pos/application/completeTransaction.test.ts`
- Production under test: `packages/athena-webapp/convex/pos/application/commands/completeTransaction.ts`

**Test scenarios:**
- Session-based checkout fails before transaction creation when the session has no drawer binding.
- Session-based checkout fails before transaction creation when the drawer is closed, closing, wrong store, wrong terminal, or otherwise not POS-usable.
- If both stored and provided register session ids are present and differ, checkout fails before transaction creation.
- Session-based checkout uses the stored session drawer binding for transaction, payment allocations, and register-session sale record.
- Direct sale checkout with register session id requires terminal id.
- Direct sale checkout records register-session sale and retail payment allocations when a valid register session id and terminal are supplied.
- Checkout rejects empty payments and insufficient payment before inventory mutation.
- Checkout aggregates duplicate SKU quantities before availability checks.
- Checkout failure on missing SKU or insufficient inventory does not create transaction items, patch inventory, allocate payments, or patch session.
- Successful session checkout creates transaction and items, decrements inventory, patches session completed, records payment allocations, records register-session sale, updates customer stats best-effort, and returns transaction number.
- Customer profile id from session is copied to the transaction.
- Workflow trace creation/linking is not attempted before the transaction and session write have succeeded.
- Payment-allocation failure does not hide a completed transaction if current behavior is best-effort; otherwise assert failure before session patch according to the existing contract.

**Acceptance:** Tests assert operation order for "must happen before" safety points and assert no side effects on validation failures.

### U8. Harness and Validation Map Follow-Through

**Goal:** Keep Athena's agent harness honest after expanding the POS test surface.

**Files:**
- Review/update source registry if needed: `scripts/harness-app-registry.ts`
- Regenerate if registry changes: `packages/athena-webapp/docs/agent/validation-map.json`, `packages/athena-webapp/docs/agent/validation-guide.md`, `packages/athena-webapp/docs/agent/test-index.md`
- Do not hand-edit generated harness docs.

**Test scenarios:**
- Touched POS command, inventory session, register view-model, gateway, and register UI files map to the focused POS validation slice in `packages/athena-webapp/docs/agent/testing.md`.
- If new test files are added, `bun run harness:check` recognizes the paths and does not report stale docs.
- If `bun run harness:review` reports a validation-map gap, update `scripts/harness-app-registry.ts` and rerun `bun run harness:generate`.

**Acceptance:** The final handoff includes the focused test command, broader package test command, type/build checks, and harness checks.

## Suggested Implementation Sequence

1. U1 and U2 first. These are the command-boundary and public-mutation safety net.
2. U3 next. Bootstrap state determines whether UI and view-model tests are describing the right workflow phases.
3. U4 and U5 together. View-model orchestration and gateway normalization are tightly coupled but can be implemented in separate commits.
4. U6 after U4. Component tests should consume stable view-model state shapes.
5. U7 after command/mutation tests. Checkout is the highest-risk completion path and benefits from earlier drawer-invariant fixtures.
6. U8 last. Regenerate harness docs only if the new/changed files create a real mapping gap.

## Required Validation

Run the smallest honest focused slice first:

```sh
bun run --filter '@athena/webapp' test -- \
  convex/pos/application/sessionCommands.test.ts \
  convex/inventory/posSessions.trace.test.ts \
  convex/pos/application/completeTransaction.test.ts \
  convex/pos/application/getRegisterState.test.ts \
  convex/operations/registerSessions.trace.test.ts \
  shared/registerSessionStatus.test.ts \
  src/lib/pos/application/bootstrapRegister.test.ts \
  src/lib/pos/infrastructure/convex/sessionGateway.test.ts \
  src/lib/pos/infrastructure/convex/registerGateway.test.ts \
  src/lib/pos/presentation/register/useRegisterViewModel.test.ts \
  src/components/pos/register/POSRegisterView.test.tsx \
  src/components/pos/SessionManager.test.tsx \
  src/components/pos/session/HeldSessionsList.test.tsx
```

Then run the package and repo checks required for POS session / register-session write paths:

```sh
bun run --filter '@athena/webapp' test
bun run --filter '@athena/webapp' audit:convex
bun run --filter '@athena/webapp' lint:convex:changed
bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json
bun run --filter '@athena/webapp' build
bun run harness:check
bun run harness:review
```

If any production code files are modified while implementing this spec, also run:

```sh
bun run graphify:rebuild
```

## Done Criteria

- The new tests cover every scenario listed in U1-U7 or the handoff explains why a scenario was intentionally moved out of scope.
- Any production behavior bug exposed by these tests is fixed with the smallest scoped change and has a regression test.
- No raw backend errors are asserted in browser-facing tests unless they are explicitly normalized through existing operator-message helpers.
- Focused validation and required package checks pass.
- Harness docs remain current, and graphify is rebuilt if production code changed.
