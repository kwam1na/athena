import { describe, expect, it } from "vitest";

import type { Id } from "../../_generated/dataModel";
import { isUserErrorResult } from "../../../shared/commandResult";
import {
  planTransactionAdjustment,
  type TransactionAdjustmentPlannerInput,
} from "./commands/transactionAdjustmentPlanner";

const storeId = "store-1" as Id<"store">;
const otherStoreId = "store-2" as Id<"store">;

function baseInput(): TransactionAdjustmentPlannerInput {
  return {
    transaction: {
      _id: "txn-1" as Id<"posTransaction">,
      registerSessionId: "register-1" as Id<"registerSession">,
      staffProfileId: "staff-1" as Id<"staffProfile">,
      status: "completed",
      storeId,
      subtotal: 200,
      tax: 0,
      total: 200,
      transactionNumber: "POS-001",
    },
    originalItems: [
      {
        _id: "item-1" as Id<"posTransactionItem">,
        productId: "product-a" as Id<"product">,
        productName: "Silk wig",
        productSku: "SKU-A",
        productSkuId: "sku-a" as Id<"productSku">,
        quantity: 2,
        totalPrice: 100,
        transactionId: "txn-1" as Id<"posTransaction">,
        unitPrice: 50,
      },
      {
        _id: "item-2" as Id<"posTransactionItem">,
        productId: "product-b" as Id<"product">,
        productName: "Care kit",
        productSku: "SKU-B",
        productSkuId: "sku-b" as Id<"productSku">,
        quantity: 1,
        totalPrice: 100,
        transactionId: "txn-1" as Id<"posTransaction">,
        unitPrice: 100,
      },
    ],
    skuSnapshots: [
      {
        _id: "sku-c" as Id<"productSku">,
        productAvailability: "live",
        productId: "product-c" as Id<"product">,
        productName: "Travel brush",
        quantityAvailable: 5,
        sku: "SKU-C",
        storeId,
        price: 80,
      },
      {
        _id: "sku-d" as Id<"productSku">,
        productAvailability: "live",
        productId: "product-d" as Id<"product">,
        productName: "Edge scarf",
        quantityAvailable: 3,
        sku: "SKU-D",
        storeId,
        price: 100,
      },
    ],
    draft: {
      addedLines: [],
      existingLines: [],
    },
  };
}

describe("planTransactionAdjustment", () => {
  it("removing quantity lowers the corrected total, refunds the delta, and restocks inventory", () => {
    const result = planTransactionAdjustment({
      ...baseInput(),
      draft: {
        existingLines: [
          {
            transactionItemId: "item-1" as Id<"posTransactionItem">,
            correctedQuantity: 1,
          },
        ],
      },
    });

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        originalTotals: { subtotal: 200, tax: 0, total: 200 },
        correctedTotals: { subtotal: 150, tax: 0, total: 150 },
        deltaTotal: -50,
        settlement: { direction: "refund", amount: 50 },
        inventoryDeltas: [
          {
            productSkuId: "sku-a",
            quantityDelta: 1,
            reasonCode: "pos_transaction_adjustment_restock",
          },
        ],
      },
    });
  });

  it("adding a missed SKU raises the corrected total, collects the delta, and issues inventory", () => {
    const result = planTransactionAdjustment({
      ...baseInput(),
      draft: {
        addedLines: [
          {
            productSkuId: "sku-c" as Id<"productSku">,
            quantity: 2,
          },
        ],
      },
    });

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        correctedTotals: { subtotal: 360, tax: 0, total: 360 },
        deltaTotal: 160,
        settlement: { direction: "collect", amount: 160 },
      },
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.data.correctedLines).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            lineType: "added",
            productSkuId: "sku-c",
            correctedQuantity: 2,
            unitPrice: 80,
          }),
        ]),
      );
      expect(result.data.inventoryDeltas).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            productSkuId: "sku-c",
            quantityDelta: -2,
            reasonCode: "pos_transaction_adjustment_issue",
          }),
        ]),
      );
    }
  });

  it("swapping SKUs returns restock and issue deltas plus the net settlement", () => {
    const result = planTransactionAdjustment({
      ...baseInput(),
      draft: {
        existingLines: [
          {
            transactionItemId: "item-2" as Id<"posTransactionItem">,
            correctedQuantity: 0,
          },
        ],
        addedLines: [
          {
            productSkuId: "sku-c" as Id<"productSku">,
            quantity: 1,
          },
        ],
      },
    });

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        correctedTotals: { subtotal: 180, tax: 0, total: 180 },
        settlement: { direction: "refund", amount: 20 },
        inventoryDeltas: [
          expect.objectContaining({ productSkuId: "sku-b", quantityDelta: 1 }),
          expect.objectContaining({ productSkuId: "sku-c", quantityDelta: -1 }),
        ],
      },
    });
  });

  it("returns no settlement when quantity changes net to the original total", () => {
    const result = planTransactionAdjustment({
      ...baseInput(),
      draft: {
        existingLines: [
          {
            transactionItemId: "item-1" as Id<"posTransactionItem">,
            correctedQuantity: 0,
          },
          {
            transactionItemId: "item-2" as Id<"posTransactionItem">,
            correctedQuantity: 2,
          },
        ],
      },
    });

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        correctedTotals: { subtotal: 200, tax: 0, total: 200 },
        deltaTotal: 0,
        settlement: { direction: "none", amount: 0 },
      },
    });
  });

  it("preserves the original transaction tax when recomputing corrected totals", () => {
    const input = baseInput();
    const result = planTransactionAdjustment({
      ...input,
      transaction: {
        ...input.transaction,
        subtotal: 200,
        tax: 20,
        total: 220,
      },
      draft: {
        existingLines: [
          {
            transactionItemId: "item-1" as Id<"posTransactionItem">,
            correctedQuantity: 1,
          },
        ],
      },
    });

    expect(result).toMatchObject({
      kind: "ok",
      data: {
        originalTotals: { subtotal: 200, tax: 20, total: 220 },
        correctedTotals: { subtotal: 150, tax: 20, total: 170 },
        deltaTotal: -50,
        settlement: { direction: "refund", amount: 50 },
      },
    });
  });

  it.each([
    ["negative existing quantity", { existingLines: [{ transactionItemId: "item-1", correctedQuantity: -1 }] }],
    ["fractional existing quantity", { existingLines: [{ transactionItemId: "item-1", correctedQuantity: 1.5 }] }],
    ["non-finite existing quantity", { existingLines: [{ transactionItemId: "item-1", correctedQuantity: Number.NaN }] }],
    ["zero added quantity", { addedLines: [{ productSkuId: "sku-c", quantity: 0 }] }],
  ])("rejects malformed quantities: %s", (_name, draft) => {
    const result = planTransactionAdjustment({
      ...baseInput(),
      draft: draft as TransactionAdjustmentPlannerInput["draft"],
    });

    expect(isUserErrorResult(result)).toBe(true);
    if (isUserErrorResult(result)) {
      expect(result.error.code).toBe("validation_failed");
      expect(result.error.message).toContain("whole-number quantities");
    }
  });

  it.each([
    ["manual price", { existingLines: [{ transactionItemId: "item-1", correctedQuantity: 1, unitPrice: 75 }] }],
    ["manual discount", { existingLines: [{ transactionItemId: "item-1", correctedQuantity: 1, discount: 5 }] }],
    ["manual line total", { addedLines: [{ productSkuId: "sku-c", quantity: 1, totalPrice: 10 }] }],
    ["manual tax", { manualTax: 10 }],
    ["manual total", { manualTotal: 10 }],
    ["cashier edit", { cashierStaffProfileId: "staff-2" }],
  ])("rejects unsupported adjustment payload fields: %s", (_name, draft) => {
    const result = planTransactionAdjustment({
      ...baseInput(),
      draft: draft as TransactionAdjustmentPlannerInput["draft"],
    });

    expect(isUserErrorResult(result)).toBe(true);
    if (isUserErrorResult(result)) {
      expect(result.error.code).toBe("precondition_failed");
      expect(result.error.metadata).toMatchObject({
        unsupportedFieldsPresent: true,
      });
    }
  });

  it.each([
    ["missing SKU", []],
    [
      "cross-store SKU",
      [
        {
          _id: "sku-c",
          productAvailability: "live",
          productId: "product-c",
          productName: "Travel brush",
          quantityAvailable: 5,
          sku: "SKU-C",
          storeId: otherStoreId,
          price: 80,
        },
      ],
    ],
    [
      "inactive SKU",
      [
        {
          _id: "sku-c",
          productAvailability: "draft",
          productId: "product-c",
          productName: "Travel brush",
          quantityAvailable: 5,
          sku: "SKU-C",
          storeId,
          price: 80,
        },
      ],
    ],
  ])("rejects %s additions", (_name, skuSnapshots) => {
    const result = planTransactionAdjustment({
      ...baseInput(),
      skuSnapshots: skuSnapshots as TransactionAdjustmentPlannerInput["skuSnapshots"],
      draft: {
        addedLines: [
          {
            productSkuId: "sku-c" as Id<"productSku">,
            quantity: 1,
          },
        ],
      },
    });

    expect(isUserErrorResult(result)).toBe(true);
    if (isUserErrorResult(result)) {
      expect(["not_found", "precondition_failed"]).toContain(result.error.code);
    }
  });

  it("rejects additions that exceed available inventory", () => {
    const input = baseInput();
    const result = planTransactionAdjustment({
      ...input,
      skuSnapshots: input.skuSnapshots.map((sku) =>
        sku._id === "sku-c" ? { ...sku, quantityAvailable: 1 } : sku,
      ),
      draft: {
        addedLines: [
          {
            productSkuId: "sku-c" as Id<"productSku">,
            quantity: 2,
          },
        ],
      },
    });

    expect(isUserErrorResult(result)).toBe(true);
    if (isUserErrorResult(result)) {
      expect(result.error).toMatchObject({
        code: "conflict",
        metadata: { available: 1, requested: 2 },
      });
    }
  });

  it("rejects a new plan while an active adjustment already exists", () => {
    const result = planTransactionAdjustment({
      ...baseInput(),
      activeAdjustment: {
        _id: "adjustment-1",
        status: "pending_approval",
      },
      draft: {
        existingLines: [
          {
            transactionItemId: "item-1" as Id<"posTransactionItem">,
            correctedQuantity: 1,
          },
        ],
      },
    });

    expect(isUserErrorResult(result)).toBe(true);
    if (isUserErrorResult(result)) {
      expect(result.error).toMatchObject({
        code: "conflict",
        metadata: {
          activeAdjustmentId: "adjustment-1",
        },
      });
    }
  });

  it("returns a stable approval fingerprint and payload subject for equivalent payloads", () => {
    const first = planTransactionAdjustment({
      ...baseInput(),
      draft: {
        addedLines: [{ productSkuId: "sku-c" as Id<"productSku">, quantity: 1 }],
        existingLines: [
          {
            transactionItemId: "item-1" as Id<"posTransactionItem">,
            correctedQuantity: 1,
          },
        ],
      },
    });
    const second = planTransactionAdjustment({
      ...baseInput(),
      draft: {
        existingLines: [
          {
            correctedQuantity: 1,
            transactionItemId: "item-1" as Id<"posTransactionItem">,
          },
        ],
        addedLines: [{ quantity: 1, productSkuId: "sku-c" as Id<"productSku"> }],
      },
    });

    expect(first.kind).toBe("ok");
    expect(second.kind).toBe("ok");
    if (first.kind === "ok" && second.kind === "ok") {
      expect(first.data.payloadFingerprint).toEqual(second.data.payloadFingerprint);
      expect(first.data.payloadSubject).toEqual(second.data.payloadSubject);
      expect(first.data.payloadSubject).toContain(first.data.payloadFingerprint);
    }
  });

});
