import { describe, expect, it } from "vitest";

import {
  calculatePosCartTotals,
  calculatePosChange,
  calculatePosRemainingDue,
  type PosCartLineId,
  calculatePosTotalPaid,
  isPosPaymentSufficient,
} from "./index";

describe("calculatePosCartTotals", () => {
  it("matches the legacy register subtotal rounding behavior", () => {
    const totals = calculatePosCartTotals([
      {
        id: "line-1" as PosCartLineId,
        name: "Shirt",
        barcode: "111111111111",
        price: 12.4,
        quantity: 2,
      },
      {
        id: "line-2" as PosCartLineId,
        name: "Cap",
        barcode: "222222222222",
        price: 5.255,
        quantity: 1,
      },
    ]);

    expect(totals).toEqual({
      subtotal: 30.05,
      tax: 0,
      total: 30.05,
    });
  });
});

describe("payment helpers", () => {
  it("returns change due when payment exceeds total", () => {
    expect(calculatePosChange(40, 30.05)).toBe(9.95);
  });

  it("calculates total paid and remaining due from payment state", () => {
    const totalPaid = calculatePosTotalPaid([
      {
        id: "payment-1",
        method: "cash",
        amount: 10,
        timestamp: 1,
      },
      {
        id: "payment-2",
        method: "card",
        amount: 12.5,
        timestamp: 2,
      },
    ]);

    expect(totalPaid).toBe(22.5);
    expect(calculatePosRemainingDue(totalPaid, 30.06)).toBe(7.56);
    expect(isPosPaymentSufficient(totalPaid, 30.06)).toBe(false);
  });
});
