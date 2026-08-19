import type { AthenaReadIntent } from "../../platform/readIntentCatalog";
import type { OperationReadDefinition } from "../types";
import { defineReadOperation } from "./_shapes";

/**
 * U10 - HTTP customer channel routes - read (`http_read`) operation definitions.
 *
 * Two shapes, split by whether the response is scoped to one shopper:
 *
 * - **`customerRead`** — the route returns that shopper's own rows (their bag,
 *   their orders, their checkout sessions, their reward balance). These are
 *   claim-only: `storefrontCustomer: "admit"` with `public: "deny"`, so an
 *   anonymous caller cannot reach them at all and the handler always has a
 *   `storefront_customer` actor to derive `owner` from. `normalUser` is denied
 *   for the same reason as the writes — an operator session is not a shopper.
 * - **`browseRead`** — catalog, store bootstrap and per-product review reads
 *   that anonymous visitors must keep seeing. `public: "admit"` with
 *   `storefrontCustomer: "deny"`, which makes the storefront adapter report
 *   `not_applicable` and leaves a stale or malformed cookie unable to turn a
 *   browse request into a denial.
 *
 * No `http_read` writes an admission row (the read path runs through the
 * internal query with no capture), and the shared demo is denied throughout, so
 * `SHARED_DEMO_ALLOWED_READ_INTENTS` is untouched by this unit.
 */

function customerRead(args: {
  intent: AthenaReadIntent;
  method?: string;
  operationId: string;
  path: string;
}) {
  return defineReadOperation({
    kind: "http_read" as const,
    route: { method: args.method ?? "GET", path: args.path },
    operationId: args.operationId,
    access: { kind: "read" as const, intent: args.intent },
    // The claim row decides the store; `storeId` is absent from the forwarded
    // path/query arguments on purpose.
    scope: { kind: "store" as const, storeIdArg: "storeId" },
    actors: {
      normalUser: "deny" as const,
      sharedDemo: "deny" as const,
      storefrontCustomer: "admit" as const,
      public: "deny" as const,
    },
  });
}

function browseRead(args: {
  intent: AthenaReadIntent;
  method?: string;
  operationId: string;
  path: string;
}) {
  return defineReadOperation({
    kind: "http_read" as const,
    route: { method: args.method ?? "GET", path: args.path },
    operationId: args.operationId,
    access: { kind: "read" as const, intent: args.intent },
    scope: { kind: "none" as const },
    actors: {
      normalUser: "admit" as const,
      sharedDemo: "deny" as const,
      storefrontCustomer: "deny" as const,
      public: "admit" as const,
    },
  });
}

// --- bags ------------------------------------------------------------------

export const getBagRouteReadDefinition = customerRead({
  intent: "storefront.account.view",
  operationId: "http.customerChannel.bag.get",
  path: "/bags/:bagId",
});

export const getSavedBagRouteReadDefinition = customerRead({
  intent: "storefront.account.view",
  operationId: "http.customerChannel.savedBag.get",
  path: "/savedBags/:bagId",
});

// --- checkout --------------------------------------------------------------

export const getActiveCheckoutSessionRouteReadDefinition = customerRead({
  intent: "storefront.account.view",
  operationId: "http.customerChannel.checkout.active",
  path: "/checkout/active",
});

export const getPendingCheckoutSessionsRouteReadDefinition = customerRead({
  intent: "storefront.account.view",
  operationId: "http.customerChannel.checkout.pending",
  path: "/checkout/pending",
});

export const getCheckoutSessionRouteReadDefinition = customerRead({
  intent: "storefront.account.view",
  operationId: "http.customerChannel.checkout.get",
  path: "/checkout/:sessionId",
});

export const verifyCheckoutPaymentRouteReadDefinition = customerRead({
  intent: "storefront.account.view",
  operationId: "http.customerChannel.checkout.verifyPayment",
  path: "/checkout/verify/:reference",
});

// --- account ---------------------------------------------------------------

export const getMeRouteReadDefinition = customerRead({
  intent: "storefront.account.view",
  operationId: "http.customerChannel.me.get",
  path: "/me",
});

export const getStorefrontUserRouteReadDefinition = customerRead({
  intent: "storefront.account.view",
  operationId: "http.customerChannel.user.get",
  path: "/users/:userId",
});

/**
 * Guest bootstrap read. It stays public because its whole job is to recover or
 * mint the guest row behind a cookie that may be stale or absent — admitting it
 * as a claim would turn "unknown guest id" into a terminal denial and break the
 * recovery path the storefront depends on.
 *
 * ACCEPTED RISK, stated plainly: a cookie IS caller-supplied. Anyone can
 * present an arbitrary `guest_id` and read that guest row, so this is a known
 * IDOR on the guest record, accepted so cookie recovery keeps working. An
 * earlier version of this comment claimed the opposite ("no request-supplied
 * id can select another shopper's row") — a comment asserting safety the code
 * does not have is worse than no comment, because it stops the next reader
 * looking.
 */
export const getGuestRouteReadDefinition = browseRead({
  intent: "storefront.account.view",
  operationId: "http.customerChannel.guest.get",
  path: "/guests",
});

export const getUserOffersRouteReadDefinition = customerRead({
  intent: "storefront.account.view",
  operationId: "http.customerChannel.userOffers.get",
  path: "/user-offers",
});

export const getOffersRouteReadDefinition = customerRead({
  intent: "storefront.account.view",
  operationId: "http.customerChannel.offers.get",
  path: "/offers",
});

export const getUpsellRouteReadDefinition = customerRead({
  intent: "storefront.catalog.view",
  operationId: "http.customerChannel.upsells.get",
  path: "/upsells",
});

// --- orders ----------------------------------------------------------------

export const getOrdersRouteReadDefinition = customerRead({
  intent: "online_orders.view",
  operationId: "http.customerChannel.onlineOrder.getAll",
  path: "/orders",
});

export const getOrderRouteReadDefinition = customerRead({
  intent: "online_orders.view",
  operationId: "http.customerChannel.onlineOrder.get",
  path: "/orders/:orderId",
});

// --- storefront bootstrap / catalog ----------------------------------------

export const getStorefrontRouteReadDefinition = browseRead({
  intent: "storefront.catalog.view",
  operationId: "http.customerChannel.storefront.get",
  path: "/storefront",
});

export const getHomepageSnapshotRouteReadDefinition = browseRead({
  intent: "storefront.catalog.view",
  operationId: "http.customerChannel.homepageSnapshot.get",
  path: "/homepage-snapshot",
});

// --- reviews ---------------------------------------------------------------

export const reviewExistsForOrderItemRouteReadDefinition = browseRead({
  intent: "storefront.reviews.view",
  operationId: "http.customerChannel.reviews.existsForOrderItem",
  path: "/reviews/order-item/:orderItemId/exists",
});

export const userReviewExistsForOrderItemRouteReadDefinition = customerRead({
  intent: "storefront.reviews.view",
  operationId: "http.customerChannel.reviews.userExistsForOrderItem",
  path: "/reviews/order-item/:orderItemId/user-exists",
});

export const getReviewByOrderItemRouteReadDefinition = browseRead({
  intent: "storefront.reviews.view",
  operationId: "http.customerChannel.reviews.getByOrderItem",
  path: "/reviews/order-item/:orderItemId",
});

export const getReviewsByProductSkuRouteReadDefinition = browseRead({
  intent: "storefront.reviews.view",
  operationId: "http.customerChannel.reviews.getByProductSku",
  path: "/reviews/product-sku/:productSkuId",
});

export const getReviewsByProductRouteReadDefinition = browseRead({
  intent: "storefront.reviews.view",
  operationId: "http.customerChannel.reviews.getByProduct",
  path: "/reviews/product/:productId",
});

export const getUserReviewsRouteReadDefinition = customerRead({
  intent: "storefront.reviews.view",
  operationId: "http.customerChannel.reviews.getByUser",
  path: "/reviews/user",
});

export const getUserReviewsByProductSkuRouteReadDefinition = customerRead({
  intent: "storefront.reviews.view",
  operationId: "http.customerChannel.reviews.getByUserAndProductSku",
  path: "/reviews/user/product-sku/:productSkuId",
});

// --- rewards ---------------------------------------------------------------

export const getRewardPointsRouteReadDefinition = customerRead({
  intent: "storefront.rewards.view",
  operationId: "http.customerChannel.rewards.points",
  path: "/rewards/points",
});

export const getRewardHistoryRouteReadDefinition = customerRead({
  intent: "storefront.rewards.view",
  operationId: "http.customerChannel.rewards.history",
  path: "/rewards/history",
});

export const getRewardTiersRouteReadDefinition = customerRead({
  intent: "storefront.rewards.view",
  operationId: "http.customerChannel.rewards.tiers",
  path: "/rewards/tiers",
});

export const getEligiblePastOrdersRouteReadDefinition = customerRead({
  intent: "storefront.rewards.view",
  operationId: "http.customerChannel.rewards.eligiblePastOrders",
  path: "/rewards/eligible-past-orders",
});

export const getOrderRewardPointsRouteReadDefinition = customerRead({
  intent: "storefront.rewards.view",
  operationId: "http.customerChannel.rewards.orderPoints",
  path: "/rewards/order-points",
});

// --- POS receipt share -----------------------------------------------------

/**
 * A receipt share link is its own bearer token in the path: the recipient is a
 * customer who never had a storefront cookie, so the route stays public and the
 * unguessable token is the boundary.
 */
export const getReceiptShareRouteReadDefinition = browseRead({
  intent: "customer_messaging.view",
  operationId: "http.customerChannel.posTransaction.receiptShare",
  path: "/pos-transactions/receipt-shares/:token",
});

export const HTTP_CUSTOMER_READ_DEFINITIONS: readonly OperationReadDefinition[] =
  [
    getBagRouteReadDefinition,
    getSavedBagRouteReadDefinition,
    getActiveCheckoutSessionRouteReadDefinition,
    getPendingCheckoutSessionsRouteReadDefinition,
    getCheckoutSessionRouteReadDefinition,
    verifyCheckoutPaymentRouteReadDefinition,
    getMeRouteReadDefinition,
    getStorefrontUserRouteReadDefinition,
    getGuestRouteReadDefinition,
    getUserOffersRouteReadDefinition,
    getOffersRouteReadDefinition,
    getUpsellRouteReadDefinition,
    getOrdersRouteReadDefinition,
    getOrderRouteReadDefinition,
    getStorefrontRouteReadDefinition,
    getHomepageSnapshotRouteReadDefinition,
    reviewExistsForOrderItemRouteReadDefinition,
    userReviewExistsForOrderItemRouteReadDefinition,
    getReviewByOrderItemRouteReadDefinition,
    getReviewsByProductSkuRouteReadDefinition,
    getReviewsByProductRouteReadDefinition,
    getUserReviewsRouteReadDefinition,
    getUserReviewsByProductSkuRouteReadDefinition,
    getRewardPointsRouteReadDefinition,
    getRewardHistoryRouteReadDefinition,
    getRewardTiersRouteReadDefinition,
    getEligiblePastOrdersRouteReadDefinition,
    getOrderRewardPointsRouteReadDefinition,
    getReceiptShareRouteReadDefinition,
  ];
