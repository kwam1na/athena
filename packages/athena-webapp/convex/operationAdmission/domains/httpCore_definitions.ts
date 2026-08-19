import type { AthenaCapability } from "../../platform/capabilityCatalog";
import {
  HARNESS_WAIVER_BROKER_VERIFIER,
  MARKETING_ORIGIN_VERIFIER,
  MTN_MOMO_CALLBACK_VERIFIER,
  STOREFRONT_TRACKING_ORIGIN_VERIFIER,
  WHATSAPP_SIGNATURE_VERIFIER,
} from "../ingressVerification";
import type { OperationDefinition } from "../types";
import { defineOperation } from "./_shapes";

/**
 * HTTP core, messaging and money-movement routes - write/action/http
 * operation definitions.
 *
 * Four shapes cover the whole non-GET surface of
 * `convex/http/domains/{core,customerMessaging,moneyMovement}/**` and
 * `convex/http.ts`:
 *
 * - **Customer writes** (`customerWriteRoute`) — the shopper is identified by
 *   their `user_id` / `guest_id` cookie, so `storefrontCustomer: "admit"` and
 *   `public: "deny"`: a cookieless request is a terminal denial, never an
 *   anonymous admission. The claim cookies are `SameSite=None`, so each one
 *   also declares the storefront origin allowlist. `normalUser` is denied — an
 *   authenticated Athena operator is not a shopper, and admitting one would
 *   hand the handler an actor with no shopper identity to derive `owner` from.
 * - **Public writes** (`publicWriteRoute`) — genuinely unauthenticated ingress
 *   (webhooks, the marketing beacons, the harness broker, logout). These never
 *   read or clamp on a claim cookie: they hold no shopper identity, so there
 *   is nothing for a forged cookie to impersonate. `public: "admit"` demands a
 *   declared verifier, and each one names the boundary it actually rides on.
 * - **Operator writes** (`operatorWriteRoute`) — the inert `/organizations`
 *   and `/subcategories` management stubs. They perform no read and no write
 *   today, but they are registered ingress, so they declare the operator actor
 *   rather than staying anonymous by omission.
 *
 * The shared demo is denied throughout: none of these routes is an operator
 * demo surface, so this unit widens no capability grant.
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
    // The `storeId` argument is deliberately absent from the forwarded
    // path/query arguments: the storefront adapter derives the admitted store
    // from the claim ROW and only cross-checks the `store_id` cookie.
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
  scope?: OperationDefinition["scope"];
}) {
  return defineOperation({
    kind: "http" as const,
    route: { method: args.method, path: args.path },
    operationId: args.operationId,
    capability: args.capability,
    scope: args.scope ?? { kind: "none" as const },
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

function operatorWriteRoute(args: {
  capability: AthenaCapability;
  method: string;
  operationId: string;
  path: string;
  scope?: OperationDefinition["scope"];
}) {
  return defineOperation({
    kind: "http" as const,
    route: { method: args.method, path: args.path },
    operationId: args.operationId,
    capability: args.capability,
    scope: args.scope ?? { kind: "none" as const },
    readiness: { kind: "none" as const },
    effects: { mode: "none" as const },
    actors: {
      normalUser: "admit" as const,
      sharedDemo: "deny" as const,
      storefrontCustomer: "deny" as const,
      public: "deny" as const,
    },
  });
}

// --- storefront analytics ---------------------------------------------------

/**
 * The beacon writes an event attributed to a shopper. Before admission the
 * store and the shopper both came from cookies the caller controls; now they
 * come from the admitted actor and travel to `analytics:createInternal` as
 * `owner`.
 */
export const createAnalyticsEventRouteOperationDefinition = customerWriteRoute({
  capability: "storefront.analytics.write",
  method: "POST",
  operationId: "http.core.analytics.create",
  path: "/analytics",
});

/** Re-owning a guest's events onto the signed-in shopper the claim resolved to. */
export const updateAnalyticsOwnerRouteOperationDefinition = customerWriteRoute({
  capability: "storefront.analytics.write",
  method: "POST",
  operationId: "http.core.analytics.updateOwner",
  path: "/analytics/update-owner",
});

// --- storefront account -----------------------------------------------------

/**
 * Email verification. The shopper arrives holding a guest (or returning user)
 * claim, which is what the new account inherits its name from, so this is a
 * customer route: the id the code is verified against is the admitted actor's,
 * never a body field. A caller with no claim at all was already refused before
 * the rail — `verifyCode` requires the id its arg validator could not fill.
 */
export const verifyStorefrontAuthCodeRouteOperationDefinition =
  customerWriteRoute({
    capability: "identity.authenticate",
    method: "POST",
    operationId: "http.core.auth.verify",
    path: "/auth/verify",
  });

/**
 * Logout only clears the claim cookie. It reads nothing and writes nothing, so
 * it stays anonymous ingress fenced by the storefront origin allowlist: a
 * shopper whose claim is already gone must still be able to clear it.
 */
export const logoutStorefrontUserRouteOperationDefinition = publicWriteRoute({
  capability: "identity.authenticate",
  ingressVerification: { kind: "origin_allowlist" },
  method: "POST",
  operationId: "http.core.auth.logout",
  path: "/auth/logout",
});

// --- promo codes ------------------------------------------------------------

/** Redeeming a promo code against the admitted shopper's checkout session. */
export const redeemPromoCodeRouteOperationDefinition = customerWriteRoute({
  capability: "storefront.content.manage",
  method: "POST",
  operationId: "http.core.stores.redeemPromoCode",
  path: "/stores/promoCodes",
});

// --- harness waiver broker --------------------------------------------------

export const createHarnessWaiverRequestRouteOperationDefinition =
  publicWriteRoute({
    capability: "administration.maintenance",
    ingressVerification: {
      kind: "signature",
      verifier: HARNESS_WAIVER_BROKER_VERIFIER,
    },
    method: "POST",
    operationId: "http.core.harnessWaivers.createRequest",
    path: "/harness/waivers/requests",
  });

export const consumeHarnessWaiverRouteOperationDefinition = publicWriteRoute({
  capability: "administration.maintenance",
  ingressVerification: {
    kind: "signature",
    verifier: HARNESS_WAIVER_BROKER_VERIFIER,
  },
  method: "POST",
  operationId: "http.core.harnessWaivers.consume",
  path: "/harness/waivers/requests/:approvalId/consume",
});

// --- marketing + tracking beacons -------------------------------------------

export const acceptWalkthroughRequestRouteOperationDefinition =
  publicWriteRoute({
    capability: "marketing.walkthrough.request",
    ingressVerification: {
      kind: "signature",
      verifier: MARKETING_ORIGIN_VERIFIER,
    },
    method: "POST",
    operationId: "http.core.marketing.walkthroughRequest",
    path: "/marketing/walkthrough-requests",
  });

export const appendLandingFunnelEventRouteOperationDefinition =
  publicWriteRoute({
    capability: "marketing.funnel.track",
    ingressVerification: {
      kind: "signature",
      verifier: MARKETING_ORIGIN_VERIFIER,
    },
    method: "POST",
    operationId: "http.core.marketing.funnelEvent",
    path: "/marketing/funnel-events",
  });

/**
 * The storefront tracking beacon is anonymous by design — the first event of a
 * visit predates any claim — so it is public and reads no claim cookie at all.
 * Before admission it derived the event's actor from a `guest_id` cookie any
 * caller could set, which let one visitor write events onto another's
 * timeline and abuse partition; it now records no actor.
 */
export const appendStorefrontTrackingEventRouteOperationDefinition =
  publicWriteRoute({
    capability: "workspace.telemetry.write",
    ingressVerification: {
      kind: "signature",
      verifier: STOREFRONT_TRACKING_ORIGIN_VERIFIER,
    },
    method: "POST",
    operationId: "http.core.trackingEvents.append",
    path: "/tracking-events",
  });

// --- webhooks ---------------------------------------------------------------

export const whatsappWebhookRouteOperationDefinition = publicWriteRoute({
  capability: "customer.messaging.send",
  ingressVerification: {
    kind: "signature",
    verifier: WHATSAPP_SIGNATURE_VERIFIER,
  },
  method: "POST",
  operationId: "http.customerMessaging.whatsapp.webhook",
  path: "/webhooks/whatsapp",
});

/**
 * MTN registers one callback URL and calls it with POST or PUT, so the `.on()`
 * registration is two ingress points and declares two definitions. The
 * `storeId` query parameter is a real forwarded argument here, so the scope is
 * bound to it.
 */
function mtnMomoCollectionsRoute(method: "POST" | "PUT") {
  return publicWriteRoute({
    capability: "billing.manage",
    ingressVerification: {
      kind: "signature",
      verifier: MTN_MOMO_CALLBACK_VERIFIER,
    },
    method,
    operationId: `http.moneyMovement.mtnMomo.collections.${method.toLowerCase()}`,
    path: "/webhooks/mtn-momo/collections",
    scope: { kind: "store", storeIdArg: "storeId" },
  });
}

export const mtnMomoCollectionsPostRouteOperationDefinition =
  mtnMomoCollectionsRoute("POST");
export const mtnMomoCollectionsPutRouteOperationDefinition =
  mtnMomoCollectionsRoute("PUT");

// --- inert operator stubs ---------------------------------------------------

export const createOrganizationRouteOperationDefinition = operatorWriteRoute({
  capability: "organization.manage",
  method: "POST",
  operationId: "http.core.organizations.create",
  path: "/organizations",
});

export const updateOrganizationRouteOperationDefinition = operatorWriteRoute({
  capability: "organization.manage",
  method: "PUT",
  operationId: "http.core.organizations.update",
  path: "/organizations/:organizationId",
  scope: { kind: "organization", organizationIdArg: "organizationId" },
});

export const deleteOrganizationRouteOperationDefinition = operatorWriteRoute({
  capability: "organization.manage",
  method: "DELETE",
  operationId: "http.core.organizations.delete",
  path: "/organizations/:organizationId",
  scope: { kind: "organization", organizationIdArg: "organizationId" },
});

export const createSubcategoryRouteOperationDefinition = operatorWriteRoute({
  capability: "catalog.manage",
  method: "POST",
  operationId: "http.core.subcategories.create",
  path: "/subcategories",
});

export const updateSubcategoryRouteOperationDefinition = operatorWriteRoute({
  capability: "catalog.manage",
  method: "PUT",
  operationId: "http.core.subcategories.update",
  path: "/subcategories/:subcategoryId",
});

export const deleteSubcategoryRouteOperationDefinition = operatorWriteRoute({
  capability: "catalog.manage",
  method: "DELETE",
  operationId: "http.core.subcategories.delete",
  path: "/subcategories/:subcategoryId",
});

export const HTTP_CORE_DEFINITIONS: readonly OperationDefinition[] =
  [
    createAnalyticsEventRouteOperationDefinition,
    updateAnalyticsOwnerRouteOperationDefinition,
    verifyStorefrontAuthCodeRouteOperationDefinition,
    logoutStorefrontUserRouteOperationDefinition,
    redeemPromoCodeRouteOperationDefinition,
    createHarnessWaiverRequestRouteOperationDefinition,
    consumeHarnessWaiverRouteOperationDefinition,
    acceptWalkthroughRequestRouteOperationDefinition,
    appendLandingFunnelEventRouteOperationDefinition,
    appendStorefrontTrackingEventRouteOperationDefinition,
    whatsappWebhookRouteOperationDefinition,
    mtnMomoCollectionsPostRouteOperationDefinition,
    mtnMomoCollectionsPutRouteOperationDefinition,
    createOrganizationRouteOperationDefinition,
    updateOrganizationRouteOperationDefinition,
    deleteOrganizationRouteOperationDefinition,
    createSubcategoryRouteOperationDefinition,
    updateSubcategoryRouteOperationDefinition,
    deleteSubcategoryRouteOperationDefinition,
  ];
