import type { Id } from "../../_generated/dataModel";
import type { AthenaReadIntent } from "../../platform/readIntentCatalog";
import type {
  OperationAdmissionCtx,
  OperationReadDefinition,
} from "../types";
import { defineInventoryCatalogRead, defineReadOperation } from "./_shapes";

/**
 * Inventory catalog modules - read (query/http_read) operation definitions.
 *
 * Intent choice follows the closed catalog:
 *  - `inventory.catalog.view` is the operator's catalog. It is granted to the
 *    shared demo, which preserves what a demo visitor can already read today.
 *  - `storefront.catalog.view` is the shopper's view of the same rows and is
 *    NOT demo-granted, so those definitions deny the demo actor.
 *  - `store.configuration.view` (store schedule) and `inventory.stock.view`
 *    (reservation guards) are operator-only surfaces outside the demo read
 *    grant set, so they deny the demo actor too.
 *
 * No definition here admits the public actor: every anonymous storefront HTTP
 * route (`convex/http/domains/core/routes/**`) calls an internal sibling
 * query, never one of these public-facing exports, so an anonymous Convex
 * client cannot reach them directly.
 */

type ScopeResolverCtx = OperationAdmissionCtx;

function idArg(args: Record<string, unknown>, name: string) {
  const value = args[name];
  return typeof value === "string" ? value : undefined;
}

function rowStoreScope<TableName extends string>(
  table: TableName,
  argName: string,
) {
  return async (ctx: ScopeResolverCtx, args: Record<string, unknown>) => {
    const id = idArg(args, argName);
    if (!id) return {};
    const row = (await ctx.db.get(table as never, id as never)) as
      | { storeId?: Id<"store"> }
      | null;
    return row?.storeId ? { storeId: row.storeId } : {};
  };
}

function defineIntentRead(args: {
  functionName: string;
  intent: AthenaReadIntent;
  operationId: string;
  publicAccess?: "admit" | "deny";
  scope: OperationReadDefinition["scope"];
  sharedDemo?: "admit" | "deny";
}) {
  return defineReadOperation({
    kind: "query" as const,
    functionName: args.functionName,
    operationId: args.operationId,
    access: { kind: "read" as const, intent: args.intent },
    scope: args.scope,
    actors: {
      normalUser: "admit" as const,
      sharedDemo: args.sharedDemo ?? ("deny" as const),
      public: args.publicAccess ?? ("deny" as const),
    },
  });
}

/** Store-scoped operator catalog read, resolved from a row the caller names. */
function defineRowScopedCatalogRead(args: {
  argName: string;
  functionName: string;
  operationId: string;
  publicAccess?: "admit" | "deny";
  table: string;
}) {
  return defineIntentRead({
    functionName: args.functionName,
    intent: "inventory.catalog.view",
    operationId: args.operationId,
    publicAccess: args.publicAccess,
    scope: {
      kind: "store" as const,
      resolve: rowStoreScope(args.table, args.argName),
    },
    sharedDemo: "admit",
  });
}

// ---------------------------------------------------------------------------
// inventory/bannerMessage
// ---------------------------------------------------------------------------

export const getBannerMessageReadDefinition = defineInventoryCatalogRead(
  "inventory/bannerMessage:get",
  "inventory.bannerMessage.get.read",
);

// The anonymous GET /banner-message route calls the internal sibling
// (`getPublicActiveInternal`), so this export stays closed to the public actor.
export const getPublicActiveBannerMessageReadDefinition = defineIntentRead({
  functionName: "inventory/bannerMessage:getPublicActive",
  intent: "storefront.catalog.view",
  operationId: "inventory.bannerMessage.getPublicActive.read",
  scope: { kind: "store" as const, storeIdArg: "storeId" },
});

// ---------------------------------------------------------------------------
// inventory/bestSeller
// ---------------------------------------------------------------------------

export const getBestSellerByIdReadDefinition = defineRowScopedCatalogRead({
  argName: "id",
  functionName: "inventory/bestSeller:getById",
  operationId: "inventory.bestSeller.getById.read",
  table: "bestSeller",
});

// The anonymous GET /products/bestSellers route calls the internal sibling
// (`getAllInternal`), so this export stays closed to the public actor.
export const listBestSellersReadDefinition = defineInventoryCatalogRead(
  "inventory/bestSeller:getAll",
  "inventory.bestSeller.getAll.read",
);

// ---------------------------------------------------------------------------
// inventory/catalogImport
// ---------------------------------------------------------------------------

function inventoryImportRead(functionName: string) {
  return defineInventoryCatalogRead(
    `inventory/catalogImport:${functionName}`,
    `inventory.catalogImport.${functionName}.read`,
  );
}

export const getLatestInventoryImportReviewVersionReadDefinition =
  inventoryImportRead("getLatestInventoryImportReviewVersion");
export const getLatestInventoryImportReviewVersionMetadataReadDefinition =
  inventoryImportRead("getLatestInventoryImportReviewVersionMetadata");
export const getInventoryImportReviewVersionPayloadChunkReadDefinition =
  inventoryImportRead("getInventoryImportReviewVersionPayloadChunk");
export const listInventoryImportReviewSkuContextReadDefinition =
  inventoryImportRead("listInventoryImportReviewSkuContext");
export const listProductPageProvisionalSkuBindingReadDefinition =
  inventoryImportRead("listProductPageProvisionalSkuBinding");

// ---------------------------------------------------------------------------
// inventory/categories
// ---------------------------------------------------------------------------

// The anonymous GET /categories route calls the internal sibling
// (`getAllInternal`), so this export stays closed to the public actor.
export const listCategoriesReadDefinition = defineInventoryCatalogRead(
  "inventory/categories:getAll",
  "inventory.categories.getAll.read",
);

export const getCategoryByIdReadDefinition = defineInventoryCatalogRead(
  "inventory/categories:getById",
  "inventory.categories.getById.read",
);

// ---------------------------------------------------------------------------
// inventory/colors
// ---------------------------------------------------------------------------

// The anonymous GET /colors route calls the internal sibling (`getAllInternal`),
// so this export stays closed to the public actor.
export const listColorsReadDefinition = defineInventoryCatalogRead(
  "inventory/colors:getAll",
  "inventory.colors.getAll.read",
);

export const getColorByIdReadDefinition = defineRowScopedCatalogRead({
  argName: "id",
  functionName: "inventory/colors:getById",
  operationId: "inventory.colors.getById.read",
  table: "color",
});

// ---------------------------------------------------------------------------
// inventory/complimentaryProduct
// ---------------------------------------------------------------------------

export const listActiveComplimentaryProductsReadDefinition =
  defineInventoryCatalogRead(
    "inventory/complimentaryProduct:getActiveComplimentaryProducts",
    "inventory.complimentaryProduct.getActiveComplimentaryProducts.read",
  );

export const listComplimentaryProductsByCollectionReadDefinition =
  defineRowScopedCatalogRead({
    argName: "collectionId",
    functionName:
      "inventory/complimentaryProduct:getComplimentaryProductsByCollection",
    operationId:
      "inventory.complimentaryProduct.getComplimentaryProductsByCollection.read",
    table: "complimentaryProductsCollection",
  });

export const listActiveComplimentaryCollectionsReadDefinition =
  defineInventoryCatalogRead(
    "inventory/complimentaryProduct:getActiveCollections",
    "inventory.complimentaryProduct.getActiveCollections.read",
  );

export const listAllComplimentaryProductsReadDefinition =
  defineInventoryCatalogRead(
    "inventory/complimentaryProduct:getAllComplimentaryProducts",
    "inventory.complimentaryProduct.getAllComplimentaryProducts.read",
  );

// ---------------------------------------------------------------------------
// inventory/featuredItem
// ---------------------------------------------------------------------------

export const getFeaturedItemByIdReadDefinition = defineRowScopedCatalogRead({
  argName: "id",
  functionName: "inventory/featuredItem:getById",
  operationId: "inventory.featuredItem.getById.read",
  table: "featuredItem",
});

// The anonymous GET /products/featured route calls the internal sibling
// (`getAllInternal`), so this export stays closed to the public actor.
export const listFeaturedItemsReadDefinition = defineInventoryCatalogRead(
  "inventory/featuredItem:getAll",
  "inventory.featuredItem.getAll.read",
);

// ---------------------------------------------------------------------------
// inventory/products
// ---------------------------------------------------------------------------

export const getProductByIdReadDefinition = defineInventoryCatalogRead(
  "inventory/products:getById",
  "inventory.products.getById.read",
);

export const getProductBySlugReadDefinition = defineInventoryCatalogRead(
  "inventory/products:getBySlug",
  "inventory.products.getBySlug.read",
);

// The anonymous GET /products/:productId route calls the internal sibling
// (`getByIdOrSlugInternal`), so this export stays closed to the public actor.
export const getProductByIdOrSlugReadDefinition = defineInventoryCatalogRead(
  "inventory/products:getByIdOrSlug",
  "inventory.products.getByIdOrSlug.read",
);

export const getCatalogSummaryReadDefinition = defineInventoryCatalogRead(
  "inventory/products:getCatalogSummary",
  "inventory.products.getCatalogSummary.read",
);

export const getProductSkuReadDefinition = defineRowScopedCatalogRead({
  argName: "id",
  functionName: "inventory/products:getProductSku",
  operationId: "inventory.products.getProductSku.read",
  table: "productSku",
});

export const batchGetProductsReadDefinition = defineInventoryCatalogRead(
  "inventory/products:batchGet",
  "inventory.products.batchGet.read",
);

// ---------------------------------------------------------------------------
// inventory/productSku
// ---------------------------------------------------------------------------

export const getProductSkuByIdReadDefinition = defineRowScopedCatalogRead({
  argName: "id",
  functionName: "inventory/productSku:getById",
  operationId: "inventory.productSku.getById.read",
  table: "productSku",
});

// ---------------------------------------------------------------------------
// inventory/promoCode
// ---------------------------------------------------------------------------

// The anonymous GET /stores/promoCodes route calls the internal sibling
// (`getAllInternal`), so this export stays closed to the public actor.
export const listPromoCodesReadDefinition = defineInventoryCatalogRead(
  "inventory/promoCode:getAll",
  "inventory.promoCode.getAll.read",
);

export const getPromoCodeByIdReadDefinition = defineRowScopedCatalogRead({
  argName: "id",
  functionName: "inventory/promoCode:getById",
  operationId: "inventory.promoCode.getById.read",
  table: "promoCode",
});

export const listPromoCodeItemsReadDefinition = defineRowScopedCatalogRead({
  argName: "promoCodeId",
  functionName: "inventory/promoCode:getPromoCodeItems",
  operationId: "inventory.promoCode.getPromoCodeItems.read",
  table: "promoCode",
});

export const listPromoCodeItemsLightweightReadDefinition =
  defineRowScopedCatalogRead({
    argName: "promoCodeId",
    functionName: "inventory/promoCode:getPromoCodeItemsLightweight",
    operationId: "inventory.promoCode.getPromoCodeItemsLightweight.read",
    table: "promoCode",
  });

// ---------------------------------------------------------------------------
// inventory/stockValidation
// ---------------------------------------------------------------------------

function stockReservationRead(functionName: string) {
  return defineIntentRead({
    functionName: `inventory/stockValidation:${functionName}`,
    intent: "inventory.stock.view",
    operationId: `inventory.stockValidation.${functionName}.read`,
    scope: { kind: "store" as const, storeIdArg: "storeId" },
  });
}

export const getSkusReservedInCheckoutReadDefinition = stockReservationRead(
  "getSkusReservedInCheckout",
);
export const getSkusReservedInPosSessionReadDefinition = stockReservationRead(
  "getSkusReservedInPosSession",
);

// ---------------------------------------------------------------------------
// inventory/storeSchedule
// ---------------------------------------------------------------------------

function storeScheduleRead(
  functionName: string,
  sharedDemo: "admit" | "deny" = "deny",
) {
  return defineIntentRead({
    functionName: `inventory/storeSchedule:${functionName}`,
    intent: "store.configuration.view",
    operationId: `inventory.storeSchedule.${functionName}.read`,
    scope: { kind: "store" as const, storeIdArg: "storeId" },
    sharedDemo,
  });
}

export const getStoreDayContextReadDefinition =
  storeScheduleRead("getStoreDayContext");
/**
 * Demo-admitted: the POS hub (`/pos`) and POS settings both read the schedule
 * summary on load, and every "Make a sale" entry point in the demo routes
 * through the hub. Its siblings stay denied — the schedule ADMIN views they
 * back (`/configuration`) are hidden from the demo sidebar.
 */
export const getStoreScheduleSummaryReadDefinition = storeScheduleRead(
  "getStoreScheduleSummary",
  "admit",
);
export const listStoreScheduleVersionsReadDefinition = storeScheduleRead(
  "listStoreScheduleVersions",
);
export const getStoreScheduleForAdminReadDefinition = storeScheduleRead(
  "getStoreScheduleForAdmin",
);

// ---------------------------------------------------------------------------
// inventory/subcategories
// ---------------------------------------------------------------------------

// The anonymous GET /subcategories route calls the internal sibling
// (`getAllInternal`), so this export stays closed to the public actor.
export const listSubcategoriesReadDefinition = defineInventoryCatalogRead(
  "inventory/subcategories:getAll",
  "inventory.subcategories.getAll.read",
);

export const getSubcategoryByIdReadDefinition = defineInventoryCatalogRead(
  "inventory/subcategories:getById",
  "inventory.subcategories.getById.read",
);

export const INVENTORY_CATALOG_READ_DEFINITIONS: readonly OperationReadDefinition[] =
  [
    getBannerMessageReadDefinition,
    getPublicActiveBannerMessageReadDefinition,
    getBestSellerByIdReadDefinition,
    listBestSellersReadDefinition,
    getLatestInventoryImportReviewVersionReadDefinition,
    getLatestInventoryImportReviewVersionMetadataReadDefinition,
    getInventoryImportReviewVersionPayloadChunkReadDefinition,
    listInventoryImportReviewSkuContextReadDefinition,
    listProductPageProvisionalSkuBindingReadDefinition,
    listCategoriesReadDefinition,
    getCategoryByIdReadDefinition,
    listColorsReadDefinition,
    getColorByIdReadDefinition,
    listActiveComplimentaryProductsReadDefinition,
    listComplimentaryProductsByCollectionReadDefinition,
    listActiveComplimentaryCollectionsReadDefinition,
    listAllComplimentaryProductsReadDefinition,
    getFeaturedItemByIdReadDefinition,
    listFeaturedItemsReadDefinition,
    getProductByIdReadDefinition,
    getProductBySlugReadDefinition,
    getProductByIdOrSlugReadDefinition,
    getCatalogSummaryReadDefinition,
    getProductSkuReadDefinition,
    batchGetProductsReadDefinition,
    getProductSkuByIdReadDefinition,
    listPromoCodesReadDefinition,
    getPromoCodeByIdReadDefinition,
    listPromoCodeItemsReadDefinition,
    listPromoCodeItemsLightweightReadDefinition,
    getSkusReservedInCheckoutReadDefinition,
    getSkusReservedInPosSessionReadDefinition,
    getStoreDayContextReadDefinition,
    getStoreScheduleSummaryReadDefinition,
    listStoreScheduleVersionsReadDefinition,
    getStoreScheduleForAdminReadDefinition,
    listSubcategoriesReadDefinition,
    getSubcategoryByIdReadDefinition,
  ];
