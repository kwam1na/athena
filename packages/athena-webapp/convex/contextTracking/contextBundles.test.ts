import { describe, expect, it } from "vitest";

import {
  buildStoreInsightsContextBundleFromAnalytics,
  buildUserInsightsContextBundleFromAnalytics,
} from "./contextBundles";

type AnalyticsRow = Parameters<
  typeof buildStoreInsightsContextBundleFromAnalytics
>[0][number];

function analyticsRow(overrides: Partial<AnalyticsRow> = {}): AnalyticsRow {
  return {
    _id: "analytics_1" as AnalyticsRow["_id"],
    _creationTime: 1_700_000_000_000,
    storeId: "store_1" as AnalyticsRow["storeId"],
    storeFrontUserId: "guest_1" as AnalyticsRow["storeFrontUserId"],
    action: "viewed_product",
    data: {},
    device: "mobile",
    productId: "product_1" as AnalyticsRow["productId"],
    ...overrides,
  };
}

describe("context bundle storefront analytics compilation", () => {
  it("builds store bundles from compiled historic analytics rows", () => {
    const bundle = buildStoreInsightsContextBundleFromAnalytics([
      analyticsRow({
        _id: "analytics_valid" as AnalyticsRow["_id"],
        _creationTime: 1_700_000_000_100,
        data: { categorySlug: "wigs" },
      }),
      analyticsRow({
        _id: "analytics_invalid" as AnalyticsRow["_id"],
        productId: undefined,
        data: {},
      }),
      analyticsRow({
        _id: "analytics_synthetic" as AnalyticsRow["_id"],
        origin: "synthetic_monitor",
      }),
    ]);

    expect(bundle).toMatchObject({
      bundleKind: "store_insights_context",
      freshness: "current",
      dataWindowStartAt: 1_700_000_000_100,
      dataWindowEndAt: 1_700_000_000_100,
      hiddenSourceCount: 1,
      omittedEvidenceCount: 1,
      limitedEvidence: false,
    });
    expect(bundle.qualityFlags).toEqual([
      "legacy_analytics_compiled",
      "legacy_analytics_omitted",
    ]);
    expect(bundle.sourceRefs).toEqual([
      {
        table: "analytics",
        id: "analytics_valid",
        label: "storefront.product_viewed",
      },
    ]);
    expect(readCompactAnalytics(bundle)).toMatchObject([
      {
        id: "analytics_valid",
        contextEventId: "storefront.product_viewed",
        contextSchemaVersion: 1,
        payload: { productId: "product_1", categorySlug: "wigs" },
      },
    ]);
  });

  it("keeps user actor source refs separate from analytics evidence refs", () => {
    const bundle = buildUserInsightsContextBundleFromAnalytics(
      [
        analyticsRow({
          _id: "analytics_user" as AnalyticsRow["_id"],
          action: "added_product_to_bag",
          productId: undefined,
          data: { product: "product_1", quantity: 2 },
        }),
      ],
      { table: "guest", id: "guest_1" },
    );

    expect(bundle.sourceRefs).toEqual([
      { table: "guest", id: "guest_1" },
      {
        table: "analytics",
        id: "analytics_user",
        label: "storefront.cart_changed",
      },
    ]);
    expect(bundle.hiddenSourceCount).toBe(0);
    expect(readCompactAnalytics(bundle)).toMatchObject([
      {
        contextEventId: "storefront.cart_changed",
        payload: { productId: "product_1", quantity: 2 },
      },
    ]);
  });

  it("counts analytics evidence hidden behind the source-ref cap", () => {
    const rows = Array.from({ length: 27 }, (_, index) =>
      analyticsRow({
        _id: `analytics_${index}` as AnalyticsRow["_id"],
        _creationTime: 1_700_000_000_000 + index,
        productId: `product_${index}` as AnalyticsRow["productId"],
      }),
    );

    const bundle = buildStoreInsightsContextBundleFromAnalytics(rows);

    expect(bundle.sourceRefs).toHaveLength(25);
    expect(bundle.hiddenSourceCount).toBe(2);
    expect(bundle.omittedEvidenceCount).toBe(0);
  });

  it("marks bundles partial when no storefront context can be compiled", () => {
    const bundle = buildStoreInsightsContextBundleFromAnalytics([
      analyticsRow({
        productId: undefined,
        data: {},
      }),
    ]);

    expect(bundle).toMatchObject({
      freshness: "partial",
      hiddenSourceCount: 1,
      omittedEvidenceCount: 1,
      limitedEvidence: true,
    });
    expect(bundle.qualityFlags).toEqual([
      "no_storefront_context",
      "legacy_analytics_omitted",
    ]);
  });
});

function readCompactAnalytics(bundle: { payloadSummary: Record<string, unknown> }) {
  return bundle.payloadSummary.compactAnalytics;
}
