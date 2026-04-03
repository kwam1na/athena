# V26-168 Commerce Convex Query Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace scan-heavy Convex bag, saved-bag, checkout-session, and online-order access with indexed or bounded reads while preserving current storefront behavior.

**Architecture:** Add the missing additive indexes in `convex/schema.ts`, then refactor each commerce module to load bags, sessions, orders, and related items through explicit indexed loaders. Keep the API boundary stable and limit any new helpers to small local functions in the touched modules.

**Tech Stack:** Convex, TypeScript, Vitest, Hono route callers

---

### Task 1: Lock the schema contract with tests

**Files:**
- Create: `packages/athena-webapp/convex/storeFront/commerceQueryIndexes.test.ts`
- Modify: `packages/athena-webapp/convex/schema.ts`

- [ ] **Step 1: Write the failing test**
- [ ] **Step 2: Run `bun run test convex/storeFront/commerceQueryIndexes.test.ts` to verify it fails**
- [ ] **Step 3: Add the new additive indexes in `packages/athena-webapp/convex/schema.ts`**
- [ ] **Step 4: Run `bun run test convex/storeFront/commerceQueryIndexes.test.ts` to verify it passes**

### Task 2: Refactor bag and saved-bag lookups

**Files:**
- Modify: `packages/athena-webapp/convex/storeFront/bag.ts`
- Modify: `packages/athena-webapp/convex/storeFront/savedBag.ts`
- Test: `packages/athena-webapp/convex/storeFront/commerceQueryIndexes.test.ts`

- [ ] **Step 1: Add failing assertions for bag and saved-bag owner/item lookup patterns**
- [ ] **Step 2: Run the focused test file and verify it fails**
- [ ] **Step 3: Replace owner and item scans with indexed loaders**
- [ ] **Step 4: Run the focused test file and verify it passes**

### Task 3: Refactor checkout-session and online-order lookups

**Files:**
- Modify: `packages/athena-webapp/convex/storeFront/checkoutSession.ts`
- Modify: `packages/athena-webapp/convex/storeFront/onlineOrder.ts`
- Test: `packages/athena-webapp/convex/storeFront/commerceQueryIndexes.test.ts`

- [ ] **Step 1: Add failing assertions for checkout-session and online-order indexed lookup patterns**
- [ ] **Step 2: Run the focused test file and verify it fails**
- [ ] **Step 3: Replace session, order, and order-item scans with indexed loaders**
- [ ] **Step 4: Run the focused test file and verify it passes**

### Task 4: Full validation

**Files:**
- Modify: `packages/athena-webapp/convex/storeFront/bag.ts`
- Modify: `packages/athena-webapp/convex/storeFront/savedBag.ts`
- Modify: `packages/athena-webapp/convex/storeFront/checkoutSession.ts`
- Modify: `packages/athena-webapp/convex/storeFront/onlineOrder.ts`
- Modify: `packages/athena-webapp/convex/schema.ts`
- Test: `packages/athena-webapp/convex/storeFront/commerceQueryIndexes.test.ts`

- [ ] **Step 1: Run `bun run lint:convex:changed`**
- [ ] **Step 2: Run `bun run build`**
- [ ] **Step 3: Run `bun run test`**
- [ ] **Step 4: Commit with a `V26-168` message once validation is green**
