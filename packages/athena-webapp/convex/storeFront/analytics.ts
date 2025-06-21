import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { Id } from "../_generated/dataModel";

const entity = "analytics";

export const create = mutation({
  args: {
    storeId: v.id("store"),
    storeFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")),
    origin: v.optional(v.string()),
    action: v.string(),
    data: v.record(v.string(), v.any()),
    device: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert(entity, {
      ...args,
    });

    return await ctx.db.get(id);
  },
});

export const updateOwner = mutation({
  args: {
    guestId: v.id("guest"),
    userId: v.id("storeFrontUser"),
  },
  handler: async (ctx, args) => {
    // Get all analytics records for the guest user
    const records = await ctx.db
      .query(entity)
      .withIndex("by_storeFrontUserId", (q) =>
        q.eq("storeFrontUserId", args.guestId)
      )
      .collect();

    // Update each record in parallel to associate with the authenticated user
    await Promise.all(
      records.map((record) =>
        ctx.db.patch(record._id, {
          storeFrontUserId: args.userId,
        })
      )
    );

    return { updated: records.length };
  },
});

export const getAll = query({
  args: {
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    // TODO: Add pagination
    // if (process.env.STAGE === "prod") {
    //   return await ctx.db
    //     .query(entity)
    //     .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
    //     .order("desc")
    //     .collect();
    // }

    return await ctx.db
      .query(entity)
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .order("desc")
      .take(250);
    // .collect();
  },
});

export const getAllPaginated = query({
  args: {
    storeId: v.id("store"),
    cursor: v.union(v.string(), v.null()),
    action: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { page, continueCursor, isDone } = await ctx.db
      .query(entity)
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .filter((q) => q.eq(q.field("action"), args.action))
      .order("desc")
      .paginate({
        numItems: 10,
        cursor: args.cursor,
      });

    return {
      items: page,
      cursor: continueCursor,
      isDone,
    };
  },
});

export const get = query({
  args: {
    id: v.id("analytics"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const getProductViewCount = query({
  args: {
    productId: v.id("product"),
  },
  handler: async (ctx, args) => {
    // Calculate the start of today (midnight)
    const now = new Date();
    const startOfDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    ).getTime();

    // All-time views
    const totalRecords = await ctx.db
      .query(entity)
      .filter((q) =>
        q.and(
          q.eq(q.field("action"), "viewed_product"),
          q.eq(q.field("data.product"), args.productId)
        )
      )
      .collect();

    // Today's views
    const dailyRecords = totalRecords.filter(
      (rec) => rec._creationTime >= startOfDay
    );

    return {
      daily: dailyRecords.length,
      total: totalRecords.length,
    };
  },
});

export const getByPromoCodeId = query({
  args: {
    promoCodeId: v.id("promoCode"),
  },
  handler: async (ctx, args) => {
    // Query the analytics table for records with promoCodeId in the data field
    const analytics = await ctx.db
      .query(entity)
      .filter(
        (q) => q.eq(q.field("data.promoCodeId"), args.promoCodeId) // Filter by the action relevant to promo codes
      )
      .order("desc")
      .collect();

    return analytics;
  },
});

export const clear = mutation({
  args: {
    storeId: v.id("store"),
    storeFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")),
    action: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.action) {
      const records = await ctx.db
        .query(entity)
        .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
        .filter((q) =>
          q.and(
            q.eq(q.field("storeFrontUserId"), args.storeFrontUserId),
            q.eq(q.field("action"), args.action)
          )
        )
        .collect();

      await Promise.all(records.map((record) => ctx.db.delete(record._id)));

      return {
        deleted: records.length,
      };
    } else {
      const records = await ctx.db
        .query(entity)
        .withIndex("by_storeFrontUserId", (q) =>
          q.eq("storeFrontUserId", args.storeFrontUserId)
        )
        .collect();

      await Promise.all(records.map((record) => ctx.db.delete(record._id)));

      return {
        deleted: records.length,
      };
    }
  },
});

export const getEnhancedAnalytics = query({
  args: {
    storeId: v.id("store"),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let analyticsQuery = ctx.db
      .query(entity)
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .order("desc");

    // Apply date filtering if provided
    if (args.startDate && args.endDate) {
      analyticsQuery = analyticsQuery.filter((q) =>
        q.and(
          q.gte(q.field("_creationTime"), args.startDate!),
          q.lte(q.field("_creationTime"), args.endDate!)
        )
      );
    }

    // Limit to prevent excessive reads - use take(500) instead of take(1000)
    const analytics = await analyticsQuery.take(500);

    // Calculate enhanced metrics
    const uniqueVisitors = new Set(analytics.map((a) => a.storeFrontUserId))
      .size;
    const totalViews = analytics.length;

    // Product view metrics
    const productViews = analytics.filter((a) =>
      ["viewed_product", "view_product"].includes(a.action)
    );

    // Cart metrics (using actual tracked actions)
    const cartActions = analytics.filter((a) =>
      ["added_product_to_bag", "updated_product_in_bag"].includes(a.action)
    );

    // Checkout metrics
    const checkoutActions = analytics.filter((a) =>
      ["initiated_checkout", "checkout_initiated"].includes(a.action)
    );

    // Purchase metrics
    const purchaseActions = analytics.filter((a) =>
      ["finalized_checkout", "checkout_finalized"].includes(a.action)
    );

    // Device breakdown
    const deviceBreakdown = analytics.reduce(
      (acc, a) => {
        if (a.device === "mobile") acc.mobile++;
        else if (a.device === "desktop") acc.desktop++;
        else acc.unknown++;
        return acc;
      },
      { mobile: 0, desktop: 0, unknown: 0 }
    );

    // Calculate conversion rates
    const viewToCartRate =
      productViews.length > 0
        ? (cartActions.length / productViews.length) * 100
        : 0;

    const cartToCheckoutRate =
      cartActions.length > 0
        ? (checkoutActions.length / cartActions.length) * 100
        : 0;

    const checkoutToPurchaseRate =
      checkoutActions.length > 0
        ? (purchaseActions.length / checkoutActions.length) * 100
        : 0;

    return {
      overview: {
        uniqueVisitors,
        totalViews,
        productViews: productViews.length,
        cartActions: cartActions.length,
        checkoutActions: checkoutActions.length,
        purchaseActions: purchaseActions.length,
      },
      conversions: {
        viewToCartRate: Math.round(viewToCartRate * 100) / 100,
        cartToCheckoutRate: Math.round(cartToCheckoutRate * 100) / 100,
        checkoutToPurchaseRate: Math.round(checkoutToPurchaseRate * 100) / 100,
        overallConversionRate:
          productViews.length > 0
            ? Math.round(
                (purchaseActions.length / productViews.length) * 100 * 100
              ) / 100
            : 0,
      },
      deviceBreakdown,
      rawAnalytics: analytics,
    };
  },
});

export const getRevenueAnalytics = query({
  args: {
    storeId: v.id("store"),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Get all completed orders for revenue calculation
    let ordersQuery = ctx.db
      .query("onlineOrder")
      .filter((q) =>
        q.and(
          q.eq(q.field("storeId"), args.storeId),
          q.eq(q.field("status"), "completed")
        )
      );

    if (args.startDate && args.endDate) {
      ordersQuery = ordersQuery.filter((q) =>
        q.and(
          q.gte(q.field("_creationTime"), args.startDate!),
          q.lte(q.field("_creationTime"), args.endDate!)
        )
      );
    }

    const orders = await ordersQuery.collect();

    const totalRevenue = orders.reduce(
      (sum, order) => sum + (order.amount || 0),
      0
    );
    const totalOrders = orders.length;
    const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    // Group revenue by day for trending
    const revenueByDay = orders.reduce(
      (acc, order) => {
        const day = new Date(order._creationTime).toISOString().split("T")[0];
        acc[day] = (acc[day] || 0) + (order.amount || 0);
        return acc;
      },
      {} as Record<string, number>
    );

    return {
      totalRevenue,
      totalOrders,
      averageOrderValue: Math.round(averageOrderValue * 100) / 100,
      revenueByDay,
    };
  },
});

export const getTopProducts = query({
  args: {
    storeId: v.id("store"),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let analyticsQuery = ctx.db
      .query(entity)
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId));

    if (args.startDate && args.endDate) {
      analyticsQuery = analyticsQuery.filter((q) =>
        q.and(
          q.gte(q.field("_creationTime"), args.startDate!),
          q.lte(q.field("_creationTime"), args.endDate!)
        )
      );
    }

    // OPTIMIZATION: Limit records instead of using collect() to prevent full table scan
    const analytics = await analyticsQuery.take(2000);

    // Count product views
    const productViews = analytics
      .filter(
        (a) =>
          ["viewed_product", "view_product"].includes(a.action) &&
          a.data?.product
      )
      .reduce(
        (acc, a) => {
          const productId = a.data!.product as string;
          acc[productId] = (acc[productId] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );

    // Sort and limit results
    const sortedProducts = Object.entries(productViews)
      .sort(([, a], [, b]) => b - a)
      .slice(0, args.limit || 10)
      .map(([productId, views]) => ({ productId, views }));

    return sortedProducts;
  },
});

export const getVisitorInsights = query({
  args: {
    storeId: v.id("store"),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Get current period analytics
    let currentQuery = ctx.db
      .query(entity)
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId));

    if (args.startDate && args.endDate) {
      currentQuery = currentQuery.filter((q) =>
        q.and(
          q.gte(q.field("_creationTime"), args.startDate!),
          q.lte(q.field("_creationTime"), args.endDate!)
        )
      );
    }

    // OPTIMIZATION: Limit records to prevent excessive database reads
    const currentAnalytics = await currentQuery.take(5000);

    // Calculate visitor patterns by hour
    const visitorsByHour = currentAnalytics.reduce(
      (acc, a) => {
        const hour = new Date(a._creationTime).getHours();
        acc[hour] = (acc[hour] || 0) + 1;
        return acc;
      },
      {} as Record<number, number>
    );

    // Find peak hour
    const peakHour = Object.entries(visitorsByHour).sort(
      ([, a], [, b]) => b - a
    )[0]?.[0];

    // Calculate returning visitors
    const userIds = [
      ...new Set(currentAnalytics.map((a) => a.storeFrontUserId)),
    ];

    // Check how many of these users have previous activity
    const returningVisitorChecks = await Promise.all(
      userIds.map(async (userId) => {
        const previousActivity = await ctx.db
          .query(entity)
          .withIndex("by_storeFrontUserId", (q) =>
            q.eq("storeFrontUserId", userId)
          )
          .filter((q) => q.lt(q.field("_creationTime"), args.startDate || 0))
          .first();
        return previousActivity ? 1 : 0;
      })
    );
    const returningVisitorCount = returningVisitorChecks.reduce(
      (sum: number, val: number) => sum + val,
      0
    );

    return {
      totalVisitors: userIds.length,
      returningVisitors: returningVisitorCount,
      newVisitors: userIds.length - returningVisitorCount,
      peakHour: peakHour ? parseInt(peakHour) : null,
      visitorsByHour,
    };
  },
});

export const getStoreActivityTimeline = query({
  args: {
    storeId: v.id("store"),
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
  // returns: v.array(
  //   v.object({
  //     _id: v.id("analytics"),
  //     _creationTime: v.number(),
  //     storeFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")),
  //     action: v.string(),
  //     origin: v.optional(v.string()),
  //     device: v.optional(v.string()),
  //     data: v.record(v.string(), v.any()),
  //     userData: v.optional(
  //       v.object({
  //         email: v.optional(v.string()),
  //       })
  //     ),
  //     productInfo: v.optional(
  //       v.object({
  //         name: v.optional(v.string()),
  //         images: v.optional(v.array(v.string())),
  //         price: v.optional(v.number()),
  //         currency: v.optional(v.string()),
  //       })
  //     ),
  //   })
  // ),
  handler: async (ctx, args) => {
    const { storeId, limit = 20, timeRange = "24h" } = args;

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
      .query(entity)
      .withIndex("by_storeId", (q) => q.eq("storeId", storeId));

    if (timeFilter) {
      analyticsQuery = analyticsQuery.filter((q) =>
        q.gte(q.field("_creationTime"), timeFilter)
      );
    }

    const analytics = await analyticsQuery.order("desc").take(limit);

    // OPTIMIZATION: Batch user and product data fetching to avoid N+1 queries

    // Batch fetch user data
    const userIds = [...new Set(analytics.map((a) => a.storeFrontUserId))];
    const userData = new Map();

    await Promise.all(
      userIds.map(async (userId) => {
        try {
          const user = await ctx.db.get(userId as Id<"storeFrontUser">);
          if (user && "email" in user) {
            userData.set(userId, { email: user.email });
          }
        } catch (e) {
          try {
            const guest = await ctx.db.get(userId as Id<"guest">);
            if (guest && "email" in guest) {
              userData.set(userId, { email: guest.email });
            }
          } catch (e2) {
            // User not found in either table
          }
        }
      })
    );

    // Batch fetch product data
    const productIds = [
      ...new Set(
        analytics
          .filter((a) => a.data.product)
          .map((a) => a.data.product as Id<"product">)
      ),
    ];

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

    // Batch fetch SKU data (simplified for performance)
    const skuMap = new Map();
    if (productIds.length > 0 && productIds.length < 50) {
      // Only for reasonable numbers
      const allSkus = await ctx.db.query("productSku").collect();
      const relevantSkus = allSkus.filter((sku) =>
        productIds.includes(sku.productId)
      );

      relevantSkus.forEach((sku) => {
        const key = `${sku.productId}-${sku.sku}`;
        skuMap.set(key, sku);
      });
    }

    // Enrich analytics with cached data (optimized)
    const enrichedAnalytics = analytics.map((analytic) => {
      const userInfo = userData.get(analytic.storeFrontUserId) || {};
      let productInfo = undefined;

      // If this is a product-related event, get product info from cached data
      if (analytic.data.product && analytic.data.productSku) {
        const productId = analytic.data.product as Id<"product">;
        const product = productMap.get(productId);

        if (product) {
          const skuKey = `${productId}-${analytic.data.productSku}`;
          const sku = skuMap.get(skuKey);

          productInfo = {
            name: "name" in product ? product.name : undefined,
            images: sku?.images || [],
            price: sku?.price,
            currency: "currency" in product ? product.currency : undefined,
          };
        }
      }

      return {
        ...analytic,
        userData: userInfo,
        productInfo,
      };
    });

    return enrichedAnalytics;
  },
});

export const getConsolidatedAnalytics = query({
  args: {
    storeId: v.id("store"),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // OPTIMIZATION: Single query to get all analytics data needed for dashboard
    let analyticsQuery = ctx.db
      .query(entity)
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .order("desc");

    // Apply date filtering if provided
    if (args.startDate && args.endDate) {
      analyticsQuery = analyticsQuery.filter((q) =>
        q.and(
          q.gte(q.field("_creationTime"), args.startDate!),
          q.lte(q.field("_creationTime"), args.endDate!)
        )
      );
    }

    // Limit to prevent excessive reads
    const analytics = await analyticsQuery.take(2000);

    // Calculate all metrics in a single pass
    const uniqueVisitors = new Set(analytics.map((a) => a.storeFrontUserId))
      .size;
    const totalViews = analytics.length;

    // Product view metrics
    const productViews = analytics.filter((a) =>
      ["viewed_product", "view_product"].includes(a.action)
    );

    // Cart metrics
    const cartActions = analytics.filter((a) =>
      ["added_product_to_bag", "updated_product_in_bag"].includes(a.action)
    );

    // Checkout metrics
    const checkoutActions = analytics.filter((a) =>
      ["initiated_checkout", "checkout_initiated"].includes(a.action)
    );

    // Purchase metrics
    const purchaseActions = analytics.filter((a) =>
      ["finalized_checkout", "checkout_finalized"].includes(a.action)
    );

    // Device breakdown
    const deviceBreakdown = analytics.reduce(
      (acc, a) => {
        if (a.device === "mobile") acc.mobile++;
        else if (a.device === "desktop") acc.desktop++;
        else acc.unknown++;
        return acc;
      },
      { mobile: 0, desktop: 0, unknown: 0 }
    );

    // Calculate conversion rates
    const viewToCartRate =
      productViews.length > 0
        ? (cartActions.length / productViews.length) * 100
        : 0;
    const cartToCheckoutRate =
      cartActions.length > 0
        ? (checkoutActions.length / cartActions.length) * 100
        : 0;
    const checkoutToPurchaseRate =
      checkoutActions.length > 0
        ? (purchaseActions.length / checkoutActions.length) * 100
        : 0;

    // Top products calculation
    const productViews_TopProducts = analytics
      .filter(
        (a) =>
          ["viewed_product", "view_product"].includes(a.action) &&
          a.data?.product
      )
      .reduce(
        (acc, a) => {
          const productId = a.data!.product as string;
          acc[productId] = (acc[productId] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>
      );

    const topProducts = Object.entries(productViews_TopProducts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([productId, views]) => ({ productId, views }));

    // Visitor insights
    const visitorsByHour = analytics.reduce(
      (acc, a) => {
        const hour = new Date(a._creationTime).getHours();
        acc[hour] = (acc[hour] || 0) + 1;
        return acc;
      },
      {} as Record<number, number>
    );

    const peakHour = Object.entries(visitorsByHour).sort(
      ([, a], [, b]) => b - a
    )[0]?.[0];

    // Get revenue data from orders (separate query but optimized)
    let ordersQuery = ctx.db
      .query("onlineOrder")
      .filter((q) =>
        q.and(
          q.eq(q.field("storeId"), args.storeId),
          q.eq(q.field("status"), "completed")
        )
      );

    if (args.startDate && args.endDate) {
      ordersQuery = ordersQuery.filter((q) =>
        q.and(
          q.gte(q.field("_creationTime"), args.startDate!),
          q.lte(q.field("_creationTime"), args.endDate!)
        )
      );
    }

    const orders = await ordersQuery.take(1000); // Limit orders too

    const totalRevenue = orders.reduce(
      (sum, order) => sum + (order.amount || 0),
      0
    );
    const totalOrders = orders.length;
    const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    const revenueByDay = orders.reduce(
      (acc, order) => {
        const day = new Date(order._creationTime).toISOString().split("T")[0];
        acc[day] = (acc[day] || 0) + (order.amount || 0);
        return acc;
      },
      {} as Record<string, number>
    );

    // Calculate new vs returning visitors (simplified)
    const userIds = [...new Set(analytics.map((a) => a.storeFrontUserId))];
    const newVisitors = userIds.length; // Simplified for now
    const returningVisitors = 0; // Simplified for now to avoid additional queries

    return {
      overview: {
        uniqueVisitors,
        totalViews,
        productViews: productViews.length,
        cartActions: cartActions.length,
        checkoutActions: checkoutActions.length,
        purchaseActions: purchaseActions.length,
      },
      conversions: {
        viewToCartRate: Math.round(viewToCartRate * 100) / 100,
        cartToCheckoutRate: Math.round(cartToCheckoutRate * 100) / 100,
        checkoutToPurchaseRate: Math.round(checkoutToPurchaseRate * 100) / 100,
        overallConversionRate:
          productViews.length > 0
            ? Math.round(
                (purchaseActions.length / productViews.length) * 100 * 100
              ) / 100
            : 0,
      },
      deviceBreakdown,
      revenue: {
        totalRevenue,
        totalOrders,
        averageOrderValue: Math.round(averageOrderValue * 100) / 100,
        revenueByDay,
      },
      visitors: {
        totalVisitors: userIds.length,
        newVisitors,
        returningVisitors,
        peakHour: peakHour ? parseInt(peakHour) : null,
        visitorsByHour,
      },
      topProducts,
    };
  },
});
