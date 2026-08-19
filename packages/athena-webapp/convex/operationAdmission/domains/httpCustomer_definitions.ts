import type { AthenaCapability } from "../../platform/capabilityCatalog";
import { PAYSTACK_SIGNATURE_VERIFIER } from "../ingressVerification";
import type { OperationDefinition } from "../types";
import { defineOperation } from "./_shapes";

/**
 * HTTP customer channel routes - write/action/http operation definitions.
 *
 * Every route under `convex/http/domains/customerChannel/**` that is not a GET
 * declares one definition here and is wrapped with `admitHttpRoute`.
 *
 * Two shapes cover the whole surface:
 *
 * - **Customer writes** (`customerWriteRoute`): the shopper is identified by
 *   their `user_id` / `guest_id` cookie, so `storefrontCustomer: "admit"` and
 *   `public: "deny"` — a cookieless request to a customer write route is a
 *   terminal denial, not an anonymous admission. Because the storefront claim
 *   cookies are `SameSite=None`, each one also declares
 *   `ingressVerification: { kind: "origin_allowlist" }` so a foreign origin
 *   cannot drive the write with the visitor's cookie attached.
 *   `normalUser` is denied: an authenticated Athena operator is not a shopper,
 *   and admitting one would hand the handler a `normal_user` actor with no
 *   shopper identity to derive `owner` from.
 * - **Public writes** (`publicWriteRoute`): genuinely pre-claim ingress — guest
 *   bootstrap, the anonymous inventory batch read, and the Paystack webhook.
 *   `public: "admit"` demands a declared verifier, so these carry either the
 *   origin allowlist (storefront-originated) or a signature verifier (webhook).
 *
 * The shared demo is denied everywhere in this channel: a demo principal is an
 * operator persona, never a storefront shopper, so no capability or read intent
 * grant is widened by this unit.
 *
 * The store is never taken from the request. Customer routes declare a store
 * scope whose `storeIdArg` is absent from the forwarded path/query arguments,
 * which is deliberate: the storefront adapter derives the admitted store from
 * the claim ROW and only cross-checks the `store_id` cookie.
 */

function customerWriteRoute(args: {
  capability: AthenaCapability;
  method: string;
  operationId: string;
  path: string;
}) {
  return defineOperation({
    kind: "http" as const,
    route: { method: args.method, path: args.path },
    operationId: args.operationId,
    capability: args.capability,
    scope: { kind: "store" as const, storeIdArg: "storeId" },
    readiness: { kind: "none" as const },
    effects: { mode: "none" as const },
    ingressVerification: { kind: "origin_allowlist" as const },
    actors: {
      normalUser: "deny" as const,
      sharedDemo: "deny" as const,
      storefrontCustomer: "admit" as const,
      public: "deny" as const,
    },
  });
}

function publicWriteRoute(args: {
  capability: AthenaCapability;
  ingressVerification: OperationDefinition["ingressVerification"];
  method: string;
  operationId: string;
  path: string;
}) {
  return defineOperation({
    kind: "http" as const,
    route: { method: args.method, path: args.path },
    operationId: args.operationId,
    capability: args.capability,
    scope: { kind: "none" as const },
    readiness: { kind: "none" as const },
    effects: { mode: "none" as const },
    ingressVerification: args.ingressVerification,
    actors: {
      normalUser: "deny" as const,
      sharedDemo: "deny" as const,
      storefrontCustomer: "deny" as const,
      public: "admit" as const,
    },
  });
}

// --- bag -------------------------------------------------------------------

export const addBagItemRouteOperationDefinition = customerWriteRoute({
  capability: "storefront.session.manage",
  method: "POST",
  operationId: "http.customerChannel.bag.addItem",
  path: "/bags/:bagId/items",
});

export const updateBagOwnerRouteOperationDefinition = customerWriteRoute({
  capability: "storefront.session.manage",
  method: "POST",
  operationId: "http.customerChannel.bag.updateOwner",
  path: "/bags/:bagId/owner",
});

export const deleteBagItemRouteOperationDefinition = customerWriteRoute({
  capability: "storefront.session.manage",
  method: "DELETE",
  operationId: "http.customerChannel.bag.deleteItem",
  path: "/bags/:bagId/items/:itemId",
});

export const clearBagRouteOperationDefinition = customerWriteRoute({
  capability: "storefront.session.manage",
  method: "DELETE",
  operationId: "http.customerChannel.bag.clear",
  path: "/bags/:bagId/items",
});

export const updateBagItemRouteOperationDefinition = customerWriteRoute({
  capability: "storefront.session.manage",
  method: "PUT",
  operationId: "http.customerChannel.bag.updateItem",
  path: "/bags/:bagId/items/:itemId",
});

// --- saved bag -------------------------------------------------------------

export const addSavedBagItemRouteOperationDefinition = customerWriteRoute({
  capability: "storefront.session.manage",
  method: "POST",
  operationId: "http.customerChannel.savedBag.addItem",
  path: "/savedBags/:bagId/items",
});

export const updateSavedBagOwnerRouteOperationDefinition = customerWriteRoute({
  capability: "storefront.session.manage",
  method: "POST",
  operationId: "http.customerChannel.savedBag.updateOwner",
  path: "/savedBags/:bagId/owner",
});

export const deleteSavedBagItemRouteOperationDefinition = customerWriteRoute({
  capability: "storefront.session.manage",
  method: "DELETE",
  operationId: "http.customerChannel.savedBag.deleteItem",
  path: "/savedBags/:bagId/items/:itemId",
});

export const updateSavedBagItemRouteOperationDefinition = customerWriteRoute({
  capability: "storefront.session.manage",
  method: "PUT",
  operationId: "http.customerChannel.savedBag.updateItem",
  path: "/savedBags/:bagId/items/:itemId",
});

// --- checkout --------------------------------------------------------------

export const createCheckoutSessionRouteOperationDefinition = customerWriteRoute(
  {
    capability: "storefront.session.manage",
    method: "POST",
    operationId: "http.customerChannel.checkout.createSession",
    path: "/checkout",
  },
);

/**
 * One route, several body-selected actions (finalize-payment, place-order,
 * cancel-order, …). The rail forwards only path and query arguments, so the
 * body's `action` cannot select a capability at admission time; the definition
 * therefore declares the broadest capability the route can reach and the
 * handler's own branch guards keep the narrower rules.
 */
export const checkoutSessionActionRouteOperationDefinition = customerWriteRoute(
  {
    capability: "orders.create",
    method: "POST",
    operationId: "http.customerChannel.checkout.sessionAction",
    path: "/checkout/:checkoutSessionId",
  },
);

// --- guest / account -------------------------------------------------------

export const updateGuestRouteOperationDefinition = customerWriteRoute({
  capability: "storefront.session.manage",
  method: "PUT",
  operationId: "http.customerChannel.guest.update",
  path: "/guests",
});

/**
 * Guest bootstrap: the caller has no claim yet — this is the request that mints
 * one — so it is public ingress fenced by the storefront origin allowlist.
 */
export const createGuestRouteOperationDefinition = publicWriteRoute({
  capability: "storefront.session.manage",
  ingressVerification: { kind: "origin_allowlist" },
  method: "POST",
  operationId: "http.customerChannel.guest.create",
  path: "/guests",
});

export const updateMeRouteOperationDefinition = customerWriteRoute({
  capability: "storefront.session.manage",
  method: "PUT",
  operationId: "http.customerChannel.me.update",
  path: "/me",
});

export const updateStorefrontUserRouteOperationDefinition = customerWriteRoute({
  capability: "storefront.session.manage",
  method: "PUT",
  operationId: "http.customerChannel.user.update",
  path: "/users/:userId",
});

// --- offers ----------------------------------------------------------------

export const createOfferRouteOperationDefinition = customerWriteRoute({
  capability: "storefront.session.manage",
  method: "POST",
  operationId: "http.customerChannel.offers.create",
  path: "/offers",
});

// --- orders ----------------------------------------------------------------

export const updateOrderOwnerRouteOperationDefinition = customerWriteRoute({
  capability: "orders.manage",
  method: "POST",
  operationId: "http.customerChannel.onlineOrder.updateOwner",
  path: "/orders/owner",
});

// --- reviews ---------------------------------------------------------------

export const createReviewRouteOperationDefinition = customerWriteRoute({
  capability: "reviews.manage",
  method: "POST",
  operationId: "http.customerChannel.reviews.create",
  path: "/reviews",
});

export const updateReviewRouteOperationDefinition = customerWriteRoute({
  capability: "reviews.manage",
  method: "PATCH",
  operationId: "http.customerChannel.reviews.update",
  path: "/reviews/:id",
});

export const deleteReviewRouteOperationDefinition = customerWriteRoute({
  capability: "reviews.manage",
  method: "DELETE",
  operationId: "http.customerChannel.reviews.delete",
  path: "/reviews/:id",
});

export const markReviewHelpfulRouteOperationDefinition = customerWriteRoute({
  capability: "reviews.manage",
  method: "POST",
  operationId: "http.customerChannel.reviews.markHelpful",
  path: "/reviews/:reviewId/helpful",
});

// --- rewards ---------------------------------------------------------------

export const redeemRewardPointsRouteOperationDefinition = customerWriteRoute({
  capability: "rewards.manage",
  method: "POST",
  operationId: "http.customerChannel.rewards.redeem",
  path: "/rewards/redeem",
});

export const awardPastOrderPointsRouteOperationDefinition = customerWriteRoute({
  capability: "rewards.manage",
  method: "POST",
  operationId: "http.customerChannel.rewards.awardPastOrder",
  path: "/rewards/award-past-order",
});

export const awardGuestOrderPointsRouteOperationDefinition = customerWriteRoute(
  {
    capability: "rewards.manage",
    method: "POST",
    operationId: "http.customerChannel.rewards.awardGuestOrders",
    path: "/rewards/award-guest-orders",
  },
);

// --- storefront ------------------------------------------------------------

/**
 * A POST that only reads inventory for the anonymous storefront grid. It stays
 * public (a shopper has no claim while browsing) and is fenced by the origin
 * allowlist like every other storefront-originated write.
 */
export const storefrontInventoryBatchRouteOperationDefinition =
  publicWriteRoute({
    capability: "storefront.session.manage",
    ingressVerification: { kind: "origin_allowlist" },
    method: "POST",
    operationId: "http.customerChannel.storefront.inventoryBatch",
    path: "/storefront/inventory/batch",
  });

// --- payment webhook -------------------------------------------------------

/**
 * Paystack has no cookie and no origin — its only boundary is the HMAC over the
 * raw body, verified BEFORE admission so a forged webhook leaves no admission
 * row and no capture. The verifier fails closed when `PAYSTACK_SECRET_KEY` is
 * unset.
 */
export const paystackWebhookRouteOperationDefinition = publicWriteRoute({
  capability: "billing.manage",
  ingressVerification: {
    kind: "signature",
    verifier: PAYSTACK_SIGNATURE_VERIFIER,
  },
  method: "POST",
  operationId: "http.customerChannel.paystack.webhook",
  path: "/webhooks/paystack",
});

export const HTTP_CUSTOMER_DEFINITIONS: readonly OperationDefinition[] =
  [
    addBagItemRouteOperationDefinition,
    updateBagOwnerRouteOperationDefinition,
    deleteBagItemRouteOperationDefinition,
    clearBagRouteOperationDefinition,
    updateBagItemRouteOperationDefinition,
    addSavedBagItemRouteOperationDefinition,
    updateSavedBagOwnerRouteOperationDefinition,
    deleteSavedBagItemRouteOperationDefinition,
    updateSavedBagItemRouteOperationDefinition,
    createCheckoutSessionRouteOperationDefinition,
    checkoutSessionActionRouteOperationDefinition,
    updateGuestRouteOperationDefinition,
    createGuestRouteOperationDefinition,
    updateMeRouteOperationDefinition,
    updateStorefrontUserRouteOperationDefinition,
    createOfferRouteOperationDefinition,
    updateOrderOwnerRouteOperationDefinition,
    createReviewRouteOperationDefinition,
    updateReviewRouteOperationDefinition,
    deleteReviewRouteOperationDefinition,
    markReviewHelpfulRouteOperationDefinition,
    redeemRewardPointsRouteOperationDefinition,
    awardPastOrderPointsRouteOperationDefinition,
    awardGuestOrderPointsRouteOperationDefinition,
    storefrontInventoryBatchRouteOperationDefinition,
    paystackWebhookRouteOperationDefinition,
  ];
