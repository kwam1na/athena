import { describe, expect, it, vi } from "vitest";

import {
  buildStorefrontContextEvent,
  createStorefrontContextTrackingEnvelope,
  getStorefrontContextEventInput,
  trackStorefrontContextEvent,
} from "./storefrontContextEvents";
import {
  createBagAddSucceededEvent,
  createCheckoutCompletionBlockedEvent,
  createCheckoutCompletionSucceededEvent,
  createCheckoutDetailsViewedEvent,
  createCheckoutStartEvent,
  createOrderReviewViewedEvent,
  createPaymentSubmissionStartedEvent,
  createPaymentVerificationStartedEvent,
  createProductDetailViewedEvent,
} from "./storefrontJourneyEvents";

const baseContext = {
  route: "/shop/product/product_123",
  origin: "homepage",
  sessionId: "session_ctx_123",
  userType: "guest" as const,
};

describe("storefront context events", () => {
  it("builds product-viewed events with safe scalar payloads and stable idempotency", () => {
    const first = createStorefrontContextTrackingEnvelope({
      event: createProductDetailViewedEvent({
        productId: "product_123",
        productSku: "sku_123",
        categorySlug: "hair",
        subcategorySlug: undefined,
      }),
      baseContext,
    });
    const second = createStorefrontContextTrackingEnvelope({
      event: createProductDetailViewedEvent({
        productId: "product_123",
        productSku: "sku_123",
        categorySlug: "hair",
      }),
      baseContext,
    });

    if (!first || !second) {
      throw new Error("Expected product context envelopes");
    }
    expect(first).toMatchObject({
      surface: "storefront",
      eventId: "storefront.product_viewed",
      schemaVersion: 1,
      origin: "homepage",
      payload: {
        productId: "product_123",
        sku: "sku_123",
        categorySlug: "hair",
      },
      primarySubject: {
        type: "product",
        id: "product_123",
      },
      sessionRef: {
        kind: "storefront_session",
        id: "session_ctx_123",
      },
    });
    expect(first.idempotencyKey).toBe(second.idempotencyKey);
    expect(first.payload).not.toHaveProperty("subcategorySlug");
  });

  it("maps cart and checkout milestones into registered event families", () => {
    expect(
      createStorefrontContextTrackingEnvelope({
        event: createBagAddSucceededEvent({
          productId: "product_123",
          productSku: "sku_123",
          quantity: 2,
        }),
        baseContext: {
          ...baseContext,
          route: "/shop/bag",
        },
      }),
    ).toMatchObject({
      eventId: "storefront.cart_changed",
      payload: {
        productId: "product_123",
        quantity: 2,
        change: "added",
      },
    });

    expect(
      createStorefrontContextTrackingEnvelope({
        event: createCheckoutStartEvent({
          bagId: "bag_123",
          checkoutSessionId: "checkout_123",
        }),
        baseContext: {
          ...baseContext,
          route: "/shop/bag",
        },
      }),
    ).toMatchObject({
      eventId: "storefront.checkout_state_changed",
      payload: {
        checkoutSessionId: "checkout_123",
        state: "started",
      },
    });

    expect(
      createStorefrontContextTrackingEnvelope({
        event: createPaymentSubmissionStartedEvent({
          checkoutSessionId: "checkout_123",
          paymentMethod: "card",
          podPaymentMethod: "cash",
        }),
        baseContext: {
          ...baseContext,
          route: "/shop/checkout",
        },
      }),
    ).toMatchObject({
      eventId: "storefront.checkout_state_changed",
      payload: {
        checkoutSessionId: "checkout_123",
        state: "requires_action",
      },
    });
  });

  it("rejects missing required keys, unknown keys, and nested payloads", () => {
    expect(() =>
      buildStorefrontContextEvent({
        eventId: "storefront.route_viewed",
        payload: {},
      }),
    ).toThrow(/Missing payload key: route/);

    expect(() =>
      buildStorefrontContextEvent({
        eventId: "storefront.product_viewed",
        payload: {
          productId: "product_123",
          rawUrl: "https://example.test/shop/product/product_123",
        },
      }),
    ).toThrow(/Unexpected payload key: rawUrl/);

    expect(() =>
      buildStorefrontContextEvent({
        eventId: "storefront.checkout_state_changed",
        payload: {
          checkoutSessionId: "checkout_123",
          state: "blocked",
          error: {
            message: "Do not persist raw backend text",
          },
        },
      }),
    ).toThrow(/Unexpected payload key: error/);
  });

  it("returns undefined for non-context observability events", () => {
    expect(
      getStorefrontContextEventInput({
        event: {
          journey: "auth",
          step: "login_entry",
          status: "viewed",
        },
        baseContext,
      }),
    ).toBeUndefined();
  });

  it("contains tracking failures so user flows do not block", async () => {
    const transport = vi.fn().mockRejectedValue(new Error("network down"));

    await expect(
      trackStorefrontContextEvent({
        event: createCheckoutCompletionSucceededEvent({
          checkoutSessionId: "checkout_123",
          orderId: "order_123",
        }),
        baseContext: {
          ...baseContext,
          route: "/shop/checkout/complete",
        },
        transport,
      }),
    ).resolves.toEqual({
      ok: false,
      skipped: false,
      error: "network down",
    });

    expect(transport).toHaveBeenCalledOnce();
  });

  it("uses safe blocker codes for checkout blocked states", () => {
    expect(
      createStorefrontContextTrackingEnvelope({
        event: createCheckoutCompletionBlockedEvent({
          checkoutSessionId: "checkout_123",
        }),
        baseContext,
      }),
    ).toMatchObject({
      eventId: "storefront.checkout_state_changed",
      payload: {
        checkoutSessionId: "checkout_123",
        state: "blocked",
        blocker: "unknown",
      },
    });
  });

  it("maps checkout milestones to backend-registered state codes", () => {
    const events = [
      [createCheckoutDetailsViewedEvent({ checkoutSessionId: "checkout_123" }), "details_entered"],
      [createOrderReviewViewedEvent({ checkoutSessionId: "checkout_123" }), "reviewing"],
      [
        createPaymentSubmissionStartedEvent({
          checkoutSessionId: "checkout_123",
          paymentMethod: "card",
        }),
        "requires_action",
      ],
      [
        createPaymentVerificationStartedEvent({
          checkoutSessionId: "checkout_123",
        }),
        "verification_required",
      ],
      [
        createCheckoutCompletionSucceededEvent({
          checkoutSessionId: "checkout_123",
          orderId: "order_123",
        }),
        "completed",
      ],
    ] as const;

    for (const [event, state] of events) {
      expect(
        createStorefrontContextTrackingEnvelope({
          event,
          baseContext,
        }),
      ).toMatchObject({
        eventId: "storefront.checkout_state_changed",
        payload: { state },
      });
    }
  });
});
