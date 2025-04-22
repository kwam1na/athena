import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { api } from "../_generated/api";

const entity = "bestSeller";

export const create = mutation({
  args: {
    productId: v.id("product"),
    productSkuId: v.id("productSku"),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
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

    return await ctx.db.get(id);
  },
});

export const remove = mutation({
  args: {
    id: v.id(entity),
  },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);

    return true;
  },
});

export const getById = query({
  args: {
    id: v.id(entity),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
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
          api.inventory.productSku.getById,
          {
            id: item.productSkuId,
          }
        );

        const sku =
          args.isVisible !== undefined
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

    return enrichedItems;
  },
});

export const updateRanks = mutation({
  args: {
    ranks: v.array(v.object({ id: v.id(entity), rank: v.number() })),
  },
  handler: async (ctx, args) => {
    await Promise.all(
      args.ranks.map(async (item) => {
        await ctx.db.patch(item.id, {
          rank: item.rank,
        });
      })
    );

    return true;
  },
});
