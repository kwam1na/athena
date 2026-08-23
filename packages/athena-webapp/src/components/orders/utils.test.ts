import { describe, expect, it } from "vitest";

import { getDiscountValue as sharedGetDiscountValue } from "~/shared/orderMath";

import {
  getAmountPaidForOrder,
  getDiscountValue,
  getOnlineOrderPlacedAt,
  getOrderState,
  getPickupActionState,
  shouldShowPickupExceptionAction,
} from "./utils";

describe("getOnlineOrderPlacedAt", () => {
  it("prefers an explicit placed timestamp and falls back to Convex creation time", () => {
    expect(getOnlineOrderPlacedAt({ _creationTime: 10, placedAt: 20 })).toBe(
      20,
    );
    expect(getOnlineOrderPlacedAt({ _creationTime: 10 })).toBe(10);
  });
});

describe("getOrderState", () => {
  it("treats pickup exceptions as transitioned but not completed orders", () => {
    expect(
      getOrderState({
        amount: 12000,
        refunds: [],
        status: "pickup-exception",
      }),
    ).toMatchObject({
      hasOrderTransitioned: true,
      isOrderCompleted: false,
      isPickupException: true,
    });
  });
});

describe("getPickupActionState", () => {
  it("asks staff to collect payment before completing payment-on-pickup orders", () => {
    expect(
      getPickupActionState({
        deliveryMethod: "pickup",
        isPODOrder: true,
        paymentCollected: false,
        refunds: [],
        status: "ready-for-pickup",
      }),
    ).toMatchObject({
      canMarkPickupException: true,
      canResolvePickupException: false,
      needsPickupPaymentCollection: true,
    });
  });

  it("lets staff resolve pickup exceptions back to ready-for-pickup", () => {
    expect(
      getPickupActionState({
        deliveryMethod: "pickup",
        paymentCollected: false,
        refunds: [],
        status: "pickup-exception",
      }),
    ).toMatchObject({
      canMarkPickupException: false,
      canResolvePickupException: true,
      needsPickupPaymentCollection: false,
    });
  });
});

describe("shouldShowPickupExceptionAction", () => {
  it("hides pickup exceptions in the shared demo", () => {
    expect(
      shouldShowPickupExceptionAction({
        canMarkPickupException: true,
        isSharedDemo: true,
      }),
    ).toBe(false);
  });

  it("keeps pickup exceptions available outside the shared demo", () => {
    expect(
      shouldShowPickupExceptionAction({
        canMarkPickupException: true,
        isSharedDemo: false,
      }),
    ).toBe(true);
  });
});

describe("getDiscountValue", () => {
  const items = [{ price: 150000, productSkuId: "sku_1", quantity: 1 }];

  it("returns a fixed discount in the pesewas it was stored in", () => {
    // An operator entering GH₵20 persists 2,000 pesewas.
    expect(
      getDiscountValue({
        discount: {
          code: "FLAT20",
          span: "entire-order",
          type: "amount",
          value: 2000,
        },
        items,
      }),
    ).toBe(2000);
  });

  it("agrees with the shared order math authority the other surfaces render", () => {
    const discount = {
      code: "FLAT20",
      productSkus: ["sku_1"],
      span: "selected-products" as const,
      type: "amount" as const,
      value: 2000,
    };

    expect(getDiscountValue({ discount, items })).toBe(
      sharedGetDiscountValue(items, discount),
    );
  });

  it("keeps percentage discounts as a share of the pesewas subtotal", () => {
    expect(
      getDiscountValue({
        discount: {
          code: "SAVE10",
          span: "entire-order",
          type: "percentage",
          value: 10,
        },
        items,
      }),
    ).toBe(15000);
  });

  it("never discounts a select-items order past its eligible subtotal", () => {
    expect(
      getDiscountValue({
        discount: {
          code: "FLATMAX",
          productSkus: ["sku_1"],
          span: "selected-products",
          type: "amount",
          value: 200000,
        },
        items,
      }),
    ).toBe(150000);
  });
});

describe("getAmountPaidForOrder", () => {
  it("subtracts the stored fixed discount from the pesewas order total", () => {
    expect(
      getAmountPaidForOrder({
        amount: 150000,
        deliveryFee: 3500,
        discount: {
          code: "FLAT20",
          span: "entire-order",
          type: "amount",
          value: 2000,
        },
        items: [{ price: 150000, productSkuId: "sku_1", quantity: 1 }],
      }),
    ).toBe(151500);
  });
});
