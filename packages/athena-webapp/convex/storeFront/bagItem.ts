import { mutation, query } from "../_generated/server";
import { v } from "convex/values";

const entity = "bagItem";

export const addItemToBag = mutation({
  args: {
    bagId: v.id("bag"),
    productId: v.id("product"),
    productSku: v.id("productSku"),
    customerId: v.union(v.id("customer"), v.id("guest")),
    quantity: v.number(),
  },
  handler: async (ctx, args) => {
    const newItem = { ...args, updatedAt: Date.now() };
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
