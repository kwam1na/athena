import { describe, expect, it } from "vitest";

import {
  findRegisteredContextEvent,
  validateRegisteredContextEventPayload,
} from "./eventDefinitions";

describe("context tracking event definitions", () => {
  const productViewed = findRegisteredContextEvent({
    surface: "storefront",
    eventId: "storefront.product_viewed",
    schemaVersion: 1,
  });
  const checkoutStateChanged = findRegisteredContextEvent({
    surface: "storefront",
    eventId: "storefront.checkout_state_changed",
    schemaVersion: 1,
  });

  it("accepts registered payload keys with primitive values", () => {
    expect(productViewed).toBeDefined();

    expect(
      validateRegisteredContextEventPayload(productViewed!, {
        productId: "product_123",
        categorySlug: "wigs",
      }),
    ).toEqual({ ok: true });
  });

  it("rejects unexpected payload keys", () => {
    expect(
      validateRegisteredContextEventPayload(productViewed!, {
        productId: "product_123",
        email: "customer@example.com",
      }),
    ).toEqual({ ok: false, message: "Unexpected payload key: email" });
  });

  it("rejects nested payload values", () => {
    expect(
      validateRegisteredContextEventPayload(productViewed!, {
        productId: "product_123",
        sku: { value: "sku_123" },
      }),
    ).toEqual({ ok: false, message: "Invalid payload value: sku" });
  });

  it("rejects raw checkout error text and free-form blocker values", () => {
    expect(checkoutStateChanged).toBeDefined();

    expect(
      validateRegisteredContextEventPayload(checkoutStateChanged!, {
        checkoutSessionId: "checkout_123",
        state: "Card was declined by Stripe because the CVV failed",
      }),
    ).toEqual({ ok: false, message: "Invalid payload value: state" });

    expect(
      validateRegisteredContextEventPayload(checkoutStateChanged!, {
        checkoutSessionId: "checkout_123",
        state: "blocked",
        blocker: "Customer wrote call me at customer@example.com",
      }),
    ).toEqual({ ok: false, message: "Invalid payload value: blocker" });
  });

  it("accepts only server-allowlisted checkout state and blocker codes", () => {
    expect(
      validateRegisteredContextEventPayload(checkoutStateChanged!, {
        checkoutSessionId: "checkout_123",
        state: "blocked",
        blocker: "inventory",
      }),
    ).toEqual({ ok: true });

    expect(
      validateRegisteredContextEventPayload(checkoutStateChanged!, {
        checkoutSessionId: "checkout_123",
        state: "requires_action",
        blocker: "payment_provider",
      }),
    ).toEqual({ ok: true });
  });

  it("rejects raw URLs and contact-bearing route values", () => {
    const routeViewed = findRegisteredContextEvent({
      surface: "storefront",
      eventId: "storefront.route_viewed",
      schemaVersion: 1,
    });

    expect(
      validateRegisteredContextEventPayload(routeViewed!, {
        route: "https://wigclub.store/products?email=customer@example.com",
      }),
    ).toEqual({ ok: false, message: "Unsafe payload value: route" });
  });
});
