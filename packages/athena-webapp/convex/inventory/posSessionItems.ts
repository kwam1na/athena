import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import {
  acquireInventoryHold,
  releaseInventoryHold,
  adjustInventoryHold,
  validateInventoryAvailability,
} from "./helpers/inventoryHolds";
import {
  validateSessionActive,
  validateSessionModifiable,
  validateItemBelongsToSession,
} from "./helpers/sessionValidation";
import {
  itemResultValidator,
  operationSuccessValidator,
  error,
  itemSuccess,
  operationSuccess,
} from "./helpers/resultTypes";
import { calculateSessionExpiration } from "./helpers/sessionExpiration";

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
    areProcessingFeesAbsorbed: v.optional(v.boolean()),
  },
  returns: itemResultValidator,
  handler: async (ctx, args) => {
    try {
      const now = Date.now();

      // Validate session is active using helper
      const validation = await validateSessionActive(
        ctx.db,
        args.sessionId,
        args.cashierId
      );
      if (!validation.success) {
        return error(validation.message!);
      }

      const session = await ctx.db.get(args.sessionId);
      if (!session) {
        return error("Session not found");
      }

      // Check if item already exists in session
      const existingItems = await ctx.db
        .query("posSessionItem")
        .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
        .collect();

      const existingItem = existingItems.find(
        (item) => item.productSkuId === args.productSkuId
      );

      let itemId: Id<"posSessionItem">;

      if (existingItem) {
        // Item exists - update quantity and adjust inventory holds using helper
        const adjustResult = await adjustInventoryHold(
          ctx.db,
          args.productSkuId,
          existingItem.quantity,
          args.quantity
        );

        if (!adjustResult.success) {
          return error(adjustResult.message || "Failed to adjust inventory");
        }

        // Update the item
        await ctx.db.patch(existingItem._id, {
          quantity: args.quantity,
          price: args.price,
          barcode: args.barcode,
          updatedAt: now,
        });

        itemId = existingItem._id;
      } else {
        // New item - acquire inventory hold using helper
        const holdResult = await acquireInventoryHold(
          ctx.db,
          args.productSkuId,
          args.quantity
        );

        if (!holdResult.success) {
          return error(
            holdResult.message || "Failed to acquire inventory hold"
          );
        }

        // Create new item
        itemId = await ctx.db.insert("posSessionItem", {
          sessionId: args.sessionId,
          storeId: session.storeId,
          productId: args.productId,
          productSkuId: args.productSkuId,
          productSku: args.productSku,
          barcode: args.barcode,
          productName: args.productName,
          price: args.price,
          quantity: args.quantity,
          image: args.image,
          size: args.size,
          length: args.length,
          areProcessingFeesAbsorbed: args.areProcessingFeesAbsorbed,
          createdAt: now,
          updatedAt: now,
        });
      }

      // Extend session expiration time
      const expiresAt = calculateSessionExpiration(now);

      await ctx.db.patch(args.sessionId, {
        updatedAt: now,
        expiresAt,
      });

      return itemSuccess(itemId, expiresAt);
    } catch (err) {
      console.error("Error in addOrUpdateItem:", err);
      return error(
        err instanceof Error
          ? err.message
          : "Failed to add item. Please try again."
      );
    }
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
    try {
      const now = Date.now();

      // Validate session can be modified (checks expiration)
      const sessionValidation = await validateSessionModifiable(
        ctx.db,
        args.sessionId,
        args.cashierId
      );
      if (!sessionValidation.success) {
        return error(sessionValidation.message!);
      }

      // Validate item belongs to session using helper
      const validation = await validateItemBelongsToSession(
        ctx.db,
        args.itemId,
        args.sessionId
      );
      if (!validation.success) {
        return error(validation.message!);
      }

      // Get the item to release its inventory hold
      const item = await ctx.db.get(args.itemId);
      if (!item) {
        return error("Item not found in cart");
      }

      // Release inventory hold using helper
      await releaseInventoryHold(ctx.db, item.productSkuId, item.quantity);

      // Delete the item
      await ctx.db.delete(args.itemId);

      // Extend session expiration time
      const expiresAt = calculateSessionExpiration(now);

      await ctx.db.patch(args.sessionId, {
        updatedAt: now,
        expiresAt,
      });

      return operationSuccess(expiresAt);
    } catch (err) {
      return error(
        err instanceof Error ? err.message : "Failed to remove item from cart"
      );
    }
  },
});
