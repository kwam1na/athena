import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

import {
  STOCK_ADJUSTMENT_APPROVAL_THRESHOLD,
  assertDistinctStockAdjustmentLineItems,
  assertStockAdjustmentReasonCode,
  calculateCycleCountQuantityDelta,
  requiresStockAdjustmentApproval,
  resolveStockAdjustmentApprovalDecisionWithCtx,
  resolveStockAdjustmentQuantityDelta,
  summarizeStockAdjustmentLineItems,
} from "./adjustments";

function getSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function createApprovalDecisionMutationCtx() {
  const tables = {
    approvalRequest: new Map<string, Record<string, unknown>>([
      [
        "approval-1",
        {
          _id: "approval-1",
          requestType: "inventory_adjustment_review",
          status: "pending",
          storeId: "store-1",
          subjectId: "batch-1",
          subjectType: "stock_adjustment_batch",
          workItemId: "work-item-1",
        },
      ],
    ]),
    inventoryMovement: new Map<string, Record<string, unknown>>(),
    operationalEvent: new Map<string, Record<string, unknown>>(),
    operationalWorkItem: new Map<string, Record<string, unknown>>([
      [
        "work-item-1",
        {
          _id: "work-item-1",
          approvalRequestId: "approval-1",
          approvalState: "pending",
          status: "open",
          storeId: "store-1",
        },
      ],
    ]),
    productSku: new Map<string, Record<string, unknown>>([
      [
        "sku-1",
        {
          _id: "sku-1",
          inventoryCount: 8,
          productId: "product-1",
          productName: "Closure wig",
          quantityAvailable: 6,
          sku: "CW-18",
          storeId: "store-1",
        },
      ],
    ]),
    stockAdjustmentBatch: new Map<string, Record<string, unknown>>([
      [
        "batch-1",
        {
          _id: "batch-1",
          adjustmentType: "manual",
          approvalRequestId: "approval-1",
          approvalRequired: true,
          createdAt: 1,
          createdByUserId: "operator-1",
          largestAbsoluteDelta: 6,
          lineItemCount: 1,
          lineItems: [
            {
              productId: "product-1",
              productName: "Closure wig",
              productSkuId: "sku-1",
              quantityDelta: -6,
              sku: "CW-18",
              systemQuantity: 8,
            },
          ],
          netQuantityDelta: -6,
          notes: "Cycle count variance",
          operationalWorkItemId: "work-item-1",
          organizationId: "org-1",
          reasonCode: "damage",
          status: "pending_approval",
          storeId: "store-1",
          submissionKey: "batch-key",
        },
      ],
    ]),
  };
  const insertCounters: Record<"inventoryMovement" | "operationalEvent", number> = {
    inventoryMovement: 0,
    operationalEvent: 0,
  };

  const queryTable = (table: "inventoryMovement" | "operationalEvent") => ({
    withIndex(_index: string, applyIndex: (query: {
      eq: (field: string, value: unknown) => unknown;
    }) => unknown) {
      const filters: Array<[string, unknown]> = [];
      const query = {
        eq(field: string, value: unknown) {
          filters.push([field, value]);
          return query;
        },
      };

      applyIndex(query);

      return {
        collect: async () =>
          Array.from(tables[table].values()).filter((record) =>
            filters.every(([field, value]) => record[field] === value)
          ),
      };
    },
  });

  const ctx = {
    db: {
      async get(table: keyof typeof tables, id: string) {
        return tables[table].get(id) ?? null;
      },
      async insert(
        table: "inventoryMovement" | "operationalEvent",
        value: Record<string, unknown>
      ) {
        insertCounters[table] += 1;
        const id = `${table}-${insertCounters[table]}`;
        tables[table].set(id, { _id: id, ...value });
        return id;
      },
      async patch(
        table: keyof typeof tables,
        id: string,
        value: Record<string, unknown>
      ) {
        const existingRecord = tables[table].get(id);

        if (!existingRecord) {
          throw new Error(`Missing ${table} record: ${id}`);
        }

        tables[table].set(id, { ...existingRecord, ...value });
      },
      query(table: "inventoryMovement" | "operationalEvent") {
        return queryTable(table);
      },
    },
  } as unknown as MutationCtx;

  return { ctx, tables };
}

describe("stock ops adjustments", () => {
  it("calculates cycle-count deltas from the system quantity", () => {
    expect(
      calculateCycleCountQuantityDelta({
        countedQuantity: 3,
        systemQuantity: 8,
      })
    ).toBe(-5);

    expect(
      calculateCycleCountQuantityDelta({
        countedQuantity: 13,
        systemQuantity: 8,
      })
    ).toBe(5);
  });

  it("rejects duplicate sku entries inside one adjustment batch", () => {
    expect(() =>
      assertDistinctStockAdjustmentLineItems([
        {
          productSkuId: "sku-1",
        },
        {
          productSkuId: "sku-1",
        },
      ])
    ).toThrow("cannot include the same SKU twice");
  });

  it("requires valid reason codes for manual adjustments and cycle counts", () => {
    expect(() => assertStockAdjustmentReasonCode("manual", "damage")).not.toThrow();
    expect(() =>
      assertStockAdjustmentReasonCode("manual", "cycle_count_reconciliation")
    ).toThrow("Manual stock adjustments require a supported reason code.");

    expect(() =>
      assertStockAdjustmentReasonCode("cycle_count", "cycle_count_reconciliation")
    ).not.toThrow();
    expect(() =>
      assertStockAdjustmentReasonCode("cycle_count", "correction")
    ).toThrow("Cycle counts must reconcile with the cycle-count reason code.");
  });

  it("requires approval when a batch crosses the variance threshold", () => {
    const belowThreshold = summarizeStockAdjustmentLineItems([
      { quantityDelta: STOCK_ADJUSTMENT_APPROVAL_THRESHOLD - 1 },
      { quantityDelta: -1 },
    ]);
    const atThreshold = summarizeStockAdjustmentLineItems([
      { quantityDelta: STOCK_ADJUSTMENT_APPROVAL_THRESHOLD },
    ]);

    expect(requiresStockAdjustmentApproval(belowThreshold)).toBe(false);
    expect(requiresStockAdjustmentApproval(atThreshold)).toBe(true);
  });

  it("requires typed quantities that match the adjustment mode", () => {
    expect(
      resolveStockAdjustmentQuantityDelta({
        adjustmentType: "manual",
        quantityDelta: -2,
        systemQuantity: 8,
      })
    ).toBe(-2);

    expect(
      resolveStockAdjustmentQuantityDelta({
        adjustmentType: "cycle_count",
        countedQuantity: 11,
        systemQuantity: 8,
      })
    ).toBe(3);

    expect(() =>
      resolveStockAdjustmentQuantityDelta({
        adjustmentType: "manual",
        systemQuantity: 8,
      })
    ).toThrow(
      "Manual stock adjustments require a whole-unit delta for every selected SKU."
    );

    expect(() =>
      resolveStockAdjustmentQuantityDelta({
        adjustmentType: "cycle_count",
        systemQuantity: 8,
      })
    ).toThrow(
      "Cycle counts require an integer counted quantity for every selected SKU."
    );
  });

  it("tracks the net delta and largest absolute variance for a batch", () => {
    expect(
      summarizeStockAdjustmentLineItems([
        { quantityDelta: -3 },
        { quantityDelta: 5 },
        { quantityDelta: -1 },
      ])
    ).toEqual({
      largestAbsoluteDelta: 5,
      lineItemCount: 3,
      netQuantityDelta: 1,
    });
  });

  it("short-circuits duplicate submissions and wires approvals plus inventory movements", () => {
    const source = getSource("./adjustments.ts");

    expect(source).toContain(
      'withIndex("by_storeId_adjustmentType_submissionKey"'
    );
    expect(source).toContain("buildApprovalRequest");
    expect(source).toContain("recordInventoryMovementWithCtx");
  });

  it("applies approved stock adjustments and closes the review work item", async () => {
    const { ctx, tables } = createApprovalDecisionMutationCtx();

    await resolveStockAdjustmentApprovalDecisionWithCtx(ctx, {
      approvalRequestId: "approval-1" as Id<"approvalRequest">,
      decision: "approved",
      reviewedByUserId: "manager-1" as Id<"athenaUser">,
    });

    expect(tables.stockAdjustmentBatch.get("batch-1")).toMatchObject({
      appliedAt: expect.any(Number),
      decidedAt: expect.any(Number),
      status: "applied",
    });
    expect(tables.productSku.get("sku-1")).toMatchObject({
      inventoryCount: 2,
      quantityAvailable: 0,
    });
    expect(tables.operationalWorkItem.get("work-item-1")).toMatchObject({
      approvalState: "approved",
      completedAt: expect.any(Number),
      status: "completed",
    });
    expect(Array.from(tables.inventoryMovement.values())).toEqual([
      expect.objectContaining({
        actorUserId: "manager-1",
        movementType: "adjustment",
        quantityDelta: -6,
        reasonCode: "damage",
        sourceType: "stock_adjustment_batch",
        workItemId: "work-item-1",
      }),
    ]);
  });

  it("rejects approval-gated stock adjustments without mutating inventory", async () => {
    const { ctx, tables } = createApprovalDecisionMutationCtx();

    await resolveStockAdjustmentApprovalDecisionWithCtx(ctx, {
      approvalRequestId: "approval-1" as Id<"approvalRequest">,
      decision: "rejected",
      reviewedByUserId: "manager-1" as Id<"athenaUser">,
    });

    expect(tables.stockAdjustmentBatch.get("batch-1")).toMatchObject({
      decidedAt: expect.any(Number),
      status: "rejected",
    });
    expect(tables.productSku.get("sku-1")).toMatchObject({
      inventoryCount: 8,
      quantityAvailable: 6,
    });
    expect(tables.operationalWorkItem.get("work-item-1")).toMatchObject({
      approvalState: "rejected",
      status: "cancelled",
    });
    expect(Array.from(tables.inventoryMovement.values())).toHaveLength(0);
  });
});
