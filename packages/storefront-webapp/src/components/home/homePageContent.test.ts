import { describe, expect, it } from "vitest";

import { resolveHomepageContent } from "./homePageContent";

describe("resolveHomepageContent", () => {
  it("sorts best sellers and featured content into homepage sections", () => {
    const bestSellerSkuA = { _id: "sku-a", sku: "A" } as any;
    const bestSellerSkuB = { _id: "sku-b", sku: "B" } as any;

    const result = resolveHomepageContent({
      bestSellers: [
        { rank: 2, productSku: bestSellerSkuB },
        { rank: 1, productSku: bestSellerSkuA },
      ],
      featured: [
        { _id: "featured-2", rank: 2, type: "regular" },
        { _id: "featured-shop", rank: 1, type: "shop_look", productId: "shop-look" },
        { _id: "featured-1", rank: 0, type: "regular" },
      ],
    });

    expect(result.bestSellersProducts).toEqual([bestSellerSkuA, bestSellerSkuB]);
    expect(result.featuredSectionSorted.map((item) => item._id)).toEqual([
      "featured-1",
      "featured-2",
    ]);
    expect(result.shopLookProduct?._id).toBe("featured-shop");
    expect(result.hasHomepageData).toBe(true);
  });
});

