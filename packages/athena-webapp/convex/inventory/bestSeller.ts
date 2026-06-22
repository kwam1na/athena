/* eslint-disable @convex-dev/no-collect-in-query -- Query refactors are tracked in V26-168, V26-169, and V26-170; this PR only hardens API boundaries. */
import { v } from "convex/values";
import {
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import {
  requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx,
} from "../lib/athenaUserAuth";

const entity = "bestSeller";

async function requireHomepageStoreAdmin(
  ctx: QueryCtx | MutationCtx,
  storeId: Id<"store">,
) {
  const store = await ctx.db.get("store", storeId);
  if (!store) {
    throw new Error("Store not found.");
  }

  const athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
  await requireOrganizationMemberRoleWithCtx(ctx, {
    allowedRoles: ["full_admin"],
    failureMessage: "You do not have access to manage homepage content.",
    organizationId: store.organizationId,
    userId: athenaUser._id,
  });

  return store;
}

const validateBestSellerPlacement = async (
  ctx: QueryCtx | MutationCtx,
  args: {
    productId: Id<"product">;
    productSkuId: Id<"productSku">;
    storeId: Id<"store">;
  },
) => {
  const [product, productSku] = await Promise.all([
    ctx.db.get("product", args.productId),
    ctx.db.get("productSku", args.productSkuId),
  ]);

  if (!product || !productSku) {
    throw new Error("Best seller product and SKU must exist.");
  }

  if (product.storeId !== args.storeId || productSku.storeId !== args.storeId) {
    throw new Error("Best seller product and SKU must belong to the same store.");
  }

  if (productSku.productId !== args.productId) {
    throw new Error("Best seller SKU must belong to the selected product.");
  }
};

export const create = mutation({
  args: {
    productId: v.id("product"),
    productSkuId: v.id("productSku"),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    await requireHomepageStoreAdmin(ctx, args.storeId);
    await validateBestSellerPlacement(ctx, args);

    const existing = await ctx.db
      .query(entity)
      .filter((q) => {
        return q.and(
          q.eq(q.field("productSkuId"), args.productSkuId),
          q.eq(q.field("storeId"), args.storeId)
        );
      })
      .first();

    if (existing) {
      return;
    }

    const id = await ctx.db.insert(entity, {
      productId: args.productId,
      productSkuId: args.productSkuId,
      storeId: args.storeId,
    });

    return await ctx.db.get("bestSeller", id);
  },
});

export const remove = mutation({
  args: {
    id: v.id(entity),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get("bestSeller", args.id);
    if (!existing) {
      return true;
    }

    await requireHomepageStoreAdmin(ctx, existing.storeId);
    await ctx.db.delete("bestSeller", args.id);

    return true;
  },
});

export const getById = query({
  args: {
    id: v.id(entity),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get("bestSeller", args.id);
  },
});

export const getAll = query({
  args: {
    storeId: v.id("store"),
    isVisible: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const items = await ctx.db
      .query(entity)
      .filter((q) => q.eq(q.field("storeId"), args.storeId))
      .collect();

    const enrichedItems: any[] = await Promise.all(
      items.map(async (item: any) => {
        const productSku = await ctx.runQuery(
          internal.inventory.productSku.retrieve,
          {
            id: item.productSkuId,
          }
        );

        const sku =
          productSku?.product?.availability === "archived"
            ? undefined
            : args.isVisible !== undefined
              ? args.isVisible === productSku?.isVisible
                ? productSku
                : undefined
              : productSku;

        return {
          ...item,
          productSku: sku,
        };
      })
    );

    return enrichedItems.filter((item) => item.productSku);
  },
});

export const getAllInternal = internalQuery({
  args: {
    storeId: v.id("store"),
    isVisible: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const items = await ctx.db
      .query(entity)
      .filter((q) => q.eq(q.field("storeId"), args.storeId))
      .collect();

    const enrichedItems: any[] = await Promise.all(
      items.map(async (item: any) => {
        const productSku = await ctx.runQuery(
          internal.inventory.productSku.retrieve,
          {
            id: item.productSkuId,
          }
        );

        const sku =
          productSku?.product?.availability === "archived"
            ? undefined
            : args.isVisible !== undefined
              ? args.isVisible === productSku?.isVisible
                ? productSku
                : undefined
              : productSku;

        return {
          ...item,
          productSku: sku,
        };
      })
    );

    return enrichedItems.filter((item) => item.productSku);
  },
});

export const updateRanks = mutation({
  args: {
    ranks: v.array(v.object({ id: v.id(entity), rank: v.number() })),
  },
  handler: async (ctx, args) => {
    const rows = await Promise.all(
      args.ranks.map((item) => ctx.db.get("bestSeller", item.id))
    );
    const storeIds = new Set(
      rows
        .filter((row): row is NonNullable<typeof row> => row !== null)
        .map((row) => row.storeId)
    );

    await Promise.all(
      Array.from(storeIds).map((storeId) =>
        requireHomepageStoreAdmin(ctx, storeId)
      )
    );

    await Promise.all(
      args.ranks.map(async (item) => {
        await ctx.db.patch("bestSeller", item.id, {
          rank: item.rank,
        });
      })
    );

    return true;
  },
});
