import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import {
  listReplenishmentRecommendationsWithCtx,
} from "./replenishment";

function getSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function toAsyncIterable<T>(records: T[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const record of records) {
        yield record;
      }
    },
  };
}

function createReplenishmentQueryCtx() {
  const tables = {
    productSku: new Map<string, Record<string, unknown>>([
      [
        "sku-reorder",
        {
          _id: "sku-reorder",
          inventoryCount: 0,
          productName: "Closure Wig",
          quantityAvailable: 0,
          sku: "CW-18",
          storeId: "store-1",
        },
      ],
      [
        "sku-inbound",
        {
          _id: "sku-inbound",
          inventoryCount: 1,
          productName: "Frontal Wig",
          quantityAvailable: 1,
          sku: "FW-20",
          storeId: "store-1",
        },
      ],
      [
        "sku-constrained",
        {
          _id: "sku-constrained",
          inventoryCount: 7,
          productName: "Silk Press Kit",
          quantityAvailable: 1,
          sku: "SP-01",
          storeId: "store-1",
        },
      ],
      [
        "sku-healthy",
        {
          _id: "sku-healthy",
          inventoryCount: 8,
          productName: "Healthy Wig",
          quantityAvailable: 8,
          sku: "HW-22",
          storeId: "store-1",
        },
      ],
      [
        "sku-other-store",
        {
          _id: "sku-other-store",
          inventoryCount: 0,
          productName: "Other Store Wig",
          quantityAvailable: 0,
          sku: "OS-01",
          storeId: "store-2",
        },
      ],
    ]),
    purchaseOrder: new Map<string, Record<string, unknown>>([
      [
        "po-inbound",
        {
          _id: "po-inbound",
          expectedAt: Date.now() + 24 * 60 * 60 * 1000,
          poNumber: "PO-001",
          status: "ordered",
          storeId: "store-1",
        },
      ],
    ]),
    purchaseOrderLineItem: new Map<string, Record<string, unknown>>([
      [
        "line-inbound",
        {
          _id: "line-inbound",
          orderedQuantity: 6,
          productSkuId: "sku-inbound",
          purchaseOrderId: "po-inbound",
          receivedQuantity: 0,
          storeId: "store-1",
        },
      ],
    ]),
    vendor: new Map<string, Record<string, unknown>>([
      [
        "vendor-1",
        {
          _id: "vendor-1",
          name: "Primary Vendor",
          status: "active",
          storeId: "store-1",
        },
      ],
      [
        "vendor-other-store",
        {
          _id: "vendor-other-store",
          name: "Other Store Vendor",
          status: "active",
          storeId: "store-2",
        },
      ],
    ]),
  };

  const ctx = {
    db: {
      query(table: keyof typeof tables) {
        if (table === "productSku") {
          return {
            withIndex(
              _index: string,
              applyIndex: (queryBuilder: {
                eq: (field: string, value: unknown) => unknown;
              }) => unknown
            ) {
              let storeId: unknown;
              const queryBuilder = {
                eq(field: string, value: unknown) {
                  if (field === "storeId") {
                    storeId = value;
                  }

                  return queryBuilder;
                },
              };

              applyIndex(queryBuilder);

              return toAsyncIterable(
                Array.from(tables.productSku.values()).filter(
                  (record) => record.storeId === storeId
                )
              );
            },
          };
        }

        if (table === "purchaseOrder") {
          return {
            withIndex(
              _index: string,
              applyIndex: (queryBuilder: {
                eq: (field: string, value: unknown) => unknown;
              }) => unknown
            ) {
              let status: unknown;
              let storeId: unknown;
              const queryBuilder = {
                eq(field: string, value: unknown) {
                  if (field === "status") {
                    status = value;
                  }

                  if (field === "storeId") {
                    storeId = value;
                  }

                  return queryBuilder;
                },
              };

              applyIndex(queryBuilder);

              return toAsyncIterable(
                Array.from(tables.purchaseOrder.values()).filter(
                  (record) =>
                    record.storeId === storeId && record.status === status
                )
              );
            },
          };
        }

        if (table === "purchaseOrderLineItem") {
          return {
            withIndex(
              _index: string,
              applyIndex: (queryBuilder: {
                eq: (field: string, value: unknown) => unknown;
              }) => unknown
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

              return toAsyncIterable(
                Array.from(tables.purchaseOrderLineItem.values()).filter(
                  (record) => record.purchaseOrderId === purchaseOrderId
                )
              );
            },
          };
        }

        if (table === "vendor") {
          return {
            withIndex(
              _index: string,
              applyIndex: (queryBuilder: {
                eq: (field: string, value: unknown) => unknown;
              }) => unknown
            ) {
              let status: unknown;
              let storeId: unknown;
              const queryBuilder = {
                eq(field: string, value: unknown) {
                  if (field === "status") {
                    status = value;
                  }

                  if (field === "storeId") {
                    storeId = value;
                  }

                  return queryBuilder;
                },
              };

              applyIndex(queryBuilder);

              return toAsyncIterable(
                Array.from(tables.vendor.values()).filter(
                  (record) =>
                    record.storeId === storeId && record.status === status
                )
              );
            },
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      },
    },
  } as unknown as QueryCtx;

  return { ctx, tables };
}

describe("stock ops replenishment", () => {
  beforeEach(() => {
    vi.setSystemTime(new Date("2026-05-05T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("builds exposed, inbound, and constrained continuity rows from stock and receiving context", async () => {
    const { ctx } = createReplenishmentQueryCtx();

    const result = await listReplenishmentRecommendationsWithCtx(ctx, {
      storeId: "store-1" as Id<"store">,
    });

    expect(result.map((item) => item.status)).toEqual([
      "exposed",
      "exposed",
      "inbound",
    ]);
    expect(result.find((item) => item._id === "sku-reorder")).toMatchObject({
      productName: "Closure Wig",
      recommendationStatus: "reorder_now",
      status: "exposed",
      suggestedOrderQuantity: 6,
    });
    expect(result.find((item) => item._id === "sku-inbound")).toMatchObject({
      inboundPurchaseOrderCount: 1,
      inboundPurchaseOrderQuantity: 6,
      pendingPurchaseOrderCount: 1,
      pendingPurchaseOrderQuantity: 6,
      productName: "Frontal Wig",
      recommendationStatus: "awaiting_receipt",
      status: "inbound",
      suggestedOrderQuantity: 0,
    });
    expect(result.find((item) => item._id === "sku-constrained")).toMatchObject({
      productName: "Silk Press Kit",
      recommendationStatus: "availability_constrained",
      status: "exposed",
      suggestedOrderQuantity: 0,
    });
  });

  it("keeps a continuity row partially covered when inbound units still leave the shelf below target", async () => {
    const { ctx, tables } = createReplenishmentQueryCtx();

    tables.purchaseOrderLineItem.set("line-reorder-top-up", {
      _id: "line-reorder-top-up",
      orderedQuantity: 2,
      productSkuId: "sku-reorder",
      purchaseOrderId: "po-inbound",
      receivedQuantity: 0,
      storeId: "store-1",
    });

    const result = await listReplenishmentRecommendationsWithCtx(ctx, {
      storeId: "store-1" as Id<"store">,
    });
    const reorderItem = result.find((item) => item._id === "sku-reorder");

    expect(reorderItem).toMatchObject({
      pendingPurchaseOrderQuantity: 2,
      recommendationStatus: "reorder_now",
      status: "partially_covered",
      suggestedOrderQuantity: 4,
    });
  });

  it("separates planned purchase-order action from inbound cover", async () => {
    const { ctx, tables } = createReplenishmentQueryCtx();

    tables.purchaseOrder.set("po-planned", {
      _id: "po-planned",
      createdAt: Date.now(),
      poNumber: "PO-002",
      status: "approved",
      storeId: "store-1",
    });
    tables.purchaseOrderLineItem.set("line-planned", {
      _id: "line-planned",
      orderedQuantity: 6,
      productSkuId: "sku-reorder",
      purchaseOrderId: "po-planned",
      receivedQuantity: 0,
      storeId: "store-1",
    });

    const result = await listReplenishmentRecommendationsWithCtx(ctx, {
      storeId: "store-1" as Id<"store">,
    });
    const plannedItem = result.find((item) => item._id === "sku-reorder");

    expect(plannedItem).toMatchObject({
      inboundPurchaseOrderCount: 0,
      inboundPurchaseOrderQuantity: 0,
      plannedPurchaseOrderCount: 1,
      plannedPurchaseOrderQuantity: 6,
      status: "planned",
      suggestedOrderQuantity: 0,
    });
    expect(plannedItem?.plannedPurchaseOrders).toEqual([
      expect.objectContaining({
        poNumber: "PO-002",
        status: "approved",
      }),
    ]);
    expect(plannedItem?.pendingPurchaseOrders).toEqual([]);
  });

  it("derives v1 exceptions from planned, inbound, short receipt, cancelled cover, and missing vendor facts", async () => {
    const { ctx, tables } = createReplenishmentQueryCtx();

    tables.productSku.set("sku-stale", {
      _id: "sku-stale",
      inventoryCount: 0,
      productName: "Stale Planned Wig",
      quantityAvailable: 0,
      sku: "SPW-01",
      storeId: "store-1",
    });
    tables.productSku.set("sku-late", {
      _id: "sku-late",
      inventoryCount: 0,
      productName: "Late Inbound Wig",
      quantityAvailable: 0,
      sku: "LIW-01",
      storeId: "store-1",
    });
    tables.productSku.set("sku-short", {
      _id: "sku-short",
      inventoryCount: 1,
      productName: "Short Receipt Wig",
      quantityAvailable: 1,
      sku: "SRW-01",
      storeId: "store-1",
    });
    tables.productSku.set("sku-cancelled", {
      _id: "sku-cancelled",
      inventoryCount: 0,
      productName: "Cancelled Cover Wig",
      quantityAvailable: 0,
      sku: "CCW-01",
      storeId: "store-1",
    });

    tables.purchaseOrder.set("po-stale", {
      _id: "po-stale",
      createdAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
      poNumber: "PO-STALE",
      status: "submitted",
      storeId: "store-1",
    });
    tables.purchaseOrder.set("po-late", {
      _id: "po-late",
      expectedAt: Date.now() - 24 * 60 * 60 * 1000,
      poNumber: "PO-LATE",
      status: "ordered",
      storeId: "store-1",
    });
    tables.purchaseOrder.set("po-short", {
      _id: "po-short",
      expectedAt: Date.now() + 24 * 60 * 60 * 1000,
      poNumber: "PO-SHORT",
      status: "partially_received",
      storeId: "store-1",
    });
    tables.purchaseOrder.set("po-cancelled", {
      _id: "po-cancelled",
      cancelledAt: Date.now(),
      poNumber: "PO-CANCELLED",
      status: "cancelled",
      storeId: "store-1",
    });

    tables.purchaseOrderLineItem.set("line-stale", {
      _id: "line-stale",
      orderedQuantity: 6,
      productSkuId: "sku-stale",
      purchaseOrderId: "po-stale",
      receivedQuantity: 0,
      storeId: "store-1",
    });
    tables.purchaseOrderLineItem.set("line-late", {
      _id: "line-late",
      orderedQuantity: 6,
      productSkuId: "sku-late",
      purchaseOrderId: "po-late",
      receivedQuantity: 0,
      storeId: "store-1",
    });
    tables.purchaseOrderLineItem.set("line-short", {
      _id: "line-short",
      orderedQuantity: 3,
      productSkuId: "sku-short",
      purchaseOrderId: "po-short",
      receivedQuantity: 2,
      storeId: "store-1",
    });
    tables.purchaseOrderLineItem.set("line-cancelled", {
      _id: "line-cancelled",
      orderedQuantity: 6,
      productSkuId: "sku-cancelled",
      purchaseOrderId: "po-cancelled",
      receivedQuantity: 0,
      storeId: "store-1",
    });

    tables.vendor.clear();

    const result = await listReplenishmentRecommendationsWithCtx(ctx, {
      storeId: "store-1" as Id<"store">,
    });
    const statusBySku = new Map(
      result.map((item) => [String(item._id), item.status])
    );

    expect(statusBySku.get("sku-reorder")).toBe("vendor_missing");
    expect(statusBySku.get("sku-stale")).toBe("stale_planned_action");
    expect(statusBySku.get("sku-late")).toBe("late_inbound");
    expect(statusBySku.get("sku-short")).toBe("short_receipt");
    expect(statusBySku.get("sku-cancelled")).toBe("cancelled_cover");
  });

  it("returns resolved related rows and keeps needs-action rows sorted first", async () => {
    const { ctx, tables } = createReplenishmentQueryCtx();

    tables.purchaseOrder.set("po-received", {
      _id: "po-received",
      expectedAt: Date.now() - 24 * 60 * 60 * 1000,
      poNumber: "PO-RECEIVED",
      receivedAt: Date.now(),
      status: "received",
      storeId: "store-1",
    });
    tables.purchaseOrderLineItem.set("line-received", {
      _id: "line-received",
      orderedQuantity: 6,
      productSkuId: "sku-healthy",
      purchaseOrderId: "po-received",
      receivedQuantity: 6,
      storeId: "store-1",
    });

    const result = await listReplenishmentRecommendationsWithCtx(ctx, {
      storeId: "store-1" as Id<"store">,
    });

    expect(result.map((item) => item.status)).toEqual([
      "exposed",
      "exposed",
      "inbound",
      "resolved",
    ]);
    expect(result.at(-1)).toMatchObject({
      productName: "Healthy Wig",
      status: "resolved",
    });
  });

  it("does not include purchase-order context or SKUs from another store", async () => {
    const { ctx, tables } = createReplenishmentQueryCtx();

    tables.purchaseOrder.set("po-other-store", {
      _id: "po-other-store",
      expectedAt: Date.now() - 24 * 60 * 60 * 1000,
      poNumber: "PO-OTHER",
      status: "ordered",
      storeId: "store-2",
    });
    tables.purchaseOrderLineItem.set("line-other-store", {
      _id: "line-other-store",
      orderedQuantity: 99,
      productSkuId: "sku-reorder",
      purchaseOrderId: "po-other-store",
      receivedQuantity: 0,
      storeId: "store-2",
    });

    const result = await listReplenishmentRecommendationsWithCtx(ctx, {
      storeId: "store-1" as Id<"store">,
    });
    const reorderItem = result.find((item) => item._id === "sku-reorder");

    expect(result.some((item) => item._id === "sku-other-store")).toBe(false);
    expect(reorderItem).toMatchObject({
      pendingPurchaseOrderQuantity: 0,
      status: "exposed",
      suggestedOrderQuantity: 6,
    });
    expect(
      reorderItem?.pendingPurchaseOrders.some(
        (purchaseOrder) => purchaseOrder.poNumber === "PO-OTHER"
      )
    ).toBe(false);
  });

  it("requires full-admin access before exposing replenishment recommendations", () => {
    const source = getSource("./replenishment.ts");

    expect(source).toContain("requireStoreFullAdminAccess(ctx, args.storeId);");
  });
});
