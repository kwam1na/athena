import type { Id } from "../../_generated/dataModel";
import type {
  OperationAdmissionCtx,
  OperationDefinition,
  OperationScopeResolver,
} from "../types";
import { defineOperation } from "./_shapes";

/**
 * U7 - storeFront operator/content modules - write/action/http operation definitions.
 *
 * Scaffolded by U1a so the composing arrays in `definitions.ts` never need to
 * change again: the owning unit fills this array and edits nothing else.
 *
 * Capability choices follow the closed classification in
 * `platform/capabilityCatalog.ts` (`EXACT_PUBLIC_WRITE_CAPABILITIES` first,
 * then `PUBLIC_WRITE_MODULE_CAPABILITIES`): `storeFront/analytics` →
 * `storefront.analytics.write`, `storeFront/onlineOrder` → `orders.manage`,
 * `storeFront/reviews` → `reviews.manage`. Nothing here re-classifies a write
 * the catalog already named.
 *
 * `actors.sharedDemo` is derived, not chosen: `"admit"` exactly when the
 * capability is in `SHARED_DEMO_ALLOWED_CAPABILITIES`. `reviews.manage` and
 * `orders.manage` are granted; `storefront.analytics.write` is NOT, so every
 * analytics write is an explicit demo denial rather than a grant-set widening.
 *
 * `actors.public: "admit"` appears only where an anonymous storefront HTTP
 * route reaches the function TODAY (`http/domains/customerChannel/routes/{reviews,onlineOrder}.ts`,
 * `http/domains/core/routes/analytics.ts`), so anonymous behaviour is
 * unchanged while wave B2 flips those routes onto the `internal*` siblings and
 * their own `http` definitions. Operator-only writes deny anonymous callers.
 */

type ScopeCtx = OperationAdmissionCtx;

function idArg(args: Record<string, unknown>, name: string) {
  const value = args[name];
  return typeof value === "string" ? value : undefined;
}

/** storeId lives on the row this operation names, not in the arguments. */
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

/**
 * The storefront actor id is a union of `storeFrontUser` and `guest`, so the
 * resolver normalizes against both tables before deriving the store. A guest
 * row without `storeId` resolves to no constraint (U6 owns the backfill that
 * makes it required).
 */
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

function storeFrontWrite(args: {
  capability: OperationDefinition["capability"];
  functionName: string;
  operationId: string;
  publicAccess?: "admit" | "deny";
  scope?: OperationDefinition["scope"];
  sharedDemo?: "admit" | "deny";
}) {
  return defineOperation({
    kind: "mutation" as const,
    functionName: args.functionName,
    operationId: args.operationId,
    capability: args.capability,
    scope: args.scope ?? {
      kind: "store" as const,
      storeIdArg: "storeId",
    },
    readiness: { kind: "store_write" as const },
    effects: { mode: "none" as const },
    actors: {
      normalUser: "admit" as const,
      sharedDemo: args.sharedDemo ?? ("deny" as const),
      public: args.publicAccess ?? ("deny" as const),
    },
  });
}

// --- storeFront/analytics --------------------------------------------------
// `storefront.analytics.write` is not a demo-granted capability, so all three
// writes deny the shared demo.

export const createAnalyticsEventOperationDefinition = storeFrontWrite({
  capability: "storefront.analytics.write",
  functionName: "storeFront/analytics:create",
  operationId: "storeFront/analytics.create",
  // `POST /analytics` is the anonymous storefront tracking beacon.
  publicAccess: "admit",
});

export const updateAnalyticsOwnerOperationDefinition = storeFrontWrite({
  capability: "storefront.analytics.write",
  functionName: "storeFront/analytics:updateOwner",
  operationId: "storeFront/analytics.updateOwner",
  // `POST /analytics/update-owner` runs immediately after a shopper signs in;
  // the store comes from the guest row being re-owned, never from the caller.
  publicAccess: "admit",
  scope: { kind: "store", resolve: storeFrontActorStoreScope("guestId") },
});

export const clearAnalyticsOperationDefinition = storeFrontWrite({
  capability: "storefront.analytics.write",
  functionName: "storeFront/analytics:clear",
  operationId: "storeFront/analytics.clear",
});

// --- storeFront/onlineOrder ------------------------------------------------

export const createOnlineOrderOperationDefinition = storeFrontWrite({
  capability: "orders.manage",
  functionName: "storeFront/onlineOrder:create",
  operationId: "storeFront/onlineOrder.create",
  // No caller left: checkout creates orders through `createFromSession` /
  // `createInternal`. It therefore denies anonymous callers rather than
  // preserving a reach nothing exercises.
  scope: {
    kind: "store",
    resolve: rowStoreScope("checkoutSession", "checkoutSessionId"),
  },
  sharedDemo: "admit",
});

export const updateOnlineOrderItemsOperationDefinition = storeFrontWrite({
  capability: "orders.manage",
  functionName: "storeFront/onlineOrder:updateOrderItems",
  operationId: "storeFront/onlineOrder.updateOrderItems",
  scope: {
    kind: "store",
    resolve: async (ctx: ScopeCtx, args) => {
      const ids = args.orderItemIds;
      const first = Array.isArray(ids) && typeof ids[0] === "string"
        ? (ids[0] as string)
        : undefined;
      if (!first) return {};
      const item = await ctx.db.get("onlineOrderItem", first as never);
      if (!item) return {};
      const order = await ctx.db.get("onlineOrder", item.orderId);
      return order ? { storeId: order.storeId } : {};
    },
  },
  sharedDemo: "admit",
});

export const updateOnlineOrderOwnerOperationDefinition = storeFrontWrite({
  capability: "orders.manage",
  functionName: "storeFront/onlineOrder:updateOwner",
  operationId: "storeFront/onlineOrder.updateOwner",
  // `POST /orders/owner` re-owns a guest's orders at sign-in.
  publicAccess: "admit",
  scope: { kind: "store", resolve: storeFrontActorStoreScope("currentOwner") },
  sharedDemo: "admit",
});

// --- storeFront/reviews ----------------------------------------------------
// `reviews.manage` is demo-granted, so every review write admits the demo
// inside its own store; the store clamp comes from the review/order row.

export const createReviewOperationDefinition = storeFrontWrite({
  capability: "reviews.manage",
  functionName: "storeFront/reviews:create",
  operationId: "storeFront/reviews.create",
  // `POST /reviews` — a shopper claim exists but is not authentication; U10
  // gives the route its own `storefrontCustomer` definition.
  publicAccess: "admit",
  sharedDemo: "admit",
});

export const updateReviewOperationDefinition = storeFrontWrite({
  capability: "reviews.manage",
  functionName: "storeFront/reviews:update",
  operationId: "storeFront/reviews.update",
  publicAccess: "admit",
  scope: { kind: "store", resolve: rowStoreScope("review", "id") },
  sharedDemo: "admit",
});

export const deleteReviewOperationDefinition = storeFrontWrite({
  capability: "reviews.manage",
  functionName: "storeFront/reviews:deleteReview",
  operationId: "storeFront/reviews.deleteReview",
  publicAccess: "admit",
  scope: { kind: "store", resolve: rowStoreScope("review", "id") },
  sharedDemo: "admit",
});

export const markReviewHelpfulOperationDefinition = storeFrontWrite({
  capability: "reviews.manage",
  functionName: "storeFront/reviews:markHelpful",
  operationId: "storeFront/reviews.markHelpful",
  publicAccess: "admit",
  scope: { kind: "store", resolve: rowStoreScope("review", "reviewId") },
  sharedDemo: "admit",
});

/** Moderation: operator-only, so anonymous callers are denied outright. */
function reviewModerationOperation(functionName: string, operationId: string) {
  return storeFrontWrite({
    capability: "reviews.manage",
    functionName,
    operationId,
    scope: { kind: "store", resolve: rowStoreScope("review", "id") },
    sharedDemo: "admit",
  });
}

export const approveReviewOperationDefinition = reviewModerationOperation(
  "storeFront/reviews:approve",
  "storeFront/reviews.approve",
);

export const rejectReviewOperationDefinition = reviewModerationOperation(
  "storeFront/reviews:reject",
  "storeFront/reviews.reject",
);

export const publishReviewOperationDefinition = reviewModerationOperation(
  "storeFront/reviews:publish",
  "storeFront/reviews.publish",
);

export const unpublishReviewOperationDefinition = reviewModerationOperation(
  "storeFront/reviews:unpublish",
  "storeFront/reviews.unpublish",
);

export const U7_STOREFRONT_OPERATOR_OPERATION_DEFINITIONS: readonly OperationDefinition[] =
  [
    createAnalyticsEventOperationDefinition,
    updateAnalyticsOwnerOperationDefinition,
    clearAnalyticsOperationDefinition,
    createOnlineOrderOperationDefinition,
    updateOnlineOrderItemsOperationDefinition,
    updateOnlineOrderOwnerOperationDefinition,
    createReviewOperationDefinition,
    updateReviewOperationDefinition,
    deleteReviewOperationDefinition,
    markReviewHelpfulOperationDefinition,
    approveReviewOperationDefinition,
    rejectReviewOperationDefinition,
    publishReviewOperationDefinition,
    unpublishReviewOperationDefinition,
  ];
