import type { Doc, Id } from "../../../_generated/dataModel";
import type { QueryCtx } from "../../../_generated/server";

import {
  findActiveProvisionalImportSkuForStoreSku,
  findActivePendingCheckoutLookupAliasByCode,
  findStoreSkuByBarcode,
  findStoreSkuBySku,
  getCategoryById,
  getColorById,
  getProductById,
  isConvexProductId,
  listMatchingStoreSkus,
  listProductSkusByProductId,
} from "../../infrastructure/repositories/catalogRepository";

type CatalogResult = {
  id: Id<"productSku">;
  name: string;
  sku: string;
  barcode: string;
  price: number;
  category: string;
  description: string;
  inStock: boolean;
  quantityAvailable: number;
  image: string | null;
  size: string;
  length: number | null;
  color: string;
  productId: Id<"product">;
  skuId: Id<"productSku">;
  areProcessingFeesAbsorbed: boolean;
  pendingCheckoutItemId?: Id<"posPendingCheckoutItem">;
  pendingCheckoutAliasState?: "linked_to_catalog";
};

const POS_OPERATIONAL_CATEGORY_SLUGS = new Set([
  "legacy-import",
  "pos-pending-checkout",
  "pos-quick-add",
]);

function isDraftAllowedInTrustedCatalog(categorySlug?: string) {
  return (
    categorySlug === "legacy-import" || categorySlug === "pos-pending-checkout"
  );
}

function isTrustedCatalogResult(args: {
  product: NonNullable<Awaited<ReturnType<typeof getProductById>>>;
  sku: Doc<"productSku">;
  category?: Awaited<ReturnType<typeof getCategoryById>>;
}) {
  const isReservedPosOperationalProduct = args.category?.slug
    ? POS_OPERATIONAL_CATEGORY_SLUGS.has(args.category.slug)
    : false;
  const isDraftAllowed = isDraftAllowedInTrustedCatalog(args.category?.slug);

  return (
    args.product.availability !== "archived" &&
    (args.product.availability !== "draft" || isDraftAllowed) &&
    (args.product.isVisible !== false || isReservedPosOperationalProduct) &&
    (args.sku.isVisible !== false || isDraftAllowed)
  );
}

function getTrustedCatalogPrice(sku: Doc<"productSku">) {
  return sku.netPrice ?? sku.price;
}

async function isSuppressedByActiveLegacyImportProvisionalRow(
  ctx: QueryCtx,
  args: {
    category?: Awaited<ReturnType<typeof getCategoryById>>;
    product: NonNullable<Awaited<ReturnType<typeof getProductById>>>;
    sku: Doc<"productSku">;
    storeId: Id<"store">;
  },
) {
  return (
    args.category?.slug === "legacy-import" &&
    (args.product.availability === "draft" ||
      args.product.isVisible === false ||
      args.sku.isVisible === false) &&
    Boolean(
      await findActiveProvisionalImportSkuForStoreSku(ctx, {
        storeId: args.storeId,
        productSkuId: args.sku._id,
      }),
    )
  );
}

async function isPendingCheckoutLookupAliasVisible(
  ctx: QueryCtx,
  args: {
    alias: NonNullable<
      Awaited<ReturnType<typeof findActivePendingCheckoutLookupAliasByCode>>
    >;
    storeId: Id<"store">;
  },
) {
  const pendingItem = await ctx.db.get(
    "posPendingCheckoutItem",
    args.alias.pendingCheckoutItemId,
  );
  if (!pendingItem || pendingItem.storeId !== args.storeId) {
    return false;
  }

  let productId = pendingItem.provisionalProductId;
  if (pendingItem.provisionalProductSkuId) {
    const provisionalSku = await ctx.db.get(
      "productSku",
      pendingItem.provisionalProductSkuId,
    );
    if (!provisionalSku || provisionalSku.storeId !== args.storeId) {
      return false;
    }
    productId = provisionalSku.productId;
  }

  if (!productId) {
    return true;
  }

  const product = await ctx.db.get("product", productId);
  return (
    product !== null &&
    product.storeId === args.storeId &&
    product.availability !== "archived"
  );
}

async function mapSkuToCatalogResult(
  ctx: QueryCtx,
  args: {
    product: Awaited<ReturnType<typeof getProductById>>;
    sku: Doc<"productSku">;
    category?: Awaited<ReturnType<typeof getCategoryById>>;
    categoryName?: string;
    pendingCheckoutItemId?: Id<"posPendingCheckoutItem">;
    pendingCheckoutAliasState?: "linked_to_catalog";
  },
): Promise<CatalogResult | null> {
  const category =
    args.category ??
    (args.product ? await getCategoryById(ctx, args.product.categoryId) : null);

  if (
    !args.product ||
    !isTrustedCatalogResult({
      product: args.product,
      sku: args.sku,
      category,
    }) ||
    getTrustedCatalogPrice(args.sku) <= 0
  ) {
    return null;
  }

  const categoryName = args.categoryName ?? category?.name ?? "";
  const color = (await getColorById(ctx, args.sku.color))?.name ?? "";

  return {
    id: args.sku._id,
    name: args.product.name,
    sku: args.sku.sku || "",
    barcode: args.sku.barcode || "",
    price: getTrustedCatalogPrice(args.sku),
    category: categoryName,
    description: args.product.description || "",
    inStock: args.sku.quantityAvailable > 0,
    quantityAvailable: args.sku.quantityAvailable,
    image: args.sku.images?.[0] || null,
    size: args.sku.size || "",
    length: args.sku.length || null,
    color,
    productId: args.product._id,
    skuId: args.sku._id,
    areProcessingFeesAbsorbed: args.product.areProcessingFeesAbsorbed || false,
    pendingCheckoutItemId: args.pendingCheckoutItemId,
    pendingCheckoutAliasState: args.pendingCheckoutAliasState,
  };
}

export async function searchProducts(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
    searchQuery: string;
  },
) {
  if (!args.searchQuery.trim()) {
    return [];
  }

  const query = args.searchQuery.toLowerCase().trim();

  if (isConvexProductId(query)) {
    const product = await getProductById(ctx, query as Id<"product">);
    const category =
      product?.storeId === args.storeId
        ? await getCategoryById(ctx, product.categoryId)
        : null;

    if (
      product?.storeId === args.storeId &&
      product.availability !== "archived" &&
      (product.availability !== "draft" ||
        isDraftAllowedInTrustedCatalog(category?.slug)) &&
      (product.isVisible !== false ||
        POS_OPERATIONAL_CATEGORY_SLUGS.has(category?.slug ?? ""))
    ) {
      const productSkus = await listProductSkusByProductId(ctx, product._id);
      const categoryName = category?.name || "";
      const results = await Promise.all(
        productSkus.map(async (sku) =>
          (await isSuppressedByActiveLegacyImportProvisionalRow(ctx, {
            category,
            product,
            sku,
            storeId: args.storeId,
          }))
            ? null
            : mapSkuToCatalogResult(ctx, {
                product,
                sku,
                category,
                categoryName,
              }),
        ),
      );

      return results.filter(
        (result): result is CatalogResult => result !== null,
      );
    }
  }

  const matchingSkus = await listMatchingStoreSkus(ctx, {
    storeId: args.storeId,
    searchQuery: query,
  });
  const aliasMatchesBySkuId = new Map<
    Id<"productSku">,
    {
      pendingCheckoutItemId: Id<"posPendingCheckoutItem">;
      pendingCheckoutAliasState: "linked_to_catalog";
    }
  >();
  const aliasMatch = await findActivePendingCheckoutLookupAliasByCode(ctx, {
    storeId: args.storeId,
    lookupCode: query,
  });
  const visibleAliasMatch =
    aliasMatch &&
    (await isPendingCheckoutLookupAliasVisible(ctx, {
      alias: aliasMatch,
      storeId: args.storeId,
    }))
      ? aliasMatch
      : null;
  if (visibleAliasMatch) {
    aliasMatchesBySkuId.set(visibleAliasMatch.productSkuId, {
      pendingCheckoutItemId: visibleAliasMatch.pendingCheckoutItemId,
      pendingCheckoutAliasState: "linked_to_catalog",
    });
    const aliasSku = await ctx.db.get(
      "productSku",
      visibleAliasMatch.productSkuId,
    );
    const aliasProduct = aliasSku
      ? await getProductById(ctx, aliasSku.productId)
      : null;
    if (
      aliasSku &&
      aliasProduct &&
      aliasProduct.storeId === args.storeId &&
      !matchingSkus.some(({ sku }) => sku._id === aliasSku._id)
    ) {
      matchingSkus.unshift({ product: aliasProduct, sku: aliasSku });
    }
  }
  const results = await Promise.all(
    matchingSkus.map(async ({ product, sku }) => {
      const category =
        product?.storeId === args.storeId
          ? await getCategoryById(ctx, product.categoryId)
          : null;

      if (
        await isSuppressedByActiveLegacyImportProvisionalRow(ctx, {
          category,
          product,
          sku,
          storeId: args.storeId,
        })
      ) {
        return null;
      }

      return mapSkuToCatalogResult(ctx, {
        product,
        sku,
        category,
        ...aliasMatchesBySkuId.get(sku._id),
      });
    }),
  );

  return results.filter((result): result is CatalogResult => result !== null);
}

export async function lookupByBarcode(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
    barcode: string;
  },
): Promise<CatalogResult | CatalogResult[] | null> {
  if (!args.barcode.trim()) {
    return null;
  }

  let sku = await findStoreSkuByBarcode(ctx, args);

  if (!sku) {
    sku = await findStoreSkuBySku(ctx, {
      storeId: args.storeId,
      sku: args.barcode,
    });
  }

  let aliasMatch: Awaited<
    ReturnType<typeof findActivePendingCheckoutLookupAliasByCode>
  > | null = null;
  if (!sku) {
    const matchedAlias = await findActivePendingCheckoutLookupAliasByCode(ctx, {
      storeId: args.storeId,
      lookupCode: args.barcode,
    });
    aliasMatch =
      matchedAlias &&
      (await isPendingCheckoutLookupAliasVisible(ctx, {
        alias: matchedAlias,
        storeId: args.storeId,
      }))
        ? matchedAlias
        : null;
    sku = aliasMatch
      ? await ctx.db.get("productSku", aliasMatch.productSkuId)
      : null;
  }

  if (!sku) {
    const product = isConvexProductId(args.barcode)
      ? await getProductById(ctx, args.barcode as Id<"product">)
      : null;
    const category =
      product?.storeId === args.storeId
        ? await getCategoryById(ctx, product.categoryId)
        : null;

    if (
      product?.storeId === args.storeId &&
      product.availability !== "archived" &&
      (product.availability !== "draft" ||
        isDraftAllowedInTrustedCatalog(category?.slug)) &&
      (product.isVisible !== false ||
        POS_OPERATIONAL_CATEGORY_SLUGS.has(category?.slug ?? ""))
    ) {
      const allSkus = await listProductSkusByProductId(ctx, product._id);
      const categoryName = category?.name || "";
      const results = await Promise.all(
        allSkus.map(async (productSku) =>
          (await isSuppressedByActiveLegacyImportProvisionalRow(ctx, {
            category,
            product,
            sku: productSku,
            storeId: args.storeId,
          }))
            ? null
            : mapSkuToCatalogResult(ctx, {
                product,
                sku: productSku,
                category,
                categoryName,
              }),
        ),
      );

      return results.filter(
        (result): result is CatalogResult => result !== null,
      );
    }
  }

  if (!sku) {
    return null;
  }

  const product = await getProductById(ctx, sku.productId);
  const category =
    product?.storeId === args.storeId
      ? await getCategoryById(ctx, product.categoryId)
      : null;
  if (
    !product ||
    product.availability === "archived" ||
    (product.availability === "draft" &&
      !isDraftAllowedInTrustedCatalog(category?.slug)) ||
    (product.isVisible === false &&
      !POS_OPERATIONAL_CATEGORY_SLUGS.has(category?.slug ?? ""))
  ) {
    return null;
  }

  if (
    await isSuppressedByActiveLegacyImportProvisionalRow(ctx, {
      category,
      product,
      sku,
      storeId: args.storeId,
    })
  ) {
    return null;
  }

  return mapSkuToCatalogResult(ctx, {
    product,
    sku,
    category,
    pendingCheckoutItemId: aliasMatch?.pendingCheckoutItemId,
    pendingCheckoutAliasState: aliasMatch ? "linked_to_catalog" : undefined,
  });
}
