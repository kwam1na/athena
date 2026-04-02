import { describe, expect, it } from "vitest";
import { calculateDeliveryFee } from "./deliveryFees";

describe("calculateDeliveryFee", () => {
  // All fee config values are now in pesewas (base unit)
  const fees = { withinAccra: 3000, otherRegions: 7000, international: 80000 };

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
      deliveryFees: fees,
    });

    expect(result).toEqual({
      deliveryFee: 3000,
      deliveryOption: "within-accra",
    });
  });

  it("calculates outside-accra fee for non-GA Ghana regions", () => {
    const result = calculateDeliveryFee({
      deliveryMethod: "delivery",
      country: "GH",
      region: "AS",
      waiveDeliveryFees: null,
      deliveryFees: fees,
    });

    expect(result).toEqual({
      deliveryFee: 7000,
      deliveryOption: "outside-accra",
    });
  });

  it("calculates international fee for non-GH countries", () => {
    const result = calculateDeliveryFee({
      deliveryMethod: "delivery",
      country: "US",
      region: null,
      waiveDeliveryFees: null,
      deliveryFees: fees,
    });

    expect(result).toEqual({
      deliveryFee: 80000,
      deliveryOption: "intl",
    });
  });

  it("waives fee when all fees are waived", () => {
    const result = calculateDeliveryFee({
      deliveryMethod: "delivery",
      country: "GH",
      region: "GA",
      waiveDeliveryFees: { all: true },
      deliveryFees: fees,
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
      deliveryFees: fees,
    });

    expect(result).toEqual({
      deliveryFee: 0,
      deliveryOption: "within-accra",
    });
  });

  it("uses configured Ghana fees when provided", () => {
    const result = calculateDeliveryFee({
      deliveryMethod: "delivery",
      country: "GH",
      region: "GA",
      waiveDeliveryFees: null,
      deliveryFees: { withinAccra: 5000, otherRegions: 10000, international: 80000 },
    });

    expect(result).toEqual({
      deliveryFee: 5000,
      deliveryOption: "within-accra",
    });
  });

  it("uses configured other-regions Ghana fee when provided", () => {
    const result = calculateDeliveryFee({
      deliveryMethod: "delivery",
      country: "GH",
      region: "AS",
      waiveDeliveryFees: null,
      deliveryFees: { withinAccra: 5000, otherRegions: 10000, international: 80000 },
    });

    expect(result).toEqual({
      deliveryFee: 10000,
      deliveryOption: "outside-accra",
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
      deliveryFee: 3000,
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
      deliveryFee: 80000,
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

  it("waives fee when waiver is ON and subtotal meets threshold", () => {
    const result = calculateDeliveryFee({
      deliveryMethod: "delivery",
      country: "GH",
      region: "GA",
      waiveDeliveryFees: { withinAccra: true, minimumOrderAmount: 10000 },
      deliveryFees: fees,
      subtotal: 10000,
    });
    expect(result).toEqual({ deliveryFee: 0, deliveryOption: "within-accra" });
  });

  it("charges fee when waiver is ON but subtotal below threshold", () => {
    const result = calculateDeliveryFee({
      deliveryMethod: "delivery",
      country: "GH",
      region: "GA",
      waiveDeliveryFees: { withinAccra: true, minimumOrderAmount: 10000 },
      deliveryFees: fees,
      subtotal: 5000,
    });
    expect(result).toEqual({ deliveryFee: 3000, deliveryOption: "within-accra" });
  });

  it("waives fee when waiver is ON and no threshold set", () => {
    const result = calculateDeliveryFee({
      deliveryMethod: "delivery",
      country: "GH",
      region: "GA",
      waiveDeliveryFees: { withinAccra: true },
      deliveryFees: fees,
      subtotal: 100,
    });
    expect(result).toEqual({ deliveryFee: 0, deliveryOption: "within-accra" });
  });

  it("waives international fee when threshold is met", () => {
    const result = calculateDeliveryFee({
      deliveryMethod: "delivery",
      country: "US",
      region: null,
      waiveDeliveryFees: { international: true, minimumOrderAmount: 20000 },
      deliveryFees: fees,
      subtotal: 25000,
    });
    expect(result).toEqual({ deliveryFee: 0, deliveryOption: "intl" });
  });

  it("charges international fee when threshold is not met", () => {
    const result = calculateDeliveryFee({
      deliveryMethod: "delivery",
      country: "US",
      region: null,
      waiveDeliveryFees: { international: true, minimumOrderAmount: 20000 },
      deliveryFees: fees,
      subtotal: 10000,
    });
    expect(result).toEqual({ deliveryFee: 80000, deliveryOption: "intl" });
  });
});
