"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import redisClient from "../redis";
import { api } from "../_generated/api";

export const getAllProducts = action({
  args: {
    storeId: v.id("store"),
    color: v.optional(v.array(v.id("color"))),
    length: v.optional(v.array(v.number())),
    category: v.optional(v.array(v.string())),
    subcategory: v.optional(v.array(v.string())),
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

    const cacheKey = `all:products:${args.storeId}${colorParam}${lengthParam}${categoryParam}${subcategoryParam}`;

    // Check cache first
    try {
      const cachedData = await redisClient.get(cacheKey);

      if (cachedData) {
        console.log("hit cache");
        return JSON.parse(cachedData);
      }

      console.log("miss cache. Fetching data...");
      const products: any[] = await ctx.runQuery(
        api.inventory.products.getAll,
        args
      );

      // Cache the data
      await redisClient.set(cacheKey, JSON.stringify(products));

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
      // Create pattern to match all cache entries for this store
      // This will clear cache for all filter combinations
      const pattern = `all:products:${args.storeId}*`;

      // Get all matching keys
      const keys = await redisClient.keys(pattern);

      if (keys.length > 0) {
        // Delete all matching keys
        await redisClient.del(keys);
      }

      return {
        success: true,
        keysCleared: keys.length,
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
