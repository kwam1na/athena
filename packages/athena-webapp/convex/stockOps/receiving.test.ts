import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { ok, userError } from "../../shared/commandResult";
import { assertConformsToExportedReturns } from "../lib/returnValidatorContract";

const mockedAuthServer = vi.hoisted(() => ({
  getAuthUserId: vi.fn(),
}));

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: mockedAuthServer.getAuthUserId,
}));

import {
  assertDistinctReceivingLineItems,
  assertReceivablePurchaseOrderStatus,
  assertReceivingLineQuantities,
  calculatePurchaseOrderReceivingStatus,
  calculateReceivingBatchTotals,
  normalizeConfirmedReceiptCost,
  receivePurchaseOrderBatch,
  receivePurchaseOrderBatchCommandWithCtx,
  summarizeReceivingSkuDeltas,
} from "./receiving";

function getSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function createReceivingMutationCtx(args?: {
  purchaseOrderCurrency?: string;
  purchaseOrderUnitCost?: number;
  purchaseOrderStatus?: string;
}) {
  mockedAuthServer.getAuthUserId.mockResolvedValue("auth-user-1");

  const tables = {
    athenaUser: new Map<string, Record<string, unknown>>([
      ["athena-user-1", { _id: "athena-user-1", email: "manager@example.com" }],
    ]),
    organizationMember: new Map<string, Record<string, unknown>>([
      [
        "membership-1",
        {
          _id: "membership-1",
          organizationId: "org-1",
          role: "full_admin",
          userId: "athena-user-1",
        },
      ],
    ]),
    productSku: new Map<string, Record<string, unknown>>([
      [
        "sku-1",
        {
          _id: "sku-1",
          inventoryCount: 8,
          quantityAvailable: 6,
          storeId: "store-1",
        },
      ],
    ]),
    purchaseOrder: new Map<string, Record<string, unknown>>([
      [
        "purchase-order-1",
        {
          _id: "purchase-order-1",
          operationalWorkItemId: "work-item-1",
          organizationId: "org-1",
          currency: args?.purchaseOrderCurrency ?? "GHS",
          status: args?.purchaseOrderStatus ?? "ordered",
          storeId: "store-1",
        },
      ],
    ]),
    purchaseOrderLineItem: new Map<string, Record<string, unknown>>([
      [
        "line-item-1",
        {
          _id: "line-item-1",
          orderedQuantity: 4,
          productId: "product-1",
          productSkuId: "sku-1",
          purchaseOrderId: "purchase-order-1",
          receivedQuantity: 1,
          unitCost: args?.purchaseOrderUnitCost ?? 2_000,
        },
      ],
    ]),
    catalogSummary: new Map<string, Record<string, unknown>>(),
    inventoryMovement: new Map<string, Record<string, unknown>>(),
    reportingInventoryDeficitLedger: new Map<string, Record<string, unknown>>(),
    reportingInventoryDeficitLot: new Map<string, Record<string, unknown>>(),
    reportingInventoryEffect: new Map<string, Record<string, unknown>>(),
    reportingInventoryEffectSourceReference: new Map<
      string,
      Record<string, unknown>
    >(),
    reportingInventoryPosition: new Map<string, Record<string, unknown>>(),
    reportingInventoryPositionRevision: new Map<
      string,
      Record<string, unknown>
    >(),
    reportingProjectionActivation: new Map<string, Record<string, unknown>>(),
    reportingProjectionGeneration: new Map<string, Record<string, unknown>>(),
    reportingIngress: new Map<string, Record<string, unknown>>(),
    reportingIngressLine: new Map<string, Record<string, unknown>>(),
    reportingIngressSourceReference: new Map<string, Record<string, unknown>>(),
    reportingSkuEvidence: new Map<string, Record<string, unknown>>(),
    receivingBatch: new Map<string, Record<string, unknown>>(),
    skuActivityEvent: new Map<string, Record<string, unknown>>(),
    reportFact: new Map<string, Record<string, unknown>>(),
    reportDay: new Map<string, Record<string, unknown>>(),
    reportSkuDay: new Map<string, Record<string, unknown>>(),
    reportDirtyDay: new Map<string, Record<string, unknown>>(),
    storeTimezoneVersion: new Map<string, Record<string, unknown>>(),
    store: new Map<string, Record<string, unknown>>([
      ["store-1", { _id: "store-1", currency: "GHS", organizationId: "org-1" }],
    ]),
    storeSchedule: new Map<string, Record<string, unknown>>(),
    users: new Map<string, Record<string, unknown>>([
      ["auth-user-1", { _id: "auth-user-1", email: "manager@example.com" }],
    ]),
  };
  const insertCounters: Record<string, number> = {};

  const ctx = {
    db: {
      async get(table: keyof typeof tables, id: string) {
        return tables[table].get(id) ?? null;
      },
      async insert(
        table: keyof typeof tables,
        value: Record<string, unknown>,
      ) {
        insertCounters[table] = (insertCounters[table] ?? 0) + 1;
        const id = `${table}-${insertCounters[table]}`;
        tables[table].set(id, { _id: id, ...value });
        return id;
      },
      async patch(
        table: keyof typeof tables,
        id: string,
        value: Record<string, unknown>,
      ) {
        const existingRecord = tables[table].get(id);

        if (!existingRecord) {
          throw new Error(`Missing ${table} record: ${id}`);
        }

        tables[table].set(id, { ...existingRecord, ...value });
      },
      query(table: keyof typeof tables) {
        if (table === "athenaUser" || table === "organizationMember") {
          return {
            filter(
              applyFilter: (queryBuilder: {
                and: (...conditions: unknown[]) => unknown;
                eq: (left: unknown, right: unknown) => unknown;
                field: (name: string) => string;
              }) => unknown,
            ) {
              const filters: Array<[string, unknown]> = [];
              const queryBuilder = {
                and: (...conditions: unknown[]) => conditions,
                eq(left: unknown, right: unknown) {
                  filters.push([left as string, right]);
                  return { left, right };
                },
                field(name: string) {
                  return name;
                },
              };

              applyFilter(queryBuilder);

              return {
                first: async () =>
                  Array.from(tables[table].values()).find((record) =>
                    filters.every(([field, value]) => record[field] === value),
                  ) ?? null,
              };
            },
          };
        }

        if (table === "purchaseOrderLineItem") {
          return {
            withIndex(
              _index: string,
              applyIndex: (queryBuilder: {
                eq: (field: string, value: unknown) => unknown;
              }) => unknown,
            ) {
              let purchaseOrderId: unknown;
              const queryBuilder = {
                eq(field: string, value: unknown) {
                  if (field === "purchaseOrderId") {
                    purchaseOrderId = value;
                  }
                  return queryBuilder;
                },
              };

              applyIndex(queryBuilder);

              return {
                async *[Symbol.asyncIterator]() {
                  for (const record of tables.purchaseOrderLineItem.values()) {
                    if (record.purchaseOrderId === purchaseOrderId) {
                      yield record;
                    }
                  }
                },
              };
            },
          };
        }

        if (table === "inventoryMovement") {
          return {
            withIndex(
              _index: string,
              applyIndex: (queryBuilder: {
                eq: (field: string, value: unknown) => unknown;
              }) => unknown,
            ) {
              const filters: Array<[string, unknown]> = [];
              const queryBuilder = {
                eq(field: string, value: unknown) {
                  filters.push([field, value]);
                  return queryBuilder;
                },
              };

              applyIndex(queryBuilder);

              return {
                collect: async () =>
                  Array.from(tables.inventoryMovement.values()).filter(
                    (record) =>
                      filters.every(
                        ([field, value]) => record[field] === value,
                      ),
                  ),
              };
            },
          };
        }

        return {
          withIndex(
            _index: string,
            applyIndex: (queryBuilder: {
              eq: (field: string, value: unknown) => unknown;
              lte: (field: string, value: number) => unknown;
            }) => unknown,
          ) {
            const filters: Array<[string, unknown]> = [];
            const queryBuilder = {
              eq(field: string, value: unknown) {
                filters.push([field, value]);
                return queryBuilder;
              },
              lte() {
                return queryBuilder;
              },
            };

            applyIndex(queryBuilder);

            const results = Array.from(tables[table].values()).filter(
              (record) =>
                filters.every(([field, value]) => record[field] === value),
            );
            const chain = {
              first: async () => results[0] ?? null,
              take: async (limit: number) => results.slice(0, limit),
              order: () => chain,
              unique: async () => {
                if (results.length > 1) {
                  throw new Error(
                    `Expected at most one ${String(table)} record, found ${results.length}.`,
                  );
                }
                return results[0] ?? null;
              },
            };
            return chain;
          },
        };
      },
    },
    runMutation: vi.fn().mockResolvedValue(undefined),
    scheduler: {
      runAfter: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as MutationCtx;

  return { ctx, tables };
}

describe("stock ops receiving", () => {
  // Admission rail: the ingress resolves an actor before the handler body.
  // `procurement.manage` is not demo-granted, so the definition denies shared
  // demo and an anonymous caller never reaches the receiving write.
  it("routes the receiving ingress through the admission rail", () => {
    const source = getSource("./receiving.ts");

    expect(source).toContain(
      "handler: admitPublicMutation(\n    receivePurchaseOrderBatchOperationDefinition,",
    );
    expect(source).toContain(
      "export const receivePurchaseOrderBatch = mutation({",
    );
  });

  it("accepts the representative receive command return contract", () => {
    assertConformsToExportedReturns(
      receivePurchaseOrderBatch,
      ok({ receivingBatchId: "receiving-batch-1" }),
    );
    assertConformsToExportedReturns(
      receivePurchaseOrderBatch,
      userError({
        code: "validation_failed",
        message: "Receiving batch is invalid.",
      }),
    );
  });

  it("calculates batch totals from partial receiving line items", () => {
    expect(
      calculateReceivingBatchTotals([
        { receivedQuantity: 2 },
        { receivedQuantity: 1 },
      ]),
    ).toEqual({
      lineItemCount: 2,
      totalUnits: 3,
    });
  });

  it("preserves unknown, known-zero, and known receipt cost distinctly", () => {
    expect(
      normalizeConfirmedReceiptCost({
        confirmedCurrency: "GHS",
        confirmedUnitCost: undefined,
      }),
    ).toEqual({ confirmedCurrency: "GHS", confirmedUnitCost: undefined });
    expect(
      normalizeConfirmedReceiptCost({
        confirmedCurrency: " ghs ",
        confirmedUnitCost: 0,
      }),
    ).toEqual({ confirmedCurrency: "GHS", confirmedUnitCost: 0 });
    expect(
      normalizeConfirmedReceiptCost({
        confirmedCurrency: "GHS",
        confirmedUnitCost: 2_500,
      }),
    ).toEqual({ confirmedCurrency: "GHS", confirmedUnitCost: 2_500 });
  });

  it("rejects negative, fractional, or currency-free known receipt cost", () => {
    expect(() =>
      normalizeConfirmedReceiptCost({ confirmedUnitCost: -1 }),
    ).toThrow(
      "Confirmed unit cost must be a nonnegative whole minor-unit amount",
    );
    expect(() =>
      normalizeConfirmedReceiptCost({
        confirmedCurrency: "GHS",
        confirmedUnitCost: 1.5,
      }),
    ).toThrow(
      "Confirmed unit cost must be a nonnegative whole minor-unit amount",
    );
    expect(() =>
      normalizeConfirmedReceiptCost({ confirmedUnitCost: 0 }),
    ).toThrow("Confirmed currency is required when unit cost is known");
  });

  it("blocks over-receiving beyond the ordered quantity", () => {
    expect(() =>
      assertReceivingLineQuantities([
        {
          orderedQuantity: 2,
          receivedQuantity: 3,
        },
      ]),
    ).toThrow("cannot receive more than ordered");
  });

  it("keeps a purchase order partially received until every line is satisfied", () => {
    expect(
      calculatePurchaseOrderReceivingStatus([
        {
          orderedQuantity: 4,
          receivedQuantity: 4,
        },
        {
          orderedQuantity: 2,
          receivedQuantity: 0,
        },
      ]),
    ).toBe("partially_received");

    expect(
      calculatePurchaseOrderReceivingStatus([
        {
          orderedQuantity: 4,
          receivedQuantity: 4,
        },
        {
          orderedQuantity: 2,
          receivedQuantity: 2,
        },
      ]),
    ).toBe("received");
  });

  it("rejects duplicate purchase-order lines inside one receiving batch", () => {
    expect(() =>
      assertDistinctReceivingLineItems([
        {
          purchaseOrderLineItemId: "line-1",
        },
        {
          purchaseOrderLineItemId: "line-1",
        },
      ]),
    ).toThrow("cannot include the same purchase order line twice");
  });

  it("only accepts receivable purchase-order statuses", () => {
    expect(() => assertReceivablePurchaseOrderStatus("draft")).toThrow(
      "Cannot receive purchase order while it is draft",
    );
    expect(() => assertReceivablePurchaseOrderStatus("approved")).toThrow(
      "Cannot receive purchase order while it is approved",
    );
    expect(() => assertReceivablePurchaseOrderStatus("ordered")).not.toThrow();
    expect(() =>
      assertReceivablePurchaseOrderStatus("partially_received"),
    ).not.toThrow();
  });

  it("coalesces repeated sku deltas before inventory updates are written", () => {
    expect(
      summarizeReceivingSkuDeltas([
        {
          productId: "product-1",
          productSkuId: "sku-1",
          receivedQuantity: 2,
        },
        {
          productId: "product-1",
          productSkuId: "sku-1",
          receivedQuantity: 3,
        },
        {
          productId: "product-2",
          productSkuId: "sku-2",
          receivedQuantity: 1,
        },
      ]),
    ).toEqual([
      {
        productId: "product-1",
        productSkuId: "sku-1",
        receivedQuantity: 5,
      },
      {
        productId: "product-2",
        productSkuId: "sku-2",
        receivedQuantity: 1,
      },
    ]);
  });

  it("short-circuits duplicate batch submissions through the receiving batch lookup", () => {
    const source = getSource("./receiving.ts");

    expect(source).toContain(
      'withIndex("by_storeId_purchaseOrderId_submissionKey"',
    );
    expect(source).toContain("existingReceivingBatch");
    expect(source).toContain("if (existingReceivingBatch) {");
  });

  it("returns a validation user error when the receiving submission key is missing", async () => {
    const { ctx } = createReceivingMutationCtx();

    await expect(
      receivePurchaseOrderBatchCommandWithCtx(ctx, {
        lineItems: [],
        notes: undefined,
        purchaseOrderId: "purchase-order-1" as Id<"purchaseOrder">,
        receivedByUserId: undefined,
        storeId: "store-1" as Id<"store">,
        submissionKey: "   ",
      }),
    ).resolves.toMatchObject({
      kind: "user_error",
      error: {
        code: "validation_failed",
        message: "A receiving submission key is required.",
      },
    });
  });

  it("returns a validation user error when a receiving batch over-receives a line", async () => {
    const { ctx } = createReceivingMutationCtx();

    await expect(
      receivePurchaseOrderBatchCommandWithCtx(ctx, {
        lineItems: [
          {
            purchaseOrderLineItemId:
              "line-item-1" as Id<"purchaseOrderLineItem">,
            receivedQuantity: 4,
          },
        ],
        notes: undefined,
        purchaseOrderId: "purchase-order-1" as Id<"purchaseOrder">,
        receivedByUserId: undefined,
        storeId: "store-1" as Id<"store">,
        submissionKey: "receive-1",
      }),
    ).resolves.toMatchObject({
      kind: "user_error",
      error: {
        code: "validation_failed",
        message: "You cannot receive more than ordered.",
      },
    });
  });

  it("keeps linked purchase-order work in progress until the order is fully received", async () => {
    const partial = createReceivingMutationCtx();

    await receivePurchaseOrderBatchCommandWithCtx(partial.ctx, {
      lineItems: [
        {
          purchaseOrderLineItemId: "line-item-1" as Id<"purchaseOrderLineItem">,
          receivedQuantity: 1,
        },
      ],
      notes: undefined,
      purchaseOrderId: "purchase-order-1" as Id<"purchaseOrder">,
      receivedByUserId: undefined,
      storeId: "store-1" as Id<"store">,
      submissionKey: "receive-partial",
    });

    expect(partial.ctx.runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: "in_progress",
        workItemId: "work-item-1",
      }),
    );

    const complete = createReceivingMutationCtx();

    await receivePurchaseOrderBatchCommandWithCtx(complete.ctx, {
      lineItems: [
        {
          purchaseOrderLineItemId: "line-item-1" as Id<"purchaseOrderLineItem">,
          receivedQuantity: 3,
        },
      ],
      notes: undefined,
      purchaseOrderId: "purchase-order-1" as Id<"purchaseOrder">,
      receivedByUserId: undefined,
      storeId: "store-1" as Id<"store">,
      submissionKey: "receive-complete",
    });

    expect(complete.ctx.runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: "completed",
        workItemId: "work-item-1",
      }),
    );
  });

  it("commits confirmed receipt cost with stock, movement, and valuation evidence", async () => {
    const { ctx, tables } = createReceivingMutationCtx();

    await receivePurchaseOrderBatchCommandWithCtx(ctx, {
      lineItems: [
        {
          confirmedCurrency: "GHS",
          confirmedUnitCost: 2_500,
          purchaseOrderLineItemId: "line-item-1" as Id<"purchaseOrderLineItem">,
          receivedQuantity: 1,
        },
      ],
      purchaseOrderId: "purchase-order-1" as Id<"purchaseOrder">,
      storeId: "store-1" as Id<"store">,
      submissionKey: "receive-costed",
    });

    expect(tables.receivingBatch.get("receivingBatch-1")).toMatchObject({
      lineItems: [
        expect.objectContaining({
          confirmedCurrency: "GHS",
          confirmedUnitCost: 2_500,
        }),
      ],
    });
    expect(tables.productSku.get("sku-1")).toMatchObject({
      inventoryCount: 9,
      quantityAvailable: 7,
    });
    expect(
      tables.reportingInventoryPosition.get("reportingInventoryPosition-1"),
    ).toMatchObject({
      costedQuantity: 1,
      knownCostPoolMinor: 2_500,
      mode: "compatibility_shadow",
      uncostedQuantity: 8,
    });
    expect(tables.inventoryMovement.size).toBe(1);
    expect(tables.skuActivityEvent.size).toBe(1);

    const [reportFact] = Array.from(tables.reportFact.values());
    expect(reportFact).toMatchObject({
      currency: "GHS",
      factKind: "procurement_receipt",
      grossAmountMinor: 2_500,
      lineId: "line-item-1",
      netAmountMinor: 2_500,
      productSkuId: "sku-1",
      quantity: 1,
      sourceDomain: "inventory",
      sourceId: "receivingBatch-1",
      unitCostMinor: 2_500,
    });
  });

  it("records the confirmed received cost on the procurement_receipt fact, not the planned PO cost", async () => {
    const { ctx, tables } = createReceivingMutationCtx({
      purchaseOrderCurrency: "GHS",
      purchaseOrderUnitCost: 2_000,
    });

    await receivePurchaseOrderBatchCommandWithCtx(ctx, {
      lineItems: [
        {
          confirmedCurrency: "GHS",
          confirmedUnitCost: 2_500,
          purchaseOrderLineItemId: "line-item-1" as Id<"purchaseOrderLineItem">,
          receivedQuantity: 1,
        },
      ],
      purchaseOrderId: "purchase-order-1" as Id<"purchaseOrder">,
      storeId: "store-1" as Id<"store">,
      submissionKey: "receive-divergent-cost",
    });

    const [reportFact] = Array.from(tables.reportFact.values());
    expect(reportFact).toMatchObject({
      currency: "GHS",
      factKind: "procurement_receipt",
      netAmountMinor: 2_500,
      quantity: 1,
      unitCostMinor: 2_500,
    });
  });

  it("records the confirmed line currency on the receipt fact, independent of the PO commitment currency", async () => {
    const { ctx, tables } = createReceivingMutationCtx({
      purchaseOrderCurrency: "GHS",
      purchaseOrderUnitCost: 2_000,
    });

    await receivePurchaseOrderBatchCommandWithCtx(ctx, {
      lineItems: [
        {
          confirmedCurrency: "USD",
          confirmedUnitCost: 2_500,
          purchaseOrderLineItemId: "line-item-1" as Id<"purchaseOrderLineItem">,
          receivedQuantity: 1,
        },
      ],
      purchaseOrderId: "purchase-order-1" as Id<"purchaseOrder">,
      storeId: "store-1" as Id<"store">,
      submissionKey: "receive-divergent-currency",
    });

    const [reportFact] = Array.from(tables.reportFact.values());
    expect(reportFact).toMatchObject({
      currency: "USD",
      factKind: "procurement_receipt",
      netAmountMinor: 2_500,
      quantity: 1,
      unitCostMinor: 2_500,
    });
    expect(
      tables.reportingInventoryPosition.get("reportingInventoryPosition-1"),
    ).toMatchObject({ currencyCode: "USD", knownCostPoolMinor: 2_500 });
  });

  it("falls back to the planned PO cost on the receipt fact when the received cost is unconfirmed", async () => {
    const { ctx, tables } = createReceivingMutationCtx({
      purchaseOrderCurrency: "GHS",
      purchaseOrderUnitCost: 2_000,
    });

    await receivePurchaseOrderBatchCommandWithCtx(ctx, {
      lineItems: [
        {
          purchaseOrderLineItemId: "line-item-1" as Id<"purchaseOrderLineItem">,
          receivedQuantity: 1,
        },
      ],
      purchaseOrderId: "purchase-order-1" as Id<"purchaseOrder">,
      storeId: "store-1" as Id<"store">,
      submissionKey: "receive-uncosted",
    });

    const [reportFact] = Array.from(tables.reportFact.values());
    expect(reportFact).toMatchObject({
      currency: "GHS",
      factKind: "procurement_receipt",
      grossAmountMinor: 2_000,
      netAmountMinor: 2_000,
      quantity: 1,
      sourceDomain: "inventory",
    });
    expect(reportFact!.unitCostMinor).toBeUndefined();
  });
});
