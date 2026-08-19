import type { AthenaReadIntent } from "../../platform/readIntentCatalog";
import { HARNESS_WAIVER_BROKER_VERIFIER } from "../ingressVerification";
import type { OperationReadDefinition } from "../types";
import { defineReadOperation } from "./_shapes";

/**
 * HTTP core, messaging and money-movement routes - read (http_read)
 * operation definitions.
 *
 * Two shapes:
 *
 * - **Anonymous browse reads** (`publicReadRoute`) — the storefront catalog,
 *   the banner, the shallow health probe and the WhatsApp verification
 *   handshake. `public: "admit"`, and `storefrontCustomer: "deny"` on purpose:
 *   these reads are identical for every visitor, so admitting the claim actor
 *   would turn a stale or unknown cookie into a terminal denial on a page that
 *   never needed an identity in the first place.
 * - **Claim-only reads** (`customerReadRoute`) — the one core read that is
 *   *about* the shopper. It admits the claim actor and nothing else, so the id
 *   it reads by comes from the admitted actor rather than the cookie value the
 *   handler used to forward verbatim.
 *
 * Reads write nothing and are never captured, and the shared demo is denied
 * throughout, so no read-intent grant is widened here.
 */

function publicReadRoute(args: {
  intent: AthenaReadIntent;
  method?: string;
  operationId: string;
  path: string;
  ingressVerification?: OperationReadDefinition["ingressVerification"];
  normalUser?: "admit" | "deny";
}) {
  return defineReadOperation({
    kind: "http_read" as const,
    route: { method: args.method ?? "GET", path: args.path },
    operationId: args.operationId,
    access: { kind: "read" as const, intent: args.intent },
    scope: { kind: "none" as const },
    ...(args.ingressVerification
      ? { ingressVerification: args.ingressVerification }
      : {}),
    actors: {
      normalUser: args.normalUser ?? ("admit" as const),
      sharedDemo: "deny" as const,
      storefrontCustomer: "deny" as const,
      public: "admit" as const,
    },
  });
}

function customerReadRoute(args: {
  intent: AthenaReadIntent;
  operationId: string;
  path: string;
}) {
  return defineReadOperation({
    kind: "http_read" as const,
    route: { method: "GET", path: args.path },
    operationId: args.operationId,
    access: { kind: "read" as const, intent: args.intent },
    // `storeId` is absent from the forwarded arguments by design: the admitted
    // store comes from the claim ROW, and the `store_id` cookie is only
    // cross-checked against it.
    scope: { kind: "store" as const, storeIdArg: "storeId" },
    actors: {
      normalUser: "deny" as const,
      sharedDemo: "deny" as const,
      storefrontCustomer: "admit" as const,
      public: "deny" as const,
    },
  });
}

function operatorReadRoute(args: {
  intent: AthenaReadIntent;
  operationId: string;
  path: string;
  scope?: OperationReadDefinition["scope"];
}) {
  return defineReadOperation({
    kind: "http_read" as const,
    route: { method: "GET", path: args.path },
    operationId: args.operationId,
    access: { kind: "read" as const, intent: args.intent },
    scope: args.scope ?? { kind: "none" as const },
    actors: {
      normalUser: "admit" as const,
      sharedDemo: "deny" as const,
      storefrontCustomer: "deny" as const,
      public: "deny" as const,
    },
  });
}

// --- platform ---------------------------------------------------------------

/** The shallow liveness probe: no store, no identity, no data. */
export const healthRouteReadDefinition = publicReadRoute({
  intent: "platform.health.view",
  operationId: "http.core.health.read",
  path: "/health",
});

// --- storefront catalog -----------------------------------------------------

export const bannerMessageRouteReadDefinition = publicReadRoute({
  intent: "storefront.catalog.view",
  operationId: "http.core.bannerMessage.read",
  path: "/banner-message",
});

export const listCategoriesRouteReadDefinition = publicReadRoute({
  intent: "storefront.catalog.view",
  operationId: "http.core.categories.list",
  path: "/categories",
});

export const listColorsRouteReadDefinition = publicReadRoute({
  intent: "storefront.catalog.view",
  operationId: "http.core.colors.list",
  path: "/colors",
});

export const listProductsRouteReadDefinition = publicReadRoute({
  intent: "storefront.catalog.view",
  operationId: "http.core.products.list",
  path: "/products",
});

export const listProductColorsRouteReadDefinition = publicReadRoute({
  intent: "storefront.catalog.view",
  operationId: "http.core.products.listColors",
  path: "/products/colors",
});

export const listBestSellersRouteReadDefinition = publicReadRoute({
  intent: "storefront.catalog.view",
  operationId: "http.core.products.listBestSellers",
  path: "/products/bestSellers",
});

export const listFeaturedProductsRouteReadDefinition = publicReadRoute({
  intent: "storefront.catalog.view",
  operationId: "http.core.products.listFeatured",
  path: "/products/featured",
});

export const getProductRouteReadDefinition = publicReadRoute({
  intent: "storefront.catalog.view",
  operationId: "http.core.products.get",
  path: "/products/:productId",
});

export const listSubcategoriesRouteReadDefinition = publicReadRoute({
  intent: "storefront.catalog.view",
  operationId: "http.core.subcategories.list",
  path: "/subcategories",
});

export const getSubcategoryRouteReadDefinition = publicReadRoute({
  intent: "storefront.catalog.view",
  operationId: "http.core.subcategories.get",
  path: "/subcategories/:subcategoryId",
});

export const getStoreRouteReadDefinition = publicReadRoute({
  intent: "store.configuration.view",
  operationId: "http.core.stores.get",
  path: "/stores/:storeId",
});

export const listPromoCodesRouteReadDefinition = publicReadRoute({
  intent: "storefront.catalog.view",
  operationId: "http.core.stores.listPromoCodes",
  path: "/stores/promoCodes",
});

export const listPromoCodeItemsRouteReadDefinition = publicReadRoute({
  intent: "storefront.catalog.view",
  operationId: "http.core.stores.listPromoCodeItems",
  path: "/stores/promoCodeItems",
});

export const getProductViewCountRouteReadDefinition = publicReadRoute({
  intent: "storefront.analytics.view",
  operationId: "http.core.analytics.productViewCount",
  path: "/analytics/product-view-count",
});

// --- claim-only shopper read ------------------------------------------------

export const listRedeemedPromoCodesRouteReadDefinition = customerReadRoute({
  intent: "storefront.account.view",
  operationId: "http.core.stores.listRedeemedPromoCodes",
  path: "/stores/redeemedPromoCodes",
});

// --- messaging --------------------------------------------------------------

/**
 * Meta's subscription handshake. It carries no body to sign and returns only
 * the challenge it was handed, so the boundary is the verify token the handler
 * compares — declared `public`, with no data reachable behind it.
 */
export const whatsappWebhookVerificationRouteReadDefinition = publicReadRoute({
  intent: "customer_messaging.view",
  operationId: "http.customerMessaging.whatsapp.verify",
  path: "/webhooks/whatsapp",
});

// --- harness waiver broker --------------------------------------------------

export const getHarnessWaiverApprovalRouteReadDefinition = publicReadRoute({
  intent: "harness.waivers.view",
  ingressVerification: {
    kind: "signature",
    verifier: HARNESS_WAIVER_BROKER_VERIFIER,
  },
  operationId: "http.core.harnessWaivers.getApproval",
  path: "/harness/waivers/requests/:approvalId",
});

// --- inert operator stubs ---------------------------------------------------

export const getOrganizationRouteReadDefinition = operatorReadRoute({
  intent: "organization.view",
  operationId: "http.core.organizations.get",
  path: "/organizations/:organizationId",
  scope: { kind: "organization", organizationIdArg: "organizationId" },
});

export const listMyOrganizationsRouteReadDefinition = operatorReadRoute({
  intent: "organization.view",
  operationId: "http.core.organizations.listForCaller",
  path: "/organizations/users/me/organizations",
});

export const HTTP_CORE_READ_DEFINITIONS: readonly OperationReadDefinition[] =
  [
    healthRouteReadDefinition,
    bannerMessageRouteReadDefinition,
    listCategoriesRouteReadDefinition,
    listColorsRouteReadDefinition,
    listProductsRouteReadDefinition,
    listProductColorsRouteReadDefinition,
    listBestSellersRouteReadDefinition,
    listFeaturedProductsRouteReadDefinition,
    getProductRouteReadDefinition,
    listSubcategoriesRouteReadDefinition,
    getSubcategoryRouteReadDefinition,
    getStoreRouteReadDefinition,
    listPromoCodesRouteReadDefinition,
    listPromoCodeItemsRouteReadDefinition,
    getProductViewCountRouteReadDefinition,
    listRedeemedPromoCodesRouteReadDefinition,
    whatsappWebhookVerificationRouteReadDefinition,
    getHarnessWaiverApprovalRouteReadDefinition,
    getOrganizationRouteReadDefinition,
    listMyOrganizationsRouteReadDefinition,
  ];
