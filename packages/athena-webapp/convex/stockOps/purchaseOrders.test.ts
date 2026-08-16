import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { ok } from "../../shared/commandResult";
import { assertConformsToExportedReturns } from "../lib/returnValidatorContract";

const mockedAuthServer = vi.hoisted(() => ({
  getAuthUserId: vi.fn(),
}));

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: mockedAuthServer.getAuthUserId,
}));

import {
  assertValidPurchaseOrderStatusTransition,
  calculatePurchaseOrderTotals,
  advancePurchaseOrderToOrderedCommand,
  buildPurchaseOrderCommitmentStatusDelta,
  createPurchaseOrder,
  createPurchaseOrderCommand,
  createPurchaseOrderWithCtx,
  getPurchaseOrder,
  listPurchaseOrders,
  mapPurchaseOrderStatusToWorkItemStatus,
  mapPurchaseOrderCommandError,
  updatePurchaseOrderStatus,
  updatePurchaseOrderStatusCommand,
  updatePurchaseOrderStatusWithCtx,
} from "./purchaseOrders";

function getSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function getHandler(fn: unknown) {
  return (fn as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> })
    ._handler;
}

function createPurchaseOrderMutationCtx() {
  mockedAuthServer.getAuthUserId.mockResolvedValue(null);

  const insert = vi.fn();
  const patch = vi.fn();
  const ctx = {
    db: {
      get: vi.fn(async (table: string, id: string) => {
        if (table === "purchaseOrder" && id === "purchase-order-1") {
          return {
            _id: "purchase-order-1",
            organizationId: "org-1",
            poNumber: "PO-001",
            status: "draft",
            storeId: "store-1",
          };
        }

        return null;
      }),
      insert,
      patch,
      query: vi.fn(),
    },
    runMutation: vi.fn(),
  } as unknown as MutationCtx;

  return { ctx, insert, patch };
}

describe("stock ops purchase orders", () => {
  it("accepts representative command return contracts", () => {
    const result = ok({ purchaseOrderId: "purchase-order-1" });

    assertConformsToExportedReturns(createPurchaseOrderCommand, result);
    assertConformsToExportedReturns(updatePurchaseOrderStatusCommand, result);
    assertConformsToExportedReturns(advancePurchaseOrderToOrderedCommand, result);
  });

  it("calculates purchase-order totals from line items", () => {
    expect(
      calculatePurchaseOrderTotals([
        {
          orderedQuantity: 2,
          unitCost: 1500,
        },
        {
          orderedQuantity: 3,
          unitCost: 900,
        },
      ]),
    ).toEqual({
      lineItemCount: 2,
      subtotalAmount: 5700,
      totalAmount: 5700,
      totalUnits: 5,
    });
  });

  it("releases only outstanding line commitment on cancellation or received close", () => {
    expect(
      buildPurchaseOrderCommitmentStatusDelta({
        closesCommitment: true,
        orderedQuantity: 5,
        receivedQuantity: 2,
        unitCost: 100,
      }),
    ).toEqual({
      amountMinor: -300,
      quantity: -3,
      remainingQuantity: 3,
    });
    expect(
      buildPurchaseOrderCommitmentStatusDelta({
        closesCommitment: false,
        orderedQuantity: 5,
        receivedQuantity: 2,
        unitCost: 100,
      }),
    ).toEqual({ amountMinor: 0, quantity: 0, remainingQuantity: 3 });
  });

  it("blocks invalid purchase-order status transitions", () => {
    expect(() =>
      assertValidPurchaseOrderStatusTransition("draft", "received"),
    ).toThrow("Cannot change purchase order from draft to received.");

    expect(() =>
      assertValidPurchaseOrderStatusTransition("ordered", "draft"),
    ).toThrow("Cannot change purchase order from ordered to draft.");

    expect(() =>
      assertValidPurchaseOrderStatusTransition("draft", "submitted"),
    ).not.toThrow();

    expect(() =>
      assertValidPurchaseOrderStatusTransition("ordered", "received"),
    ).toThrow("Cannot change purchase order from ordered to received.");
  });

  it("preserves purchase-order terminal semantics on linked work items", () => {
    expect(mapPurchaseOrderStatusToWorkItemStatus("received")).toBe(
      "completed",
    );
    expect(mapPurchaseOrderStatusToWorkItemStatus("cancelled")).toBe(
      "cancelled",
    );
    expect(mapPurchaseOrderStatusToWorkItemStatus("partially_received")).toBe(
      "in_progress",
    );
  });

  it("writes purchase-order workflow changes through the shared operations rails", () => {
    const source = getSource("./purchaseOrders.ts");

    expect(source).toContain("export const createPurchaseOrder = mutation({");
    expect(source).toContain(
      "export const createPurchaseOrderCommand = mutation({",
    );
    expect(source).toContain(
      "export const updatePurchaseOrderStatus = mutation({",
    );
    expect(source).toContain(
      "export const updatePurchaseOrderStatusCommand = mutation({",
    );
    expect(source).toContain(
      "export const advancePurchaseOrderToOrderedCommand = mutation({",
    );
    expect(source).toContain("commandResultValidator(v.any())");
    for (const definitionConst of [
      "createPurchaseOrderOperationDefinition",
      "createPurchaseOrderCommandOperationDefinition",
      "updatePurchaseOrderStatusOperationDefinition",
      "updatePurchaseOrderStatusCommandOperationDefinition",
      "advancePurchaseOrderToOrderedCommandOperationDefinition",
    ]) {
      expect(source).toContain(
        `handler: admitPublicMutation(\n    ${definitionConst},`,
      );
    }
    for (const definitionConst of [
      "listPurchaseOrdersReadDefinition",
      "getPurchaseOrderReadDefinition",
    ]) {
      expect(source).toContain(
        `handler: admitPublicQuery(\n    ${definitionConst},`,
      );
    }
    expect(source).toContain(
      "return ok(await createPurchaseOrderWithCtx(ctx, args));",
    );
    expect(source).toContain(
      "return ok(await updatePurchaseOrderStatusWithCtx(ctx, args));",
    );
    expect(source).toContain(
      "return ok(await advancePurchaseOrderToOrderedWithCtx(ctx, args));",
    );
    expect(source).toContain("createOperationalWorkItemWithCtx");
    expect(source).toContain("recordOperationalEventWithCtx");
    expect(source).toContain("updateOperationalWorkItemStatus");
  });

  it("requires full-admin access before purchase-order creation writes", async () => {
    const { ctx, insert } = createPurchaseOrderMutationCtx();

    await expect(
      createPurchaseOrderWithCtx(ctx, {
        lineItems: [
          {
            orderedQuantity: 1,
            productSkuId: "sku-1" as Id<"productSku">,
            unitCost: 0,
          },
        ],
        storeId: "store-1" as Id<"store">,
        vendorId: "vendor-1" as Id<"vendor">,
      }),
    ).rejects.toThrow("Authentication required.");
    expect(insert).not.toHaveBeenCalled();
  });

  it("requires full-admin access before purchase-order status writes", async () => {
    const { ctx, patch } = createPurchaseOrderMutationCtx();

    await expect(
      updatePurchaseOrderStatusWithCtx(ctx, {
        nextStatus: "submitted",
        purchaseOrderId: "purchase-order-1" as Id<"purchaseOrder">,
      }),
    ).rejects.toThrow("Authentication required.");
    expect(patch).not.toHaveBeenCalled();
  });

  it("syncs terminal purchase-order cancellation to the linked operations work item", async () => {
    mockedAuthServer.getAuthUserId.mockResolvedValue("auth-user-1");

    const purchaseOrder = {
      currency: "GHS",
      _id: "purchase-order-1",
      operationalWorkItemId: "work-item-1",
      organizationId: "org-1",
      poNumber: "PO-001",
      status: "ordered",
      storeId: "store-1",
    };
    const insert = vi.fn(async () => "operational-event-1");
    const patch = vi.fn(async (_table: string, _id: string, updates: object) => {
      Object.assign(purchaseOrder, updates);
    });
    const runMutation = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(async (table: string, id: string) => {
          if (table === "users" && id === "auth-user-1") {
            return { _id: "auth-user-1", email: "admin@example.com" };
          }
          if (table === "store" && id === "store-1") {
            return { _id: "store-1", organizationId: "org-1" };
          }
          if (table === "purchaseOrder" && id === "purchase-order-1") {
            return purchaseOrder;
          }
          return null;
        }),
        insert,
        patch,
        query: vi.fn((table: string) => ({
          filter: vi.fn(() => ({
            first: vi.fn(async () => {
              if (table === "athenaUser") {
                return { _id: "athena-user-1", email: "admin@example.com" };
              }
              if (table === "organizationMember") {
                return {
                  _id: "member-1",
                  organizationId: "org-1",
                  role: "full_admin",
                  userId: "athena-user-1",
                };
              }
              return null;
            }),
          })),
          withIndex: vi.fn(() => ({
            collect: vi.fn(async () => []),
            first: vi.fn(async () => null),
            take: vi.fn(async () =>
              table === "purchaseOrderLineItem"
                ? [
                    {
                      _id: "line-1",
                      orderedQuantity: 5,
                      productSkuId: "sku-1",
                      purchaseOrderId: "purchase-order-1",
                      receivedQuantity: 2,
                      unitCost: 100,
                    },
                  ]
                : [],
            ),
          })),
        })),
      },
      runMutation,
      scheduler: { runAfter: vi.fn().mockResolvedValue(undefined) },
    } as unknown as MutationCtx;

    const result = await updatePurchaseOrderStatusWithCtx(ctx, {
      nextStatus: "cancelled",
      purchaseOrderId: "purchase-order-1" as Id<"purchaseOrder">,
    });

    expect(result).toMatchObject({
      _id: "purchase-order-1",
      status: "cancelled",
    });
    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      status: "cancelled",
      workItemId: "work-item-1",
    });
    // PO-line commitment release no longer emits anything into the reports
    // ledger — `shared/reportsContract.ts` has no "commitment" factKind, so
    // the status transition writes only the purchase order patch and the
    // linked work-item/operational-event trail asserted above.
    expect(insert).not.toHaveBeenCalledWith(
      "reportFact",
      expect.anything(),
    );
  });

  it("maps expected purchase-order creation failures to command-result user errors", () => {
    expect(
      mapPurchaseOrderCommandError(
        new Error("Purchase orders require at least one line item."),
      ),
    ).toEqual({
      kind: "user_error",
      error: {
        code: "validation_failed",
        message: "Purchase orders require at least one line item.",
      },
    });

    expect(
      mapPurchaseOrderCommandError(
        new Error("Purchase-order quantities must be greater than zero."),
      ),
    ).toEqual({
      kind: "user_error",
      error: {
        code: "validation_failed",
        message: "Purchase-order quantities must be greater than zero.",
      },
    });

    expect(
      mapPurchaseOrderCommandError(
        new Error("Purchase-order unit cost cannot be negative."),
      ),
    ).toEqual({
      kind: "user_error",
      error: {
        code: "validation_failed",
        message: "Purchase-order unit cost cannot be negative.",
      },
    });

    expect(mapPurchaseOrderCommandError(new Error("Store not found."))).toEqual(
      {
        kind: "user_error",
        error: {
          code: "not_found",
          message: "Store not found.",
        },
      },
    );

    expect(
      mapPurchaseOrderCommandError(
        new Error("Vendor not found for this store."),
      ),
    ).toEqual({
      kind: "user_error",
      error: {
        code: "not_found",
        message: "Vendor not found for this store.",
      },
    });

    expect(
      mapPurchaseOrderCommandError(
        new Error("Selected SKU at line 2 could not be found for this store."),
      ),
    ).toEqual({
      kind: "user_error",
      error: {
        code: "not_found",
        message: "Selected SKU at line 2 could not be found for this store.",
      },
    });
  });

  it("maps expected purchase-order status failures to command-result user errors", () => {
    expect(
      mapPurchaseOrderCommandError(new Error("Purchase order not found.")),
    ).toEqual({
      kind: "user_error",
      error: {
        code: "not_found",
        message: "Purchase order not found.",
      },
    });

    expect(
      mapPurchaseOrderCommandError(
        new Error("Cannot change purchase order from draft to received."),
      ),
    ).toEqual({
      kind: "user_error",
      error: {
        code: "validation_failed",
        message: "Cannot change purchase order from draft to received.",
      },
    });

    expect(
      mapPurchaseOrderCommandError(
        new Error("Cannot change purchase order from cancelled to submitted."),
      ),
    ).toEqual({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message: "Cannot change purchase order from cancelled to submitted.",
      },
    });

    expect(
      mapPurchaseOrderCommandError(
        new Error("Cannot change purchase order from received to ordered."),
      ),
    ).toEqual({
      kind: "user_error",
      error: {
        code: "precondition_failed",
        message: "Cannot change purchase order from received to ordered.",
      },
    });
  });

  // Admission rail: the exported ingress now resolves an actor BEFORE the
  // handler body runs. `procurement.manage` is not demo-granted, so the
  // definitions deny shared demo; an anonymous caller never reaches the
  // handler at all.
  it("denies unauthenticated callers at the ingress, before any write", async () => {
    const { ctx, insert, patch } = createPurchaseOrderMutationCtx();

    await expect(
      getHandler(createPurchaseOrder)(ctx, {
        lineItems: [
          {
            orderedQuantity: 2,
            productSkuId: "sku-1" as Id<"productSku">,
            unitCost: 1500,
          },
        ],
        storeId: "store-1" as Id<"store">,
        vendorId: "vendor-1" as Id<"vendor">,
      }),
    ).rejects.toThrow("Sign in again to continue.");

    await expect(
      getHandler(createPurchaseOrderCommand)(ctx, {
        lineItems: [
          {
            orderedQuantity: 2,
            productSkuId: "sku-1" as Id<"productSku">,
            unitCost: 1500,
          },
        ],
        storeId: "store-1" as Id<"store">,
        vendorId: "vendor-1" as Id<"vendor">,
      }),
    ).rejects.toThrow("Sign in again to continue.");

    await expect(
      getHandler(updatePurchaseOrderStatus)(ctx, {
        nextStatus: "submitted",
        purchaseOrderId: "purchase-order-1" as Id<"purchaseOrder">,
      }),
    ).rejects.toThrow("Sign in again to continue.");

    await expect(
      getHandler(updatePurchaseOrderStatusCommand)(ctx, {
        nextStatus: "submitted",
        purchaseOrderId: "purchase-order-1" as Id<"purchaseOrder">,
      }),
    ).rejects.toThrow("Sign in again to continue.");

    await expect(
      getHandler(advancePurchaseOrderToOrderedCommand)(ctx, {
        purchaseOrderId: "purchase-order-1" as Id<"purchaseOrder">,
      }),
    ).rejects.toThrow("Sign in again to continue.");

    expect(insert).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });

  it("denies unauthenticated purchase-order reads at the ingress", async () => {
    const { ctx } = createPurchaseOrderMutationCtx();

    await expect(
      getHandler(listPurchaseOrders)(ctx, {
        storeId: "store-1" as Id<"store">,
      }),
    ).rejects.toThrow("Sign in again to continue.");

    await expect(
      getHandler(getPurchaseOrder)(ctx, {
        purchaseOrderId: "purchase-order-1" as Id<"purchaseOrder">,
      }),
    ).rejects.toThrow("Sign in again to continue.");
  });
});
