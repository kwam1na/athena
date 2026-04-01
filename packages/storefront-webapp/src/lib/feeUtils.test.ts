import { describe, expect, it } from "vitest";
import { isFeeWaived, isAnyFeeWaived, hasWaiverConfigured, getRemainingForFreeDelivery } from "./feeUtils";

describe("isFeeWaived", () => {
  it("returns false for undefined/null waiveDeliveryFees", () => {
    expect(isFeeWaived(undefined, "within-accra")).toBe(false);
    expect(isFeeWaived(null, "within-accra")).toBe(false);
  });

  it("returns the boolean value for legacy boolean format", () => {
    expect(isFeeWaived(true, "within-accra")).toBe(true);
    expect(isFeeWaived(true, "intl")).toBe(true);
    expect(isFeeWaived(false, "within-accra")).toBe(false);
  });

  it("returns true when all fees are waived", () => {
    expect(isFeeWaived({ all: true }, "within-accra")).toBe(true);
    expect(isFeeWaived({ all: true }, "outside-accra")).toBe(true);
    expect(isFeeWaived({ all: true }, "intl")).toBe(true);
  });

  it("returns false when no delivery option is selected", () => {
    expect(isFeeWaived({ withinAccra: true }, null)).toBe(false);
  });

  it("checks specific delivery option flags", () => {
    const config = {
      withinAccra: true,
      otherRegions: false,
      international: true,
    };

    expect(isFeeWaived(config, "within-accra")).toBe(true);
    expect(isFeeWaived(config, "outside-accra")).toBe(false);
    expect(isFeeWaived(config, "intl")).toBe(true);
  });
});

describe("isFeeWaived with minimumOrderAmount", () => {
  it("returns true when region waiver is ON and subtotal >= threshold", () => {
    const config = { withinAccra: true, minimumOrderAmount: 100 };
    expect(isFeeWaived(config, "within-accra", 10000)).toBe(true);
  });
  it("returns false when region waiver is ON but subtotal < threshold", () => {
    const config = { withinAccra: true, minimumOrderAmount: 100 };
    expect(isFeeWaived(config, "within-accra", 5000)).toBe(false);
  });
  it("returns true when region waiver is ON and no threshold set (backward compat)", () => {
    const config = { withinAccra: true };
    expect(isFeeWaived(config, "within-accra", 5000)).toBe(true);
  });
  it("returns true when waiveDeliveryFees is boolean true regardless of subtotal", () => {
    expect(isFeeWaived(true, "within-accra", 100)).toBe(true);
    expect(isFeeWaived(true, "intl", 0)).toBe(true);
  });
  it("returns true when threshold is 0 (treated as no threshold)", () => {
    const config = { withinAccra: true, minimumOrderAmount: 0 };
    expect(isFeeWaived(config, "within-accra", 0)).toBe(true);
  });
  it("returns true when all is true and subtotal >= threshold", () => {
    const config = { all: true, minimumOrderAmount: 50 };
    expect(isFeeWaived(config, "within-accra", 5000)).toBe(true);
  });
  it("returns false when all is true but subtotal < threshold", () => {
    const config = { all: true, minimumOrderAmount: 50 };
    expect(isFeeWaived(config, "within-accra", 1000)).toBe(false);
  });
  it("returns false when region waiver is OFF regardless of subtotal", () => {
    const config = { withinAccra: false, minimumOrderAmount: 10 };
    expect(isFeeWaived(config, "within-accra", 99999)).toBe(false);
  });
  it("returns true when subtotal is not provided and no threshold (backward compat)", () => {
    const config = { withinAccra: true };
    expect(isFeeWaived(config, "within-accra")).toBe(true);
  });
});

describe("isAnyFeeWaived", () => {
  it("returns false for undefined/null", () => {
    expect(isAnyFeeWaived(undefined)).toBe(false);
    expect(isAnyFeeWaived(null)).toBe(false);
  });

  it("returns the boolean value for legacy format", () => {
    expect(isAnyFeeWaived(true)).toBe(true);
    expect(isAnyFeeWaived(false)).toBe(false);
  });

  it("returns true if any fee type is waived", () => {
    expect(isAnyFeeWaived({ withinAccra: true })).toBe(true);
    expect(isAnyFeeWaived({ otherRegions: true })).toBe(true);
    expect(isAnyFeeWaived({ international: true })).toBe(true);
    expect(isAnyFeeWaived({ all: true })).toBe(true);
  });

  it("returns false when no fees are waived", () => {
    expect(isAnyFeeWaived({})).toBe(false);
    expect(
      isAnyFeeWaived({
        withinAccra: false,
        otherRegions: false,
        international: false,
      })
    ).toBe(false);
  });
});

describe("isAnyFeeWaived with minimumOrderAmount", () => {
  it("returns false when waivers exist but subtotal is below threshold", () => {
    const config = { withinAccra: true, minimumOrderAmount: 100 };
    expect(isAnyFeeWaived(config, 5000)).toBe(false);
  });
  it("returns true when waivers exist and subtotal meets threshold", () => {
    const config = { withinAccra: true, minimumOrderAmount: 100 };
    expect(isAnyFeeWaived(config, 10000)).toBe(true);
  });
  it("returns true when no threshold is set", () => {
    const config = { withinAccra: true };
    expect(isAnyFeeWaived(config, 5000)).toBe(true);
  });
  it("returns true for legacy boolean true regardless of subtotal", () => {
    expect(isAnyFeeWaived(true, 0)).toBe(true);
  });
});

describe("hasWaiverConfigured", () => {
  it("returns true when region flag is ON regardless of threshold", () => {
    const config = { withinAccra: true, minimumOrderAmount: 9999 };
    expect(hasWaiverConfigured(config, "within-accra")).toBe(true);
  });
  it("returns false when region flag is OFF", () => {
    const config = { withinAccra: false, minimumOrderAmount: 10 };
    expect(hasWaiverConfigured(config, "within-accra")).toBe(false);
  });
  it("returns true when all is true", () => {
    const config = { all: true, minimumOrderAmount: 9999 };
    expect(hasWaiverConfigured(config, "intl")).toBe(true);
  });
  it("returns true for legacy boolean true", () => {
    expect(hasWaiverConfigured(true, "within-accra")).toBe(true);
  });
  it("returns false for legacy boolean false", () => {
    expect(hasWaiverConfigured(false, "within-accra")).toBe(false);
  });
  it("returns false for undefined/null", () => {
    expect(hasWaiverConfigured(undefined, "within-accra")).toBe(false);
    expect(hasWaiverConfigured(null, "within-accra")).toBe(false);
  });
});

describe("getRemainingForFreeDelivery", () => {
  it("returns remaining pesewas when subtotal is below threshold", () => {
    const config = { withinAccra: true, minimumOrderAmount: 100 };
    expect(getRemainingForFreeDelivery(config, "within-accra", 5000)).toBe(5000);
  });
  it("returns null when subtotal meets threshold", () => {
    const config = { withinAccra: true, minimumOrderAmount: 100 };
    expect(getRemainingForFreeDelivery(config, "within-accra", 10000)).toBeNull();
  });
  it("returns null when no threshold is set (already free)", () => {
    const config = { withinAccra: true };
    expect(getRemainingForFreeDelivery(config, "within-accra", 5000)).toBeNull();
  });
  it("returns null when region waiver is OFF", () => {
    const config = { withinAccra: false, minimumOrderAmount: 100 };
    expect(getRemainingForFreeDelivery(config, "within-accra", 5000)).toBeNull();
  });
  it("returns null when no delivery option selected", () => {
    const config = { withinAccra: true, minimumOrderAmount: 100 };
    expect(getRemainingForFreeDelivery(config, null, 5000)).toBeNull();
  });
  it("returns null for legacy boolean true (no threshold possible)", () => {
    expect(getRemainingForFreeDelivery(true, "within-accra", 100)).toBeNull();
  });
});
