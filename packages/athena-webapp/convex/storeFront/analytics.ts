import { v } from "convex/values";
import { internalQuery, mutation, query, QueryCtx } from "../_generated/server";
import { Doc, Id } from "../_generated/dataModel";
import {
  buildStorefrontObservabilityReport,
  STOREFRONT_OBSERVABILITY_ACTION,
} from "./storefrontObservabilityReport";
import { SYNTHETIC_MONITOR_ORIGIN } from "./syntheticMonitor";

const entity = "analytics";
const MAX_ANALYTICS_RESULTS = 500;
const MAX_ANALYTICS_MUTATIONS = 1000;
const MAX_PRODUCT_VIEW_RECORDS = 2000;
const MAX_PROMO_CODE_ANALYTICS_RESULTS = 2000;
const MAX_REPORTING_ORDERS = 1000;
const MAX_PRODUCT_SKUS_PER_PRODUCT = 50;
const MAX_STOREFRONT_OBSERVABILITY_RESULTS = 2000;
const MAX_ANALYTICS_WORKSPACE_EVENTS = 500;
const MAX_ANALYTICS_WORKSPACE_TODAY_EVENTS = 1000;
const MAX_ANALYTICS_WORKSPACE_USERS = 10;
const MAX_ANALYTICS_WORKSPACE_PRODUCTS = 10;
const MAX_ANALYTICS_WORKSPACE_RECENT_EVENTS = 8;
const MAX_ACTIVE_CHECKOUT_SESSIONS = 500;

function extractPromoCodeId(
  data: Record<string, any>,
): Id<"promoCode"> | undefined {
  const promoCodeId = data.promoCodeId;

  return typeof promoCodeId === "string"
    ? (promoCodeId as Id<"promoCode">)
    : undefined;
}

function getAnalyticsByStoreQuery(
  ctx: QueryCtx,
  storeId: Id<"store">,
  startDate?: number,
  endDate?: number,
  options?: {
    includeSyntheticMonitor?: boolean;
  },
) {
  const includeSyntheticMonitor = options?.includeSyntheticMonitor ?? false;
  let query;

  if (startDate !== undefined && endDate !== undefined) {
    query = ctx.db
      .query(entity)
      .withIndex("by_storeId", (q) =>
        q
          .eq("storeId", storeId)
          .gte("_creationTime", startDate)
          .lte("_creationTime", endDate),
      );
  } else if (startDate !== undefined) {
    query = ctx.db
      .query(entity)
      .withIndex("by_storeId", (q) =>
        q.eq("storeId", storeId).gte("_creationTime", startDate),
      );
  } else if (endDate !== undefined) {
    query = ctx.db
      .query(entity)
      .withIndex("by_storeId", (q) =>
        q.eq("storeId", storeId).lte("_creationTime", endDate),
      );
  } else {
    query = ctx.db
      .query(entity)
      .withIndex("by_storeId", (q) => q.eq("storeId", storeId));
  }

  if (includeSyntheticMonitor) {
    return query;
  }

  return query.filter((q) =>
    q.neq(q.field("origin"), SYNTHETIC_MONITOR_ORIGIN),
  );
}

function getCompletedOrdersQuery(
  ctx: QueryCtx,
  storeId: Id<"store">,
  startDate?: number,
  endDate?: number,
) {
  if (startDate !== undefined && endDate !== undefined) {
    return ctx.db
      .query("onlineOrder")
      .withIndex("by_storeId_status", (q) =>
        q
          .eq("storeId", storeId)
          .eq("status", "completed")
          .gte("_creationTime", startDate)
          .lte("_creationTime", endDate),
      );
  }

  if (startDate !== undefined) {
    return ctx.db
      .query("onlineOrder")
      .withIndex("by_storeId_status", (q) =>
        q
          .eq("storeId", storeId)
          .eq("status", "completed")
          .gte("_creationTime", startDate),
      );
  }

  if (endDate !== undefined) {
    return ctx.db
      .query("onlineOrder")
      .withIndex("by_storeId_status", (q) =>
        q
          .eq("storeId", storeId)
          .eq("status", "completed")
          .lte("_creationTime", endDate),
      );
  }

  return ctx.db
    .query("onlineOrder")
    .withIndex("by_storeId_status", (q) =>
      q.eq("storeId", storeId).eq("status", "completed"),
    );
}

function getAnalyticsByStoreAndActionQuery(
  ctx: QueryCtx,
  storeId: Id<"store">,
  action: string,
  startDate?: number,
  endDate?: number,
  options?: {
    includeSyntheticMonitor?: boolean;
  },
) {
  const includeSyntheticMonitor = options?.includeSyntheticMonitor ?? false;
  let query;

  if (startDate !== undefined && endDate !== undefined) {
    query = ctx.db
      .query(entity)
      .withIndex("by_storeId_action", (q) =>
        q
          .eq("storeId", storeId)
          .eq("action", action)
          .gte("_creationTime", startDate)
          .lte("_creationTime", endDate),
      );
  } else if (startDate !== undefined) {
    query = ctx.db
      .query(entity)
      .withIndex("by_storeId_action", (q) =>
        q
          .eq("storeId", storeId)
          .eq("action", action)
          .gte("_creationTime", startDate),
      );
  } else if (endDate !== undefined) {
    query = ctx.db
      .query(entity)
      .withIndex("by_storeId_action", (q) =>
        q
          .eq("storeId", storeId)
          .eq("action", action)
          .lte("_creationTime", endDate),
      );
  } else {
    query = ctx.db
      .query(entity)
      .withIndex("by_storeId_action", (q) =>
        q.eq("storeId", storeId).eq("action", action),
      );
  }

  if (includeSyntheticMonitor) {
    return query;
  }

  return query.filter((q) =>
    q.neq(q.field("origin"), SYNTHETIC_MONITOR_ORIGIN),
  );
}

async function getSkuMapForProducts(
  ctx: QueryCtx,
  productIds: Id<"product">[],
): Promise<Map<string, Doc<"productSku">>> {
  const skuMap = new Map<string, Doc<"productSku">>();
  const uniqueProductIds = [...new Set(productIds)];

  await Promise.all(
    uniqueProductIds.map(async (productId) => {
      const skus = await ctx.db
        .query("productSku")
        .withIndex("by_productId", (q) => q.eq("productId", productId))
        .take(MAX_PRODUCT_SKUS_PER_PRODUCT);

      skus.forEach((sku) => {
        skuMap.set(`${sku.productId}-${sku.sku}`, sku);
      });
    }),
  );

  return skuMap;
}

export const create = mutation({
  args: {
    storeId: v.id("store"),
    storeFrontUserId: v.union(v.id("storeFrontUser"), v.id("guest")),
    origin: v.optional(v.string()),
    action: v.string(),
    data: v.record(v.string(), v.any()),
    device: v.optional(v.string()),
    productId: v.optional(v.id("product")),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert(entity, {
      ...args,
      promoCodeId: extractPromoCodeId(args.data),
    });

    return await ctx.db.get("analytics", id);
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
        q.eq("storeFrontUserId", args.guestId),
      )
      .take(MAX_ANALYTICS_MUTATIONS);

    // Update each record in parallel to associate with the authenticated user
    await Promise.all(
      records.map((record) =>
        ctx.db.patch("analytics", record._id, {
          storeFrontUserId: args.userId,
        }),
      ),
    );

    return { updated: records.length };
  },
});

export const getAll = query({
  args: {
    storeId: v.id("store"),
    action: v.optional(v.string()),
    productId: v.optional(v.id("product")),
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

    if (args.productId && args.action) {
      return await ctx.db
        .query(entity)
        .withIndex("by_storeId_action_productId", (q) =>
          q
            .eq("storeId", args.storeId)
            .eq("action", args.action!)
            .eq("productId", args.productId),
        )
        .filter((q) => q.neq(q.field("origin"), SYNTHETIC_MONITOR_ORIGIN))
        .order("desc")
        .take(MAX_ANALYTICS_RESULTS);
    }

    if (args.action) {
      return await ctx.db
        .query(entity)
        .withIndex("by_storeId_action", (q) =>
          q.eq("storeId", args.storeId).eq("action", args.action!),
        )
        .filter((q) => q.neq(q.field("origin"), SYNTHETIC_MONITOR_ORIGIN))
        .order("desc")
        .take(MAX_ANALYTICS_RESULTS);
    }

    return await ctx.db
      .query(entity)
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .filter((q) => q.neq(q.field("origin"), SYNTHETIC_MONITOR_ORIGIN))
      .order("desc")
      .take(250);
    // .collect();
  },
});

export const getAllInternal = internalQuery({
  args: {
    storeId: v.id("store"),
    action: v.optional(v.string()),
    productId: v.optional(v.id("product")),
  },
  handler: async (ctx, args) => {
    if (args.productId && args.action) {
      return await ctx.db
        .query(entity)
        .withIndex("by_storeId_action_productId", (q) =>
          q
            .eq("storeId", args.storeId)
            .eq("action", args.action!)
            .eq("productId", args.productId),
        )
        .filter((q) => q.neq(q.field("origin"), SYNTHETIC_MONITOR_ORIGIN))
        .order("desc")
        .take(MAX_ANALYTICS_RESULTS);
    }

    if (args.action) {
      return await ctx.db
        .query(entity)
        .withIndex("by_storeId_action", (q) =>
          q.eq("storeId", args.storeId).eq("action", args.action!),
        )
        .filter((q) => q.neq(q.field("origin"), SYNTHETIC_MONITOR_ORIGIN))
        .order("desc")
        .take(MAX_ANALYTICS_RESULTS);
    }

    return await ctx.db
      .query(entity)
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .filter((q) => q.neq(q.field("origin"), SYNTHETIC_MONITOR_ORIGIN))
      .order("desc")
      .take(250);
  },
});

export const getWorkspaceSummary = query({
  args: {
    storeId: v.id("store"),
    currentTimeMs: v.number(),
  },
  handler: async (ctx, args) => {
    const startOfDay = new Date(args.currentTimeMs).setHours(0, 0, 0, 0);
    const sevenDaysAgo = args.currentTimeMs - 7 * 24 * 60 * 60 * 1000;

    const [analytics, todayAnalytics, activeCheckoutSessions] =
      await Promise.all([
        getAnalyticsByStoreQuery(ctx, args.storeId)
          .order("desc")
          .take(MAX_ANALYTICS_WORKSPACE_EVENTS),
        getAnalyticsByStoreQuery(ctx, args.storeId, startOfDay)
          .order("desc")
          .take(MAX_ANALYTICS_WORKSPACE_TODAY_EVENTS),
        ctx.db
          .query("checkoutSession")
          .withIndex("by_storeId_hasCompletedCheckoutSession", (q) =>
            q
              .eq("storeId", args.storeId)
              .eq("hasCompletedCheckoutSession", false),
          )
          .filter((q) =>
            q.or(
              q.gt(q.field("expiresAt"), args.currentTimeMs),
              q.eq(q.field("isFinalizingPayment"), true),
            ),
          )
          .take(MAX_ACTIVE_CHECKOUT_SESSIONS),
      ]);

    const productViewActions = new Set(["viewed_product", "view_product"]);
    const shopperIdsToday = new Set(
      todayAnalytics.map((item) => item.storeFrontUserId),
    );
    const shoppers = new Map<
      string,
      {
        userId: string;
        totalActions: number;
        lastActive: number;
        firstSeen: number;
        deviceCounts: Record<string, number>;
        uniqueProducts: Set<string>;
        mostRecentAction: string;
        mostRecentActionTime: number;
        mostRecentActionData: Record<string, any>;
      }
    >();
    const productViews = new Map<
      string,
      {
        productId: Id<"product">;
        productSku: string;
        views: number;
        lastViewed: number;
      }
    >();

    for (const item of analytics) {
      const userId = item.storeFrontUserId;
      const shopper = shoppers.get(userId) ?? {
        userId,
        totalActions: 0,
        lastActive: item._creationTime,
        firstSeen: item._creationTime,
        deviceCounts: {},
        uniqueProducts: new Set<string>(),
        mostRecentAction: item.action,
        mostRecentActionTime: item._creationTime,
        mostRecentActionData: item.data,
      };

      shopper.totalActions += 1;
      shopper.lastActive = Math.max(shopper.lastActive, item._creationTime);
      shopper.firstSeen = Math.min(shopper.firstSeen, item._creationTime);

      if (item._creationTime >= shopper.mostRecentActionTime) {
        shopper.mostRecentAction = item.action;
        shopper.mostRecentActionTime = item._creationTime;
        shopper.mostRecentActionData = item.data;
      }

      const device = item.device || "unknown";
      shopper.deviceCounts[device] = (shopper.deviceCounts[device] || 0) + 1;

      if (item.data?.product) {
        shopper.uniqueProducts.add(item.data.product as string);
      }

      shoppers.set(userId, shopper);

      if (productViewActions.has(item.action) && item.data?.product) {
        const productId = item.data.product as Id<"product">;
        const productSku =
          typeof item.data.productSku === "string" ? item.data.productSku : "";
        const productKey = `${productId}:${productSku}`;
        const productView = productViews.get(productKey) ?? {
          productId,
          productSku,
          views: 0,
          lastViewed: item._creationTime,
        };

        productView.views += 1;
        productView.lastViewed = Math.max(
          productView.lastViewed,
          item._creationTime,
        );
        productViews.set(productKey, productView);
      }
    }

    const topShopperMetrics = [...shoppers.values()]
      .sort((a, b) => b.lastActive - a.lastActive)
      .slice(0, MAX_ANALYTICS_WORKSPACE_USERS);
    const shopperDocs = await Promise.all(
      topShopperMetrics.map(async (shopper) => {
        const storeFrontUser = await ctx.db.get(
          "storeFrontUser",
          shopper.userId as Id<"storeFrontUser">,
        );

        if (storeFrontUser) {
          return storeFrontUser;
        }

        return ctx.db.get("guest", shopper.userId as Id<"guest">);
      }),
    );

    const topUsers = topShopperMetrics.map((shopper, index) => {
      const user = shopperDocs[index];
      const devicePreference =
        Object.entries(shopper.deviceCounts).sort(([, a], [, b]) => b - a)[0]
          ?.[0] ?? "unknown";

      return {
        userId: shopper.userId,
        email: user && "email" in user ? user.email : undefined,
        userType:
          user && "storeId" in user && "email" in user
            ? ("Registered" as const)
            : ("Guest" as const),
        isNewUser: user ? user._creationTime > sevenDaysAgo : false,
        isNewActivity: shopper.firstSeen > sevenDaysAgo,
        totalActions: shopper.totalActions,
        lastActive: shopper.lastActive,
        firstSeen: shopper.firstSeen,
        devicePreference: devicePreference as "mobile" | "desktop" | "unknown",
        mostRecentAction: shopper.mostRecentAction,
        uniqueProducts: shopper.uniqueProducts.size,
        mostRecentActionData: shopper.mostRecentActionData,
        user: user ?? undefined,
      };
    });

    const topProductMetrics = [...productViews.values()]
      .sort((a, b) => b.views - a.views)
      .slice(0, MAX_ANALYTICS_WORKSPACE_PRODUCTS);
    const topProducts = (
      await Promise.all(
        topProductMetrics.map(async (productMetric) => {
          const product = await ctx.db.get("product", productMetric.productId);

          if (!product || product.storeId !== args.storeId) {
            return null;
          }

          const skus = await ctx.db
            .query("productSku")
            .withIndex("by_productId", (q) =>
              q.eq("productId", productMetric.productId),
            )
            .take(MAX_PRODUCT_SKUS_PER_PRODUCT);

          return {
            ...productMetric,
            product: {
              ...product,
              skus,
            },
          };
        }),
      )
    ).filter((product): product is NonNullable<typeof product> => !!product);

    const productViewCount = analytics.filter((item) =>
      productViewActions.has(item.action),
    ).length;

    return {
      overview: {
        knownShoppers: shoppers.size,
        productViews: productViewCount,
        visitorsToday: shopperIdsToday.size,
        activeCheckoutSessions: activeCheckoutSessions.length,
      },
      recentEvents: analytics
        .slice(0, MAX_ANALYTICS_WORKSPACE_RECENT_EVENTS)
        .map((item) => ({
          _id: item._id,
          _creationTime: item._creationTime,
          action: item.action,
        })),
      topUsers,
      topProducts,
    };
  },
});

export const getAllPaginated = query({
  args: {
    storeId: v.id("store"),
    cursor: v.union(v.string(), v.null()),
    action: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const indexedQuery = args.action
      ? ctx.db
          .query(entity)
          .withIndex("by_storeId_action", (q) =>
            q.eq("storeId", args.storeId).eq("action", args.action!),
          )
      : ctx.db
          .query(entity)
          .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId));

    const baseQuery = indexedQuery.filter((q) =>
      q.neq(q.field("origin"), SYNTHETIC_MONITOR_ORIGIN),
    );

    const { page, continueCursor, isDone } = await baseQuery
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
    return await ctx.db.get("analytics", args.id);
  },
});

export const getProductViewCount = query({
  args: {
    productId: v.id("product"),
    currentDayStartMs: v.number(),
  },
  handler: async (ctx, args) => {
    const [viewedProductRecords, legacyViewProductRecords] = await Promise.all([
      ctx.db
        .query(entity)
        .withIndex("by_action_productId", (q) =>
          q.eq("action", "viewed_product").eq("productId", args.productId),
        )
        .filter((q) => q.neq(q.field("origin"), SYNTHETIC_MONITOR_ORIGIN))
        .take(MAX_PRODUCT_VIEW_RECORDS),
      ctx.db
        .query(entity)
        .withIndex("by_action_productId", (q) =>
          q.eq("action", "view_product").eq("productId", args.productId),
        )
        .filter((q) => q.neq(q.field("origin"), SYNTHETIC_MONITOR_ORIGIN))
        .take(MAX_PRODUCT_VIEW_RECORDS),
    ]);

    const totalRecords = [...viewedProductRecords, ...legacyViewProductRecords];
    const dailyRecords = totalRecords.filter(
      (rec) => rec._creationTime >= args.currentDayStartMs,
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
    return await ctx.db
      .query(entity)
      .withIndex("by_promoCodeId", (q) => q.eq("promoCodeId", args.promoCodeId))
      .filter((q) => q.neq(q.field("origin"), SYNTHETIC_MONITOR_ORIGIN))
      .order("desc")
      .take(MAX_PROMO_CODE_ANALYTICS_RESULTS);
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
        .withIndex("by_storeFrontUserId_storeId", (q) =>
          q
            .eq("storeFrontUserId", args.storeFrontUserId)
            .eq("storeId", args.storeId),
        )
        .filter((q) => q.eq(q.field("action"), args.action))
        .take(MAX_ANALYTICS_MUTATIONS);

      await Promise.all(
        records.map((record) => ctx.db.delete("analytics", record._id)),
      );

      return {
        deleted: records.length,
      };
    } else {
      const records = await ctx.db
        .query(entity)
        .withIndex("by_storeFrontUserId_storeId", (q) =>
          q
            .eq("storeFrontUserId", args.storeFrontUserId)
            .eq("storeId", args.storeId),
        )
        .take(MAX_ANALYTICS_MUTATIONS);

      await Promise.all(
        records.map((record) => ctx.db.delete("analytics", record._id)),
      );

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
    const analytics = await getAnalyticsByStoreQuery(
      ctx,
      args.storeId,
      args.startDate,
      args.endDate,
    )
      .order("desc")
      .take(MAX_ANALYTICS_RESULTS);

    // Calculate enhanced metrics
    const uniqueVisitors = new Set(analytics.map((a) => a.storeFrontUserId))
      .size;
    const totalViews = analytics.length;

    // Product view metrics
    const productViews = analytics.filter((a) =>
      ["viewed_product", "view_product"].includes(a.action),
    );

    // Cart metrics (using actual tracked actions)
    const cartActions = analytics.filter((a) =>
      ["added_product_to_bag", "updated_product_in_bag"].includes(a.action),
    );

    // Checkout metrics
    const checkoutActions = analytics.filter((a) =>
      ["initiated_checkout", "checkout_initiated"].includes(a.action),
    );

    // Purchase metrics
    const purchaseActions = analytics.filter((a) =>
      ["finalized_checkout", "checkout_finalized"].includes(a.action),
    );

    // Device breakdown
    const deviceBreakdown = analytics.reduce(
      (acc, a) => {
        if (a.device === "mobile") acc.mobile++;
        else if (a.device === "desktop") acc.desktop++;
        else acc.unknown++;
        return acc;
      },
      { mobile: 0, desktop: 0, unknown: 0 },
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
                (purchaseActions.length / productViews.length) * 100 * 100,
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
    const orders = await getCompletedOrdersQuery(
      ctx,
      args.storeId,
      args.startDate,
      args.endDate,
    )
      .order("desc")
      .take(MAX_REPORTING_ORDERS);

    const totalRevenue = orders.reduce(
      (sum, order) => sum + (order.amount || 0),
      0,
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
      {} as Record<string, number>,
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
    const analytics = await getAnalyticsByStoreQuery(
      ctx,
      args.storeId,
      args.startDate,
      args.endDate,
    )
      .order("desc")
      .take(MAX_PRODUCT_VIEW_RECORDS);

    // Count product views
    const productViews = analytics
      .filter(
        (a) =>
          ["viewed_product", "view_product"].includes(a.action) &&
          a.data?.product,
      )
      .reduce(
        (acc, a) => {
          const productId = a.data!.product as string;
          acc[productId] = (acc[productId] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
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
    const currentAnalytics = await getAnalyticsByStoreQuery(
      ctx,
      args.storeId,
      args.startDate,
      args.endDate,
    )
      .order("desc")
      .take(5000);

    // Calculate visitor patterns by hour
    const visitorsByHour = currentAnalytics.reduce(
      (acc, a) => {
        const hour = new Date(a._creationTime).getHours();
        acc[hour] = (acc[hour] || 0) + 1;
        return acc;
      },
      {} as Record<number, number>,
    );

    // Find peak hour
    const peakHour = Object.entries(visitorsByHour).sort(
      ([, a], [, b]) => b - a,
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
            q
              .eq("storeFrontUserId", userId)
              .lt("_creationTime", args.startDate ?? 0),
          )
          .first();
        return previousActivity ? 1 : 0;
      }),
    );
    const returningVisitorCount = returningVisitorChecks.reduce(
      (sum: number, val: number) => sum + val,
      0,
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
        v.literal("all"),
      ),
    ),
    currentTimeMs: v.number(),
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
    const now = args.currentTimeMs;

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
    const analytics = await getAnalyticsByStoreQuery(
      ctx,
      storeId,
      timeFilter,
      undefined,
    )
      .order("desc")
      .take(limit);

    // OPTIMIZATION: Batch user and product data fetching to avoid N+1 queries

    // Batch fetch user data
    const userIds = [...new Set(analytics.map((a) => a.storeFrontUserId))];
    const userData = new Map();

    await Promise.all(
      userIds.map(async (userId) => {
        try {
          const user = await ctx.db.get(
            "storeFrontUser",
            userId as Id<"storeFrontUser">,
          );
          if (user && "email" in user) {
            userData.set(userId, { email: user.email });
          }
        } catch (e) {
          try {
            const guest = await ctx.db.get("guest", userId as Id<"guest">);
            if (guest && "email" in guest) {
              userData.set(userId, { email: guest.email });
            }
          } catch (e2) {
            // User not found in either table
          }
        }
      }),
    );

    // Batch fetch product data
    const productIds = [
      ...new Set(
        analytics
          .filter((a) => a.data.product)
          .map((a) => a.data.product as Id<"product">),
      ),
    ];

    const products = await Promise.all(
      productIds.map(async (productId) => {
        try {
          return await ctx.db.get("product", productId);
        } catch {
          return null;
        }
      }),
    );

    const productMap = new Map();
    products.filter(Boolean).forEach((product) => {
      productMap.set(product!._id, product);
    });

    const skuMap = await getSkuMapForProducts(ctx, productIds);

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

export const getStorefrontObservabilityReport = query({
  args: {
    storeId: v.id("store"),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const analytics = await getAnalyticsByStoreAndActionQuery(
      ctx,
      args.storeId,
      STOREFRONT_OBSERVABILITY_ACTION,
      args.startDate,
      args.endDate,
      { includeSyntheticMonitor: true },
    )
      .order("desc")
      .take(MAX_STOREFRONT_OBSERVABILITY_RESULTS);

    return buildStorefrontObservabilityReport(analytics);
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
    const analytics = await getAnalyticsByStoreQuery(
      ctx,
      args.storeId,
      args.startDate,
      args.endDate,
    )
      .order("desc")
      .take(MAX_PRODUCT_VIEW_RECORDS);

    // Calculate all metrics in a single pass
    const uniqueVisitors = new Set(analytics.map((a) => a.storeFrontUserId))
      .size;
    const totalViews = analytics.length;

    // Product view metrics
    const productViews = analytics.filter((a) =>
      ["viewed_product", "view_product"].includes(a.action),
    );

    // Cart metrics
    const cartActions = analytics.filter((a) =>
      ["added_product_to_bag", "updated_product_in_bag"].includes(a.action),
    );

    // Checkout metrics
    const checkoutActions = analytics.filter((a) =>
      ["initiated_checkout", "checkout_initiated"].includes(a.action),
    );

    // Purchase metrics
    const purchaseActions = analytics.filter((a) =>
      ["finalized_checkout", "checkout_finalized"].includes(a.action),
    );

    // Device breakdown
    const deviceBreakdown = analytics.reduce(
      (acc, a) => {
        if (a.device === "mobile") acc.mobile++;
        else if (a.device === "desktop") acc.desktop++;
        else acc.unknown++;
        return acc;
      },
      { mobile: 0, desktop: 0, unknown: 0 },
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
          a.data?.product,
      )
      .reduce(
        (acc, a) => {
          const productId = a.data!.product as string;
          acc[productId] = (acc[productId] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
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
      {} as Record<number, number>,
    );

    const peakHour = Object.entries(visitorsByHour).sort(
      ([, a], [, b]) => b - a,
    )[0]?.[0];

    const orders = await getCompletedOrdersQuery(
      ctx,
      args.storeId,
      args.startDate,
      args.endDate,
    )
      .order("desc")
      .take(MAX_REPORTING_ORDERS);

    const totalRevenue = orders.reduce(
      (sum, order) => sum + (order.amount || 0),
      0,
    );
    const totalOrders = orders.length;
    const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    const revenueByDay = orders.reduce(
      (acc, order) => {
        const day = new Date(order._creationTime).toISOString().split("T")[0];
        acc[day] = (acc[day] || 0) + (order.amount || 0);
        return acc;
      },
      {} as Record<string, number>,
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
                (purchaseActions.length / productViews.length) * 100 * 100,
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
