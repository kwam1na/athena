import { mutation } from "../_generated/server";
import { v } from "convex/values";

const entity = "savedBagItem";

export const addItemToBag = mutation({
  args: {
    savedBagId: v.id("savedBag"),
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
          q.eq(q.field("savedBagId"), args.savedBagId),
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

export const deleteItemFromSavedBag = mutation({
  args: {
    itemId: v.id(entity),
  },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.itemId);
    return { message: "Item deleted from saved bag" };
  },
});
