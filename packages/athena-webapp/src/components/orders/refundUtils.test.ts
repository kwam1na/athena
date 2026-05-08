import { describe, expect, it } from "vitest";

import { calculateRefundAmount, getNetAmount } from "./refundUtils";
import type { OnlineOrder } from "~/types";

const baseOrder = {
  amount: 10_000,
  deliveryFee: 1_500,
  paymentDue: 8_500,
  refunds: [],
  items: [
    {
      _id: "item-1",
      isRefunded: false,
      price: 4_500,
      quantity: 2,
    },
    {
      _id: "item-2",
      isRefunded: false,
      price: 2_000,
      quantity: 1,
    },
  ],
} as unknown as OnlineOrder;

describe("refund money calculations", () => {
  it("uses paymentDue for the refundable balance when discounts changed what was paid", () => {
    expect(getNetAmount(baseOrder)).toBe(8_500);
  });

  it("treats order item prices as stored minor units for partial refunds", () => {
    expect(
      calculateRefundAmount(
        {
          ...baseOrder,
          paymentDue: 20_000,
        },
        "partial",
        new Set(["item-1"]),
      ),
    ).toBe(9_000);
  });

  it("can include the stored delivery fee without converting twice", () => {
    expect(
      calculateRefundAmount(
        {
          ...baseOrder,
          paymentDue: 20_000,
        },
        "partial",
        new Set(["item-2"]),
        true,
      ),
    ).toBe(3_500);
  });
});
