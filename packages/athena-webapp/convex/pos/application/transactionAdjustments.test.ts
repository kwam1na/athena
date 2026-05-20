import { describe, expect, it, vi } from "vitest";

import type { Id } from "../../_generated/dataModel";
import {
  createTransactionAdjustmentForTransaction,
  getActiveTransactionAdjustment,
  listTransactionAdjustmentLines,
  listTransactionAdjustments,
} from "../infrastructure/repositories/transactionRepository";

function queryWithCollect(results: unknown[]) {
  return {
    withIndex: vi.fn(() => ({
      order: vi.fn(() => ({
        collect: vi.fn().mockResolvedValue(results),
      })),
      collect: vi.fn().mockResolvedValue(results),
    })),
  };
}

function queryWithFirst(result: unknown) {
  return {
    withIndex: vi.fn(() => ({
      first: vi.fn().mockResolvedValue(result),
    })),
  };
}

describe("transaction adjustment repository helpers", () => {
  it("lists transaction-scoped adjustments newest first without reading transaction items", async () => {
    const adjustments = [
      {
        _id: "adjustment-2",
        createdAt: 200,
        transactionId: "txn-1" as Id<"posTransaction">,
      },
      {
        _id: "adjustment-1",
        createdAt: 100,
        transactionId: "txn-1" as Id<"posTransaction">,
      },
    ];
    const ctx = {
      db: {
        query: vi.fn(() => queryWithCollect(adjustments)),
      },
    };

    await expect(
      listTransactionAdjustments(ctx as never, "txn-1" as Id<"posTransaction">),
    ).resolves.toEqual(adjustments);

    expect(ctx.db.query).toHaveBeenCalledWith("posTransactionAdjustment");
  });

  it("loads lines for a submitted adjustment", async () => {
    const lines = [
      {
        _id: "adjustment-line-1",
        adjustmentId: "adjustment-1",
      },
    ];
    const ctx = {
      db: {
        query: vi.fn(() => queryWithCollect(lines)),
      },
    };

    await expect(
      listTransactionAdjustmentLines(
        ctx as never,
        "adjustment-1",
      ),
    ).resolves.toEqual(lines);

    expect(ctx.db.query).toHaveBeenCalledWith("posTransactionAdjustmentLine");
  });

  it("finds the one active pending adjustment for a transaction", async () => {
    const activeAdjustment = {
      _id: "adjustment-1",
      status: "pending_approval",
      storeId: "store-1" as Id<"store">,
      transactionId: "txn-1" as Id<"posTransaction">,
    };
    const ctx = {
      db: {
        query: vi.fn(() => queryWithFirst(activeAdjustment)),
      },
    };

    await expect(
      getActiveTransactionAdjustment(ctx as never, {
        storeId: "store-1" as Id<"store">,
        transactionId: "txn-1" as Id<"posTransaction">,
      }),
    ).resolves.toEqual(activeAdjustment);

    expect(ctx.db.query).toHaveBeenCalledWith("posTransactionAdjustment");
  });

  it("creates an adjustment and lines without patching original transaction facts", async () => {
    const get = vi.fn().mockResolvedValue({
      _id: "txn-1" as Id<"posTransaction">,
      storeId: "store-1" as Id<"store">,
      status: "completed",
    });
    const insert = vi
      .fn()
      .mockResolvedValueOnce("adjustment-1")
      .mockResolvedValueOnce("adjustment-line-1");
    const patch = vi.fn();
    const ctx = {
      db: {
        get,
        insert,
        patch,
      },
    };

    await expect(
      createTransactionAdjustmentForTransaction(ctx as never, {
        adjustment: {
          correctedSubtotal: 150,
          correctedTax: 0,
          correctedTotal: 150,
          createdAt: 10,
          deltaTotal: -50,
          originalSubtotal: 200,
          originalTax: 0,
          originalTotal: 200,
          payloadFingerprint: "pos-adjustment:123",
          payloadSubject: "pos_transaction_item_adjustment:txn-1:pos-adjustment:123",
          registerSessionId: "register-1" as Id<"registerSession">,
          requestedByStaffProfileId: "staff-1" as Id<"staffProfile">,
          settlementAmount: 50,
          settlementDirection: "refund",
          status: "pending_approval",
          storeId: "store-1" as Id<"store">,
          transactionId: "txn-1" as Id<"posTransaction">,
          updatedAt: 10,
        },
        lines: [
          {
            correctedQuantity: 1,
            correctedTotal: 50,
            createdAt: 10,
            inventoryDelta: 1,
            lineType: "existing",
            originalQuantity: 2,
            originalTotal: 100,
            originalTransactionItemId: "item-1" as Id<"posTransactionItem">,
            productId: "product-a" as Id<"product">,
            productName: "Silk wig",
            productSku: "SKU-A",
            productSkuId: "sku-a" as Id<"productSku">,
            quantityDelta: -1,
            storeId: "store-1" as Id<"store">,
            transactionId: "txn-1" as Id<"posTransaction">,
            unitPrice: 50,
          },
        ],
        storeId: "store-1" as Id<"store">,
        transactionId: "txn-1" as Id<"posTransaction">,
      }),
    ).resolves.toEqual({
      adjustmentId: "adjustment-1",
      lineIds: ["adjustment-line-1"],
    });

    expect(insert).toHaveBeenNthCalledWith(
      1,
      "posTransactionAdjustment",
      expect.objectContaining({
        transactionId: "txn-1",
        originalTotal: 200,
        correctedTotal: 150,
      }),
    );
    expect(insert).toHaveBeenNthCalledWith(
      2,
      "posTransactionAdjustmentLine",
      expect.objectContaining({
        adjustmentId: "adjustment-1",
        originalTransactionItemId: "item-1",
      }),
    );
    expect(patch).not.toHaveBeenCalled();
  });

  it("rejects adjustment creation for a missing transaction", async () => {
    const ctx = {
      db: {
        get: vi.fn().mockResolvedValue(null),
        insert: vi.fn(),
      },
    };

    await expect(
      createTransactionAdjustmentForTransaction(ctx as never, {
        adjustment: {} as never,
        lines: [],
        storeId: "store-1" as Id<"store">,
        transactionId: "txn-missing" as Id<"posTransaction">,
      }),
    ).rejects.toThrow("POS transaction not found.");

    expect(ctx.db.insert).not.toHaveBeenCalled();
  });
});
