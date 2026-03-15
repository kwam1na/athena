import { describe, expect, it } from "vitest";
import { isFeeWaived, isAnyFeeWaived } from "./feeUtils";

describe("isFeeWaived", () => {
  describe("boolean format (legacy)", () => {
    it("returns true when waiveDeliveryFees is true", () => {
      expect(isFeeWaived(true, "within-accra")).toBe(true);
      expect(isFeeWaived(true, "outside-accra")).toBe(true);
      expect(isFeeWaived(true, "intl")).toBe(true);
      expect(isFeeWaived(true, null)).toBe(true);
    });

    it("returns false when waiveDeliveryFees is false", () => {
      expect(isFeeWaived(false, "within-accra")).toBe(false);
      expect(isFeeWaived(false, null)).toBe(false);
    });
  });

  describe("null / undefined", () => {
    it("returns false when waiveDeliveryFees is null", () => {
      expect(isFeeWaived(null, "within-accra")).toBe(false);
    });

    it("returns false when waiveDeliveryFees is undefined", () => {
      expect(isFeeWaived(undefined, "within-accra")).toBe(false);
    });
  });

  describe("object format", () => {
    it("returns true when 'all' flag is set", () => {
      expect(isFeeWaived({ all: true }, "within-accra")).toBe(true);
      expect(isFeeWaived({ all: true }, "intl")).toBe(true);
      expect(isFeeWaived({ all: true }, null)).toBe(true);
    });

    it("returns false when deliveryOption is null and 'all' is not set", () => {
      expect(isFeeWaived({ withinAccra: true }, null)).toBe(false);
    });

    it("returns true for within-accra when withinAccra flag is set", () => {
      expect(isFeeWaived({ withinAccra: true }, "within-accra")).toBe(true);
    });

    it("returns false for within-accra when only otherRegions is set", () => {
      expect(isFeeWaived({ otherRegions: true }, "within-accra")).toBe(false);
    });

    it("returns true for outside-accra when otherRegions flag is set", () => {
      expect(isFeeWaived({ otherRegions: true }, "outside-accra")).toBe(true);
    });

    it("returns false for outside-accra when only withinAccra is set", () => {
      expect(isFeeWaived({ withinAccra: true }, "outside-accra")).toBe(false);
    });

    it("returns true for intl when international flag is set", () => {
      expect(isFeeWaived({ international: true }, "intl")).toBe(true);
    });

    it("returns false for intl when only withinAccra is set", () => {
      expect(isFeeWaived({ withinAccra: true }, "intl")).toBe(false);
    });

    it("returns false when no matching flag is set", () => {
      expect(isFeeWaived({}, "within-accra")).toBe(false);
      expect(isFeeWaived({}, "outside-accra")).toBe(false);
      expect(isFeeWaived({}, "intl")).toBe(false);
    });
  });
});

describe("isAnyFeeWaived", () => {
  it("returns true for boolean true", () => {
    expect(isAnyFeeWaived(true)).toBe(true);
  });

  it("returns false for boolean false", () => {
    expect(isAnyFeeWaived(false)).toBe(false);
  });

  it("returns false for null / undefined", () => {
    expect(isAnyFeeWaived(null)).toBe(false);
    expect(isAnyFeeWaived(undefined)).toBe(false);
  });

  it("returns true when any single fee type is waived", () => {
    expect(isAnyFeeWaived({ withinAccra: true })).toBe(true);
    expect(isAnyFeeWaived({ otherRegions: true })).toBe(true);
    expect(isAnyFeeWaived({ international: true })).toBe(true);
    expect(isAnyFeeWaived({ all: true })).toBe(true);
  });

  it("returns false when no fee type is waived", () => {
    expect(isAnyFeeWaived({})).toBe(false);
    expect(isAnyFeeWaived({ withinAccra: false, otherRegions: false })).toBe(
      false
    );
  });

  it("returns true when multiple fee types are waived", () => {
    expect(isAnyFeeWaived({ withinAccra: true, international: true })).toBe(
      true
    );
  });
});
