import type { Id } from "../../_generated/dataModel";
import type { AthenaReadIntent } from "../../platform/readIntentCatalog";
import type {
  OperationAdmissionCtx,
  OperationReadDefinition,
  OperationScopeResolver,
} from "../types";
import { defineReadOperation } from "./_shapes";

/**
 * U7 - storeFront operator/content modules - read (query/http_read) operation definitions.
 *
 * Scaffolded by U1a so the composing arrays in `readDefinitions.ts` never need
 * to change again: the owning unit fills this array and edits nothing else.
 *
 * Intents come from the closed catalog:
 *  - `online_orders.view` — order reads. It IS in
 *    `SHARED_DEMO_ALLOWED_READ_INTENTS`, so those reads admit the demo inside
 *    its own store, exactly as today.
 *  - `storefront.analytics.view` and `storefront.reviews.view` — NOT in the
 *    demo read grant set, so every analytics and review read is an explicit
 *    demo denial. Widening the grant set is a policy change reviewed on its
 *    own, not a migration side effect.
 *
 * `actors.public: "admit"` marks the reads an anonymous storefront HTTP route
 * reaches today (`http/domains/customerChannel/routes/{reviews,onlineOrder}.ts`,
 * `http/domains/core/routes/analytics.ts`). Operator surfaces — the workspace
 * analytics panels, the moderation queue, the order operations views — deny
 * anonymous callers.
 */

type ScopeCtx = OperationAdmissionCtx;

function idArg(args: Record<string, unknown>, name: string) {
  const value = args[name];
  return typeof value === "string" ? value : undefined;
}

/** storeId lives on the row this read names, not in the arguments. */
function rowStoreScope(table: string, argName: string): OperationScopeResolver {
  return async (ctx: ScopeCtx, args) => {
    const id = idArg(args, argName);
    if (!id) return {};
    const row = (await ctx.db.get(table as never, id as never)) as
      | { storeId?: Id<"store"> }
      | null;
    return row?.storeId ? { storeId: row.storeId } : {};
  };
}

/** The storefront actor id is a `storeFrontUser` | `guest` union. */
function storeFrontActorStoreScope(argName: string): OperationScopeResolver {
  return async (ctx: ScopeCtx, args) => {
    const id = idArg(args, argName);
    if (!id) return {};
    const storeFrontUserId = ctx.db.normalizeId("storeFrontUser", id);
    if (storeFrontUserId) {
      const user = await ctx.db.get("storeFrontUser", storeFrontUserId);
      return user?.storeId ? { storeId: user.storeId } : {};
    }
    const guestId = ctx.db.normalizeId("guest", id);
    if (guestId) {
      const guest = await ctx.db.get("guest", guestId);
      return guest?.storeId ? { storeId: guest.storeId } : {};
    }
    return {};
  };
}

/** The order behind an order item, for item-scoped reads. */
const orderItemStoreScope: OperationScopeResolver = async (
  ctx: ScopeCtx,
  args,
) => {
  const id = idArg(args, "orderItemId");
  if (!id) return {};
  const item = await ctx.db.get("onlineOrderItem", id as never);
  if (!item) return {};
  const order = await ctx.db.get("onlineOrder", item.orderId);
  return order ? { storeId: order.storeId } : {};
};

/** The product SKU behind a review read. */
const productSkuStoreScope: OperationScopeResolver = async (
  ctx: ScopeCtx,
  args,
) => {
  const id = idArg(args, "productSkuId");
  if (!id) return {};
  const sku = await ctx.db.get("productSku", id as never);
  return sku?.storeId ? { storeId: sku.storeId } : {};
};

/**
 * `storeFront/onlineOrder:get` accepts an order id, an external reference, or
 * a checkout session id. The resolver reproduces the handler's own lookup
 * order so admission clamps the SAME order the body will read — the identical
 * resolver `getOnlineOrderReadDefinition` (the operator sibling
 * `getForOperations`) already uses.
 */
const onlineOrderIdentifierScope: OperationScopeResolver = async (
  ctx: ScopeCtx,
  args,
) => {
  const identifier = idArg(args, "identifier");
  if (!identifier) return {};
  const onlineOrderId = ctx.db.normalizeId("onlineOrder", identifier);
  let order = onlineOrderId
    ? await ctx.db.get("onlineOrder", onlineOrderId)
    : null;
  if (!order) {
    order = await ctx.db
      .query("onlineOrder")
      .withIndex("by_externalReference", (q) =>
        q.eq("externalReference", identifier),
      )
      .first();
  }
  const checkoutSessionId = ctx.db.normalizeId("checkoutSession", identifier);
  if (!order && checkoutSessionId) {
    order = await ctx.db
      .query("onlineOrder")
      .withIndex("by_checkoutSessionId", (q) =>
        q.eq("checkoutSessionId", checkoutSessionId),
      )
      .first();
  }
  return order ? { storeId: order.storeId } : {};
};

const checkoutSessionOrderScope: OperationScopeResolver = async (
  ctx: ScopeCtx,
  args,
) => {
  const checkoutSessionId = idArg(args, "checkoutSessionId");
  if (!checkoutSessionId) return {};
  const session = await ctx.db.get("checkoutSession", checkoutSessionId as never);
  return session?.storeId ? { storeId: session.storeId } : {};
};

const externalReferenceOrderScope: OperationScopeResolver = async (
  ctx: ScopeCtx,
  args,
) => {
  const externalReference = idArg(args, "externalReference");
  if (!externalReference) return {};
  const order = await ctx.db
    .query("onlineOrder")
    .withIndex("by_externalReference", (q) =>
      q.eq("externalReference", externalReference),
    )
    .first();
  return order ? { storeId: order.storeId } : {};
};

function storeFrontRead(args: {
  functionName: string;
  intent: AthenaReadIntent;
  operationId: string;
  publicAccess?: "admit" | "deny";
  scope?: OperationReadDefinition["scope"];
  sharedDemo?: "admit" | "deny";
}) {
  return defineReadOperation({
    kind: "query" as const,
    functionName: args.functionName,
    operationId: args.operationId,
    access: { kind: "read" as const, intent: args.intent },
    scope: args.scope ?? { kind: "store" as const, storeIdArg: "storeId" },
    actors: {
      normalUser: "admit" as const,
      sharedDemo: args.sharedDemo ?? ("deny" as const),
      public: args.publicAccess ?? ("deny" as const),
    },
  });
}

// --- storeFront/analytics --------------------------------------------------
// `storefront.analytics.view` is outside the demo read grant set, so every one
// of these denies the shared demo.

function analyticsRead(args: {
  functionName: string;
  operationId: string;
  publicAccess?: "admit" | "deny";
  scope?: OperationReadDefinition["scope"];
}) {
  return storeFrontRead({
    functionName: args.functionName,
    intent: "storefront.analytics.view",
    operationId: args.operationId,
    publicAccess: args.publicAccess,
    scope: args.scope,
  });
}

export const listAnalyticsReadDefinition = analyticsRead({
  functionName: "storeFront/analytics:getAll",
  operationId: "storeFront/analytics.getAll.read",
});

export const listAnalyticsPagedReadDefinition = analyticsRead({
  functionName: "storeFront/analytics:getAllPaginated",
  operationId: "storeFront/analytics.getAllPaginated.read",
});

export const getAnalyticsEventReadDefinition = analyticsRead({
  functionName: "storeFront/analytics:get",
  operationId: "storeFront/analytics.get.read",
  scope: { kind: "store", resolve: rowStoreScope("analytics", "id") },
});

export const getAnalyticsWorkspaceSummaryReadDefinition = analyticsRead({
  functionName: "storeFront/analytics:getWorkspaceSummary",
  operationId: "storeFront/analytics.getWorkspaceSummary.read",
});

export const getProductViewCountReadDefinition = analyticsRead({
  functionName: "storeFront/analytics:getProductViewCount",
  operationId: "storeFront/analytics.getProductViewCount.read",
  // `GET /analytics/product-view-count` is the anonymous product-page badge.
  publicAccess: "admit",
  scope: { kind: "store", resolve: rowStoreScope("product", "productId") },
});

export const getAnalyticsByPromoCodeReadDefinition = analyticsRead({
  functionName: "storeFront/analytics:getByPromoCodeId",
  operationId: "storeFront/analytics.getByPromoCodeId.read",
  scope: { kind: "store", resolve: rowStoreScope("promoCode", "promoCodeId") },
});

export const getEnhancedAnalyticsReadDefinition = analyticsRead({
  functionName: "storeFront/analytics:getEnhancedAnalytics",
  operationId: "storeFront/analytics.getEnhancedAnalytics.read",
});

export const getRevenueAnalyticsReadDefinition = analyticsRead({
  functionName: "storeFront/analytics:getRevenueAnalytics",
  operationId: "storeFront/analytics.getRevenueAnalytics.read",
});

export const getTopProductsReadDefinition = analyticsRead({
  functionName: "storeFront/analytics:getTopProducts",
  operationId: "storeFront/analytics.getTopProducts.read",
});

export const getVisitorInsightsReadDefinition = analyticsRead({
  functionName: "storeFront/analytics:getVisitorInsights",
  operationId: "storeFront/analytics.getVisitorInsights.read",
});

export const getStoreActivityTimelineReadDefinition = analyticsRead({
  functionName: "storeFront/analytics:getStoreActivityTimeline",
  operationId: "storeFront/analytics.getStoreActivityTimeline.read",
});

export const getStorefrontObservabilityReportReadDefinition = analyticsRead({
  functionName: "storeFront/analytics:getStorefrontObservabilityReport",
  operationId: "storeFront/analytics.getStorefrontObservabilityReport.read",
});

export const getConsolidatedAnalyticsReadDefinition = analyticsRead({
  functionName: "storeFront/analytics:getConsolidatedAnalytics",
  operationId: "storeFront/analytics.getConsolidatedAnalytics.read",
});

// --- storeFront/onlineOrder ------------------------------------------------
// `online_orders.view` IS demo-granted, so these admit the demo inside its own
// store — unchanged from today.

function onlineOrderRead(args: {
  functionName: string;
  operationId: string;
  publicAccess?: "admit" | "deny";
  scope: OperationReadDefinition["scope"];
}) {
  return storeFrontRead({
    functionName: args.functionName,
    intent: "online_orders.view",
    operationId: args.operationId,
    publicAccess: args.publicAccess,
    scope: args.scope,
    sharedDemo: "admit",
  });
}

export const listCustomerOnlineOrdersReadDefinition = onlineOrderRead({
  functionName: "storeFront/onlineOrder:getAll",
  operationId: "storeFront/onlineOrder.getAll.read",
  // `GET /orders` — the shopper's own order list.
  publicAccess: "admit",
  scope: {
    kind: "store",
    resolve: storeFrontActorStoreScope("storeFrontUserId"),
  },
});

export const getCustomerOnlineOrderReadDefinition = onlineOrderRead({
  functionName: "storeFront/onlineOrder:get",
  operationId: "storeFront/onlineOrder.get.read",
  // `GET /orders/:orderId` and the paystack webhook.
  publicAccess: "admit",
  scope: { kind: "store", resolve: onlineOrderIdentifierScope },
});

export const getOnlineOrderByCheckoutSessionReadDefinition = onlineOrderRead({
  functionName: "storeFront/onlineOrder:getByCheckoutSessionId",
  operationId: "storeFront/onlineOrder.getByCheckoutSessionId.read",
  // `POST /checkout/:checkoutSessionId` and the paystack webhook.
  publicAccess: "admit",
  scope: { kind: "store", resolve: checkoutSessionOrderScope },
});

export const getOnlineOrderByExternalReferenceReadDefinition = onlineOrderRead({
  functionName: "storeFront/onlineOrder:getByExternalReference",
  operationId: "storeFront/onlineOrder.getByExternalReference.read",
  scope: { kind: "store", resolve: externalReferenceOrderScope },
});

export const listOnlineOrdersByStoreFrontUserReadDefinition = onlineOrderRead({
  functionName: "storeFront/onlineOrder:getAllOnlineOrdersByStoreFrontUserId",
  operationId: "storeFront/onlineOrder.getAllOnlineOrdersByStoreFrontUserId.read",
  scope: {
    kind: "store",
    resolve: storeFrontActorStoreScope("storeFrontUserId"),
  },
});

export const getOnlineOrderItemsReadDefinition = onlineOrderRead({
  functionName: "storeFront/onlineOrder:getOrderItems",
  operationId: "storeFront/onlineOrder.getOrderItems.read",
  scope: { kind: "store", resolve: rowStoreScope("onlineOrder", "orderId") },
});

export const getReturnExchangeOverviewReadDefinition = onlineOrderRead({
  functionName: "storeFront/onlineOrder:getReturnExchangeOverview",
  operationId: "storeFront/onlineOrder.getReturnExchangeOverview.read",
  scope: { kind: "store", resolve: rowStoreScope("onlineOrder", "orderId") },
});

export const isDuplicateOnlineOrderReadDefinition = onlineOrderRead({
  functionName: "storeFront/onlineOrder:isDuplicateOrder",
  operationId: "storeFront/onlineOrder.isDuplicateOrder.read",
  scope: { kind: "store", resolve: rowStoreScope("onlineOrder", "id") },
});

// --- storeFront/reviews ----------------------------------------------------
// `storefront.reviews.view` is outside the demo read grant set: the review
// surfaces deny the shared demo rather than seeding a new grant.

function reviewRead(args: {
  functionName: string;
  operationId: string;
  publicAccess?: "admit" | "deny";
  scope?: OperationReadDefinition["scope"];
}) {
  return storeFrontRead({
    functionName: args.functionName,
    intent: "storefront.reviews.view",
    operationId: args.operationId,
    publicAccess: args.publicAccess,
    scope: args.scope,
  });
}

export const getReviewByOrderItemReadDefinition = reviewRead({
  functionName: "storeFront/reviews:getByOrderItem",
  operationId: "storeFront/reviews.getByOrderItem.read",
  publicAccess: "admit",
  scope: { kind: "store", resolve: orderItemStoreScope },
});

export const hasReviewForOrderItemReadDefinition = reviewRead({
  functionName: "storeFront/reviews:hasReviewForOrderItem",
  operationId: "storeFront/reviews.hasReviewForOrderItem.read",
  publicAccess: "admit",
  scope: { kind: "store", resolve: orderItemStoreScope },
});

export const hasUserReviewForOrderItemReadDefinition = reviewRead({
  functionName: "storeFront/reviews:hasUserReviewForOrderItem",
  operationId: "storeFront/reviews.hasUserReviewForOrderItem.read",
  publicAccess: "admit",
  scope: { kind: "store", resolve: orderItemStoreScope },
});

export const listReviewsByProductSkuReadDefinition = reviewRead({
  functionName: "storeFront/reviews:getByProductSkuId",
  operationId: "storeFront/reviews.getByProductSkuId.read",
  publicAccess: "admit",
  scope: { kind: "store", resolve: productSkuStoreScope },
});

export const listReviewsByProductReadDefinition = reviewRead({
  functionName: "storeFront/reviews:getByProductId",
  operationId: "storeFront/reviews.getByProductId.read",
  publicAccess: "admit",
  scope: { kind: "store", resolve: rowStoreScope("product", "productId") },
});

export const listReviewsByUserReadDefinition = reviewRead({
  functionName: "storeFront/reviews:getByUser",
  operationId: "storeFront/reviews.getByUser.read",
  publicAccess: "admit",
  scope: { kind: "store", resolve: storeFrontActorStoreScope("userId") },
});

export const listReviewsByUserAndProductSkuReadDefinition = reviewRead({
  functionName: "storeFront/reviews:getByUserAndProductSkuId",
  operationId: "storeFront/reviews.getByUserAndProductSkuId.read",
  publicAccess: "admit",
  scope: { kind: "store", resolve: productSkuStoreScope },
});

export const listStoreReviewsReadDefinition = reviewRead({
  functionName: "storeFront/reviews:getAllReviewsForStore",
  operationId: "storeFront/reviews.getAllReviewsForStore.read",
});

export const getUnapprovedReviewsCountReadDefinition = reviewRead({
  functionName: "storeFront/reviews:getUnapprovedReviewsCount",
  operationId: "storeFront/reviews.getUnapprovedReviewsCount.read",
});

export const U7_STOREFRONT_OPERATOR_READ_OPERATION_DEFINITIONS: readonly OperationReadDefinition[] =
  [
    listAnalyticsReadDefinition,
    listAnalyticsPagedReadDefinition,
    getAnalyticsEventReadDefinition,
    getAnalyticsWorkspaceSummaryReadDefinition,
    getProductViewCountReadDefinition,
    getAnalyticsByPromoCodeReadDefinition,
    getEnhancedAnalyticsReadDefinition,
    getRevenueAnalyticsReadDefinition,
    getTopProductsReadDefinition,
    getVisitorInsightsReadDefinition,
    getStoreActivityTimelineReadDefinition,
    getStorefrontObservabilityReportReadDefinition,
    getConsolidatedAnalyticsReadDefinition,
    listCustomerOnlineOrdersReadDefinition,
    getCustomerOnlineOrderReadDefinition,
    getOnlineOrderByCheckoutSessionReadDefinition,
    getOnlineOrderByExternalReferenceReadDefinition,
    listOnlineOrdersByStoreFrontUserReadDefinition,
    getOnlineOrderItemsReadDefinition,
    getReturnExchangeOverviewReadDefinition,
    isDuplicateOnlineOrderReadDefinition,
    getReviewByOrderItemReadDefinition,
    hasReviewForOrderItemReadDefinition,
    hasUserReviewForOrderItemReadDefinition,
    listReviewsByProductSkuReadDefinition,
    listReviewsByProductReadDefinition,
    listReviewsByUserReadDefinition,
    listReviewsByUserAndProductSkuReadDefinition,
    listStoreReviewsReadDefinition,
    getUnapprovedReviewsCountReadDefinition,
  ];
