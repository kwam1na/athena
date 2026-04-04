import { internalMutation, query } from "../_generated/server";
import { v } from "convex/values";
import { loadBagWithItems } from "./helpers/bag";

const entity = "bagItem";
const MAX_BAGS_FOR_STORE = 500;

export const addItemToBag = internalMutation({
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

    // update the bag's updatedAt field
    await ctx.db.patch("bag", args.bagId, { updatedAt: Date.now() });

    if (existing) {
      return await ctx.db.patch("bagItem", existing._id, {
        quantity: existing.quantity + args.quantity,
        updatedAt: Date.now(),
      });
    }

    return await ctx.db.insert(entity, newItem);
  },
});

export const updateItemInBag = internalMutation({
  args: {
    itemId: v.id(entity),
    quantity: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.patch("bagItem", args.itemId, { quantity: args.quantity });
  },
});

export const deleteItemFromBag = internalMutation({
  args: {
    itemId: v.id(entity),
  },
  handler: async (ctx, args) => {
    await ctx.db.delete("bagItem", args.itemId);
    return { message: "Item deleted from bag" };
  },
});

export const getBagItemsForStore = query({
  args: {
    storeId: v.id("store"),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    // Get all the bags for the store
    const bags = await ctx.db
      .query("bag")
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .order("desc")
      .take(MAX_BAGS_FOR_STORE);

    // Get all the items for the bags
    const items: any[] = await Promise.all(
      bags.map(async (bag) => await loadBagWithItems(ctx, bag))
    );

    return items.filter((item) => item.items.length > 0);
  },
});
