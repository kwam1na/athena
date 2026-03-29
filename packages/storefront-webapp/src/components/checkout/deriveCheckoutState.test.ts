import { describe, expect, it } from "vitest";
import { deriveCheckoutState } from "./deriveCheckoutState";
import { CheckoutState } from "./types";

const baseState: CheckoutState = {
  billingDetails: null,
  deliveryFee: null,
  deliveryMethod: "pickup",
  deliveryOption: null,
  deliveryDetails: null,
  deliveryInstructions: "",
  customerDetails: null,
  pickupLocation: "wigclub-hair-studio",
  didEnterDeliveryDetails: false,
  didEnterBillingDetails: false,
  didSelectPickupLocation: false,
  isUSOrder: false,
  isROWOrder: false,
  isGhanaOrder: true,
  isPickupOrder: true,
  isDeliveryOrder: false,
  failedFinalValidation: false,
  bag: null,
  discount: null,
  onlineOrder: null,
  paymentMethod: "online_payment",
  podPaymentMethod: null,
};

describe("deriveCheckoutState", () => {
  it("marks pickup orders correctly", () => {
    const result = deriveCheckoutState({
      ...baseState,
      deliveryMethod: "pickup",
      pickupLocation: "wigclub-hair-studio",
    });

    expect(result.isPickupOrder).toBe(true);
    expect(result.isDeliveryOrder).toBe(false);
    expect(result.isGhanaOrder).toBe(true);
    expect(result.didSelectPickupLocation).toBe(true);
  });

  it("marks delivery orders correctly", () => {
    const result = deriveCheckoutState({
      ...baseState,
      deliveryMethod: "delivery",
      deliveryDetails: {
        country: "US",
        address: "123 Main",
        city: "Austin",
        state: "TX",
        zip: "78701",
      },
    });

    expect(result.isPickupOrder).toBe(false);
    expect(result.isDeliveryOrder).toBe(true);
    expect(result.isUSOrder).toBe(true);
    expect(result.isGhanaOrder).toBe(false);
    expect(result.isROWOrder).toBe(false);
  });

  it("identifies Ghana delivery orders", () => {
    const result = deriveCheckoutState({
      ...baseState,
      deliveryMethod: "delivery",
      deliveryDetails: {
        country: "GH",
        region: "GA",
        street: "Oxford St",
        neighborhood: "osu",
      },
      deliveryOption: "within-accra",
    });

    expect(result.isGhanaOrder).toBe(true);
    expect(result.isUSOrder).toBe(false);
    expect(result.isROWOrder).toBe(false);
  });

  it("identifies rest-of-world delivery orders", () => {
    const result = deriveCheckoutState({
      ...baseState,
      deliveryMethod: "delivery",
      deliveryDetails: { country: "GB", address: "10 Downing", city: "London" },
    });

    expect(result.isROWOrder).toBe(true);
    expect(result.isUSOrder).toBe(false);
    expect(result.isGhanaOrder).toBe(false);
  });

  it("computes didEnterDeliveryDetails for US addresses", () => {
    const result = deriveCheckoutState({
      ...baseState,
      deliveryMethod: "delivery",
      deliveryOption: "intl",
      deliveryDetails: {
        country: "US",
        address: "123 Main",
        city: "Austin",
        state: "TX",
        zip: "78701",
      },
    });

    expect(result.didEnterDeliveryDetails).toBe(true);
  });

  it("computes didEnterDeliveryDetails as false when US fields are incomplete", () => {
    const result = deriveCheckoutState({
      ...baseState,
      deliveryMethod: "delivery",
      deliveryOption: "intl",
      deliveryDetails: {
        country: "US",
        address: "123 Main",
        city: "Austin",
      },
    });

    expect(result.didEnterDeliveryDetails).toBe(false);
  });

  it("computes didEnterDeliveryDetails for Ghana addresses", () => {
    const result = deriveCheckoutState({
      ...baseState,
      deliveryMethod: "delivery",
      deliveryOption: "within-accra",
      deliveryDetails: {
        country: "GH",
        region: "GA",
        street: "Oxford St",
      },
    });

    expect(result.didEnterDeliveryDetails).toBe(true);
  });

  it("computes didEnterDeliveryDetails for ROW addresses", () => {
    const result = deriveCheckoutState({
      ...baseState,
      deliveryMethod: "delivery",
      deliveryOption: "intl",
      deliveryDetails: {
        country: "GB",
        address: "10 Downing St",
        city: "London",
      },
    });

    expect(result.didEnterDeliveryDetails).toBe(true);
  });

  it("requires deliveryOption for didEnterDeliveryDetails", () => {
    const result = deriveCheckoutState({
      ...baseState,
      deliveryMethod: "delivery",
      deliveryOption: null,
      deliveryDetails: {
        country: "GB",
        address: "10 Downing St",
        city: "London",
      },
    });

    expect(result.didEnterDeliveryDetails).toBe(false);
  });

  it("computes didEnterBillingDetails for US billing address", () => {
    const result = deriveCheckoutState({
      ...baseState,
      billingDetails: {
        country: "US",
        address: "123 Main",
        city: "Austin",
        state: "TX",
        zip: "78701",
      },
    });

    expect(result.didEnterBillingDetails).toBe(true);
  });

  it("computes didEnterBillingDetails as false when US billing fields incomplete", () => {
    const result = deriveCheckoutState({
      ...baseState,
      billingDetails: {
        country: "US",
        address: "123 Main",
        city: "Austin",
      },
    });

    expect(result.didEnterBillingDetails).toBe(false);
  });
});
