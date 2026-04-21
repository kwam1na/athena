import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  buildOnlineOrderReturnExchangePlan,
  type ReturnExchangeReplacementInput,
} from "./helpers/returnExchangeOperations";

function getSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function createOrderItem(overrides: Record<string, unknown> = {}) {
  return {
    _id: "item-1",
    isReady: true,
    isRefunded: false,
    isRestocked: false,
    orderId: "order-1",
    price: 45,
    productId: "product-1",
    productName: "Curly Closure",
    productSku: "SKU-RETURN-1",
    productSkuId: "sku-1",
    quantity: 2,
    storeFrontUserId: "guest-1",
    ...overrides,
  } as any;
}

function createReplacement(
  overrides: Partial<ReturnExchangeReplacementInput> = {},
): ReturnExchangeReplacementInput {
  return {
    productId: "product-2" as any,
    productName: "Body Wave Closure",
    productSkuId: "sku-2" as any,
    quantity: 1,
    quantityAvailable: 4,
    inventoryCount: 4,
    skuLabel: "SKU-EXCHANGE-2",
    unitPrice: 110_00,
    ...overrides,
  };
}

describe("online order return and exchange planning", () => {
  it("plans a partial return with a refund, safe restock, and operational events", () => {
    const plan = buildOnlineOrderReturnExchangePlan({
      order: {
        _id: "order-1",
        amount: 18_000,
        deliveryMethod: "pickup",
        orderNumber: "10001",
        status: "picked-up",
      } as any,
      orderItems: [
        createOrderItem(),
        createOrderItem({
          _id: "item-2",
          price: 60,
          productId: "product-3",
          productName: "Frontal Unit",
          productSku: "SKU-RETURN-2",
          productSkuId: "sku-3",
          quantity: 1,
        }),
      ],
      restockReturnedItems: true,
      returnItemIds: ["item-1" as any],
    });

    expect(plan).toMatchObject({
      approvalReason: null,
      balanceDueAmount: 0,
      kind: "partial_return",
      paymentAllocation: {
        allocationType: "online_order_return_refund",
        amount: 9_000,
        direction: "out",
      },
      refundAmount: 9_000,
      requiresApproval: false,
    });
    expect(plan.eventType).toBe("online_order_return_processed");
    expect(plan.returnMovements).toEqual([
      expect.objectContaining({
        orderItemId: "item-1",
        quantityDelta: 2,
        reasonCode: "online_order_return_restocked",
      }),
    ]);
  });

  it("treats returning every remaining line as a full return and sums the total refund correctly", () => {
    const plan = buildOnlineOrderReturnExchangePlan({
      order: {
        _id: "order-1",
        amount: 15_000,
        orderNumber: "10002",
        status: "delivered",
      } as any,
      orderItems: [
        createOrderItem({
          _id: "item-1",
          price: 45,
          quantity: 2,
        }),
        createOrderItem({
          _id: "item-2",
          price: 60,
          productId: "product-3",
          productName: "Frontal Unit",
          productSku: "SKU-RETURN-2",
          productSkuId: "sku-3",
          quantity: 1,
        }),
      ],
      restockReturnedItems: true,
      returnItemIds: ["item-1" as any, "item-2" as any],
    });

    expect(plan.kind).toBe("full_return");
    expect(plan.refundAmount).toBe(15_000);
    expect(plan.selectedItems).toHaveLength(2);
  });

  it("plans an exchange to a new item and only collects the price delta", () => {
    const plan = buildOnlineOrderReturnExchangePlan({
      order: {
        _id: "order-1",
        amount: 9_000,
        orderNumber: "10003",
        status: "picked-up",
      } as any,
      orderItems: [createOrderItem()],
      replacementItems: [createReplacement()],
      restockReturnedItems: true,
      returnItemIds: ["item-1" as any],
    });

    expect(plan).toMatchObject({
      balanceDueAmount: 2_000,
      kind: "exchange",
      paymentAllocation: {
        allocationType: "online_order_exchange_balance_collection",
        amount: 2_000,
        direction: "in",
      },
      refundAmount: 0,
      requiresApproval: false,
    });
    expect(plan.eventType).toBe("online_order_exchange_processed");
    expect(plan.exchangeMovements).toEqual([
      expect.objectContaining({
        productSkuId: "sku-2",
        quantityDelta: -1,
        reasonCode: "online_order_exchange_issued",
      }),
    ]);
  });

  it("requires approval when the return path is not safe to self-resolve", () => {
    const plan = buildOnlineOrderReturnExchangePlan({
      order: {
        _id: "order-1",
        amount: 9_000,
        orderNumber: "10004",
        status: "open",
      } as any,
      orderItems: [
        createOrderItem({
          _id: "item-unsafe",
          isReady: false,
        }),
      ],
      restockReturnedItems: true,
      returnItemIds: ["item-unsafe" as any],
    });

    expect(plan.requiresApproval).toBe(true);
    expect(plan.approvalReason).toMatch(/inspection|approval/i);
    expect(plan.paymentAllocation).toBeNull();
    expect(plan.returnMovements).toEqual([]);
  });
});

describe("online order return and exchange mutation wiring", () => {
  it("routes storefront returns and exchanges through shared operational rails", () => {
    const onlineOrderSource = getSource("./onlineOrder.ts");

    expect(onlineOrderSource).toContain(
      "export const processReturnExchange = mutation({",
    );
    expect(onlineOrderSource).toContain("buildOnlineOrderReturnExchangePlan");
    expect(onlineOrderSource).toContain("recordPaymentAllocationWithCtx");
    expect(onlineOrderSource).toContain("recordInventoryMovementWithCtx");
    expect(onlineOrderSource).toContain("recordOperationalEventWithCtx");
    expect(onlineOrderSource).toContain("buildApprovalRequest");
  });
});
