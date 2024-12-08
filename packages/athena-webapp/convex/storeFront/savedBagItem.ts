import { mutation, query } from "../_generated/server";
import { v } from "convex/values";

const entity = "savedBagItem";

export const addItemToBag = mutation({
  args: {
    savedBagId: v.id("savedBag"),
    productId: v.id("product"),
    productSkuId: v.id("productSku"),
    productSku: v.string(),
    customerId: v.union(v.id("customer"), v.id("guest")),
    quantity: v.number(),
  },
  handler: async (ctx, args) => {
    const newItem = { ...args, updatedAt: Date.now() };

    const existing = await ctx.db
      .query(entity)
      .filter((q) =>
        q.and(
          q.eq(q.field("productSkuId"), args.productSkuId),
          q.eq(q.field("customerId"), args.customerId)
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