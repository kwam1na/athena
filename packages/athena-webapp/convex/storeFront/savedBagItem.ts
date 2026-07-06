import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

const entity = "savedBagItem";

export const addItemToBag = internalMutation({
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
      .withIndex("by_savedBagId_storeFrontUserId_productSkuId", (q) =>
        q
          .eq("savedBagId", args.savedBagId)
          .eq("storeFrontUserId", args.storeFrontUserId)
          .eq("productSkuId", args.productSkuId),
      )
      .first();

    if (existing) {
      return await ctx.db.patch("savedBagItem", existing._id, {
        quantity: existing.quantity + args.quantity,
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
    return await ctx.db.patch("savedBagItem", args.itemId, {
      quantity: args.quantity,
    });
  },
});

export const deleteItemFromSavedBag = internalMutation({
  args: {
    itemId: v.id(entity),
  },
  handler: async (ctx, args) => {
    await ctx.db.delete("savedBagItem", args.itemId);
    return { message: "Item deleted from saved bag" };
  },
});
