import { describe, expect, it } from "vitest";
import { isFeeWaived, isAnyFeeWaived } from "./feeUtils";

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
