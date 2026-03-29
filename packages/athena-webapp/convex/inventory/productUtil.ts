"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { api } from "../_generated/api";
import { ValkeyClient } from "../cache";

export const getAllProducts = action({
  args: {
    storeId: v.id("store"),
    color: v.optional(v.array(v.id("color"))),
    length: v.optional(v.array(v.number())),
    category: v.optional(v.array(v.string())),
    subcategory: v.optional(v.array(v.string())),
    isVisible: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // Create a cache key that includes all filter parameters
    const colorParam = args.color ? `:color:${args.color.join(",")}` : "";
    const lengthParam = args.length ? `:length:${args.length.join(",")}` : "";
    const categoryParam = args.category
      ? `:category:${args.category.join(",")}`
      : "";
    const subcategoryParam = args.subcategory
      ? `:subcategory:${args.subcategory.join(",")}`
      : "";

    // Use hash tag for slot alignment
    const cacheKey = `all:products:{${args.storeId}}${colorParam}${lengthParam}${categoryParam}${subcategoryParam}`;

    try {
      const cache = new ValkeyClient();
      const cachedData = await cache.get(cacheKey);

      if (cachedData) {
        console.log("hit cache");
        return JSON.parse(cachedData);
      }

      console.log("miss cache. Fetching data...");
      const products: any[] = await ctx.runQuery(
        api.inventory.products.getAll,
        args
      );

      try {
        await cache.set(cacheKey, JSON.stringify(products));
      } catch (e) {
        console.log("Cache set error", (e as Error).message);
      }

      return products;
    } catch (e) {
      console.log("error", (e as Error).message);
    }
  },
});

export const invalidateProductCache = action({
  args: {
    storeId: v.id("store"),
  },
  handler: async (_, args) => {
    try {
      // Match the hash tag style from getAllProducts
      const pattern = `all:products:{${args.storeId}}*`;

      const cache = new ValkeyClient();
      const keys = await cache.invalidate(pattern);

      return {
        success: true,
        keysCleared: keys,
      };
    } catch (e) {
      console.log("Cache invalidation error", (e as Error).message);
      return {
        success: false,
        error: (e as Error).message,
      };
    }
  },
});

export const clearAllCache = action({
  args: {},
  handler: async () => {
    try {
      const cache = new ValkeyClient();
      // Use wildcard pattern to clear all keys
      const keys = await cache.invalidate("*");

      return {
        success: true,
        keysCleared: keys,
      };
    } catch (e) {
      console.log("Cache clear error", (e as Error).message);
      return {
        success: false,
        error: (e as Error).message,
      };
    }
  },
});
