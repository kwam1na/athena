import { describe, expect, it } from "vitest";

import {
  getRemainingRefundableBalance,
  resolveServerDeliveryFee,
  resolveRefundAmount,
} from "./helpers/paymentHelpers";

describe("storefront refund money contract", () => {
  it("computes the remaining refundable balance in minor units", () => {
    expect(
      getRemainingRefundableBalance({
        amount: 10_000,
        deliveryFee: 2_000,
        refunds: [{ amount: 3_500 }],
      }),
    ).toBe(8_500);

    expect(
      getRemainingRefundableBalance({
        amount: 10_000,
        deliveryFee: 2_000,
        paymentDue: 9_000,
        refunds: [{ amount: 3_500 }],
      }),
    ).toBe(5_500);
  });

  it("requires optional refund amounts to be positive integer minor units and within the cap", () => {
    expect(
      resolveRefundAmount({
        remainingRefundableBalance: 5_500,
        requestedAmount: undefined,
      }),
    ).toBe(5_500);

    expect(
      resolveRefundAmount({
        remainingRefundableBalance: 5_500,
        requestedAmount: 2_500,
      }),
    ).toBe(2_500);

    expect(() =>
      resolveRefundAmount({
        remainingRefundableBalance: 5_500,
        requestedAmount: 25.5,
      }),
    ).toThrow(/integer minor-unit/);

    expect(() =>
      resolveRefundAmount({
        remainingRefundableBalance: 5_500,
        requestedAmount: 5_501,
      }),
    ).toThrow(/remaining refundable balance/);
  });
});

describe("storefront delivery fee money contract", () => {
  const storeConfig = {
    commerce: {
      deliveryFees: {
        withinAccra: 1_000,
        otherRegions: 2_500,
        international: 12_000,
      },
    },
  };

  it("derives delivery fees from server-inspected delivery details", () => {
    expect(
      resolveServerDeliveryFee({
        deliveryDetails: { country: "GH", region: "GA" },
        deliveryMethod: "delivery",
        deliveryOption: "within-accra",
        storeConfig,
        subtotal: 10_000,
      }),
    ).toBe(1_000);

    expect(
      resolveServerDeliveryFee({
        deliveryDetails: { country: "GH", region: "AA" },
        deliveryMethod: "delivery",
        deliveryOption: "outside-accra",
        storeConfig,
        subtotal: 10_000,
      }),
    ).toBe(2_500);

    expect(
      resolveServerDeliveryFee({
        deliveryDetails: { country: "US" },
        deliveryMethod: "delivery",
        deliveryOption: "intl",
        storeConfig,
        subtotal: 10_000,
      }),
    ).toBe(12_000);
  });

  it("fails closed when client delivery option conflicts with the address", () => {
    expect(
      resolveServerDeliveryFee({
        deliveryDetails: { country: "GH", region: "AA" },
        deliveryMethod: "delivery",
        deliveryOption: "within-accra",
        storeConfig,
        subtotal: 10_000,
      }),
    ).toBeNull();
  });

  it("fails closed for delivery orders without a resolvable address", () => {
    expect(
      resolveServerDeliveryFee({
        deliveryDetails: null,
        deliveryMethod: "delivery",
        deliveryOption: "within-accra",
        storeConfig,
        subtotal: 10_000,
      }),
    ).toBeNull();
  });
});
