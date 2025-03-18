import { api } from "../_generated/api";
import { mutation, query } from "../_generated/server";
import { v } from "convex/values";

const entity = "bagItem";

export const addItemToBag = mutation({
  args: {
    bagId: v.id("bag"),
    productId: v.id("product"),
    productSkuId: v.id("productSku"),
    productSku: v.string(),
    storeFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")),
    quantity: v.number(),
  },
  handler: async (ctx, args) => {
    const newItem = { ...args, updatedAt: Date.now() };

    const existing = await ctx.db
      .query(entity)
      .filter((q) =>
        q.and(
          q.eq(q.field("productSkuId"), args.productSkuId),
          q.eq(q.field("bagId"), args.bagId),
          q.eq(q.field("storeFrontUserId"), args.storeFrontUserId)
        )
      )
      .first();

    if (existing) {
      return await ctx.db.patch(existing._id, {
        quantity: existing.quantity + args.quantity,
      });
    }

    return await ctx.db.insert(entity, newItem);
  },
});

export const updateItemInBag = mutation({
  args: {
    itemId: v.id(entity),
    quantity: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.patch(args.itemId, { quantity: args.quantity });
  },
});

export const deleteItemFromBag = mutation({
  args: {
    itemId: v.id(entity),
  },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.itemId);
    return { message: "Item deleted from bag" };
  },
});

export const getBagItemsForStore = query({
  args: {
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    // Get all the bags for the store
    const bags = await ctx.db
      .query("bag")
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .collect();

    // Get all the items for the bags
    const items: any[] = await Promise.all(
      bags.map(async (bag) => {
        return await ctx.runQuery(api.storeFront.bag.getById, {
          id: bag._id,
        });
      })
    );

    return items;
  },
});
