import { describe, expect, it } from "vitest";
import { calculateDeliveryFee } from "./deliveryFees";

describe("calculateDeliveryFee", () => {
  it("returns 0 for pickup orders", () => {
    const result = calculateDeliveryFee({
      deliveryMethod: "pickup",
      country: "GH",
      region: "GA",
      waiveDeliveryFees: null,
      deliveryFees: null,
    });

    expect(result).toEqual({
      deliveryFee: 0,
      deliveryOption: null,
    });
  });

  it("calculates within-accra fee for Greater Accra region", () => {
    const result = calculateDeliveryFee({
      deliveryMethod: "delivery",
      country: "GH",
      region: "GA",
      waiveDeliveryFees: null,
      deliveryFees: { withinAccra: 30, otherRegions: 70, international: 800 },
    });

    expect(result).toEqual({
      deliveryFee: 30,
      deliveryOption: "within-accra",
    });
  });

  it("calculates outside-accra fee for non-GA Ghana regions", () => {
    const result = calculateDeliveryFee({
      deliveryMethod: "delivery",
      country: "GH",
      region: "AS",
      waiveDeliveryFees: null,
      deliveryFees: { withinAccra: 30, otherRegions: 70, international: 800 },
    });

    expect(result).toEqual({
      deliveryFee: 70,
      deliveryOption: "outside-accra",
    });
  });

  it("calculates international fee for non-GH countries", () => {
    const result = calculateDeliveryFee({
      deliveryMethod: "delivery",
      country: "US",
      region: null,
      waiveDeliveryFees: null,
      deliveryFees: { withinAccra: 30, otherRegions: 70, international: 800 },
    });

    expect(result).toEqual({
      deliveryFee: 800,
      deliveryOption: "intl",
    });
  });

  it("waives fee when all fees are waived", () => {
    const result = calculateDeliveryFee({
      deliveryMethod: "delivery",
      country: "GH",
      region: "GA",
      waiveDeliveryFees: { all: true },
      deliveryFees: { withinAccra: 30, otherRegions: 70, international: 800 },
    });

    expect(result).toEqual({
      deliveryFee: 0,
      deliveryOption: "within-accra",
    });
  });

  it("waives fee when specific region fee is waived", () => {
    const result = calculateDeliveryFee({
      deliveryMethod: "delivery",
      country: "GH",
      region: "GA",
      waiveDeliveryFees: { withinAccra: true },
      deliveryFees: { withinAccra: 30, otherRegions: 70, international: 800 },
    });

    expect(result).toEqual({
      deliveryFee: 0,
      deliveryOption: "within-accra",
    });
  });

  it("uses legacy boolean waiveDeliveryFees format", () => {
    const result = calculateDeliveryFee({
      deliveryMethod: "delivery",
      country: "US",
      region: null,
      waiveDeliveryFees: true,
      deliveryFees: { withinAccra: 30, otherRegions: 70, international: 800 },
    });

    expect(result).toEqual({
      deliveryFee: 0,
      deliveryOption: "intl",
    });
  });

  it("uses hardcoded Ghana fees regardless of deliveryFees config", () => {
    const result = calculateDeliveryFee({
      deliveryMethod: "delivery",
      country: "GH",
      region: "GA",
      waiveDeliveryFees: null,
      deliveryFees: { withinAccra: 50, otherRegions: 100, international: 800 },
    });

    expect(result).toEqual({
      deliveryFee: 30,
      deliveryOption: "within-accra",
    });
  });

  it("uses default fees when deliveryFees config is null", () => {
    const result = calculateDeliveryFee({
      deliveryMethod: "delivery",
      country: "GH",
      region: "GA",
      waiveDeliveryFees: null,
      deliveryFees: null,
    });

    expect(result).toEqual({
      deliveryFee: 30,
      deliveryOption: "within-accra",
    });
  });

  it("uses default international fee when not configured", () => {
    const result = calculateDeliveryFee({
      deliveryMethod: "delivery",
      country: "US",
      region: null,
      waiveDeliveryFees: null,
      deliveryFees: null,
    });

    expect(result).toEqual({
      deliveryFee: 800,
      deliveryOption: "intl",
    });
  });

  it("ignores country for pickup orders", () => {
    const result = calculateDeliveryFee({
      deliveryMethod: "pickup",
      country: "US",
      region: null,
      waiveDeliveryFees: null,
      deliveryFees: null,
    });

    expect(result).toEqual({
      deliveryFee: 0,
      deliveryOption: null,
    });
  });
});
