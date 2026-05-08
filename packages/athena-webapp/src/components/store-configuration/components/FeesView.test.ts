import { describe, expect, it } from "vitest";

import { formatDeliveryFeeInput, parseDeliveryFeeInputs } from "./FeesView";

describe("delivery fee money inputs", () => {
  it("renders stored minor-unit fees as editable display values", () => {
    expect(formatDeliveryFeeInput(1250)).toBe("12.5");
    expect(formatDeliveryFeeInput(0)).toBe("0");
    expect(formatDeliveryFeeInput(undefined)).toBe("");
  });

  it("parses decimal display fees into minor units", () => {
    expect(
      parseDeliveryFeeInputs({
        international: "120.99",
        otherRegions: "25.50",
        withinAccra: "10",
      }),
    ).toEqual({
      ok: true,
      value: {
        international: 12099,
        otherRegions: 2550,
        withinAccra: 1000,
      },
    });
  });

  it("keeps blank fees unset", () => {
    expect(
      parseDeliveryFeeInputs({
        international: "",
        otherRegions: " ",
        withinAccra: "0",
      }),
    ).toEqual({
      ok: true,
      value: {
        international: undefined,
        otherRegions: undefined,
        withinAccra: 0,
      },
    });
  });

  it("rejects invalid fee entries", () => {
    expect(
      parseDeliveryFeeInputs({
        international: "-12",
        otherRegions: "",
        withinAccra: "10",
      }),
    ).toEqual({ ok: false });
  });
});
