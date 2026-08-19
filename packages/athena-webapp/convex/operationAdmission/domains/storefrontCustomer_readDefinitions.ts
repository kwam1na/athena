import type { AthenaReadIntent } from "../../platform/readIntentCatalog";
import type {
  OperationReadDefinition,
  OperationScopeResolver,
} from "../types";
import { defineReadOperation } from "./_shapes";

/**
 * StoreFront customer modules - read (query/http_read) operation definitions.
 *
 * Scaffolded by U1a so the composing arrays in `readDefinitions.ts` never need
 * to change again: the owning unit fills this array and edits nothing else.
 *
 * Intents come from the closed catalog and split by WHO the data is for:
 * `storefront.account.view` is one shopper's account state as an operator sees
 * it, `storefront.analytics.view` is aggregate behaviour, `storefront.catalog.view`
 * is shopper-facing merchandising, `storefront.rewards.view` is the loyalty
 * ledger, and `online_orders.view` is the order book.
 *
 * `actors.sharedDemo: "admit"` is applied under ONE rule so it is auditable:
 * the intent must be in `SHARED_DEMO_ALLOWED_READ_INTENTS` **and** the read
 * must be store-scoped by argument, so the clamp the demo adapter applies is
 * meaningful rather than resolved from a row the caller named. Of the four
 * storefront intents used here none is granted, so exactly one read qualifies.
 * Widening demo read reach is a deliberate policy change, not a migration side
 * effect.
 *
 * `actors.storefrontCustomer` is absent throughout: a shopper's cookie is a
 * claim boundary only at HTTP ingress, and the rail rejects the actor on
 * `query` kinds. Shopper-facing reads reach these handlers through the httpCustomer domain's
 * `http_read` definitions and the internal siblings declared alongside each
 * public query.
 */

/** storeId lives on the row this read names, not in the arguments. */
function resolveStoreFromRow(
  table: "bag" | "checkoutSession" | "onlineOrder" | "promoCode" | "savedBag",
  idArg: string,
): OperationScopeResolver {
  return async (ctx, args) => {
    const id = args[idArg];
    if (typeof id !== "string") return {};
    const row = await ctx.db.get(table, id as never);
    if (!row) return {};
    return row.storeId ? { storeId: row.storeId } : {};
  };
}

/**
 * The storefront identity columns are a union of two tables, so the store has
 * to be derived by normalizing the id rather than by guessing a table. An id
 * that belongs to neither — or a guest row with no store — resolves to "no
 * constraint" rather than to a defaulted store.
 */
function resolveStoreFromStorefrontActor(idArg: string): OperationScopeResolver {
  return async (ctx, args) => {
    const id = args[idArg];
    if (typeof id !== "string") return {};

    const storeFrontUserId = ctx.db.normalizeId("storeFrontUser", id);
    if (storeFrontUserId) {
      const user = await ctx.db.get("storeFrontUser", storeFrontUserId);
      return user?.storeId ? { storeId: user.storeId } : {};
    }

    const guestId = ctx.db.normalizeId("guest", id);
    if (!guestId) return {};
    const guest = await ctx.db.get("guest", guestId);
    return guest?.storeId ? { storeId: guest.storeId } : {};
  };
}

function storefrontRead(args: {
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

// --- storeFront/bag -------------------------------------------------------

export const getAllBagsReadDefinition = storefrontRead({
  functionName: "storeFront/bag:getAll",
  intent: "storefront.account.view",
  operationId: "storeFront/bag.getAll.read",
  scope: { kind: "none" },
});

export const getBagByIdReadDefinition = storefrontRead({
  functionName: "storeFront/bag:getById",
  intent: "storefront.account.view",
  operationId: "storeFront/bag.getById.read",
  scope: { kind: "store", resolve: resolveStoreFromRow("bag", "id") },
});

export const getBagByUserIdReadDefinition = storefrontRead({
  functionName: "storeFront/bag:getByUserId",
  intent: "storefront.account.view",
  operationId: "storeFront/bag.getByUserId.read",
  scope: {
    kind: "store",
    resolve: resolveStoreFromStorefrontActor("storeFrontUserId"),
  },
});

export const getPaginatedBagsReadDefinition = storefrontRead({
  functionName: "storeFront/bag:getPaginatedBags",
  intent: "storefront.account.view",
  operationId: "storeFront/bag.getPaginatedBags.read",
});

// --- storeFront/bagItem ---------------------------------------------------

export const getBagItemsForStoreReadDefinition = storefrontRead({
  functionName: "storeFront/bagItem:getBagItemsForStore",
  intent: "storefront.account.view",
  operationId: "storeFront/bagItem.getBagItemsForStore.read",
});

// --- storeFront/checkoutSession -------------------------------------------

/**
 * The only storefront-customer read that satisfies both halves of the demo rule:
 * `online_orders.view` is granted AND the store comes from an argument, so the
 * demo adapter clamps a store the caller cannot choose out from under it.
 */
export const getActiveCheckoutSessionsForStoreReadDefinition = storefrontRead({
  functionName: "storeFront/checkoutSession:getActiveCheckoutSessionsForStore",
  intent: "online_orders.view",
  operationId: "storeFront/checkoutSession.getActiveCheckoutSessionsForStore.read",
  sharedDemo: "admit",
});

export const getActiveCheckoutSessionReadDefinition = storefrontRead({
  functionName: "storeFront/checkoutSession:getActiveCheckoutSession",
  intent: "online_orders.view",
  operationId: "storeFront/checkoutSession.getActiveCheckoutSession.read",
  scope: {
    kind: "store",
    resolve: resolveStoreFromStorefrontActor("storeFrontUserId"),
  },
});

// --- storeFront/customerBehaviorTimeline ----------------------------------

function customerBehaviorRead(functionName: string, operationId: string) {
  return storefrontRead({
    functionName,
    intent: "storefront.analytics.view",
    operationId,
    scope: {
      kind: "store",
      resolve: resolveStoreFromStorefrontActor("userId"),
    },
  });
}

export const getCustomerBehaviorTimelineReadDefinition = customerBehaviorRead(
  "storeFront/customerBehaviorTimeline:getCustomerBehaviorTimeline",
  "storeFront/customerBehaviorTimeline.getCustomerBehaviorTimeline.read",
);

export const getCustomerBehaviorSummaryReadDefinition = customerBehaviorRead(
  "storeFront/customerBehaviorTimeline:getCustomerBehaviorSummary",
  "storeFront/customerBehaviorTimeline.getCustomerBehaviorSummary.read",
);

export const getCustomerObservabilityTimelineReadDefinition =
  customerBehaviorRead(
    "storeFront/customerBehaviorTimeline:getCustomerObservabilityTimeline",
    "storeFront/customerBehaviorTimeline.getCustomerObservabilityTimeline.read",
  );

// --- storeFront/guest -----------------------------------------------------

// Store-scoped (default `storeIdArg: "storeId"`): a guest is a per-store row
// and the listing names the store it is about; `scope: none` here used to
// answer every tenant's guests to any signed-in Athena account.
export const getAllGuestsReadDefinition = storefrontRead({
  functionName: "storeFront/guest:getAll",
  intent: "storefront.account.view",
  operationId: "storeFront/guest.getAll.read",
});

export const getUniqueVisitorsForDayReadDefinition = storefrontRead({
  functionName: "storeFront/guest:getUniqueVisitorsForDay",
  intent: "storefront.analytics.view",
  operationId: "storeFront/guest.getUniqueVisitorsForDay.read",
});

export const getUniqueVisitorsReadDefinition = storefrontRead({
  functionName: "storeFront/guest:getUniqueVisitors",
  intent: "storefront.analytics.view",
  operationId: "storeFront/guest.getUniqueVisitors.read",
});

export const getReturningVisitorsForDayReadDefinition = storefrontRead({
  functionName: "storeFront/guest:getReturningVisitorsForDay",
  intent: "storefront.analytics.view",
  operationId: "storeFront/guest.getReturningVisitorsForDay.read",
});

// --- storeFront/offers ----------------------------------------------------

export const getOffersByStoreIdReadDefinition = storefrontRead({
  functionName: "storeFront/offers:getByStoreId",
  intent: "storefront.analytics.view",
  operationId: "storeFront/offers.getByStoreId.read",
});

export const getOffersByPromoCodeIdReadDefinition = storefrontRead({
  functionName: "storeFront/offers:getByPromoCodeId",
  intent: "storefront.analytics.view",
  operationId: "storeFront/offers.getByPromoCodeId.read",
  scope: {
    kind: "store",
    resolve: resolveStoreFromRow("promoCode", "promoCodeId"),
  },
});

export const getOffersByEmailReadDefinition = storefrontRead({
  functionName: "storeFront/offers:getByEmail",
  intent: "storefront.account.view",
  operationId: "storeFront/offers.getByEmail.read",
  scope: { kind: "none" },
});

// --- storeFront/rewards ---------------------------------------------------

export const getRewardTiersReadDefinition = storefrontRead({
  functionName: "storeFront/rewards:getTiers",
  intent: "storefront.rewards.view",
  operationId: "storeFront/rewards.getTiers.read",
});

// --- storeFront/savedBag --------------------------------------------------

export const getAllSavedBagsReadDefinition = storefrontRead({
  functionName: "storeFront/savedBag:getAll",
  intent: "storefront.account.view",
  operationId: "storeFront/savedBag.getAll.read",
  scope: { kind: "none" },
});

export const getSavedBagByIdReadDefinition = storefrontRead({
  functionName: "storeFront/savedBag:getById",
  intent: "storefront.account.view",
  operationId: "storeFront/savedBag.getById.read",
  scope: { kind: "store", resolve: resolveStoreFromRow("savedBag", "id") },
});

// --- storeFront/user ------------------------------------------------------

function storefrontAccountRead(
  functionName: string,
  operationId: string,
  idArg: string,
) {
  return storefrontRead({
    functionName,
    intent: "storefront.account.view",
    operationId,
    scope: { kind: "store", resolve: resolveStoreFromStorefrontActor(idArg) },
  });
}

export const getAllStoreFrontUsersReadDefinition = storefrontRead({
  functionName: "storeFront/user:getAll",
  intent: "storefront.account.view",
  operationId: "storeFront/user.getAll.read",
  scope: { kind: "none" },
});

export const getUserByIdentifierReadDefinition = storefrontAccountRead(
  "storeFront/user:getByIdentifier",
  "storeFront/user.getByIdentifier.read",
  "id",
);

export const findLinkedAccountsReadDefinition = storefrontAccountRead(
  "storeFront/user:findLinkedAccounts",
  "storeFront/user.findLinkedAccounts.read",
  "userId",
);

export const getAllUserActivityReadDefinition = storefrontAccountRead(
  "storeFront/user:getAllUserActivity",
  "storeFront/user.getAllUserActivity.read",
  "id",
);

export const getMostRecentActivityReadDefinition = storefrontAccountRead(
  "storeFront/user:getMostRecentActivity",
  "storeFront/user.getMostRecentActivity.read",
  "id",
);

export const getLastViewedProductsReadDefinition = storefrontRead({
  functionName: "storeFront/user:getLastViewedProducts",
  intent: "storefront.catalog.view",
  operationId: "storeFront/user.getLastViewedProducts.read",
  scope: { kind: "store", resolve: resolveStoreFromStorefrontActor("id") },
});

export const getOnlineOrderByIdReadDefinition = storefrontRead({
  functionName: "storeFront/user:getOnlineOrderById",
  intent: "online_orders.view",
  operationId: "storeFront/user.getOnlineOrderById.read",
  scope: { kind: "store", resolve: resolveStoreFromRow("onlineOrder", "id") },
});

// --- storeFront/users -----------------------------------------------------

export const getStoreFrontUsersByIdsReadDefinition = storefrontRead({
  functionName: "storeFront/users:getByIds",
  intent: "storefront.account.view",
  operationId: "storeFront/users.getByIds.read",
  scope: { kind: "none" },
});

export const STOREFRONT_CUSTOMER_READ_DEFINITIONS: readonly OperationReadDefinition[] =
  [
    getAllBagsReadDefinition,
    getBagByIdReadDefinition,
    getBagByUserIdReadDefinition,
    getPaginatedBagsReadDefinition,
    getBagItemsForStoreReadDefinition,
    getActiveCheckoutSessionReadDefinition,
    getActiveCheckoutSessionsForStoreReadDefinition,
    getCustomerBehaviorTimelineReadDefinition,
    getCustomerBehaviorSummaryReadDefinition,
    getCustomerObservabilityTimelineReadDefinition,
    getAllGuestsReadDefinition,
    getUniqueVisitorsForDayReadDefinition,
    getUniqueVisitorsReadDefinition,
    getReturningVisitorsForDayReadDefinition,
    getOffersByStoreIdReadDefinition,
    getOffersByPromoCodeIdReadDefinition,
    getOffersByEmailReadDefinition,
    getRewardTiersReadDefinition,
    getAllSavedBagsReadDefinition,
    getSavedBagByIdReadDefinition,
    getAllStoreFrontUsersReadDefinition,
    getUserByIdentifierReadDefinition,
    findLinkedAccountsReadDefinition,
    getAllUserActivityReadDefinition,
    getLastViewedProductsReadDefinition,
    getOnlineOrderByIdReadDefinition,
    getMostRecentActivityReadDefinition,
    getStoreFrontUsersByIdsReadDefinition,
  ];
