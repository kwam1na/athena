import { describe, expect, it } from "vitest";

import { reconcileProjection } from "./reconciliation";

describe("reporting projection reconciliation", () => {
  it("verifies only exact expected and projected units", () => {
    expect(
      reconcileProjection({
        expected: { netRevenueMinor: 10_000, quantity: 4 },
        projected: { netRevenueMinor: 10_000, quantity: 4 },
      }),
    ).toEqual({ differences: [], status: "verified" });
  });

  it("names every unexplained difference and prevents verification", () => {
    const result = reconcileProjection({
      expected: { netRevenueMinor: 10_000, quantity: 4 },
      projected: { netRevenueMinor: 9_900, quantity: 3 },
    });

    expect(result.status).toBe("failed");
    expect(result.differences).toEqual([
      {
        actual: 9_900,
        difference: -100,
        expected: 10_000,
        unit: "minor_currency",
        field: "netRevenueMinor",
      },
      {
        actual: 3,
        difference: -1,
        expected: 4,
        unit: "quantity",
        field: "quantity",
      },
    ]);
  });
});
