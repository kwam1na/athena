import { describe, expect, it } from "vitest";

import {
  BEST_SELLERS_LIMIT,
  buildHomepageSnapshotV1,
  get,
  HOMEPAGE_SNAPSHOT_CONTRACT_VERSION,
} from "./homepageSnapshot";
import { assertConformsToExportedReturns } from "../lib/returnValidatorContract";

const store = {
  _id: "store-1",
  organizationId: "org-1",
  name: "Main store",
  slug: "main-store",
  currency: "GHS",
  config: {
    media: {
      homeHero: {
        displayType: "image",
        headerImage: "https://cdn.example.com/hero.webp",
        showOverlay: true,
        showText: false,
      },
      images: {
        shopTheLookImage: "https://cdn.example.com/shop-look.webp",
      },
    },
  },
};

const publicCategory = {
  _id: "category-1",
  name: "Lace fronts",
  slug: "lace-fronts",
  storeId: "store-1",
};

const publicSubcategory = {
  _id: "subcategory-1",
  name: "Closures",
  slug: "closures",
  categoryId: "category-1",
  storeId: "store-1",
};

function sku(id: string, rank: number, overrides: Record<string, unknown> = {}) {
  return {
    _id: `best-seller-${id}`,
    rank,
    storeId: "store-1",
    productId: `product-${id}`,
    productSkuId: `sku-${id}`,
    productSku: {
      _id: `sku-${id}`,
      storeId: "store-1",
      productId: `product-${id}`,
      sku: `SKU-${id}`,
      images: [`https://cdn.example.com/${id}.webp`],
      isVisible: true,
      price: 12_500,
      product: {
        _id: `product-${id}`,
        storeId: "store-1",
        name: `Product ${id}`,
        slug: `product-${id}`,
        currency: "GHS",
        availability: "live",
        isVisible: true,
        categoryId: "category-1",
        subcategoryId: "subcategory-1",
      },
      category: publicCategory,
      subcategory: publicSubcategory,
      ...overrides,
    },
  };
}

describe("homepage snapshot presenter", () => {
  it("projects customer-safe homepage sections with explicit minor-unit money", () => {
    const snapshot = buildHomepageSnapshotV1({
      store,
      nowMs: 1_000,
      bannerMessage: {
        active: true,
        heading: "  New arrivals  ",
        message: "Fresh styles are live.",
        countdownEndsAt: 5_000,
      },
      bestSellers: [
        sku("hidden", 0, { isVisible: false }),
        ...Array.from({ length: BEST_SELLERS_LIMIT + 2 }, (_, index) =>
          sku(String(index), BEST_SELLERS_LIMIT + 2 - index),
        ),
      ],
      featuredItems: [
        {
          _id: "featured-pos",
          rank: 0,
          type: "regular",
          category: {
            _id: "category-pos",
            name: "POS quick add",
            slug: "pos-quick-add",
            storeId: "store-1",
          },
        },
        {
          _id: "featured-product",
          rank: 1,
          type: "regular",
          product: {
            _id: "product-featured",
            storeId: "store-1",
            name: "Featured wig",
            slug: "featured-wig",
            currency: "GHS",
            availability: "live",
            isVisible: true,
            categoryId: "category-1",
            subcategoryId: "subcategory-1",
            skus: [
              {
                _id: "sku-featured",
                storeId: "store-1",
                productId: "product-featured",
                images: ["https://cdn.example.com/featured.webp"],
                isVisible: true,
                price: 20_000,
                sku: "FEATURED",
              },
            ],
          },
          category: publicCategory,
          subcategory: publicSubcategory,
        },
        {
          _id: "featured-category",
          rank: 2,
          type: "regular",
          category: {
            ...publicCategory,
            products: [
              {
                _id: "product-hidden-first",
                storeId: "store-1",
                name: "Hidden first",
                slug: "hidden-first",
                currency: "GHS",
                availability: "archived",
                isVisible: true,
                categoryId: "category-1",
                subcategoryId: "subcategory-1",
                category: publicCategory,
                subcategory: publicSubcategory,
                skus: [
                  {
                    _id: "sku-hidden-first",
                    storeId: "store-1",
                    productId: "product-hidden-first",
                    images: [],
                    isVisible: true,
                    price: 10_000,
                  },
                ],
              },
              {
                _id: "product-category",
                storeId: "store-1",
                name: "Category product",
                slug: "category-product",
                currency: "GHS",
                availability: "live",
                isVisible: true,
                categoryId: "category-1",
                subcategoryId: "subcategory-1",
                category: publicCategory,
                subcategory: publicSubcategory,
                skus: [
                  {
                    _id: "sku-category",
                    storeId: "store-1",
                    productId: "product-category",
                    images: [],
                    isVisible: true,
                    price: 16_000,
                  },
                ],
              },
            ],
          },
        },
        {
          _id: "featured-subcategory",
          rank: 3,
          type: "regular",
          subcategory: {
            ...publicSubcategory,
            category: publicCategory,
            products: [
              {
                _id: "product-subcategory",
                storeId: "store-1",
                name: "Subcategory product",
                slug: "subcategory-product",
                currency: "GHS",
                availability: "live",
                isVisible: true,
                categoryId: "category-1",
                subcategoryId: "subcategory-1",
                category: publicCategory,
                subcategory: publicSubcategory,
                skus: [
                  {
                    _id: "sku-subcategory",
                    storeId: "store-1",
                    productId: "product-subcategory",
                    images: [],
                    isVisible: true,
                    price: 17_000,
                  },
                ],
              },
            ],
          },
        },
        {
          _id: "featured-hidden-parent-subcategory",
          rank: 4,
          type: "regular",
          subcategory: {
            ...publicSubcategory,
            _id: "subcategory-hidden-parent",
            slug: "hidden-parent",
            category: {
              ...publicCategory,
              _id: "category-hidden-parent",
              showOnStorefront: false,
            },
            products: [
              {
                _id: "product-hidden-parent",
                storeId: "store-1",
                name: "Hidden parent product",
                slug: "hidden-parent-product",
                currency: "GHS",
                availability: "live",
                isVisible: true,
                categoryId: "category-hidden-parent",
                subcategoryId: "subcategory-hidden-parent",
                category: {
                  ...publicCategory,
                  _id: "category-hidden-parent",
                  showOnStorefront: false,
                },
                subcategory: {
                  ...publicSubcategory,
                  _id: "subcategory-hidden-parent",
                  slug: "hidden-parent",
                },
                skus: [
                  {
                    _id: "sku-hidden-parent",
                    storeId: "store-1",
                    productId: "product-hidden-parent",
                    images: [],
                    isVisible: true,
                    price: 17_000,
                  },
                ],
              },
            ],
          },
        },
        {
          _id: "shop-look",
          rank: 5,
          type: "shop_look",
          productId: "product-shop-look",
          product: {
            _id: "product-shop-look",
            storeId: "store-1",
            name: "Shop look",
            slug: "shop-look",
            currency: "GHS",
            availability: "live",
            isVisible: true,
            categoryId: "category-1",
            subcategoryId: "subcategory-1",
            skus: [
              {
                _id: "sku-shop-look",
                storeId: "store-1",
                productId: "product-shop-look",
                images: [],
                isVisible: true,
                price: 18_000,
              },
            ],
          },
          category: publicCategory,
          subcategory: publicSubcategory,
        },
      ],
    });

    expect(snapshot.contractVersion).toBe(HOMEPAGE_SNAPSHOT_CONTRACT_VERSION);
    expect(snapshot.bannerMessage).toEqual({
      heading: "New arrivals",
      message: "Fresh styles are live.",
      countdownEndsAt: 5_000,
    });
    expect(snapshot.bestSellers).toHaveLength(BEST_SELLERS_LIMIT);
    expect(snapshot.bestSellers[0].rank).toBe(1);
    expect(snapshot.bestSellers[0].productSku.priceAmountMinor).toBe(12_500);
    expect(snapshot.bestSellers[0].productSku).not.toHaveProperty("price");
    expect(snapshot.featuredItems.map((item) => item.id)).toEqual([
      "featured-product",
      "featured-category",
      "featured-subcategory",
    ]);
    expect(snapshot.featuredItems[1].category?.products.map((product) => product.productSlug)).toEqual([
      "category-product",
    ]);
    expect(snapshot.featuredItems[2].subcategory?.products.map((product) => product.productSlug)).toEqual([
      "subcategory-product",
    ]);
    expect(snapshot.shopLook?.id).toBe("shop-look");
    expect(JSON.stringify(snapshot)).not.toContain("omission");
    expect(JSON.stringify(snapshot)).not.toContain("_creationTime");
    expect(() => assertConformsToExportedReturns(get, snapshot)).not.toThrow();
  });

  it("uses arrays and nulls for empty or ineligible public content", () => {
    const snapshot = buildHomepageSnapshotV1({
      store,
      nowMs: 2_000,
      bannerMessage: {
        active: true,
        heading: "Expired",
        countdownEndsAt: 1_000,
      },
      bestSellers: [],
      featuredItems: [],
    });

    expect(snapshot.bannerMessage).toBeNull();
    expect(snapshot.bestSellers).toEqual([]);
    expect(snapshot.featuredItems).toEqual([]);
    expect(snapshot.shopLook).toBeNull();
  });
});
