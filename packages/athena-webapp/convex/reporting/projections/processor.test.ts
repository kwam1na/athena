import { describe, expect, it } from "vitest";

import { currencyForFactMetric, mergeProjectionValue } from "./processor";

describe("reporting incremental projection processor", () => {
  it("adds compatible currency values", () => {
    expect(
      mergeProjectionValue({
        currentCurrencyCode: "GHS",
        currentKnownValue: 1_200,
        incomingCurrencyCode: "GHS",
        incomingValue: 300,
      }),
    ).toEqual({ knownValue: 1_500 });
  });

  it("withholds an aggregate instead of summing unlike currencies", () => {
    expect(
      mergeProjectionValue({
        currentCurrencyCode: "GHS",
        currentKnownValue: 1_200,
        incomingCurrencyCode: "USD",
        incomingValue: 300,
      }),
    ).toEqual({
      completeness: "unavailable",
      knownValue: undefined,
      limitingReason: "mixed_currency",
    });
  });

  it("keeps a mixed-currency aggregate withheld on later facts", () => {
    expect(
      mergeProjectionValue({
        currentCurrencyCode: "GHS",
        currentKnownValue: undefined,
        currentLimitingReason: "mixed_currency",
        incomingCurrencyCode: "GHS",
        incomingValue: 300,
      }),
    ).toEqual({
      completeness: "unavailable",
      knownValue: undefined,
      limitingReason: "mixed_currency",
    });
  });

  it("selects revenue and valuation currencies independently by metric", () => {
    const fact = {
      currencyCode: "GHS",
      inventoryContributionKind: undefined,
      revenueCurrencyCode: "GHS",
      valuationCurrencyCode: "USD",
    } as never;
    expect(currencyForFactMetric(fact, "net_sales")).toBe("GHS");
    expect(currencyForFactMetric(fact, "known_cogs")).toBe("USD");
    expect(currencyForFactMetric(fact, "units_sold")).toBeUndefined();
  });

  it("does not treat missing monetary currency as compatible with a known segment", () => {
    expect(
      mergeProjectionValue({
        currentCurrencyCode: "GHS",
        currentKnownValue: 1_200,
        incomingCurrencyCode: undefined,
        incomingValue: 300,
      }),
    ).toEqual({
      completeness: "unavailable",
      knownValue: undefined,
      limitingReason: "mixed_currency",
    });
  });
});
