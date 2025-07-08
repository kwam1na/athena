import { query } from "../_generated/server";
import { v } from "convex/values";
import { Id } from "../_generated/dataModel";

export const getCustomerBehaviorTimeline = query({
  args: {
    userId: v.union(v.id("storeFrontUser"), v.id("guest")),
    limit: v.optional(v.number()),
    timeRange: v.optional(
      v.union(
        v.literal("24h"),
        v.literal("7d"),
        v.literal("30d"),
        v.literal("all")
      )
    ),
  },
  returns: v.array(
    v.object({
      _id: v.id("analytics"),
      _creationTime: v.number(),
      storeFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")),
      storeId: v.id("store"),
      action: v.string(),
      origin: v.optional(v.string()),
      device: v.optional(v.string()),
      data: v.record(v.string(), v.any()),
      productId: v.optional(v.id("product")),
      userData: v.optional(
        v.object({
          email: v.optional(v.string()),
        })
      ),
      productInfo: v.optional(
        v.object({
          name: v.optional(v.string()),
          images: v.optional(v.array(v.string())),
          price: v.optional(v.number()),
          currency: v.optional(v.string()),
        })
      ),
    })
  ),
  handler: async (ctx, args) => {
    const { userId, limit = 50, timeRange = "30d" } = args;

    // Calculate time filter
    let timeFilter: number | undefined;
    const now = Date.now();

    switch (timeRange) {
      case "24h":
        timeFilter = now - 24 * 60 * 60 * 1000;
        break;
      case "7d":
        timeFilter = now - 7 * 24 * 60 * 60 * 1000;
        break;
      case "30d":
        timeFilter = now - 30 * 24 * 60 * 60 * 1000;
        break;
      case "all":
        timeFilter = undefined;
        break;
    }

    // Get analytics data with time filtering
    let analyticsQuery = ctx.db
      .query("analytics")
      .filter((q) => q.eq(q.field("storeFrontUserId"), userId));

    if (timeFilter) {
      analyticsQuery = analyticsQuery.filter((q) =>
        q.gte(q.field("_creationTime"), timeFilter)
      );
    }

    const analytics = await analyticsQuery.order("desc").take(limit);

    // Get user data
    let userData: { email?: string } = {};
    try {
      const user = await ctx.db.get(userId as Id<"storeFrontUser">);
      if (user) {
        userData = { email: user.email };
      }
    } catch (e) {
      try {
        const guest = await ctx.db.get(userId as Id<"guest">);
        if (guest) {
          userData = { email: guest.email };
        }
      } catch (e2) {
        // User not found in either table
      }
    }

    // OPTIMIZATION: Batch product data fetching to avoid N+1 queries
    const productIds = [
      ...new Set(
        analytics
          .filter((a) => a.data.product)
          .map((a) => a.data.product as Id<"product">)
      ),
    ];

    // Batch fetch all products
    const products = await Promise.all(
      productIds.map(async (productId) => {
        try {
          return await ctx.db.get(productId);
        } catch {
          return null;
        }
      })
    );

    const productMap = new Map();
    products.filter(Boolean).forEach((product) => {
      productMap.set(product!._id, product);
    });

    // Batch fetch SKUs for products (avoiding complex filter that causes linter issues)
    const skuMap = new Map();
    if (productIds.length > 0) {
      // Get all SKUs and filter in memory for now (can be optimized with proper indexes later)
      const allSkus = await ctx.db.query("productSku").collect();

      // Filter to only SKUs for our products
      const relevantSkus = allSkus.filter((sku) =>
        productIds.includes(sku.productId)
      );

      relevantSkus.forEach((sku) => {
        const key = `${sku.productId}-${sku.sku}`;
        skuMap.set(key, sku);
      });
    }

    // Enrich analytics with product information (optimized)
    const enrichedAnalytics = analytics.map((analytic) => {
      let productInfo = undefined;

      // If this is a product-related event, get product info from cached maps
      if (analytic.data.product && analytic.data.productSku) {
        const productId = analytic.data.product as Id<"product">;
        const product = productMap.get(productId);

        if (product) {
          const skuKey = `${productId}-${analytic.data.productSku}`;
          const sku = skuMap.get(skuKey);

          productInfo = {
            name: product.name,
            images: sku?.images || [],
            price: sku?.price,
            currency: product.currency,
          };
        }
      }

      return {
        ...analytic,
        userData,
        productInfo,
      };
    });

    return enrichedAnalytics;
  },
});

export const getCustomerBehaviorSummary = query({
  args: {
    userId: v.union(v.id("storeFrontUser"), v.id("guest")),
    timeRange: v.optional(
      v.union(
        v.literal("24h"),
        v.literal("7d"),
        v.literal("30d"),
        v.literal("all")
      )
    ),
  },
  returns: v.object({
    totalActions: v.number(),
    uniqueProducts: v.number(),
    mostCommonAction: v.optional(v.string()),
    deviceBreakdown: v.object({
      mobile: v.number(),
      desktop: v.number(),
    }),
    lastActiveTime: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    const { userId, timeRange = "30d" } = args;

    // Calculate time filter (same logic as above)
    let timeFilter: number | undefined;
    const now = Date.now();

    switch (timeRange) {
      case "24h":
        timeFilter = now - 24 * 60 * 60 * 1000;
        break;
      case "7d":
        timeFilter = now - 7 * 24 * 60 * 60 * 1000;
        break;
      case "30d":
        timeFilter = now - 30 * 24 * 60 * 60 * 1000;
        break;
      case "all":
        timeFilter = undefined;
        break;
    }

    let analyticsQuery = ctx.db
      .query("analytics")
      .filter((q) => q.eq(q.field("storeFrontUserId"), userId));

    if (timeFilter) {
      analyticsQuery = analyticsQuery.filter((q) =>
        q.gte(q.field("_creationTime"), timeFilter)
      );
    }

    // OPTIMIZATION: Limit records to prevent excessive database reads
    const analytics = await analyticsQuery.take(1000);

    // Calculate summary statistics
    const totalActions = analytics.length;
    const uniqueProducts = new Set(
      analytics
        .filter((a) => a.data.product)
        .map((a) => a.data.product as string)
    ).size;

    // Find most common action
    const actionCounts: Record<string, number> = {};
    analytics.forEach((a) => {
      actionCounts[a.action] = (actionCounts[a.action] || 0) + 1;
    });

    let mostCommonAction: string | undefined = undefined;
    const actionKeys = Object.keys(actionCounts);
    if (actionKeys.length > 0) {
      mostCommonAction = actionKeys.reduce((a, b) =>
        actionCounts[a] > actionCounts[b] ? a : b
      );
    }

    // Device breakdown
    const deviceBreakdown = analytics.reduce(
      (acc, a) => {
        if (a.device === "mobile") acc.mobile++;
        else if (a.device === "desktop") acc.desktop++;
        return acc;
      },
      { mobile: 0, desktop: 0 }
    );

    // Last active time
    const lastActiveTime =
      analytics.length > 0 ? analytics[0]._creationTime : undefined;

    return {
      totalActions,
      uniqueProducts,
      mostCommonAction,
      deviceBreakdown,
      lastActiveTime,
    };
  },
});
