/* eslint-disable @convex-dev/no-collect-in-query -- Catalog summary repair intentionally scans a store's catalog once at admin/backfill boundaries. */
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { internalMutation } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { v } from "convex/values";

export type CatalogSummary = {
  categoryCount: number;
  missingInfoProductCount: number;
  needsRefresh?: boolean;
  outOfStockProductCount: number;
  productCount: number;
};

export const EMPTY_CATALOG_SUMMARY: CatalogSummary = {
  categoryCount: 0,
  missingInfoProductCount: 0,
  outOfStockProductCount: 0,
  productCount: 0,
};

export async function computeCatalogSummary(
  ctx: Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">,
  storeId: Id<"store">,
): Promise<CatalogSummary> {
  const [products, skus, categories] = await Promise.all([
    ctx.db
      .query("product")
      .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
      .collect(),
    ctx.db
      .query("productSku")
      .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
      .collect(),
    ctx.db
      .query("category")
      .withIndex("by_storeId_slug", (q) => q.eq("storeId", storeId))
      .collect(),
  ]);

  const catalogProductIds = new Set<Id<"product">>();
  const inventoryCountsByProductId = new Map<Id<"product">, number>();
  const hasMissingInfoByProductId = new Set<Id<"product">>();

  for (const product of products) {
    if (product.availability === "archived") continue;

    catalogProductIds.add(product._id);
    inventoryCountsByProductId.set(product._id, 0);
  }

  for (const sku of skus) {
    if (!catalogProductIds.has(sku.productId)) continue;

    inventoryCountsByProductId.set(
      sku.productId,
      (inventoryCountsByProductId.get(sku.productId) ?? 0) +
        (sku.inventoryCount || 0),
    );

    if ((sku.images ?? []).length === 0 || (sku.price ?? 0) === 0) {
      hasMissingInfoByProductId.add(sku.productId);
    }
  }

  return {
    categoryCount: categories.length,
    missingInfoProductCount: hasMissingInfoByProductId.size,
    outOfStockProductCount: Array.from(
      inventoryCountsByProductId.values(),
    ).filter((inventoryCount) => inventoryCount === 0).length,
    productCount: catalogProductIds.size,
  };
}

export async function refreshCatalogSummaryWithCtx(
  ctx: Pick<MutationCtx, "db">,
  storeId: Id<"store">,
) {
  const summary = await computeCatalogSummary(ctx, storeId);
  const existing = await ctx.db
    .query("catalogSummary")
    .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
    .first();
  const value = {
    ...summary,
    needsRefresh: false,
    storeId,
    updatedAt: Date.now(),
  };

  if (existing) {
    await ctx.db.patch("catalogSummary", existing._id, value);
    return existing._id;
  }

  return await ctx.db.insert("catalogSummary", value);
}

export async function markCatalogSummaryNeedsRefresh(
  ctx: Pick<MutationCtx, "db">,
  storeId: Id<"store">,
) {
  let existing: { _id: Id<"catalogSummary">; needsRefresh?: boolean } | null =
    null;

  try {
    const indexedQuery = ctx.db
      .query("catalogSummary")
      .withIndex("by_storeId", (q) => q.eq("storeId", storeId));
    if (typeof indexedQuery.first !== "function") {
      return undefined;
    }
    existing = await indexedQuery.first();
  } catch {
    return undefined;
  }

  if (existing) {
    if (existing.needsRefresh) {
      return existing._id;
    }

    await ctx.db.patch("catalogSummary", existing._id, {
      needsRefresh: true,
      updatedAt: Date.now(),
    });
    return existing._id;
  }

  const id = await ctx.db.insert("catalogSummary", {
    ...EMPTY_CATALOG_SUMMARY,
    needsRefresh: true,
    storeId,
    updatedAt: Date.now(),
  });
  return id;
}

export const refreshCatalogSummaryInternal = internalMutation({
  args: {
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    return await refreshCatalogSummaryWithCtx(ctx, args.storeId);
  },
});

export const markCatalogSummaryNeedsRefreshInternal = internalMutation({
  args: {
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    return await markCatalogSummaryNeedsRefresh(ctx, args.storeId);
  },
});
