import { describe, expect, it } from "vitest";

import {
  getOnlineOrderPlacedAt,
  getOrderState,
  getPickupActionState,
  shouldShowPickupExceptionAction,
} from "./utils";

describe("getOnlineOrderPlacedAt", () => {
  it("prefers an explicit placed timestamp and falls back to Convex creation time", () => {
    expect(getOnlineOrderPlacedAt({ _creationTime: 10, placedAt: 20 })).toBe(20);
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
