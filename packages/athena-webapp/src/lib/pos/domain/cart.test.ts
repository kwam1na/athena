import { describe, expect, it } from "vitest";

import {
  calculatePosCartTotals,
  calculatePosChange,
  calculatePosRemainingDue,
  type PosCartLineId,
  type PosServiceCartLineInput,
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

  it("includes product and service lines in mixed checkout totals", () => {
    const serviceLine: PosServiceCartLineInput = {
      lineKind: "service",
      id: "service:line-1",
      name: "Braids installation",
      displayName: "Braids installation",
      serviceCatalogId:
        "service-catalog-1" as PosServiceCartLineInput["serviceCatalogId"],
      serviceMode: "same_day",
      pricingSource: "catalog_base_price",
      unitPrice: 120,
      price: 120,
      quantity: 1,
    };

    const totals = calculatePosCartTotals(
      [
        {
          id: "line-1" as PosCartLineId,
          name: "Edge control",
          barcode: "111111111111",
          price: 15.5,
          quantity: 2,
        },
        serviceLine,
      ],
      0.1,
    );

    expect(totals).toEqual({
      subtotal: 151,
      tax: 15.1,
      total: 166.1,
    });
  });

  it("calculates service quantity from unit price", () => {
    const totals = calculatePosCartTotals([
      {
        lineKind: "service",
        id: "service:line-1",
        name: "Consultation block",
        displayName: "Consultation block",
        serviceCatalogId:
          "service-catalog-1" as PosServiceCartLineInput["serviceCatalogId"],
        serviceMode: "consultation",
        pricingSource: "pos_entered",
        unitPrice: 45,
        price: 45,
        quantity: 3,
      },
    ]);

    expect(totals).toEqual({
      subtotal: 135,
      tax: 0,
      total: 135,
    });
  });

  it.each([
    {
      displayName: "",
      quantity: 1,
      unitPrice: 20,
      message: "Service line requires a display name.",
    },
    {
      displayName: "Retwist",
      quantity: 0,
      unitPrice: 20,
      message: "Service line quantity must be greater than zero.",
    },
    {
      displayName: "Retwist",
      quantity: 1,
      unitPrice: -1,
      message: "Service line price cannot be negative.",
    },
  ])(
    "rejects invalid service line fields before total calculation",
    ({ displayName, quantity, unitPrice, message }) => {
      expect(() =>
        calculatePosCartTotals([
          {
            lineKind: "service",
            id: "service:line-1",
            name: displayName || "Retwist",
            displayName,
            serviceCatalogId:
              "service-catalog-1" as PosServiceCartLineInput["serviceCatalogId"],
            serviceMode: "repair",
            pricingSource: "pos_entered",
            unitPrice,
            price: unitPrice,
            quantity,
          },
        ]),
      ).toThrow(message);
    },
  );
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
