import { describe, expect, it } from "vitest";
import type { Doc, Id } from "../_generated/dataModel";
import { buildCustomerObservabilityTimeline } from "./customerObservabilityTimelineData";

type AnalyticsDoc = Doc<"analytics"> & {
  userData?: {
    email?: string;
  };
  productInfo?: {
    name?: string;
    images?: string[];
    price?: number;
    currency?: string;
  };
};

function createAnalyticsEvent(
  overrides: Partial<AnalyticsDoc> & {
    data?: Record<string, unknown>;
  } = {},
): AnalyticsDoc {
  const { data, ...restOverrides } = overrides;
  const baseEvent: AnalyticsDoc = {
    _id: "analytics_1" as Id<"analytics">,
    _creationTime: 1,
    action: "storefront_observability",
    data: {},
    origin: "homepage",
    device: "desktop",
    storeFrontUserId: "guest_1" as Id<"guest">,
    storeId: "store_1" as Id<"store">,
  };

  return {
    ...baseEvent,
    ...restOverrides,
    data: {
      ...(data ?? {}),
    },
  };
}

describe("buildCustomerObservabilityTimeline", () => {
  it("returns observability-first summary and normalized user journey events", () => {
    const timeline = buildCustomerObservabilityTimeline([
      createAnalyticsEvent({
        _id: "analytics_latest" as Id<"analytics">,
        _creationTime: 300,
        data: {
          journey: "checkout",
          step: "payment_submission",
          status: "failed",
          sessionId: "session-2",
          route: "/shop/checkout",
          checkoutSessionId: "checkout_123",
          errorCategory: "network",
          errorCode: "timeout",
          errorMessage: "Request timed out",
        },
        userData: {
          email: "shopper@example.com",
        },
      }),
      createAnalyticsEvent({
        _id: "analytics_older" as Id<"analytics">,
        _creationTime: 200,
        data: {
          journey: "bag",
          step: "checkout_start",
          status: "started",
          sessionId: "session-2",
          checkoutSessionId: "checkout_123",
        },
      }),
      createAnalyticsEvent({
        _id: "analytics_product" as Id<"analytics">,
        _creationTime: 100,
        productId: "product_1" as Id<"product">,
        data: {
          journey: "product_discovery",
          step: "product_detail",
          status: "viewed",
          sessionId: "session-1",
          productSku: "SKU-1",
        },
        productInfo: {
          name: "Weekend Tote",
          images: ["https://example.com/image.png"],
          price: 120,
          currency: "GHS",
        },
      }),
      createAnalyticsEvent({
        _id: "analytics_legacy" as Id<"analytics">,
        _creationTime: 50,
        action: "viewed_product",
      }),
    ]);

    expect(timeline.summary).toEqual({
      totalEvents: 3,
      uniqueSessions: 2,
      failureCount: 1,
      latestEvent: {
        journey: "checkout",
        step: "payment_submission",
        status: "failed",
        _creationTime: 300,
      },
    });

    expect(timeline.events).toHaveLength(3);
    expect(timeline.events[0]).toMatchObject({
      journey: "checkout",
      step: "payment_submission",
      status: "failed",
      sessionId: "session-2",
      route: "/shop/checkout",
      checkoutSessionId: "checkout_123",
      errorCategory: "network",
      errorCode: "timeout",
      errorMessage: "Request timed out",
      userData: {
        email: "shopper@example.com",
      },
    });
    expect(timeline.events[2]).toMatchObject({
      journey: "product_discovery",
      step: "product_detail",
      status: "viewed",
      sessionId: "session-1",
      productId: "product_1",
      productSku: "SKU-1",
      productInfo: {
        name: "Weekend Tote",
      },
    });
  });

  it("falls back missing session and failure fields without dropping the event", () => {
    const timeline = buildCustomerObservabilityTimeline([
      createAnalyticsEvent({
        _id: "analytics_missing" as Id<"analytics">,
        _creationTime: 150,
        data: {
          journey: "auth",
          step: "auth_verification",
          status: "blocked",
        },
      }),
    ]);

    expect(timeline.summary.failureCount).toBe(1);
    expect(timeline.events[0]).toMatchObject({
      journey: "auth",
      step: "auth_verification",
      status: "blocked",
      sessionId: "unknown:analytics_missing",
      errorCategory: "unknown",
    });
  });

  it("keeps non-failure events free of synthetic error metadata", () => {
    const timeline = buildCustomerObservabilityTimeline([
      createAnalyticsEvent({
        _id: "analytics_clean" as Id<"analytics">,
        _creationTime: 175,
        data: {
          journey: "browse",
          step: "landing_page",
          status: "viewed",
          sessionId: "session-clean",
        },
      }),
    ]);

    expect(timeline.events[0]).toMatchObject({
      journey: "browse",
      step: "landing_page",
      status: "viewed",
      sessionId: "session-clean",
    });
    expect(timeline.events[0].errorCategory).toBeUndefined();
    expect(timeline.summary.failureCount).toBe(0);
  });
});
