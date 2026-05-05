import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

const mockedAuthServer = vi.hoisted(() => ({
  getAuthUserId: vi.fn(),
}));

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: mockedAuthServer.getAuthUserId,
}));

import {
  assertValidPurchaseOrderStatusTransition,
  calculatePurchaseOrderTotals,
  createPurchaseOrderWithCtx,
  mapPurchaseOrderCommandError,
  updatePurchaseOrderStatusWithCtx,
} from "./purchaseOrders";

function getSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
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
    expect(source).toContain("commandResultValidator(v.any())");
    expect(source).toContain(
      "return ok(await createPurchaseOrderWithCtx(ctx, args));",
    );
    expect(source).toContain(
      "return ok(await updatePurchaseOrderStatusWithCtx(ctx, args));",
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
});
