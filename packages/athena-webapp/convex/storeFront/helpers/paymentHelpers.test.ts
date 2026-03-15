// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

const { getDiscountValue, getOrderAmount } = vi.hoisted(() => ({
  getDiscountValue: vi.fn(),
  getOrderAmount: vi.fn(),
}));

vi.mock("../../inventory/utils", () => ({
  getDiscountValue,
  getOrderAmount,
}));

import {
  calculateOrderAmount,
  calculateRewardPoints,
  extractOrderItems,
  generatePODReference,
  getOrderDiscountValue,
  validatePaymentAmount,
} from "./paymentHelpers";

describe("paymentHelpers", () => {
  it("generates a POD reference with timestamp and checkout session id", () => {
    vi.spyOn(Date, "now").mockReturnValue(1710000000000);

    const result = generatePODReference("session_123" as never);

    expect(result).toBe("POD-1710000000000-session_123");
  });

  it("extracts order items from session items", () => {
    const result = extractOrderItems([
      {
        productSkuId: "sku_1" as never,
        quantity: 2,
        price: 4200,
      },
    ]);

    expect(result).toEqual([
      {
        productSkuId: "sku_1",
        quantity: 2,
        price: 4200,
      },
    ]);
  });

  it("delegates order amount calculation", () => {
    getOrderAmount.mockReturnValue(9800);

    const result = calculateOrderAmount({
      items: [],
      discount: { type: "percentage", value: 10 },
      deliveryFee: 500,
      subtotal: 10000,
    });

    expect(getOrderAmount).toHaveBeenCalledWith({
      items: [],
      discount: { type: "percentage", value: 10 },
      deliveryFee: 500,
      subtotal: 10000,
    });
    expect(result).toBe(9800);
  });

  it("calculates reward points using floor division", () => {
    expect(calculateRewardPoints(9999)).toBe(9);
    expect(calculateRewardPoints(10000)).toBe(10);
  });

  it("validates payment amount and success status", () => {
    expect(
      validatePaymentAmount({
        paystackAmount: 10000,
        orderAmount: 10000,
        paystackStatus: "success",
      })
    ).toBe(true);

    expect(
      validatePaymentAmount({
        paystackAmount: 10000,
        orderAmount: 9000,
        paystackStatus: "success",
      })
    ).toBe(false);

    expect(
      validatePaymentAmount({
        paystackAmount: 10000,
        orderAmount: 10000,
        paystackStatus: "failed",
      })
    ).toBe(false);
  });

  it("delegates discount value lookup", () => {
    getDiscountValue.mockReturnValue(1200);

    const result = getOrderDiscountValue(
      [{ productSkuId: "sku_1" as never, quantity: 1, price: 12000 }],
      { type: "amount", value: 1200 }
    );

    expect(getDiscountValue).toHaveBeenCalledWith(
      [{ productSkuId: "sku_1", quantity: 1, price: 12000 }],
      { type: "amount", value: 1200 }
    );
    expect(result).toBe(1200);
  });
});
