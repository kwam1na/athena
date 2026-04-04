import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("V26-169 time/query refactors", () => {
  it("adds the indexes needed for offers, reviews, guests, and analytics lookups", () => {
    const schemaSource = readSource("convex/schema.ts").replace(/\s+/g, " ");

    expect(schemaSource).toContain(
      '.index("by_storeFrontUserId_storeId", ["storeFrontUserId", "storeId"])'
    );
    expect(schemaSource).toContain(
      '.index("by_action_productId", ["action", "productId"])'
    );
    expect(schemaSource).toContain('.index("by_marker", ["marker"])');
    expect(schemaSource).toContain('.index("by_storeFrontUserId_promoCodeId", [');
    expect(schemaSource).toContain('"storeFrontUserId", "promoCodeId"');
    expect(schemaSource).toContain('.index("by_storeId_status", ["storeId", "status"])');
    expect(schemaSource).toContain(
      '.index("by_createdByStoreFrontUserId", ["createdByStoreFrontUserId"])'
    );
    expect(schemaSource).toContain(
      '.index("by_createdByStoreFrontUserId_productSkuId", ['
    );
    expect(schemaSource).toContain(
      '"createdByStoreFrontUserId", "productSkuId"'
    );
    expect(schemaSource).toContain('.index("by_productSkuId", ["productSkuId"])');
    expect(schemaSource).toContain('.index("by_storeId", ["storeId"])');
    expect(schemaSource).toContain('.index("by_productId", ["productId"])');
  });

  it("removes direct Date.now usage from scoped query modules", () => {
    const analyticsSource = readSource("convex/storeFront/analytics.ts");
    const userOffersSource = readSource("convex/storeFront/userOffers.ts");
    const bannerMessageSource = readSource("convex/inventory/bannerMessage.ts");

    expect(analyticsSource).not.toContain("Date.now(");
    expect(userOffersSource).not.toContain("Date.now(");
    expect(bannerMessageSource).not.toContain("Date.now(");

    expect(userOffersSource).toContain("currentTimeMs");
    expect(bannerMessageSource).toContain("expireActiveBannerMessage");
    expect(bannerMessageSource).toContain("ctx.scheduler.runAt(");
  });

  it("uses indexed access patterns in the remaining V26-169 hotspots", () => {
    const offersSource = readSource("convex/storeFront/offers.ts");
    const reviewsSource = readSource("convex/storeFront/reviews.ts");
    const guestSource = readSource("convex/storeFront/guest.ts");
    const analyticsSource = readSource("convex/storeFront/analytics.ts");

    expect(offersSource).toContain('.withIndex("by_storeId_status"');
    expect(offersSource).toContain('.withIndex("by_storeFrontUserId_promoCodeId"');
    expect(offersSource).toContain(".take(");

    expect(reviewsSource).toContain('.withIndex("by_createdByStoreFrontUserId"');
    expect(reviewsSource).toContain(
      '.withIndex("by_createdByStoreFrontUserId_productSkuId"'
    );
    expect(reviewsSource).toContain('.withIndex("by_productSkuId"');
    expect(reviewsSource).toContain('.withIndex("by_productId"');

    expect(guestSource).toContain('.withIndex("by_marker"');
    expect(analyticsSource).toContain('.withIndex("by_storeFrontUserId_storeId"');
    expect(analyticsSource).toContain('.withIndex("by_action_productId"');
  });
});
