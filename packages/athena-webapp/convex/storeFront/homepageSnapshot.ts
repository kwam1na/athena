import { v } from "convex/values";
import { query, type QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { normalizeStoreConfig } from "../inventory/storeConfigV2";
import {
  presentPublicBannerMessage,
  publicBannerMessageValidator,
} from "../inventory/bannerMessage";

export const HOMEPAGE_SNAPSHOT_CONTRACT_VERSION = "homepage_snapshot.v1" as const;
export const BEST_SELLERS_LIMIT = 12;
export const FEATURED_ITEMS_LIMIT = 12;
export const FEATURED_ITEM_PRODUCTS_LIMIT = 5;
export const HOMEPAGE_SNAPSHOT_SCAN_LIMIT = 100;

const RESERVED_STOREFRONT_CATEGORY_SLUGS = new Set(["pos-quick-add"]);
const RESERVED_STOREFRONT_SUBCATEGORY_SLUGS = new Set(["uncategorized"]);

type AnyRecord = Record<string, any>;

const nullableStringValidator = v.union(v.string(), v.null());
const nullableNumberValidator = v.union(v.number(), v.null());

export const homepageProductSkuValidator = v.object({
  productId: v.string(),
  productSlug: v.string(),
  productName: v.string(),
  skuId: v.string(),
  sku: nullableStringValidator,
  imageUrls: v.array(v.string()),
  currency: v.string(),
  priceAmountMinor: v.number(),
  netPriceAmountMinor: nullableNumberValidator,
  colorName: nullableStringValidator,
  size: nullableStringValidator,
  length: nullableNumberValidator,
});

const homepageCategoryValidator = v.object({
  categoryId: v.string(),
  name: v.string(),
  slug: v.string(),
  products: v.array(homepageProductSkuValidator),
});

const homepageSubcategoryValidator = v.object({
  subcategoryId: v.string(),
  categoryId: v.string(),
  name: v.string(),
  slug: v.string(),
  products: v.array(homepageProductSkuValidator),
});

const homepageFeaturedItemValidator = v.object({
  id: v.string(),
  rank: v.number(),
  type: v.union(v.literal("regular"), v.literal("shop_look")),
  targetKind: v.union(
    v.literal("product"),
    v.literal("category"),
    v.literal("subcategory"),
  ),
  product: v.union(homepageProductSkuValidator, v.null()),
  category: v.union(homepageCategoryValidator, v.null()),
  subcategory: v.union(homepageSubcategoryValidator, v.null()),
});

export const homepageSnapshotV1Validator = v.object({
  contractVersion: v.literal(HOMEPAGE_SNAPSHOT_CONTRACT_VERSION),
  generatedAtMs: v.number(),
  store: v.object({
    id: v.string(),
    organizationId: v.string(),
    name: v.string(),
    slug: v.string(),
    currency: v.string(),
  }),
  hero: v.object({
    displayType: v.union(v.literal("reel"), v.literal("image")),
    headerImageUrl: nullableStringValidator,
    showOverlay: v.boolean(),
    showText: v.boolean(),
    activeReelVersion: nullableNumberValidator,
    activeReelHlsUrl: nullableStringValidator,
    fallbackImageUrl: nullableStringValidator,
    shopTheLookImageUrl: nullableStringValidator,
  }),
  bannerMessage: publicBannerMessageValidator,
  bestSellers: v.array(
    v.object({
      id: v.string(),
      rank: v.number(),
      productSku: homepageProductSkuValidator,
    }),
  ),
  featuredItems: v.array(homepageFeaturedItemValidator),
  shopLook: v.union(homepageFeaturedItemValidator, v.null()),
});

const stringOrNull = (value: unknown): string | null => {
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

const numberOrNull = (value: unknown): number | null => {
  return typeof value === "number" ? value : null;
};

const rowId = (row: AnyRecord) => String(row._id ?? row.id ?? "");

const rowRank = (row: AnyRecord) => {
  return typeof row.rank === "number" ? row.rank : 0;
};

const sortByRankThenId = <T extends AnyRecord>(rows: T[]): T[] => {
  return [...rows].sort((a, b) => {
    const rankDelta = rowRank(a) - rowRank(b);
    if (rankDelta !== 0) {
      return rankDelta;
    }
    return rowId(a).localeCompare(rowId(b));
  });
};

const isCustomerVisibleCategory = (category: AnyRecord | null | undefined) => {
  if (!category) {
    return false;
  }
  if (category.showOnStorefront === false) {
    return false;
  }
  return !RESERVED_STOREFRONT_CATEGORY_SLUGS.has(category.slug);
};

const isCustomerVisibleSubcategory = (
  subcategory: AnyRecord | null | undefined,
) => {
  if (!subcategory) {
    return false;
  }
  return !RESERVED_STOREFRONT_SUBCATEGORY_SLUGS.has(subcategory.slug);
};

const isCustomerVisibleProduct = (
  product: AnyRecord | null | undefined,
  storeId: string,
) => {
  return Boolean(
    product &&
      product.storeId === storeId &&
      product.availability === "live" &&
      product.isVisible !== false,
  );
};

const isCustomerVisibleSku = (
  sku: AnyRecord | null | undefined,
  product: AnyRecord,
  storeId: string,
) => {
  return Boolean(
    sku &&
      sku.storeId === storeId &&
      sku.productId === product._id &&
      sku.isVisible !== false &&
      typeof sku.price === "number" &&
      sku.price > 0,
  );
};

const presentProductSku = (
  sku: AnyRecord | null | undefined,
  storeId: string,
) => {
  const product = sku?.product;
  const category = sku?.category;
  const subcategory = sku?.subcategory;

  if (
    !isCustomerVisibleProduct(product, storeId) ||
    !isCustomerVisibleSku(sku, product, storeId) ||
    !isCustomerVisibleCategory(category) ||
    !isCustomerVisibleSubcategory(subcategory)
  ) {
    return null;
  }

  const publicSku = sku as AnyRecord;
  const publicProduct = product as AnyRecord;

  return {
    productId: String(publicProduct._id),
    productSlug: publicProduct.slug,
    productName: publicProduct.name,
    skuId: String(publicSku._id),
    sku: stringOrNull(publicSku.sku),
    imageUrls: Array.isArray(publicSku.images)
      ? publicSku.images.filter(
          (image: unknown): image is string => typeof image === "string",
        )
      : [],
    currency: publicProduct.currency,
    priceAmountMinor: publicSku.price,
    netPriceAmountMinor: numberOrNull(publicSku.netPrice),
    colorName: stringOrNull(publicSku.colorName),
    size: stringOrNull(publicSku.size),
    length: numberOrNull(publicSku.length),
  };
};

const skusFromProduct = (product: AnyRecord) => {
  return Array.isArray(product.skus) ? product.skus : [];
};

const presentProduct = (
  product: AnyRecord | null | undefined,
  storeId: string,
  category?: AnyRecord | null,
  subcategory?: AnyRecord | null,
) => {
  if (!isCustomerVisibleProduct(product, storeId)) {
    return null;
  }

  const publicProduct = product as AnyRecord;
  const publicSkus = sortByRankThenId(skusFromProduct(publicProduct))
    .map((sku) =>
      presentProductSku(
        {
          ...sku,
          product: publicProduct,
          category: category ?? publicProduct.category,
          subcategory: subcategory ?? publicProduct.subcategory,
        },
        storeId,
      ),
    )
    .filter((item): item is NonNullable<typeof item> => item !== null);

  return publicSkus[0] ?? null;
};

const presentCategory = (
  category: AnyRecord | null | undefined,
  storeId: string,
) => {
  if (!isCustomerVisibleCategory(category) || category?.storeId !== storeId) {
    return null;
  }

  const products = Array.isArray(category.products)
    ? category.products
        .map((product: AnyRecord) =>
          presentProduct(product, storeId, category, product.subcategory),
        )
        .filter((item): item is NonNullable<typeof item> => item !== null)
        .slice(0, FEATURED_ITEM_PRODUCTS_LIMIT)
    : [];

  return {
    categoryId: String(category._id),
    name: category.name,
    slug: category.slug,
    products,
  };
};

const presentSubcategory = (
  subcategory: AnyRecord | null | undefined,
  storeId: string,
) => {
  if (
    !isCustomerVisibleSubcategory(subcategory) ||
    subcategory?.storeId !== storeId ||
    !isCustomerVisibleCategory(subcategory?.category)
  ) {
    return null;
  }

  const products = Array.isArray(subcategory.products)
    ? subcategory.products
        .map((product: AnyRecord) =>
          presentProduct(product, storeId, product.category, subcategory),
        )
        .filter((item): item is NonNullable<typeof item> => item !== null)
        .slice(0, FEATURED_ITEM_PRODUCTS_LIMIT)
    : [];

  return {
    subcategoryId: String(subcategory._id),
    categoryId: String(subcategory.categoryId),
    name: subcategory.name,
    slug: subcategory.slug,
    products,
  };
};

const presentFeaturedItem = (item: AnyRecord, storeId: string) => {
  const type: "regular" | "shop_look" =
    item.type === "shop_look" ? "shop_look" : "regular";
  const product = presentProduct(
    item.product,
    storeId,
    item.category,
    item.subcategory,
  );

  if (product) {
    return {
      id: rowId(item),
      rank: rowRank(item),
      type,
      targetKind: "product" as const,
      product,
      category: null,
      subcategory: null,
    };
  }

  const category = presentCategory(item.category, storeId);
  if (category) {
    return {
      id: rowId(item),
      rank: rowRank(item),
      type,
      targetKind: "category" as const,
      product: null,
      category,
      subcategory: null,
    };
  }

  const subcategory = presentSubcategory(item.subcategory, storeId);
  if (subcategory) {
    return {
      id: rowId(item),
      rank: rowRank(item),
      type,
      targetKind: "subcategory" as const,
      product: null,
      category: null,
      subcategory,
    };
  }

  return null;
};

export const buildHomepageSnapshotV1 = ({
  store,
  nowMs,
  bannerMessage,
  bestSellers,
  featuredItems,
}: {
  store: AnyRecord;
  nowMs: number;
  bannerMessage?: AnyRecord | null;
  bestSellers?: AnyRecord[];
  featuredItems?: AnyRecord[];
}) => {
  const storeId = String(store._id);
  const config = normalizeStoreConfig(store.config);

  const bestSellerItems = sortByRankThenId(bestSellers ?? [])
    .map((item) => {
      const productSku = presentProductSku(item.productSku, storeId);
      if (!productSku) {
        return null;
      }

      return {
        id: rowId(item),
        rank: rowRank(item),
        productSku,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .slice(0, BEST_SELLERS_LIMIT);

  const presentedFeatured = sortByRankThenId(featuredItems ?? [])
    .map((item) => presentFeaturedItem(item, storeId))
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const featuredRegular = presentedFeatured
    .filter((item) => item.type === "regular")
    .slice(0, FEATURED_ITEMS_LIMIT);
  const shopLook = presentedFeatured.find((item) => item.type === "shop_look") ?? null;

  return {
    contractVersion: HOMEPAGE_SNAPSHOT_CONTRACT_VERSION,
    generatedAtMs: nowMs,
    store: {
      id: storeId,
      organizationId: String(store.organizationId),
      name: store.name,
      slug: store.slug,
      currency: store.currency,
    },
    hero: {
      displayType: config.media.homeHero.displayType,
      headerImageUrl: stringOrNull(config.media.homeHero.headerImage),
      showOverlay: config.media.homeHero.showOverlay,
      showText: config.media.homeHero.showText,
      activeReelVersion: numberOrNull(config.media.reels.activeVersion),
      activeReelHlsUrl: stringOrNull(config.media.reels.activeHlsUrl),
      fallbackImageUrl: stringOrNull(config.media.images.fallbackImageUrl),
      shopTheLookImageUrl: stringOrNull(config.media.images.shopTheLookImage),
    },
    bannerMessage: presentPublicBannerMessage(
      (bannerMessage ?? null) as Parameters<typeof presentPublicBannerMessage>[0],
      nowMs,
    ),
    bestSellers: bestSellerItems,
    featuredItems: featuredRegular,
    shopLook,
  };
};

async function hydrateProduct(
  ctx: QueryCtx,
  product: AnyRecord,
  storeId: Id<"store">,
) {
  const [category, subcategory, skus] = await Promise.all([
    ctx.db.get("category", product.categoryId),
    ctx.db.get("subcategory", product.subcategoryId),
    ctx.db
      .query("productSku")
      .withIndex("by_productId", (q) => q.eq("productId", product._id))
      .take(FEATURED_ITEM_PRODUCTS_LIMIT * 4),
  ]);

  return {
    ...product,
    category,
    subcategory,
    skus: skus.filter((sku) => sku.storeId === storeId),
  };
}

async function hydrateTargetProducts(
  ctx: QueryCtx,
  storeId: Id<"store">,
  target:
    | { kind: "category"; id: Id<"category"> }
    | { kind: "subcategory"; id: Id<"subcategory"> },
) {
  const productsQuery = ctx.db
    .query("product")
    .withIndex("by_storeId", (q) => q.eq("storeId", storeId));

  const products =
    target.kind === "category"
      ? await productsQuery
          .filter((q) => q.eq(q.field("categoryId"), target.id))
          .take(HOMEPAGE_SNAPSHOT_SCAN_LIMIT)
      : await productsQuery
          .filter((q) => q.eq(q.field("subcategoryId"), target.id))
          .take(HOMEPAGE_SNAPSHOT_SCAN_LIMIT);

  const hydratedProducts = await Promise.all(
    products.map((product) => hydrateProduct(ctx, product, storeId)),
  );

  return hydratedProducts.slice(0, FEATURED_ITEM_PRODUCTS_LIMIT);
}

async function hydrateCategory(
  ctx: QueryCtx,
  category: AnyRecord,
  storeId: Id<"store">,
) {
  const hydratedProducts = await hydrateTargetProducts(ctx, storeId, {
    kind: "category",
    id: category._id,
  });

  return {
    ...category,
    products: hydratedProducts,
  };
}

async function hydrateSubcategory(
  ctx: QueryCtx,
  subcategory: AnyRecord,
  storeId: Id<"store">,
) {
  const [category, hydratedProducts] = await Promise.all([
    ctx.db.get("category", subcategory.categoryId),
    hydrateTargetProducts(ctx, storeId, {
      kind: "subcategory",
      id: subcategory._id,
    }),
  ]);

  return {
    ...subcategory,
    category,
    products: hydratedProducts,
  };
}

async function hydrateBestSeller(ctx: QueryCtx, item: AnyRecord) {
  const sku = await ctx.db.get("productSku", item.productSkuId);
  if (!sku) {
    return { ...item, productSku: null };
  }

  const product = await ctx.db.get("product", sku.productId);
  if (!product) {
    return { ...item, productSku: null };
  }

  const [category, subcategory] = await Promise.all([
    ctx.db.get("category", product.categoryId),
    ctx.db.get("subcategory", product.subcategoryId),
  ]);

  return {
    ...item,
    productSku: {
      ...sku,
      product,
      category,
      subcategory,
    },
  };
}

async function hydrateFeaturedItem(
  ctx: QueryCtx,
  item: AnyRecord,
  storeId: Id<"store">,
) {
  const hydrated: AnyRecord = { ...item };

  if (item.productId) {
    const product = await ctx.db.get("product", item.productId);
    hydrated.product = product
      ? await hydrateProduct(ctx, product, storeId)
      : null;
    hydrated.category = hydrated.product?.category ?? null;
    hydrated.subcategory = hydrated.product?.subcategory ?? null;
    return hydrated;
  }

  if (item.categoryId) {
    const category = await ctx.db.get("category", item.categoryId);
    hydrated.category = category
      ? await hydrateCategory(ctx, category, storeId)
      : null;
    return hydrated;
  }

  if (item.subcategoryId) {
    const subcategory = await ctx.db.get("subcategory", item.subcategoryId);
    hydrated.subcategory = subcategory
      ? await hydrateSubcategory(ctx, subcategory, storeId)
      : null;
  }

  return hydrated;
}

export const get = query({
  args: {
    storeId: v.id("store"),
    nowMs: v.number(),
  },
  returns: v.union(homepageSnapshotV1Validator, v.null()),
  handler: async (ctx, args) => {
    const store = await ctx.db.get("store", args.storeId);
    if (!store) {
      return null;
    }

    const [bannerMessage, bestSellerRows, featuredRows] = await Promise.all([
      ctx.db
        .query("bannerMessage")
        .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
        .first(),
      ctx.db
        .query("bestSeller")
        .filter((q) => q.eq(q.field("storeId"), args.storeId))
        .take(HOMEPAGE_SNAPSHOT_SCAN_LIMIT),
      ctx.db
        .query("featuredItem")
        .filter((q) => q.eq(q.field("storeId"), args.storeId))
        .take(HOMEPAGE_SNAPSHOT_SCAN_LIMIT),
    ]);

    const [bestSellers, featuredItems] = await Promise.all([
      Promise.all(bestSellerRows.map((item) => hydrateBestSeller(ctx, item))),
      Promise.all(
        featuredRows.map((item) =>
          hydrateFeaturedItem(ctx, item, args.storeId),
        ),
      ),
    ]);

    return buildHomepageSnapshotV1({
      store,
      nowMs: args.nowMs,
      bannerMessage,
      bestSellers,
      featuredItems,
    });
  },
});
