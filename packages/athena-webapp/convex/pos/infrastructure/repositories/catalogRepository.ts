import type { Doc, Id } from "../../../_generated/dataModel";
import type { QueryCtx } from "../../../_generated/server";

const CONVEX_PRODUCT_ID_PATTERN = /^[a-z0-9]{32}$/;

export type CatalogProductMatch = {
  product: Doc<"product">;
  sku: Doc<"productSku">;
};

export function isConvexProductId(value: string): value is Id<"product"> {
  return CONVEX_PRODUCT_ID_PATTERN.test(value);
}

async function readAllQueryResults<T>(query: AsyncIterable<T>) {
  const results: T[] = [];

  for await (const item of query) {
    results.push(item);
  }

  return results;
}

export async function getProductById(ctx: QueryCtx, productId: Id<"product">) {
  return ctx.db.get("product", productId);
}

export async function getCategoryById(
  ctx: QueryCtx,
  categoryId: Id<"category"> | undefined,
) {
  if (!categoryId) {
    return null;
  }

  return ctx.db.get("category", categoryId);
}

export async function getColorById(
  ctx: QueryCtx,
  colorId: Id<"color"> | undefined,
) {
  if (!colorId) {
    return null;
  }

  return ctx.db.get("color", colorId);
}

export async function listProductSkusByProductId(
  ctx: QueryCtx,
  productId: Id<"product">,
) {
  return readAllQueryResults(
    ctx.db
      .query("productSku")
      .withIndex("by_productId", (q) => q.eq("productId", productId)),
  );
}

export async function findStoreSkuByBarcode(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
    barcode: string;
  },
) {
  return ctx.db
    .query("productSku")
    .withIndex("by_storeId_barcode", (q) =>
      q.eq("storeId", args.storeId).eq("barcode", args.barcode),
    )
    .first();
}

export async function findStoreSkuBySku(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
    sku: string;
  },
) {
  return ctx.db
    .query("productSku")
    .withIndex("by_storeId_sku", (q) =>
      q.eq("storeId", args.storeId).eq("sku", args.sku),
    )
    .first();
}

function normalizeLookupCode(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized ? normalized : undefined;
}

export async function findActivePendingCheckoutLookupAliasByCode(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
    lookupCode: string;
  },
) {
  const normalizedLookupCode = normalizeLookupCode(args.lookupCode);
  if (!normalizedLookupCode) {
    return null;
  }

  return ctx.db
    .query("posPendingCheckoutLookupAlias")
    .withIndex("by_storeId_normalizedLookupCode_status", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("normalizedLookupCode", normalizedLookupCode)
        .eq("status", "active"),
    )
    .first();
}

export async function findActiveProvisionalImportSkuForStoreSku(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
    productSkuId: Id<"productSku">;
  },
) {
  const row = await ctx.db
    .query("inventoryImportProvisionalSku")
    .withIndex("by_storeId_productSkuId_status", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("productSkuId", args.productSkuId)
        .eq("status", "active"),
    )
    .first();

  return row?.posExposureStatus === "available" ? row : null;
}

export async function listMatchingStoreSkus(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
    searchQuery: string;
  },
): Promise<CatalogProductMatch[]> {
  const matches: CatalogProductMatch[] = [];
  const productCache = new Map<Id<"product">, Doc<"product"> | null>();

  for await (const sku of ctx.db
    .query("productSku")
    .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))) {
    let product = productCache.get(sku.productId);

    if (product === undefined) {
      product = (await ctx.db.get("product", sku.productId)) ?? null;
      productCache.set(sku.productId, product);
    }

    if (
      !product ||
      product.storeId !== args.storeId ||
      product.availability === "archived"
    ) {
      continue;
    }

    const barcodeMatches =
      sku.barcode?.toLowerCase().includes(args.searchQuery) ?? false;
    const skuMatches =
      sku.sku?.toLowerCase().includes(args.searchQuery) ?? false;
    const nameMatches = product.name.toLowerCase().includes(args.searchQuery);
    const productIdMatches = product._id
      .toLowerCase()
      .includes(args.searchQuery);
    const descriptionMatches =
      product.description?.toLowerCase().includes(args.searchQuery) ?? false;

    if (
      barcodeMatches ||
      skuMatches ||
      nameMatches ||
      descriptionMatches ||
      productIdMatches
    ) {
      matches.push({ product, sku });
    }
  }

  return matches;
}
