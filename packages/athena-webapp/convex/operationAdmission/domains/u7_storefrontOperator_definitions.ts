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
// `storefront.analytics.write` is not a demo-granted capability, so this write
// denies the shared demo.

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

// --- storeFront/reviews ----------------------------------------------------
// `reviews.manage` is demo-granted, so every review write admits the demo
// inside its own store; the store clamp comes from the review row.

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
    clearAnalyticsOperationDefinition,
    createOnlineOrderOperationDefinition,
    updateOnlineOrderItemsOperationDefinition,
    approveReviewOperationDefinition,
    rejectReviewOperationDefinition,
    publishReviewOperationDefinition,
    unpublishReviewOperationDefinition,
  ];
