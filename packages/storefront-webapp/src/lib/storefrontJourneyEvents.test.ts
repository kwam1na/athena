import { describe, expect, it } from "vitest";

import {
  createAuthEntryViewedEvent,
  createAuthVerificationSucceededEvent,
  createBagAddSucceededEvent,
  createCategoryBrowseViewedEvent,
  createCheckoutCompletionBlockedEvent,
  createCheckoutCompletionCanceledEvent,
  createCheckoutCompletionSucceededEvent,
  createLandingPageViewedEvent,
  createOrderReviewViewedEvent,
  createPaymentSubmissionStartedEvent,
  createProductDetailViewedEvent,
} from "./storefrontJourneyEvents";

describe("storefront journey events", () => {
  it("creates the landing page browse milestone", () => {
    expect(createLandingPageViewedEvent()).toEqual({
      journey: "browse",
      step: "landing_page",
      status: "viewed",
    });
  });

  it("creates category and product discovery milestones with context", () => {
    expect(
      createCategoryBrowseViewedEvent({
        categorySlug: "hair",
        subcategorySlug: "closures",
      }),
    ).toEqual({
      journey: "product_discovery",
      step: "category_browse",
      status: "viewed",
      context: {
        categorySlug: "hair",
        subcategorySlug: "closures",
      },
    });

    expect(
      createProductDetailViewedEvent({
        productId: "product_123",
        productSku: "sku_123",
        categorySlug: "hair",
      }),
    ).toEqual({
      journey: "product_discovery",
      step: "product_detail",
      status: "viewed",
      context: {
        productId: "product_123",
        productSku: "sku_123",
        categorySlug: "hair",
      },
    });
  });

  it("creates bag and checkout progression milestones", () => {
    expect(
      createBagAddSucceededEvent({
        productId: "product_123",
        productSku: "sku_123",
        quantity: 1,
      }),
    ).toEqual({
      journey: "bag",
      step: "bag_add",
      status: "succeeded",
      context: {
        productId: "product_123",
        productSku: "sku_123",
        quantity: 1,
      },
    });

    expect(
      createOrderReviewViewedEvent({
        checkoutSessionId: "checkout_123",
      }),
    ).toEqual({
      journey: "checkout",
      step: "order_review",
      status: "viewed",
      context: {
        checkoutSessionId: "checkout_123",
      },
    });

    expect(
      createPaymentSubmissionStartedEvent({
        checkoutSessionId: "checkout_123",
        paymentMethod: "online_payment",
      }),
    ).toEqual({
      journey: "checkout",
      step: "payment_submission",
      status: "started",
      context: {
        checkoutSessionId: "checkout_123",
        paymentMethod: "online_payment",
      },
    });
  });

  it("creates canonical checkout terminal milestones", () => {
    expect(
      createCheckoutCompletionSucceededEvent({
        checkoutSessionId: "checkout_123",
        orderId: "order_123",
      }),
    ).toEqual({
      journey: "checkout",
      step: "checkout_completion",
      status: "succeeded",
      context: {
        checkoutSessionId: "checkout_123",
        orderId: "order_123",
      },
    });

    expect(
      createCheckoutCompletionBlockedEvent({
        checkoutSessionId: "checkout_123",
        orderId: "order_123",
      }),
    ).toEqual({
      journey: "checkout",
      step: "checkout_completion",
      status: "blocked",
      context: {
        checkoutSessionId: "checkout_123",
        orderId: "order_123",
      },
    });

    expect(
      createCheckoutCompletionCanceledEvent({
        checkoutSessionId: "checkout_123",
      }),
    ).toEqual({
      journey: "checkout",
      step: "checkout_completion",
      status: "canceled",
      context: {
        checkoutSessionId: "checkout_123",
      },
    });
  });

  it("creates auth continuity milestones", () => {
    expect(
      createAuthEntryViewedEvent({
        mode: "login",
        origin: "guest-rewards",
        email: "shopper@example.com",
      }),
    ).toEqual({
      journey: "auth",
      step: "login_entry",
      status: "viewed",
      context: {
        entryOrigin: "guest-rewards",
        email: "shopper@example.com",
      },
    });

    expect(
      createAuthVerificationSucceededEvent({
        email: "shopper@example.com",
      }),
    ).toEqual({
      journey: "auth",
      step: "auth_verification",
      status: "succeeded",
      context: {
        email: "shopper@example.com",
      },
    });
  });
});
