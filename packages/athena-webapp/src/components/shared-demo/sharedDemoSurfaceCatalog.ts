export type AthenaSurfacePresentation =
  | "interactive"
  | "read_only"
  | "observational";

export type AthenaSurfaceDefinition = {
  description: string;
  presentation: AthenaSurfacePresentation;
  routes: readonly string[];
};

export const ATHENA_VIEW_SURFACE_CATALOG = {
  "organization.overview": {
    description: "Organization landing and store selection",
    presentation: "observational",
    routes: ["/:orgUrlSlug", "/:orgUrlSlug/store"],
  },
  "organization.settings": {
    description: "Organization and store administration",
    presentation: "read_only",
    routes: [
      "/:orgUrlSlug/settings",
      "/:orgUrlSlug/settings/organization",
      "/:orgUrlSlug/settings/stores/:storeUrlSlug",
    ],
  },
  "store.entry": {
    description: "Store entry and redirect",
    presentation: "observational",
    routes: ["/:orgUrlSlug/store/:storeUrlSlug"],
  },
  "demo.owner_orientation": {
    description: "Demo owner orientation",
    presentation: "observational",
    routes: ["/:orgUrlSlug/store/:storeUrlSlug/shared-demo"],
  },
  "owner.dashboard": {
    description: "Store owner dashboard",
    presentation: "observational",
    routes: ["/:orgUrlSlug/store/:storeUrlSlug/dashboard"],
  },
  "storefront.homepage": {
    description: "Storefront homepage workspace",
    presentation: "read_only",
    routes: ["/:orgUrlSlug/store/:storeUrlSlug/home"],
  },
  "storefront.assets": {
    description: "Storefront asset library",
    presentation: "read_only",
    routes: ["/:orgUrlSlug/store/:storeUrlSlug/assets"],
  },
  "storefront.bags": {
    description: "Customer bag detail and history",
    presentation: "read_only",
    routes: [
      "/:orgUrlSlug/store/:storeUrlSlug/bags",
      "/:orgUrlSlug/store/:storeUrlSlug/bags/:bagId",
    ],
  },
  "storefront.checkout_sessions": {
    description: "Storefront checkout sessions",
    presentation: "read_only",
    routes: ["/:orgUrlSlug/store/:storeUrlSlug/checkout-sessions"],
  },
  "customer.profile": {
    description: "Customer profile and order context",
    presentation: "read_only",
    routes: ["/:orgUrlSlug/store/:storeUrlSlug/users/:userId"],
  },
  "reviews.moderation": {
    description: "Storefront review queues",
    presentation: "read_only",
    routes: [
      "/:orgUrlSlug/store/:storeUrlSlug/reviews",
      "/:orgUrlSlug/store/:storeUrlSlug/reviews/new",
      "/:orgUrlSlug/store/:storeUrlSlug/reviews/published",
    ],
  },
  "orders.fulfillment": {
    description: "Order queues, detail, and fulfillment",
    presentation: "interactive",
    routes: [
      "/:orgUrlSlug/store/:storeUrlSlug/orders",
      "/:orgUrlSlug/store/:storeUrlSlug/orders/all",
      "/:orgUrlSlug/store/:storeUrlSlug/orders/open",
      "/:orgUrlSlug/store/:storeUrlSlug/orders/ready",
      "/:orgUrlSlug/store/:storeUrlSlug/orders/out-for-delivery",
      "/:orgUrlSlug/store/:storeUrlSlug/orders/completed",
      "/:orgUrlSlug/store/:storeUrlSlug/orders/cancelled",
      "/:orgUrlSlug/store/:storeUrlSlug/orders/refunded",
      "/:orgUrlSlug/store/:storeUrlSlug/orders/:orderSlug",
    ],
  },
  "pos.checkout": {
    description: "POS overview and checkout register",
    presentation: "interactive",
    routes: [
      "/:orgUrlSlug/store/:storeUrlSlug/pos",
      "/:orgUrlSlug/store/:storeUrlSlug/pos/register",
    ],
  },
  "pos.sales_history": {
    description: "POS sessions and transaction history",
    presentation: "read_only",
    routes: [
      "/:orgUrlSlug/store/:storeUrlSlug/pos/sessions",
      "/:orgUrlSlug/store/:storeUrlSlug/pos/transactions",
      "/:orgUrlSlug/store/:storeUrlSlug/pos/transactions/:transactionId",
    ],
  },
  "pos.expense_control": {
    description: "POS expenses and expense reports",
    presentation: "read_only",
    routes: [
      "/:orgUrlSlug/store/:storeUrlSlug/pos/expense",
      "/:orgUrlSlug/store/:storeUrlSlug/pos/expense-reports",
      "/:orgUrlSlug/store/:storeUrlSlug/pos/expense-reports/:reportId",
    ],
  },
  "pos.terminal_health": {
    description: "Terminal fleet and terminal health detail",
    presentation: "read_only",
    routes: [
      "/:orgUrlSlug/store/:storeUrlSlug/pos/terminals",
      "/:orgUrlSlug/store/:storeUrlSlug/pos/terminals/:terminalId",
    ],
  },
  "pos.settings": {
    description: "POS terminal settings",
    presentation: "read_only",
    routes: ["/:orgUrlSlug/store/:storeUrlSlug/pos/settings"],
  },
  "cash.register_control": {
    description: "Cash control and register sessions",
    presentation: "interactive",
    routes: [
      "/:orgUrlSlug/store/:storeUrlSlug/cash-controls",
      "/:orgUrlSlug/store/:storeUrlSlug/cash-controls/registers",
      "/:orgUrlSlug/store/:storeUrlSlug/cash-controls/registers/:sessionId",
      "/:orgUrlSlug/store/:storeUrlSlug/cash-controls/registers/:sessionId/activity",
    ],
  },
  "daily_operations": {
    description: "Daily opening, close, and open work",
    presentation: "interactive",
    routes: [
      "/:orgUrlSlug/store/:storeUrlSlug/operations",
      "/:orgUrlSlug/store/:storeUrlSlug/operations/opening",
      "/:orgUrlSlug/store/:storeUrlSlug/operations/daily-close",
      "/:orgUrlSlug/store/:storeUrlSlug/operations/daily-close-history",
      "/:orgUrlSlug/store/:storeUrlSlug/operations/open-work",
    ],
  },
  "inventory.operations": {
    description: "Stock adjustment and SKU activity",
    presentation: "interactive",
    routes: [
      "/:orgUrlSlug/store/:storeUrlSlug/operations/stock-adjustments",
      "/:orgUrlSlug/store/:storeUrlSlug/operations/sku-activity",
    ],
  },
  "operations.approvals": {
    description: "Operational approvals",
    presentation: "read_only",
    routes: ["/:orgUrlSlug/store/:storeUrlSlug/operations/approvals"],
  },
  "inventory.import": {
    description: "Inventory import and review",
    presentation: "read_only",
    routes: [
      "/:orgUrlSlug/store/:storeUrlSlug/operations/inventory-import",
      "/:orgUrlSlug/store/:storeUrlSlug/operations/inventory-import/review",
    ],
  },
  "procurement.receiving": {
    description: "Procurement and receiving",
    presentation: "read_only",
    routes: ["/:orgUrlSlug/store/:storeUrlSlug/procurement"],
  },
  "catalog.products": {
    description: "Product catalog and product detail",
    presentation: "read_only",
    routes: [
      "/:orgUrlSlug/store/:storeUrlSlug/products",
      "/:orgUrlSlug/store/:storeUrlSlug/products/:productSlug",
      "/:orgUrlSlug/store/:storeUrlSlug/products/unresolved",
    ],
  },
  "catalog.product_create": {
    description: "Product creation",
    presentation: "read_only",
    routes: ["/:orgUrlSlug/store/:storeUrlSlug/products/new"],
  },
  "catalog.product_edit": {
    description: "Product editing",
    presentation: "read_only",
    routes: ["/:orgUrlSlug/store/:storeUrlSlug/products/:productSlug/edit"],
  },
  "catalog.product_archive": {
    description: "Archived products",
    presentation: "read_only",
    routes: ["/:orgUrlSlug/store/:storeUrlSlug/products/archived"],
  },
  "catalog.complimentary": {
    description: "Complimentary product catalog",
    presentation: "read_only",
    routes: ["/:orgUrlSlug/store/:storeUrlSlug/products/complimentary"],
  },
  "catalog.complimentary_create": {
    description: "Complimentary product creation",
    presentation: "read_only",
    routes: ["/:orgUrlSlug/store/:storeUrlSlug/products/complimentary/new"],
  },
  "marketing.promotions": {
    description: "Promotion code administration",
    presentation: "read_only",
    routes: [
      "/:orgUrlSlug/store/:storeUrlSlug/promo-codes",
      "/:orgUrlSlug/store/:storeUrlSlug/promo-codes/new",
      "/:orgUrlSlug/store/:storeUrlSlug/promo-codes/:promoCodeSlug",
    ],
  },
  reports: {
    description: "Store, inventory, item, and storefront reporting",
    presentation: "observational",
    routes: [
      "/:orgUrlSlug/store/:storeUrlSlug/reports",
      "/:orgUrlSlug/store/:storeUrlSlug/reports/inventory",
      "/:orgUrlSlug/store/:storeUrlSlug/reports/storefront",
      "/:orgUrlSlug/store/:storeUrlSlug/reports/items",
      "/:orgUrlSlug/store/:storeUrlSlug/reports/items/:productSkuId",
    ],
  },
  "services.operations": {
    description: "Service intake, appointments, and active cases",
    presentation: "read_only",
    routes: [
      "/:orgUrlSlug/store/:storeUrlSlug/services",
      "/:orgUrlSlug/store/:storeUrlSlug/services/intake",
      "/:orgUrlSlug/store/:storeUrlSlug/services/appointments",
      "/:orgUrlSlug/store/:storeUrlSlug/services/active-cases",
    ],
  },
  "services.catalog_management": {
    description: "Service catalog administration",
    presentation: "read_only",
    routes: [
      "/:orgUrlSlug/store/:storeUrlSlug/services/catalog-management",
    ],
  },
  "administration.app_settings": {
    description: "Application settings",
    presentation: "read_only",
    routes: ["/:orgUrlSlug/store/:storeUrlSlug/app-settings"],
  },
  "administration.store_configuration": {
    description: "Storefront configuration",
    presentation: "read_only",
    routes: ["/:orgUrlSlug/store/:storeUrlSlug/configuration"],
  },
  "administration.members": {
    description: "Store members and permissions",
    presentation: "read_only",
    routes: ["/:orgUrlSlug/store/:storeUrlSlug/members"],
  },
  "administration.bulk_operations": {
    description: "Bulk administration",
    presentation: "read_only",
    routes: ["/:orgUrlSlug/store/:storeUrlSlug/bulk-operations"],
  },
  "observability.logs": {
    description: "Application logs and log detail",
    presentation: "observational",
    routes: [
      "/:orgUrlSlug/store/:storeUrlSlug/logs",
      "/:orgUrlSlug/store/:storeUrlSlug/logs/:logId",
    ],
  },
  "observability.workflow_trace": {
    description: "Workflow trace detail",
    presentation: "observational",
    routes: ["/:orgUrlSlug/store/:storeUrlSlug/traces/:traceId"],
  },
} as const satisfies Record<string, AthenaSurfaceDefinition>;

export type AthenaViewSurface = keyof typeof ATHENA_VIEW_SURFACE_CATALOG;

export const SHARED_DEMO_VISIBLE_SURFACES = [
  "organization.overview",
  "store.entry",
  "demo.owner_orientation",
  "owner.dashboard",
  "storefront.homepage",
  "storefront.assets",
  "storefront.bags",
  "storefront.checkout_sessions",
  "customer.profile",
  "reviews.moderation",
  "orders.fulfillment",
  "pos.checkout",
  "pos.sales_history",
  "pos.expense_control",
  "pos.terminal_health",
  "pos.settings",
  "cash.register_control",
  "daily_operations",
  "inventory.operations",
  "operations.approvals",
  "inventory.import",
  "procurement.receiving",
  "catalog.products",
  "catalog.complimentary",
  "reports",
  "services.operations",
  "services.catalog_management",
  "observability.logs",
  "observability.workflow_trace",
] as const satisfies readonly AthenaViewSurface[];

const sharedDemoVisibleSurfaceSet = new Set<AthenaViewSurface>(
  SHARED_DEMO_VISIBLE_SURFACES,
);

function normalizePathname(pathname: string) {
  const pathOnly = pathname.split(/[?#]/, 1)[0] ?? "/";
  if (pathOnly === "/") {
    return pathOnly;
  }
  return pathOnly.replace(/\/+$/, "");
}

function routeTemplateMatches(pathname: string, routeTemplate: string) {
  const pathSegments = normalizePathname(pathname).split("/").filter(Boolean);
  const templateSegments = routeTemplate.split("/").filter(Boolean);

  return (
    pathSegments.length === templateSegments.length &&
    templateSegments.every(
      (segment, index) =>
        segment.startsWith(":") || segment === pathSegments[index],
    )
  );
}

export function classifyAthenaViewSurface(
  pathname: string,
): AthenaViewSurface | null {
  let bestMatch: { literalSegments: number; surface: AthenaViewSurface } | null =
    null;
  for (const [surface, definition] of Object.entries(
    ATHENA_VIEW_SURFACE_CATALOG,
  ) as [AthenaViewSurface, AthenaSurfaceDefinition][]) {
    for (const routeTemplate of definition.routes) {
      if (!routeTemplateMatches(pathname, routeTemplate)) {
        continue;
      }
      const literalSegments = routeTemplate
        .split("/")
        .filter((segment) => segment && !segment.startsWith(":"))
        .length;
      if (!bestMatch || literalSegments > bestMatch.literalSegments) {
        bestMatch = { literalSegments, surface };
      }
    }
  }
  return bestMatch?.surface ?? null;
}

export function isSharedDemoSurfaceVisible(pathname: string) {
  const surface = classifyAthenaViewSurface(pathname);
  return surface !== null && sharedDemoVisibleSurfaceSet.has(surface);
}
