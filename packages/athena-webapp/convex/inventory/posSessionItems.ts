import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import {
  itemResultValidator,
  operationSuccessValidator,
  error,
} from "./helpers/resultTypes";
import {
  runRemoveSessionItemCommand,
  runUpsertSessionItemCommand,
} from "../pos/application/commands/sessionCommands";

// Get all items for a session
export const getSessionItems = query({
  args: { sessionId: v.id("posSession") },
  returns: v.array(
    v.object({
      _id: v.id("posSessionItem"),
      _creationTime: v.number(),
      sessionId: v.id("posSession"),
      storeId: v.id("store"),
      productId: v.id("product"),
      productSkuId: v.id("productSku"),
      productSku: v.string(),
      barcode: v.optional(v.string()),
      productName: v.string(),
      price: v.number(),
      quantity: v.number(),
      image: v.optional(v.string()),
      size: v.optional(v.string()),
      length: v.optional(v.number()),
      color: v.optional(v.string()),
      areProcessingFeesAbsorbed: v.optional(v.boolean()),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const items = await ctx.db
      .query("posSessionItem")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    return items;
  },
});

// Add or update an item in the session
export const addOrUpdateItem = mutation({
  args: {
    sessionId: v.id("posSession"),
    productId: v.id("product"),
    productSkuId: v.id("productSku"),
    cashierId: v.id("cashier"),
    productSku: v.string(),
    barcode: v.optional(v.string()),
    productName: v.string(),
    price: v.number(),
    quantity: v.number(),
    image: v.optional(v.string()),
    size: v.optional(v.string()),
    length: v.optional(v.number()),
    color: v.optional(v.string()),
    areProcessingFeesAbsorbed: v.optional(v.boolean()),
  },
  returns: itemResultValidator,
  handler: async (ctx, args) => {
    const result = await runUpsertSessionItemCommand(ctx, args);

    if (result.status === "ok") {
      return {
        success: true as const,
        data: result.data,
      };
    }

    return error(result.message);
  },
});

// Remove an item from the session
export const removeItem = mutation({
  args: {
    sessionId: v.id("posSession"),
    cashierId: v.id("cashier"),
    itemId: v.id("posSessionItem"),
  },
  returns: operationSuccessValidator,
  handler: async (ctx, args) => {
    const result = await runRemoveSessionItemCommand(ctx, args);

    if (result.status === "ok") {
      return {
        success: true as const,
        data: result.data,
      };
    }

    return error(result.message);
  },
});
