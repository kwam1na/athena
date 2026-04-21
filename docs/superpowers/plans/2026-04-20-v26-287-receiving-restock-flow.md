# V26-287 Receiving and Restock Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tightly scoped purchase-order receiving flow that supports partial receipts, blocks over-receiving, and records stock changes through inventory movements.

**Architecture:** Keep the new work inside `stockOps` with one schema file, one Convex module, and one thin React view. The mutation should validate against purchase-order line items, create an idempotent receiving batch, update received quantities, and write inventory-movement records so stock changes remain auditable.

**Tech Stack:** Convex, React, Vitest, TypeScript, Athena webapp harness docs.

---

### Task 1: Add receiving-batch schema and test helpers

**Files:**
- Create: `packages/athena-webapp/convex/schemas/stockOps/receivingBatch.ts`
- Modify: `packages/athena-webapp/convex/schemas/stockOps/index.ts`
- Modify: `packages/athena-webapp/convex/schema.ts`
- Test: `packages/athena-webapp/convex/stockOps/receiving.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("describes a receiving batch record with submission idempotency fields", () => {
  const source = getSource("./receiving.ts");

  expect(source).toContain("export function calculateReceivingBatchTotals");
  expect(source).toContain("export function assertReceivingLineQuantities");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter '@athena/webapp' test convex/stockOps/receiving.test.ts`
Expected: FAIL because the receiving module does not exist yet.

- [ ] **Step 3: Write minimal schema implementation**

```ts
import { v } from "convex/values";

export const receivingBatchSchema = v.object({
  storeId: v.id("store"),
  organizationId: v.optional(v.id("organization")),
  purchaseOrderId: v.id("purchaseOrder"),
  submissionKey: v.string(),
  lineItemCount: v.number(),
  totalUnits: v.number(),
  receivedByUserId: v.optional(v.id("athenaUser")),
  notes: v.optional(v.string()),
  lineItems: v.array(
    v.object({
      purchaseOrderLineItemId: v.id("purchaseOrderLineItem"),
      productSkuId: v.id("productSku"),
      receivedQuantity: v.number(),
    })
  ),
  createdAt: v.number(),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --filter '@athena/webapp' test convex/stockOps/receiving.test.ts`
Expected: PASS once the helper file exists and exports the expected symbols.

- [ ] **Step 5: Commit**

```bash
git add packages/athena-webapp/convex/schemas/stockOps/receivingBatch.ts packages/athena-webapp/convex/schemas/stockOps/index.ts packages/athena-webapp/convex/schema.ts packages/athena-webapp/convex/stockOps/receiving.test.ts
git commit -m "V26-287: add receiving batch schema"
```

### Task 2: Implement receiving mutation and inventory-movement routing

**Files:**
- Create: `packages/athena-webapp/convex/stockOps/receiving.ts`
- Modify: `packages/athena-webapp/convex/_generated/api.d.ts` and related generated Convex artifacts via codegen
- Test: `packages/athena-webapp/convex/stockOps/receiving.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("keeps partial receipts auditable and blocks over-receiving", () => {
  const partial = buildReceivingBatchTotals([
    { receivedQuantity: 2 },
    { receivedQuantity: 1 },
  ]);

  expect(partial).toEqual({ lineItemCount: 2, totalUnits: 3 });
  expect(() =>
    assertReceivingLineQuantities([
      { orderedQuantity: 2, receivedQuantity: 3 },
    ])
  ).toThrow("cannot receive more than ordered");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter '@athena/webapp' test convex/stockOps/receiving.test.ts`
Expected: FAIL until the helper logic exists.

- [ ] **Step 3: Write minimal mutation implementation**

```ts
export const receivePurchaseOrderBatch = mutation({
  args: {
    purchaseOrderId: v.id("purchaseOrder"),
    storeId: v.id("store"),
    submissionKey: v.string(),
    receivedByUserId: v.optional(v.id("athenaUser")),
    notes: v.optional(v.string()),
    lineItems: v.array(
      v.object({
        purchaseOrderLineItemId: v.id("purchaseOrderLineItem"),
        receivedQuantity: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    // load purchase order, short-circuit duplicate submissionKey,
    // validate quantities, patch productSku inventoryCount + quantityAvailable,
    // record inventory movements with sourceType "purchase_order_receiving_batch",
    // and patch PO line-item receivedQuantity/status.
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --filter '@athena/webapp' test convex/stockOps/receiving.test.ts`
Expected: PASS after the mutation helper and duplicate-batch logic are implemented.

- [ ] **Step 5: Commit**

```bash
git add packages/athena-webapp/convex/stockOps/receiving.ts packages/athena-webapp/convex/stockOps/receiving.test.ts packages/athena-webapp/convex/_generated/api.d.ts packages/athena-webapp/convex/_generated/api.js packages/athena-webapp/convex/_generated/dataModel.d.ts packages/athena-webapp/convex/_generated/server.d.ts packages/athena-webapp/convex/_generated/server.js
git commit -m "V26-287: implement purchase-order receiving"
```

### Task 3: Add the thin receiving view

**Files:**
- Create: `packages/athena-webapp/src/components/procurement/ReceivingView.tsx`
- Test: `packages/athena-webapp/src/components/procurement/ReceivingView.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("renders a compact receiving form with a submission key and line-item inputs", () => {
  render(<ReceivingView purchaseOrderId="po_1" lineItems={[]} />);
  expect(screen.getByText(/receiving/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter '@athena/webapp' test src/components/procurement/ReceivingView.test.tsx`
Expected: FAIL because the view does not exist yet.

- [ ] **Step 3: Write the thin view implementation**

```tsx
export function ReceivingView({ purchaseOrderId, lineItems }: Props) {
  const receivePurchaseOrderBatch = useMutation(api.stockOps.receiving.receivePurchaseOrderBatch);
  // render a small form that collects submissionKey and quantities, then calls the mutation
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --filter '@athena/webapp' test src/components/procurement/ReceivingView.test.tsx`
Expected: PASS once the view exists.

- [ ] **Step 5: Commit**

```bash
git add packages/athena-webapp/src/components/procurement/ReceivingView.tsx packages/athena-webapp/src/components/procurement/ReceivingView.test.tsx
git commit -m "V26-287: add receiving view"
```

### Task 4: Validate the slice and refresh graphify

**Files:**
- Modify: generated Convex artifacts if codegen updates them

- [ ] **Step 1: Run package validation**

Run:
```bash
bun run --filter '@athena/webapp' test convex/stockOps/receiving.test.ts src/components/procurement/ReceivingView.test.tsx
bun run --filter '@athena/webapp' audit:convex
bun run --filter '@athena/webapp' lint:convex:changed
bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json
bun run graphify:rebuild
```
Expected: all commands succeed.

- [ ] **Step 2: Run diff hygiene**

Run: `git diff --check`
Expected: no whitespace or patch formatting issues.

- [ ] **Step 3: Commit the finished slice**

```bash
git add -A
git commit -m "V26-287: finish receiving restock flow"
```
