import { describe, expect, it } from "vitest";

import {
  BEST_SELLERS_LIMIT,
  FEATURED_ITEMS_LIMIT,
  buildHomepageSnapshotV1,
  get,
  getHomepageSnapshotWithCtx,
  hydrateHomepageRowsUntil,
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
      quantityAvailable: 4,
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
  it("hydrates ranked candidates in bounded batches until the visible quota is full", async () => {
    const hydrated: number[] = [];
    const rows = Array.from({ length: 100 }, (_, index) => index);

    const accepted = await hydrateHomepageRowsUntil({
      rows,
      batchSize: 4,
      hydrate: async (row) => {
        hydrated.push(row);
        return { row, visible: row >= 6 };
      },
      isComplete: (items) => items.filter((item) => item.visible).length >= 5,
    });

    expect(accepted.filter((item) => item.visible).map((item) => item.row)).toEqual([
      6, 7, 8, 9, 10, 11,
    ]);
    expect(hydrated).toEqual(Array.from({ length: 12 }, (_, index) => index));
  });

  it("uses store-scoped placement indexes and stops hydrating after the visible quota", async () => {
    const indexReads: Array<[string, string]> = [];
    const skuGets: string[] = [];
    const bestSellerRows = Array.from({ length: 100 }, (_, index) => ({
      _id: `best-${index}`,
      rank: index,
      productId: `product-${index}`,
      productSkuId: `sku-${index}`,
      storeId: "store-1",
    }));
    const db = {
      get: async (table: string, id: string) => {
        if (table === "store") return store;
        if (table === "category") return publicCategory;
        if (table === "subcategory") return publicSubcategory;
        if (table === "productSku") {
          skuGets.push(id);
          return {
            _id: id,
            images: [],
            isVisible: true,
            price: 12_500,
            productId: `product-${id.replace("sku-", "")}`,
            quantityAvailable: 2,
            storeId: "store-1",
          };
        }
        if (table === "product") {
          return {
            _id: id,
            availability: "live",
            categoryId: "category-1",
            currency: "GHS",
            isVisible: true,
            name: id,
            slug: id,
            storeId: "store-1",
            subcategoryId: "subcategory-1",
          };
        }
        return null;
      },
      query: (table: string) => {
        const chain = {
          first: async () => null,
          take: async (limit: number) => {
            if (table === "bestSeller") return bestSellerRows.slice(0, limit);
            if (table === "featuredItem") return [];
            if (table === "productSku") {
              const index = skuGets.length - 1;
              return [
                {
                  _id: `sku-${index}`,
                  images: [],
                  isVisible: true,
                  price: 12_500,
                  productId: `product-${index}`,
                  quantityAvailable: 2,
                  storeId: "store-1",
                },
              ];
            }
            return [];
          },
          withIndex: (index: string, build?: (q: any) => unknown) => {
            indexReads.push([table, index]);
            const q = {
              eq: () => q,
            };
            build?.(q);
            return chain;
          },
        };
        return chain;
      },
    };

    const snapshot = await getHomepageSnapshotWithCtx(
      { db } as never,
      { storeId: "store-1" as never, nowMs: 1_000 },
    );

    expect(snapshot?.bestSellers).toHaveLength(BEST_SELLERS_LIMIT);
    expect(skuGets).toHaveLength(BEST_SELLERS_LIMIT);
    expect(indexReads).toContainEqual(["bestSeller", "by_storeId"]);
    expect(indexReads).toContainEqual(["featuredItem", "by_storeId"]);
  });

  it("finds a sellable best-seller sibling beyond the first twenty SKUs", async () => {
    const placedSku = {
      _id: "sku-placed",
      images: [],
      isVisible: true,
      price: 12_500,
      productId: "product-shared",
      quantityAvailable: 0,
      sku: "PLACED",
      storeId: "store-1",
    };
    const siblingSkus = [
      ...Array.from({ length: 21 }, (_, index) => ({
        ...placedSku,
        _id: `sku-sold-out-${index}`,
        sku: `SOLD-OUT-${index}`,
      })),
      {
        ...placedSku,
        _id: "sku-sellable",
        quantityAvailable: 3,
        sku: "SELLABLE",
      },
    ];
    const skuTakeLimits: number[] = [];
    const db = {
      get: async (table: string, id: string) => {
        if (table === "store") return store;
        if (table === "productSku") return placedSku;
        if (table === "product") {
          return {
            _id: id,
            availability: "live",
            categoryId: publicCategory._id,
            currency: "GHS",
            isVisible: true,
            name: "Shared product",
            slug: "shared-product",
            storeId: "store-1",
            subcategoryId: publicSubcategory._id,
          };
        }
        if (table === "category") return publicCategory;
        if (table === "subcategory") return publicSubcategory;
        return null;
      },
      query: (table: string) => {
        const chain = {
          first: async () => null,
          take: async (limit: number) => {
            if (table === "bestSeller") {
              return [
                {
                  _id: "best-seller-placed",
                  productSkuId: placedSku._id,
                  rank: 0,
                  storeId: "store-1",
                },
              ];
            }
            if (table === "productSku") {
              skuTakeLimits.push(limit);
              return siblingSkus.slice(0, limit);
            }
            return [];
          },
          withIndex: (_index: string, build?: (q: any) => unknown) => {
            const q = { eq: () => q };
            build?.(q);
            return chain;
          },
        };
        return chain;
      },
    };

    const snapshot = await getHomepageSnapshotWithCtx(
      { db } as never,
      { storeId: "store-1" as never, nowMs: 1_000 },
    );

    expect(snapshot?.bestSellers[0]?.productSku).toMatchObject({
      skuId: "sku-sellable",
      sku: "SELLABLE",
      quantityAvailable: 3,
    });
    expect(skuTakeLimits).toEqual([100]);
  });

  it("hydrates a late shop-look independently from the regular featured quota", async () => {
    const categoryGets: string[] = [];
    const featuredRows = [
      ...Array.from({ length: 99 }, (_, index) => ({
        _id: `featured-${index}`,
        categoryId: `category-${index}`,
        rank: index,
        storeId: "store-1",
        type: "regular",
      })),
      {
        _id: "featured-shop-look",
        categoryId: "category-shop-look",
        rank: 99,
        storeId: "store-1",
        type: "shop_look",
      },
    ];
    const db = {
      get: async (table: string, id: string) => {
        if (table === "store") return store;
        if (table === "category") {
          categoryGets.push(id);
          return {
            ...publicCategory,
            _id: id,
            slug: id,
          };
        }
        return null;
      },
      query: (table: string) => {
        const chain = {
          first: async () => null,
          take: async (limit: number) =>
            table === "featuredItem" ? featuredRows.slice(0, limit) : [],
          withIndex: (_index: string, build?: (q: any) => unknown) => {
            const q = { eq: () => q };
            build?.(q);
            return chain;
          },
        };
        return chain;
      },
    };

    const snapshot = await getHomepageSnapshotWithCtx(
      { db } as never,
      { storeId: "store-1" as never, nowMs: 1_000 },
    );

    expect(snapshot?.featuredItems).toHaveLength(FEATURED_ITEMS_LIMIT);
    expect(snapshot?.shopLook?.id).toBe("featured-shop-look");
    expect(categoryGets).toHaveLength(FEATURED_ITEMS_LIMIT + 1);
  });

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
    expect(snapshot.bestSellers[0].productSku.quantityAvailable).toBe(4);
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
    expect(snapshot.featuredItems[2].subcategory?.categorySlug).toBe(
      "lace-fronts",
    );
    expect(snapshot.shopLook?.id).toBe("shop-look");
    expect(JSON.stringify(snapshot)).not.toContain("omission");
    expect(JSON.stringify(snapshot)).not.toContain("_creationTime");
    expect(() => assertConformsToExportedReturns(get, snapshot)).not.toThrow();
  });

  it("sorts legacy unranked best sellers after ranked rows", () => {
    const unranked = sku("unranked", 0);
    delete (unranked as { rank?: number }).rank;

    const snapshot = buildHomepageSnapshotV1({
      store,
      nowMs: 1_000,
      bestSellers: [unranked, sku("ranked", 0)],
      featuredItems: [],
    });

    expect(snapshot.bestSellers.map((item) => item.productSku.sku)).toEqual([
      "SKU-ranked",
      "SKU-unranked",
    ]);
    expect(snapshot.bestSellers.map((item) => item.rank)).toEqual([0, 1]);
  });

  it("uses a sellable sibling SKU when a best-seller placement points at a sold-out SKU", () => {
    const placedSoldOutSku = sku("placed", 1, {
      quantityAvailable: 0,
      product: {
        _id: "product-shared",
        storeId: "store-1",
        name: "Shared product",
        slug: "shared-product",
        currency: "GHS",
        availability: "live",
        isVisible: true,
        categoryId: "category-1",
        subcategoryId: "subcategory-1",
        skus: [
          {
            _id: "sku-sold-out",
            storeId: "store-1",
            productId: "product-shared",
            sku: "SOLD-OUT",
            images: ["https://cdn.example.com/sold-out.webp"],
            isVisible: true,
            price: 12_500,
            quantityAvailable: 0,
          },
          {
            _id: "sku-in-stock",
            storeId: "store-1",
            productId: "product-shared",
            sku: "IN-STOCK",
            images: ["https://cdn.example.com/in-stock.webp"],
            isVisible: true,
            price: 13_500,
            quantityAvailable: 3,
          },
        ],
      },
    });

    const snapshot = buildHomepageSnapshotV1({
      store,
      nowMs: 1_000,
      bestSellers: [placedSoldOutSku],
      featuredItems: [],
    });

    expect(snapshot.bestSellers[0].productSku).toMatchObject({
      skuId: "sku-in-stock",
      sku: "IN-STOCK",
      quantityAvailable: 3,
    });
  });

  it("presents contiguous ranks when explicit ranks are not zero-based", () => {
    const unranked = sku("unranked", 0);
    delete (unranked as { rank?: number }).rank;

    const snapshot = buildHomepageSnapshotV1({
      store,
      nowMs: 1_000,
      bestSellers: [unranked, sku("ranked", 5)],
      featuredItems: [],
    });

    expect(snapshot.bestSellers.map((item) => item.productSku.sku)).toEqual([
      "SKU-ranked",
      "SKU-unranked",
    ]);
    expect(snapshot.bestSellers.map((item) => item.rank)).toEqual([0, 1]);
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

  it("does not publish legacy highlighted rows that have no explicit section type", () => {
    const snapshot = buildHomepageSnapshotV1({
      store,
      nowMs: 2_000,
      featuredItems: [
        {
          _id: "legacy-highlight",
          rank: 0,
          category: {
            ...publicCategory,
            products: [
              {
                _id: "legacy-product",
                storeId: "store-1",
                name: "Legacy product",
                slug: "legacy-product",
                currency: "GHS",
                availability: "live",
                isVisible: true,
                categoryId: "category-1",
                subcategoryId: "subcategory-1",
                category: publicCategory,
                subcategory: publicSubcategory,
                skus: [
                  {
                    _id: "sku-legacy",
                    storeId: "store-1",
                    productId: "legacy-product",
                    images: [],
                    isVisible: true,
                    price: 12_000,
                    quantityAvailable: 2,
                  },
                ],
              },
            ],
          },
        },
      ],
    });

    expect(snapshot.featuredItems).toEqual([]);
    expect(snapshot.shopLook).toBeNull();
  });
});
