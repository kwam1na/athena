import { describe, expect, it } from "vitest";

import {
  compileLegacyStorefrontAnalyticsRow,
  compileLegacyStorefrontAnalyticsRows,
  compileLegacyStorefrontAnalyticsRowsWithReport,
} from "./legacyStorefrontAnalytics";

type LegacyRow = Parameters<typeof compileLegacyStorefrontAnalyticsRow>[0];

function analyticsRow(overrides: Partial<LegacyRow> = {}): LegacyRow {
  return {
    _id: "analytics_1" as LegacyRow["_id"],
    _creationTime: 1_700_000_000_000,
    action: "viewed_product",
    data: {},
    device: "mobile",
    origin: "web",
    productId: "product_1" as LegacyRow["productId"],
    storeFrontUserId: "guest_1" as LegacyRow["storeFrontUserId"],
    ...overrides,
  };
}

describe("legacy storefront analytics context compilation", () => {
  it("maps historic product analytics rows to storefront context primitives", () => {
    expect(
      compileLegacyStorefrontAnalyticsRow(
        analyticsRow({
          data: {
            categorySlug: "wigs",
            productSku: "lace-front-1",
            email: "customer@example.com",
            nested: { unsafe: true },
          },
        }),
      ),
    ).toMatchObject({
      _id: "analytics_1",
      action: "storefront.product_viewed",
      contextEventId: "storefront.product_viewed",
      contextSchemaVersion: 1,
      payload: {
        productId: "product_1",
        categorySlug: "wigs",
        sku: "lace-front-1",
      },
      sourceTable: "analytics",
      sourceId: "analytics_1",
    });
  });

  it("maps storefront observability rows to the closest registered context event", () => {
    expect(
      compileLegacyStorefrontAnalyticsRow(
        analyticsRow({
          action: "storefront_observability",
          productId: undefined,
          data: {
            journey: "checkout",
            step: "payment_submission",
            status: "started",
            checkoutSessionId: "checkout_1",
            route: "/checkout",
          },
        }),
      ),
    ).toMatchObject({
      action: "storefront.checkout_state_changed",
      payload: {
        checkoutSessionId: "checkout_1",
        state: "started",
      },
    });
  });

  it("excludes synthetic monitor rows from business context", () => {
    expect(
      compileLegacyStorefrontAnalyticsRows([
        analyticsRow({ origin: "synthetic_monitor" }),
        analyticsRow({ _id: "analytics_2" as LegacyRow["_id"] }),
      ]),
    ).toHaveLength(1);
  });

  it("reports omitted legacy evidence when rows cannot compile", () => {
    expect(
      compileLegacyStorefrontAnalyticsRowsWithReport([
        analyticsRow({
          productId: undefined,
          data: {},
        }),
        analyticsRow({ _id: "analytics_2" as LegacyRow["_id"] }),
      ]),
    ).toMatchObject({
      sourceRowCount: 2,
      contextRows: [{ sourceId: "analytics_2" }],
      omittedEvidenceCount: 1,
      qualityFlags: ["legacy_analytics_omitted"],
    });
  });

  it.each([
    [
      "added_product_to_bag",
      { product: "product_legacy", quantity: 2, status: "succeeded" },
      "storefront.cart_changed",
      { productId: "product_legacy", quantity: 2 },
    ],
    [
      "added_product_to_saved",
      { product: "product_saved" },
      "storefront.cart_changed",
      { productId: "product_saved" },
    ],
    [
      "deleted_product_from_saved",
      { product: "product_saved" },
      "storefront.cart_changed",
      { productId: "product_saved" },
    ],
    [
      "checkout_initiated",
      { checkoutSessionId: "checkout_1", status: "started" },
      "storefront.checkout_state_changed",
      { checkoutSessionId: "checkout_1", state: "started" },
    ],
    [
      "viewed_page",
      { route: "/collections/wigs?email=customer@example.com&token=secret" },
      "storefront.route_viewed",
      { route: "/collections/wigs" },
    ],
    [
      "clicked_on_leave_review_trigger",
      { promoCodeId: "promo_1", route: "/review?phone=5551231234" },
      "storefront.route_viewed",
      { route: "/review", promoCodeId: "promo_1" },
    ],
  ])("maps production legacy action %s", (action, data, eventId, payload) => {
    expect(
      compileLegacyStorefrontAnalyticsRow(
        analyticsRow({
          action,
          productId: undefined,
          data,
          promoCodeId:
            "promoCodeId" in data
              ? ("promo_1" as LegacyRow["promoCodeId"])
              : undefined,
        }),
      ),
    ).toMatchObject({
      action: eventId,
      payload,
    });
  });

  it("drops raw checkout error text and payment-like references", () => {
    expect(
      compileLegacyStorefrontAnalyticsRow(
        analyticsRow({
          action: "checkout_failed",
          productId: undefined,
          data: {
            checkoutSessionId: "checkout_1",
            status: "failed",
            blocker: "card token leaked customer@example.com",
            orderId: "order_1",
          },
        }),
      ),
    ).toMatchObject({
      payload: {
        checkoutSessionId: "checkout_1",
        state: "failed",
        orderId: "order_1",
      },
    });
  });

  it("drops safe-shaped checkout blocker secrets", () => {
    expect(
      compileLegacyStorefrontAnalyticsRow(
        analyticsRow({
          action: "checkout_blocked",
          productId: undefined,
          data: {
            checkoutSessionId: "checkout_1",
            status: "blocked",
            blocker: "sk_live_abc123",
          },
        }),
      ),
    ).toMatchObject({
      payload: {
        checkoutSessionId: "checkout_1",
        state: "blocked",
      },
    });
  });

  it("drops safe-shaped checkout error category secrets", () => {
    expect(
      compileLegacyStorefrontAnalyticsRow(
        analyticsRow({
          action: "checkout_blocked",
          productId: undefined,
          data: {
            checkoutSessionId: "checkout_1",
            status: "blocked",
            errorCategory: "pm_abc123",
          },
        }),
      ),
    ).toMatchObject({
      payload: {
        checkoutSessionId: "checkout_1",
        state: "blocked",
      },
    });
  });

  it("drops sensitive absolute referrer hostnames", () => {
    expect(
      compileLegacyStorefrontAnalyticsRow(
        analyticsRow({
          action: "viewed_page",
          productId: undefined,
          data: {
            route: "/collections",
            referrer: "https://token-secret.example/path",
          },
        }),
      ),
    ).toMatchObject({
      payload: {
        route: "/collections",
      },
    });
  });

  it("drops product events that cannot satisfy the registered subject payload", () => {
    expect(
      compileLegacyStorefrontAnalyticsRow(
        analyticsRow({
          action: "viewed_product",
          productId: undefined,
          data: {},
        }),
      ),
    ).toBeNull();
  });
});
