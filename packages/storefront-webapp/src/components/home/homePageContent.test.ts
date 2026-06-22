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

  it("sorts legacy unranked best sellers after ranked rows", () => {
    const rankedSku = { _id: "sku-ranked", sku: "R" } as any;
    const unrankedSku = { _id: "sku-unranked", sku: "U" } as any;

    const result = resolveHomepageContent({
      bestSellers: [
        { productSku: unrankedSku },
        { rank: 1, productSku: rankedSku },
      ],
    });

    expect(result.bestSellersProducts).toEqual([rankedSku, unrankedSku]);
  });

  it("resolves snapshot sections without converting minor-unit prices", () => {
    const result = resolveHomepageContent({
      snapshot: {
        contractVersion: "homepage_snapshot.v1",
        generatedAtMs: 1,
        store: {} as any,
        hero: {} as any,
        bannerMessage: null,
        bestSellers: [
          {
            rank: 1,
            id: "best-seller-1",
            productSku: {
              productId: "product-1",
              productSlug: "middle-part-bob",
              productName: "Middle Part Bob",
              skuId: "sku-1",
              sku: "MPB-12",
              imageUrls: ["image.jpg"],
              currency: "GHS",
              priceAmountMinor: 12999,
              netPriceAmountMinor: null,
              quantityAvailable: 4,
            },
          },
        ],
        featuredItems: [
          {
            id: "highlight-1",
            rank: 1,
            type: "regular",
            targetKind: "product",
            category: null,
            subcategory: null,
            product: {
              productId: "product-2",
              productSlug: "side-part-bob",
              productName: "Side Part Bob",
              skuId: "sku-2",
              sku: "SPB-14",
              imageUrls: ["featured.jpg"],
              currency: "GHS",
              priceAmountMinor: 6500,
              netPriceAmountMinor: null,
              quantityAvailable: 4,
            },
          },
          {
            id: "highlight-category",
            rank: 2,
            type: "regular",
            targetKind: "category",
            product: null,
            subcategory: null,
            category: {
              categoryId: "category-1",
              name: "Closures",
              slug: "closures",
              products: [
                {
                  productId: "product-3",
                  productSlug: "closure-unit",
                  productName: "Closure Unit",
                  skuId: "sku-3",
                  sku: "CLU-16",
                  imageUrls: ["closure.jpg"],
                  currency: "GHS",
                  priceAmountMinor: 5000,
                  netPriceAmountMinor: null,
                  quantityAvailable: 4,
                },
              ],
            },
          },
        ],
        shopLook: {
          id: "shop-look",
          rank: 1,
          type: "shop_look",
          targetKind: "product",
          category: null,
          subcategory: null,
          product: {
            productId: "product-shop-look",
            productSlug: "shop-look-product",
            productName: "Shop Look",
            skuId: "sku-shop-look",
            sku: null,
            imageUrls: [],
            currency: "GHS",
            priceAmountMinor: 7000,
            netPriceAmountMinor: null,
            quantityAvailable: 4,
          },
        },
      },
    });

    expect(result.bestSellersProducts).toMatchObject([
      {
        _id: "sku-1",
        productId: "middle-part-bob",
        price: 12999,
      },
    ]);
    expect(result.featuredSectionSorted[0]?.product?.skus[0]?.price).toBe(6500);
    expect(result.featuredSectionSorted.map((item) => item._id)).toEqual([
      "highlight-1",
      "highlight-category",
    ]);
    expect(
      result.featuredSectionSorted[1]?.category?.products[0]?._id,
    ).toBe("closure-unit");
    expect(result.shopLookProduct?.productId).toBe("shop-look-product");
    expect(result.hasHomepageData).toBe(true);
  });

  it("preserves parent category slug for snapshot subcategory highlights", () => {
    const result = resolveHomepageContent({
      snapshot: {
        contractVersion: "homepage_snapshot.v1",
        generatedAtMs: 1,
        store: {} as any,
        hero: {} as any,
        bannerMessage: null,
        bestSellers: [],
        featuredItems: [
          {
            id: "highlight-subcategory",
            rank: 1,
            type: "regular",
            targetKind: "subcategory",
            product: null,
            category: null,
            subcategory: {
              categoryId: "category-home-care",
              categorySlug: "home-care",
              subcategoryId: "subcategory-dispensers",
              name: "Dispensers",
              slug: "dispensers",
              products: [
                {
                  productId: "product-dispenser",
                  productSlug: "soap-dispenser",
                  productName: "Soap Dispenser",
                  skuId: "sku-dispenser",
                  sku: null,
                  imageUrls: ["soap.jpg"],
                  currency: "GHS",
                  priceAmountMinor: 4500,
                  netPriceAmountMinor: null,
                  quantityAvailable: 4,
                },
              ],
            },
          },
        ],
        shopLook: null,
      },
    });

    expect(result.featuredSectionSorted[0]?.subcategory).toMatchObject({
      categorySlug: "home-care",
      slug: "dispensers",
    });
  });

  it("treats null snapshot sections as ready empty homepage content", () => {
    const result = resolveHomepageContent({
      snapshot: {
        contractVersion: "homepage_snapshot.v1",
        generatedAtMs: 1,
        store: {} as any,
        hero: {} as any,
        bannerMessage: null,
        bestSellers: [],
        featuredItems: [],
        shopLook: null,
      },
    });

    expect(result.bestSellersProducts).toEqual([]);
    expect(result.featuredSectionSorted).toEqual([]);
    expect(result.shopLookProduct).toBeUndefined();
    expect(result.hasHomepageData).toBe(false);
  });
});
