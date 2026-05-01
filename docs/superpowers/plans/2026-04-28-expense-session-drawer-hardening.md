# Expense Session Drawer Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring expense sessions up to the POS session cash-drawer hardening pattern so expense cart and completion mutations cannot bypass an open register session.

**Architecture:** Expense sessions should persist `registerSessionId`, resolve a usable register session at create/resume/recovery boundaries, and revalidate that binding before item, clear-cart, and completion mutations. The expense register view-model should expose the same drawer recovery gate pattern used by POS instead of auto-creating or mutating expense sessions while the drawer is missing, closed, closing, store-mismatched, terminal-mismatched, or register-mismatched.

**Tech Stack:** Convex mutations/queries, shared `registerSessionStatus` policy, React hooks/view-models, Vitest.

---

### Task 1: Persist Expense Drawer Binding

**Files:**
- Modify: `packages/athena-webapp/convex/schemas/pos/expenseSession.ts`
- Modify: `packages/athena-webapp/convex/schema.ts`
- Modify: `packages/athena-webapp/convex/inventory/expenseSessions.ts`
- Test: `packages/athena-webapp/convex/inventory/expenseSessions.test.ts`

- [ ] **Step 1: Write failing schema/query coverage**

Add a test that creates or returns an expense session containing `registerSessionId` and asserts the active-session/query DTO includes it.

- [ ] **Step 2: Add persisted binding**

Add `registerSessionId: v.optional(v.id("registerSession"))` to the expense session schema and `by_registerSessionId` to the table indexes, matching `posSession`.

- [ ] **Step 3: Thread the field through DTO validators**

Add optional `registerSessionId` to `getStoreExpenseSessions`, `getExpenseSessionById`, and `getActiveExpenseSession` return validators.

- [ ] **Step 4: Verify**

Run: `bun run --filter '@athena/webapp' test packages/athena-webapp/convex/inventory/expenseSessions.test.ts`

### Task 2: Add Expense Session Command Boundary

**Files:**
- Create: `packages/athena-webapp/convex/pos/application/commands/expenseSessionCommands.ts`
- Modify: `packages/athena-webapp/convex/inventory/expenseSessions.ts`
- Modify: `packages/athena-webapp/convex/inventory/expenseSessionItems.ts`
- Test: `packages/athena-webapp/convex/pos/application/expenseSessionCommands.test.ts`

- [ ] **Step 1: Write failing command tests**

Cover create, reuse, resume, bind, add/update item, remove item, clear cart, and complete session cases for missing drawer, wrong store, closed/closing drawer, terminal mismatch, register mismatch, idempotent same-drawer recovery, and staff active on another terminal.

- [ ] **Step 2: Implement drawer resolution**

Reuse `isPosUsableRegisterSessionStatus` and the POS identity rules: require same store, same terminal, matching register number when present, and a usable register-session status.

- [ ] **Step 3: Route expense lifecycle through commands**

Move create/resume/bind logic into the command service and keep mutation exports thin, returning existing `commandResult` payloads.

- [ ] **Step 4: Enforce mutation-boundary validation**

Require a valid drawer binding before expense item add/update, item removal, cart clear, and completion. Keep hold and void semantics aligned with POS: hold may preserve inventory holds; void releases holds and keeps the audit trail.

- [ ] **Step 5: Verify**

Run: `bun run --filter '@athena/webapp' test packages/athena-webapp/convex/pos/application/expenseSessionCommands.test.ts packages/athena-webapp/convex/inventory/expenseSessions.test.ts`

### Task 3: Add Expense Drawer Recovery UI

**Files:**
- Modify: `packages/athena-webapp/src/lib/pos/presentation/expense/useExpenseRegisterViewModel.ts`
- Modify: `packages/athena-webapp/src/hooks/useSessionManagementExpense.ts`
- Modify: `packages/athena-webapp/src/hooks/useExpenseSessions.ts`
- Reuse: `packages/athena-webapp/src/components/pos/register/RegisterDrawerGate.tsx`
- Test: `packages/athena-webapp/src/lib/pos/presentation/register/useRegisterViewModel.test.ts`

- [ ] **Step 1: Write failing view-model tests**

Cover expense startup with no open drawer, active expense session without `registerSessionId`, active session bound to the wrong drawer, active open drawer recovery, and disabled product/cart/checkout actions while recovery is required.

- [ ] **Step 2: Query register state for expense**

Use the same active register-session inputs as POS: store, terminal, register number, and staff profile.

- [ ] **Step 3: Add bind/recovery action**

Expose an expense `bindExpenseSessionToRegisterSession` hook action and call it after opening or finding a usable drawer, preserving the existing expense cart.

- [ ] **Step 4: Gate UI actions**

Set `drawerGate` for expense mode and disable product entry, barcode submit, add product, quantity updates, removal, clear-cart, and completion while recovery is required.

- [ ] **Step 5: Verify**

Run: `bun run --filter '@athena/webapp' test packages/athena-webapp/src/lib/pos/presentation/register/useRegisterViewModel.test.ts`

### Task 4: Full Validation

**Files:**
- No implementation files beyond Tasks 1-3.

- [ ] **Step 1: Typecheck**

Run: `bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json`

- [ ] **Step 2: Focused test sweep**

Run: `bun run --filter '@athena/webapp' test packages/athena-webapp/convex/pos/application/expenseSessionCommands.test.ts packages/athena-webapp/convex/inventory/expenseSessions.test.ts packages/athena-webapp/src/lib/pos/presentation/register/useRegisterViewModel.test.ts`

- [ ] **Step 3: Graphify rebuild**

Run: `bun run graphify:rebuild`

- [ ] **Step 4: Manual smoke**

Use an expense register session with an authenticated staff profile. Confirm no drawer shows the drawer gate, opening a drawer binds the preserved expense session, cart items survive recovery, and stale direct mutations return user errors.
