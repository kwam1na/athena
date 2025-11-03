import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { Id } from "../_generated/dataModel";

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
    productSku: v.string(),
    productName: v.string(),
    price: v.number(),
    quantity: v.number(),
    image: v.optional(v.string()),
    size: v.optional(v.string()),
    length: v.optional(v.number()),
    areProcessingFeesAbsorbed: v.optional(v.boolean()),
  },
  returns: v.union(
    v.object({
      success: v.literal(true),
      data: v.object({
        itemId: v.id("posSessionItem"),
        expiresAt: v.number(),
      }),
    }),
    v.object({
      success: v.literal(false),
      message: v.string(),
    })
  ),
  handler: async (ctx, args) => {
    try {
      const now = Date.now();

      // Validate session exists and is active
      const session = await ctx.db.get(args.sessionId);
      if (!session) {
        return {
          success: false as const,
          message: "Your session has expired. Please start a new transaction.",
        };
      }

      if (session.status !== "active") {
        return {
          success: false as const,
          message:
            "Can only add items to active sessions. Please resume or create a new session.",
        };
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
        // Item exists - update quantity and adjust inventory holds
        const oldQuantity = existingItem.quantity;
        const quantityChange = args.quantity - oldQuantity;

        if (quantityChange !== 0) {
          // Get SKU to adjust inventory holds
          const sku = await ctx.db.get(args.productSkuId);
          if (!sku) {
            return {
              success: false as const,
              message: "Product information is missing. Please scan again.",
            };
          }

          // Type guard
          if (
            !("quantityAvailable" in sku) ||
            !("sku" in sku) ||
            typeof sku.quantityAvailable !== "number"
          ) {
            return {
              success: false as const,
              message: "Invalid product data. Please contact support.",
            };
          }

          if (quantityChange > 0) {
            if (sku.quantityAvailable === 0) {
              return {
                success: false as const,
                message: "No more units available for this product",
              };
            }

            // Need to hold more inventory
            if (sku.quantityAvailable < quantityChange) {
              return {
                success: false as const,
                message: `Only ${sku.quantityAvailable} unit${sku.quantityAvailable !== 1 ? "s" : ""} available for ${args.productName}`,
              };
            }

            // Decrease available quantity (place hold)
            await ctx.db.patch(args.productSkuId, {
              quantityAvailable: sku.quantityAvailable - quantityChange,
            });
          } else {
            // Release some inventory (quantityChange is negative)
            await ctx.db.patch(args.productSkuId, {
              quantityAvailable:
                sku.quantityAvailable + Math.abs(quantityChange),
            });
          }
        }

        // Update the item
        await ctx.db.patch(existingItem._id, {
          quantity: args.quantity,
          price: args.price,
          updatedAt: now,
        });

        itemId = existingItem._id;
      } else {
        // New item - validate inventory and place hold
        const sku = await ctx.db.get(args.productSkuId);
        if (!sku) {
          return {
            success: false as const,
            message: "Product information is missing. Please scan again.",
          };
        }

        // Type guard
        if (
          !("quantityAvailable" in sku) ||
          !("sku" in sku) ||
          typeof sku.quantityAvailable !== "number"
        ) {
          return {
            success: false as const,
            message: "Invalid product data. Please contact support.",
          };
        }

        if (sku.quantityAvailable === 0) {
          return {
            success: false as const,
            message: "No more units available for this product",
          };
        }

        // Check if enough inventory is available
        if (sku.quantityAvailable < args.quantity) {
          return {
            success: false as const,
            message: `Only ${sku.quantityAvailable} unit${sku.quantityAvailable !== 1 ? "s" : ""} available for ${args.productName}`,
          };
        }

        // Place hold by decreasing available quantity
        await ctx.db.patch(args.productSkuId, {
          quantityAvailable: sku.quantityAvailable - args.quantity,
        });

        // Create new item
        itemId = await ctx.db.insert("posSessionItem", {
          sessionId: args.sessionId,
          storeId: session.storeId,
          productId: args.productId,
          productSkuId: args.productSkuId,
          productSku: args.productSku,
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
      const sessionExpiry = 20 * 60 * 1000; // 20 minutes
      const expiresAt = now + sessionExpiry;

      await ctx.db.patch(args.sessionId, {
        updatedAt: now,
        expiresAt,
      });

      return { success: true as const, data: { itemId, expiresAt } };
    } catch (error) {
      console.error("Error in addOrUpdateItem:", error);
      return {
        success: false as const,
        message:
          error instanceof Error
            ? error.message
            : "Failed to add item. Please try again.",
      };
    }
  },
});

// Remove an item from the session
export const removeItem = mutation({
  args: {
    sessionId: v.id("posSession"),
    itemId: v.id("posSessionItem"),
  },
  returns: v.union(
    v.object({
      success: v.literal(true),
      data: v.object({
        expiresAt: v.number(),
      }),
    }),
    v.object({
      success: v.literal(false),
      message: v.string(),
    })
  ),
  handler: async (ctx, args) => {
    try {
      const now = Date.now();

      // Get the item to release its inventory hold
      const item = await ctx.db.get(args.itemId);
      if (!item) {
        return {
          success: false as const,
          message: "Item not found in cart",
        };
      }

      // Verify item belongs to this session
      if (item.sessionId !== args.sessionId) {
        return {
          success: false as const,
          message: "Item does not belong to this session",
        };
      }

      // Release inventory hold
      const sku = await ctx.db.get(item.productSkuId);
      if (
        sku &&
        "quantityAvailable" in sku &&
        typeof sku.quantityAvailable === "number"
      ) {
        await ctx.db.patch(item.productSkuId, {
          quantityAvailable: sku.quantityAvailable + item.quantity,
        });
      }

      // Delete the item
      await ctx.db.delete(args.itemId);

      // Extend session expiration time
      const sessionExpiry = 20 * 60 * 1000; // 20 minutes
      const expiresAt = now + sessionExpiry;

      await ctx.db.patch(args.sessionId, {
        updatedAt: now,
        expiresAt,
      });

      return { success: true as const, data: { expiresAt } };
    } catch (error) {
      return {
        success: false as const,
        message:
          error instanceof Error
            ? error.message
            : "Failed to remove item from cart",
      };
    }
  },
});
