import { describe, expect, it } from "vitest";

import { getOrderState, getPickupActionState } from "./utils";

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
