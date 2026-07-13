import { describe, expect, it } from "vitest";

import { summarizeSharedDemoReport } from "./reporting";

describe("shared demo reporting", () => {
  it("reflects completed POS and storefront writes in the live snapshot", () => {
    expect(
      summarizeSharedDemoReport({
        orderItems: [[{ quantity: 1 }]],
        orders: [{ amount: 2_500 }],
        transactionItems: [[{ quantity: 2 }], [{ quantity: 1 }]],
        transactions: [{ total: 5_000 }, { total: 2_500 }],
      }),
    ).toEqual({
      posRevenue: 7_500,
      storefrontRevenue: 2_500,
      unitsSold: 4,
    });
  });
});
