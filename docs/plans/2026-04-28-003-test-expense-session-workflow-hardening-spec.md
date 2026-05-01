---
title: test: Harden expense session workflow coverage
type: test-spec
status: proposed
date: 2026-04-28
---

# test: Harden expense session workflow coverage

## Summary

Mirror the POS session hardening spec for the overlapping expense-session workflow: staff sign-in, drawer gating, session create/resume/hold/recovery, cart and inventory-hold mutation, completion, safe error handling, shell rendering, and harness follow-through. Expense does not have POS customer attribution or payment sync, so those POS-only scenarios stay out of scope.

## Problem Frame

POS now has a concrete coverage plan for drawer/session invariants across backend commands, browser-callable mutations, view-model orchestration, gateway normalization, component rendering, and completion side effects. Expense sessions share the same cashier, terminal, register, cart, inventory-hold, and completion risks, but the current expense workflow does not persist a register-session binding or expose drawer recovery gates. This spec mirrors the POS test plan where the workflows overlap so implementation can harden expense without inventing a parallel testing shape.

This is a characterization-first test plan. If a proposed expense test fails because current production behavior is unsafe, keep the test, make the smallest behavior fix required, and document the uncovered bug in handoff.

## Requirements

- R1. Every expense cart or completion mutation must require an active staff-owned expense session and a POS-usable matching drawer where the operation mutates cart, inventory-hold, transaction, or session-completion state.
- R2. Expense drawer startup, recovery, closeout-blocked, and stale-client states must be differentiated at both command and presentation boundaries.
- R3. Expense lifecycle transitions must preserve cart items, inventory holds, notes, cashier/staff identity, terminal/register identity, drawer binding, expiration, and transaction state according to the transition being performed.
- R4. Expense completion must create the expense transaction and transaction items only after drawer, session, cart, and inventory preconditions pass.
- R5. Expense cart clearing and item mutation must not orphan inventory holds or mutate stale/invalid sessions.
- R6. Operator-facing failures should be normalized through existing command-result and operator-message/toast paths, not raw thrown backend text.
- R7. The focused expense validation slice in `packages/athena-webapp/docs/agent/testing.md` must remain accurate after adding tests.

## Scope Boundaries

- Do not mirror POS customer attribution, checkout payments, checkout-state versioning, retail payment allocations, or POS workflow traces unless expense explicitly gains those features.
- Do not redesign expense product search, inventory hold helpers, expense transaction numbering, or transaction history beyond what drawer hardening requires.
- Do not introduce browser E2E coverage unless a missing behavior cannot be honestly tested with existing Vitest/unit harnesses.
- Do not edit generated Convex artifacts unless a real public Convex API signature changes.
- Do not clean up unrelated legacy expense tests unless they directly block the new coverage.

## Existing Context

### POS Spec Being Mirrored

- `docs/plans/2026-04-28-001-test-pos-session-workflow-hardening-spec.md`

### Code Surfaces

- Backend expense session mutations: `packages/athena-webapp/convex/inventory/expenseSessions.ts`
- Backend expense item mutations: `packages/athena-webapp/convex/inventory/expenseSessionItems.ts`
- Expense transaction creation: `packages/athena-webapp/convex/inventory/expenseTransactions.ts`
- Expense session schema: `packages/athena-webapp/convex/schemas/pos/expenseSession.ts`
- Expense transaction schema: `packages/athena-webapp/convex/schemas/pos/expenseTransaction.ts`
- Drawer/session state policy: `packages/athena-webapp/shared/registerSessionStatus.ts`
- POS command-boundary pattern to mirror: `packages/athena-webapp/convex/pos/application/commands/sessionCommands.ts`
- POS completion drawer validation pattern to mirror: `packages/athena-webapp/convex/pos/application/commands/completeTransaction.ts`
- Expense register view-model: `packages/athena-webapp/src/lib/pos/presentation/expense/useExpenseRegisterViewModel.ts`
- Shared register shell and drawer gate UI: `packages/athena-webapp/src/components/pos/register/POSRegisterView.tsx`, `packages/athena-webapp/src/components/pos/register/RegisterDrawerGate.tsx`
- Expense browser hooks: `packages/athena-webapp/src/hooks/useExpenseSessions.ts`, `packages/athena-webapp/src/hooks/useSessionManagementExpense.ts`, `packages/athena-webapp/src/hooks/useExpenseOperations.ts`

### Existing Tests To Extend Or Add

- `packages/athena-webapp/convex/inventory/expenseSessions.test.ts`
- `packages/athena-webapp/convex/inventory/sessionQueryIndexes.test.ts`
- `packages/athena-webapp/src/hooks/useExpenseSessions.test.ts`
- `packages/athena-webapp/src/components/pos/register/POSRegisterView.test.tsx`
- Add: `packages/athena-webapp/convex/pos/application/expenseSessionCommands.test.ts`
- Add: `packages/athena-webapp/convex/inventory/expenseSessionItems.test.ts`
- Add if missing completion coverage needs isolation: `packages/athena-webapp/convex/inventory/expenseTransactions.test.ts`
- Add if the expense view-model remains separate from POS tests: `packages/athena-webapp/src/lib/pos/presentation/expense/useExpenseRegisterViewModel.test.ts`
- Add if hook behavior grows beyond existing coverage: `packages/athena-webapp/src/hooks/useSessionManagementExpense.test.ts`, `packages/athena-webapp/src/hooks/useExpenseOperations.test.ts`

### Institutional Learnings

- `docs/solutions/logic-errors/athena-pos-drawer-invariants-at-command-boundaries-2026-04-24.md`: UI gates are ergonomics; Convex command boundaries must enforce drawer invariants.

## Test Implementation Units

### U1. Expense Session Command Boundary Matrix

**Goal:** Mirror the POS session command-boundary matrix for expense lifecycle commands and cart-affecting operations.

**Files:**
- Add: `packages/athena-webapp/convex/pos/application/expenseSessionCommands.test.ts`
- Production under test: `packages/athena-webapp/convex/pos/application/commands/expenseSessionCommands.ts`
- Production adapters under test: `packages/athena-webapp/convex/inventory/expenseSessions.ts`, `packages/athena-webapp/convex/inventory/expenseSessionItems.ts`

**Test scenarios:**
- Create expense session requires a normalized register number when no terminal register number can be resolved.
- Create expense session trims register numbers and prefers the terminal's configured register number over an incoming stale argument.
- Create expense session rejects an explicitly provided drawer from another store.
- Create expense session rejects an explicitly provided drawer with missing terminal identity.
- Create expense session reuses same-terminal active empty session without auto-holding it, while binding a valid drawer if missing.
- Create expense session auto-holds same-terminal active non-empty session and preserves notes, cart items, inventory holds, staff, and drawer metadata when returning the existing session id.
- Resume expense session rejects active staff sessions on other terminals before mutating the held session.
- Resume expense session binds only to a POS-usable drawer matching the held session's terminal/register identity.
- Bind recovery is idempotent for the same drawer and does not refresh expiration or mutate notes, items, inventory holds, or unrelated fields.
- Bind recovery rejects an already-bound different drawer without changing cart items, notes, inventory holds, expiration, or session status.
- Hold expense session accepts active or held modifiable sessions only for the owning staff profile and does not release inventory holds.
- Add/update/remove expense item all reject missing, closed, closing, mismatched-terminal, mismatched-register, and mismatched-store drawer bindings before inventory-hold calls.
- Clear expense cart rejects missing, closed, closing, mismatched-terminal, mismatched-register, and mismatched-store drawer bindings before releasing holds or deleting items.
- Inventory hold acquire/adjust/release failures return safe command-result failures and do not patch session expiration or partially mutate cart items.

**Acceptance:** The fake repository or mutation harness asserts no side-effect calls happen after failed preconditions: no item writes, no inventory-hold calls, no session expiration refresh, and no transaction creation.

### U2. Public Expense Mutation And Stale-Client Coverage

**Goal:** Prove browser-callable Convex mutations enforce the same invariants as the command service, including stale-client direct calls that bypass the UI gate.

**Files:**
- Extend: `packages/athena-webapp/convex/inventory/expenseSessions.test.ts`
- Add/extend: `packages/athena-webapp/convex/inventory/expenseSessionItems.test.ts`
- Production under test: `packages/athena-webapp/convex/inventory/expenseSessions.ts`, `packages/athena-webapp/convex/inventory/expenseSessionItems.ts`

**Test scenarios:**
- `getStoreExpenseSessions`, `getExpenseSessionById`, and `getActiveExpenseSession` include `registerSessionId` when present.
- `createExpenseSession` returns a `user_error` when no usable drawer exists and does not create a session.
- `createExpenseSession` stores the resolved register-session id when a usable drawer exists.
- `resumeExpenseSession` rejects a held session when the current drawer is missing, closed, closing, wrong store, wrong terminal, or wrong register.
- `bindExpenseSessionToRegisterSession` succeeds for a valid preserved active session and leaves cart/items/notes intact.
- `bindExpenseSessionToRegisterSession` rejects mismatched drawer identity without patching the session.
- `addOrUpdateExpenseItem` rejects invalid drawer bindings before acquire/adjust hold calls.
- `removeExpenseItem` rejects invalid drawer bindings before release hold or delete calls.
- `releaseExpenseSessionInventoryHoldsAndDeleteItems` rejects invalid drawer bindings before releasing holds or deleting items.
- `voidExpenseSession` releases inventory holds aggregated per SKU, marks the session void, and does not require a usable drawer if void remains the escape hatch.
- Expiration cleanup releases only eligible expense session statuses and does not overwrite completed session identity.

**Acceptance:** Tests assert exact `CommandResult` shape (`kind`, `code`, safe message) for expected user errors and assert invalid drawer paths leave the in-memory session, cart items, and inventory-hold calls unchanged.

### U3. Expense Register State And Bootstrap Decisions

**Goal:** Mirror POS bootstrap coverage for the expense-specific decision of whether to require auth, open a drawer, recover a preserved session, resume a held session, or allow cart work.

**Files:**
- Add/extend: `packages/athena-webapp/src/lib/pos/presentation/expense/useExpenseRegisterViewModel.test.ts`
- Extend if shared bootstrap is reused: `packages/athena-webapp/src/lib/pos/application/bootstrapRegister.test.ts`
- Production under test: `packages/athena-webapp/src/lib/pos/presentation/expense/useExpenseRegisterViewModel.ts`

**Test scenarios:**
- No terminal returns a terminal-unavailable or disabled product-entry state without creating an expense session.
- Terminal with no authenticated staff profile returns the existing expense auth dialog state.
- Open or active register session plus no active expense session allows session creation/cart work.
- Closing register session is visible enough for closeout-blocked UI but never allows create, resume, cart mutation, clear cart, or completion.
- Active expense session with valid open drawer returns selling state.
- Active expense session missing `registerSessionId` returns recovery drawer gate state.
- Active expense session bound to a different drawer returns recovery/different-drawer blocking state.
- Held expense session plus POS-usable drawer can resume.
- Held expense session plus missing or closing drawer remains resumable data but resume is disabled by the view-model gate.
- Expired active or held expense sessions clear local cashier/session state according to current expense behavior.

**Acceptance:** Expense view-model tests cover every drawer gate mode and every enabled/disabled combination for product entry, cart actions, clear cart, and completion.

### U4. Expense Register View-Model Workflow Coverage

**Goal:** Exercise the expense register view-model as the user-facing orchestrator, especially around hidden auto-create and recovery paths.

**Files:**
- Add/extend: `packages/athena-webapp/src/lib/pos/presentation/expense/useExpenseRegisterViewModel.test.ts`
- Production under test: `packages/athena-webapp/src/lib/pos/presentation/expense/useExpenseRegisterViewModel.ts`

**Test scenarios:**
- Staff authentication requests expense bootstrap and does not create a session until active store, terminal, staff profile, and usable drawer are available.
- Missing drawer initial setup disables product entry, barcode submit, cart actions, clear cart, and completion, and exposes drawer gate state with opening-float validation.
- Drawer open success clears drawer input/error state, requests expense bootstrap, and does not clear staff identity.
- Drawer open failure maps backend text through safe command/operator handling and keeps the gate open.
- Closeout-blocked state disables expense controls and exposes no drawer submit path.
- Active expense session without drawer binding shows recovery gate and attempts exactly one bind request per active session/drawer pair.
- Recovery bind success requests bootstrap and preserves cart, notes, and local transaction state.
- Recovery bind failure resets the bind request key so the operator can retry after state changes.
- Mismatched drawer binding surfaces the different-drawer operator message and blocks product, cart, clear-cart, and completion actions.
- Product add creates a session only when no active session exists and a usable drawer is present.
- Product add reuses active session id when present and does not call `createExpenseSession`.
- Quantity update to zero calls remove item; positive quantity calls add/update; malformed item without SKU metadata is rejected client-side.
- Clear cart calls release/delete mutation, clears local cart only on success, and preserves staff/session state on failure.
- Hold current session preserves inventory holds and local draft state on failure.
- Starting a new expense session auto-holds a non-empty active expense session before starting, and does not start if hold fails.
- Resuming a held expense session auto-holds a different non-empty active session first if expense supports that POS overlap; otherwise assert the explicit expense behavior and keep the difference documented.
- Staff sign-out voids empty active sessions or preserves/holds non-empty sessions according to the chosen expense contract.
- Navigate back follows the same chosen void/hold contract before navigating.
- Session expiration timeout clears staff and local draft state and requests bootstrap.
- Completion persists notes first if needed, then completes with the current cart total.
- Completion failure keeps the expense cart editable and maps the message through the safe operator-copy path.
- Completion success sets completed transaction data, preserves receipt snapshot, clears active session/cart, and resets staff only if that remains the explicit expense behavior.

**Acceptance:** View-model tests assert command call order where order matters, local state after success/failure, and that blocked UI actions do not call Convex mutations.

### U5. Expense Hook And Error-Normalization Coverage

**Goal:** Ensure browser hooks normalize expense command results consistently and do not leak raw Convex failures.

**Files:**
- Extend: `packages/athena-webapp/src/hooks/useExpenseSessions.test.ts`
- Add: `packages/athena-webapp/src/hooks/useSessionManagementExpense.test.ts`
- Add: `packages/athena-webapp/src/hooks/useExpenseOperations.test.ts`
- Production under test: `packages/athena-webapp/src/hooks/useExpenseSessions.ts`, `packages/athena-webapp/src/hooks/useSessionManagementExpense.ts`, `packages/athena-webapp/src/hooks/useExpenseOperations.ts`, `packages/athena-webapp/src/lib/errors/runCommand.ts`, `packages/athena-webapp/src/lib/errors/presentCommandToast.ts`

**Test scenarios:**
- Expense session actions return success payloads for create, resume, bind recovery, update, hold, void, and clear-cart success.
- Expense session actions surface `kind: "user_error"` failures through `presentCommandToast` or returned hook errors with safe business messages.
- Thrown Convex errors normalize to unexpected errors suitable for generic operator handling.
- Active expense session mapper carries `registerSessionId`, notes, terminal/register identity, expiration, totals, and cart item identity.
- Held expense session mapper carries notes, totals, register identity, and cart item identity.
- Expense cart operations do not auto-create a session while drawer recovery or closeout-blocked state is active.
- Expense item add/update/remove failures leave local cart unchanged.

**Acceptance:** Browser hook tests do not import Convex server-only modules outside existing accepted test seams.

### U6. Component-Level Register Shell Coverage For Expense

**Goal:** Prove the shared POS register shell routes expense view-model states to the correct UI and hides controls during unsafe states.

**Files:**
- Extend: `packages/athena-webapp/src/components/pos/register/POSRegisterView.test.tsx`
- Production under test: `packages/athena-webapp/src/components/pos/register/POSRegisterView.tsx`, `packages/athena-webapp/src/components/pos/register/RegisterDrawerGate.tsx`

**Test scenarios:**
- Expense workflow renders auth dialog when staff is missing and does not render expense controls.
- Expense drawer gate state renders instead of product entry, cart, and completion controls.
- Expense recovery drawer gate renders recovery copy, inline errors, opening controls, and sign-out action.
- Expense closeout-blocked drawer gate renders Cash Controls guidance and sign-out action, with no opening-float input, notes field, or open-drawer button.
- Expense selling state renders product entry, cart, expense completion panel, and staff card without POS customer or payment controls.
- Completed expense transaction state hides product entry until starting a new transaction and shows completed expense transaction data.
- POS workflow still renders POS checkout/session controls and does not regress when expense completion data is present.

**Acceptance:** Component tests stay presentation-focused and mock the view-model; orchestration behavior remains in U4.

### U7. Expense Completion And Inventory Attribution

**Goal:** Deepen expense completion tests around drawer binding, cart validation, inventory side effects, transaction item creation, and session linkage.

**Files:**
- Extend: `packages/athena-webapp/convex/inventory/expenseSessions.test.ts`
- Add/extend: `packages/athena-webapp/convex/inventory/expenseTransactions.test.ts`
- Production under test: `packages/athena-webapp/convex/inventory/expenseSessions.ts`, `packages/athena-webapp/convex/inventory/expenseTransactions.ts`

**Test scenarios:**
- Expense completion fails before transaction creation when the session has no drawer binding.
- Expense completion fails before transaction creation when the drawer is closed, closing, wrong store, wrong terminal, or otherwise not POS-usable.
- Expense completion uses the stored session drawer binding for register attribution if direct transaction linkage is added.
- Completion rejects empty carts before inventory mutation.
- Completion aggregates duplicate SKU quantities before availability checks.
- Completion failure on missing SKU, invalid SKU data, or insufficient inventory does not create transaction items, patch inventory, or patch session completed.
- Successful completion creates transaction and items, decrements inventory, patches session completed, preserves notes, and returns transaction number.
- Completion keeps the expense session editable if transaction creation fails before the completion patch.

**Acceptance:** Tests assert operation order for "must happen before" safety points and assert no side effects on validation failures.

### U8. Harness And Validation Map Follow-Through

**Goal:** Keep Athena's agent harness honest after expanding the expense test surface.

**Files:**
- Review/update source registry if needed: `scripts/harness-app-registry.ts`
- Regenerate if registry changes: `packages/athena-webapp/docs/agent/validation-map.json`, `packages/athena-webapp/docs/agent/validation-guide.md`, `packages/athena-webapp/docs/agent/test-index.md`
- Do not hand-edit generated harness docs.

**Test scenarios:**
- Touched expense command, inventory session, expense item, expense view-model, hook, and register UI files map to the focused expense validation slice in `packages/athena-webapp/docs/agent/testing.md`.
- If new test files are added, `bun run harness:check` recognizes the paths and does not report stale docs.
- If `bun run harness:review` reports a validation-map gap, update `scripts/harness-app-registry.ts` and rerun `bun run harness:generate`.

**Acceptance:** The final handoff includes the focused test command, broader package test command, type/build checks, harness checks, and graphify rebuild if code files changed.

## Suggested Implementation Sequence

1. U1 and U2 first. These are the command-boundary and public-mutation safety net.
2. U3 next. Expense register/bootstrap state determines whether UI and view-model tests are describing the right workflow phases.
3. U4 and U5 together. View-model orchestration and hook normalization are tightly coupled but can be implemented in separate commits.
4. U6 after U4. Component tests should consume stable view-model state shapes.
5. U7 after command/mutation tests. Completion is the highest-risk irreversible path and benefits from earlier drawer-invariant fixtures.
6. U8 last. Regenerate harness docs only if the new/changed files create a real mapping gap.

## Required Validation

Run the smallest honest focused slice first:

```sh
bun run --filter '@athena/webapp' test -- \
  convex/pos/application/expenseSessionCommands.test.ts \
  convex/inventory/expenseSessions.test.ts \
  convex/inventory/expenseSessionItems.test.ts \
  convex/inventory/expenseTransactions.test.ts \
  convex/inventory/sessionQueryIndexes.test.ts \
  shared/registerSessionStatus.test.ts \
  src/hooks/useExpenseSessions.test.ts \
  src/hooks/useSessionManagementExpense.test.ts \
  src/hooks/useExpenseOperations.test.ts \
  src/lib/pos/presentation/expense/useExpenseRegisterViewModel.test.ts \
  src/components/pos/register/POSRegisterView.test.tsx
```

Then run the package and repo checks required for expense session / register-session write paths:

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

- The new tests cover every overlapping POS scenario listed in U1-U7, or the handoff explains why an item was intentionally excluded as POS-only.
- Any production behavior bug exposed by these tests is fixed with the smallest scoped change and has a regression test.
- No raw backend errors are asserted in browser-facing tests unless they are explicitly normalized through existing operator-message helpers.
- Focused validation and required package checks pass.
- Harness docs remain current, and graphify is rebuilt if production code changed.
