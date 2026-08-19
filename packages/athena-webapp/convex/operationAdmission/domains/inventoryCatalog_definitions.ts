import type { Id } from "../../_generated/dataModel";
import type {
  OperationAdmissionCtx,
  OperationDefinition,
  OperationTargetIds,
} from "../types";
import { defineOperation } from "./_shapes";

/**
 * U3 - inventory catalog modules - write/action/http operation definitions.
 *
 * Every capability here (`catalog.manage`, `storefront.content.manage`,
 * `store.configure`, `inventory.import`, `administration.maintenance`,
 * `administration.destructive`) is outside `SHARED_DEMO_ALLOWED_CAPABILITIES`,
 * so every definition denies the shared-demo actor. That is the successor to
 * the handler-local demo checks these modules used to run
 * (`requireAuthenticatedNonDemoEffect` in the productSku/productUtil actions),
 * and it matches the pre-existing behaviour: catalog writes were already
 * unreachable for a demo visitor.
 *
 * `target.protectDemoFoundation` is the successor to every retired
 * `requireNonDemoFoundationMutation` site. It is a resource guard, not actor
 * policy: it runs for EVERY admitted actor, so a normal full admin still
 * cannot mutate a demo foundation row.
 */

type ScopeResolverCtx = OperationAdmissionCtx;

/** Reads an id argument, tolerating a caller that omitted or mistyped it. */
function idArg(args: Record<string, unknown>, name: string) {
  const value = args[name];
  return typeof value === "string" ? value : undefined;
}

/**
 * Store scope resolved from the row the caller names, never from a
 * caller-supplied store id.
 */
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

/** The same row lookup, shaped as a foundation-guard target. */
function rowStoreTarget<TableName extends string>(
  table: TableName,
  argName: string,
) {
  return {
    resolve: async (
      ctx: ScopeResolverCtx,
      args: Record<string, unknown>,
    ): Promise<OperationTargetIds> => {
      const id = idArg(args, argName);
      if (!id) return {};
      const row = (await ctx.db.get(table as never, id as never)) as
        | { storeId?: Id<"store"> }
        | null;
      return row?.storeId ? { storeId: row.storeId } : {};
    },
  };
}

/**
 * Store scope for a rank-reordering mutation: the rows are named by id, so the
 * store comes from the first row that exists. The handler still re-authorizes
 * every distinct store it touches, which is what covers a mixed-store batch.
 */
function rankedRowsStoreScope<TableName extends string>(table: TableName) {
  return async (ctx: ScopeResolverCtx, args: Record<string, unknown>) => {
    const ranks = args.ranks;
    if (!Array.isArray(ranks)) return {};
    for (const entry of ranks) {
      const id = (entry as { id?: unknown })?.id;
      if (typeof id !== "string") continue;
      const row = (await ctx.db.get(table as never, id as never)) as
        | { storeId?: Id<"store"> }
        | null;
      if (row?.storeId) return { storeId: row.storeId };
    }
    return {};
  };
}

const CATALOG_ACTORS = {
  normalUser: "admit" as const,
  sharedDemo: "deny" as const,
  public: "deny" as const,
};

// ---------------------------------------------------------------------------
// inventory/bannerMessage - storefront.content.manage
// ---------------------------------------------------------------------------

export const upsertBannerMessageOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "inventory/bannerMessage:upsert",
  operationId: "inventory.bannerMessage.upsert",
  capability: "storefront.content.manage",
  scope: { kind: "store" as const, storeIdArg: "storeId" },
  readiness: { kind: "none" as const },
  effects: { mode: "none" as const },
  actors: CATALOG_ACTORS,
});

export const removeBannerMessageOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "inventory/bannerMessage:remove",
  operationId: "inventory.bannerMessage.remove",
  capability: "storefront.content.manage",
  scope: {
    kind: "store" as const,
    resolve: rowStoreScope("bannerMessage", "id"),
  },
  readiness: { kind: "none" as const },
  effects: { mode: "none" as const },
  actors: CATALOG_ACTORS,
});

// ---------------------------------------------------------------------------
// inventory/bestSeller - storefront.content.manage
// ---------------------------------------------------------------------------

export const createBestSellerOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "inventory/bestSeller:create",
  operationId: "inventory.bestSeller.create",
  capability: "storefront.content.manage",
  scope: { kind: "store" as const, storeIdArg: "storeId" },
  readiness: { kind: "none" as const },
  effects: { mode: "none" as const },
  actors: CATALOG_ACTORS,
});

export const removeBestSellerOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "inventory/bestSeller:remove",
  operationId: "inventory.bestSeller.remove",
  capability: "storefront.content.manage",
  scope: { kind: "store" as const, resolve: rowStoreScope("bestSeller", "id") },
  readiness: { kind: "none" as const },
  effects: { mode: "none" as const },
  actors: CATALOG_ACTORS,
});

export const updateBestSellerRanksOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "inventory/bestSeller:updateRanks",
  operationId: "inventory.bestSeller.updateRanks",
  capability: "storefront.content.manage",
  scope: { kind: "store" as const, resolve: rankedRowsStoreScope("bestSeller") },
  readiness: { kind: "none" as const },
  effects: { mode: "none" as const },
  actors: CATALOG_ACTORS,
});

// ---------------------------------------------------------------------------
// inventory/catalogImport - inventory.import
// ---------------------------------------------------------------------------

function inventoryImportStoreWrite(functionName: string) {
  return defineOperation({
    kind: "mutation" as const,
    functionName: `inventory/catalogImport:${functionName}`,
    operationId: `inventory.catalogImport.${functionName}`,
    capability: "inventory.import",
    scope: { kind: "store" as const, storeIdArg: "storeId" },
    readiness: { kind: "store_write" as const },
    effects: { mode: "none" as const },
    actors: CATALOG_ACTORS,
  });
}

export const importInventoryOperationDefinition =
  inventoryImportStoreWrite("importInventory");
export const saveInventoryImportReviewVersionOperationDefinition =
  inventoryImportStoreWrite("saveInventoryImportReviewVersion");
export const stageInventoryImportReviewRowsForPosOperationDefinition =
  inventoryImportStoreWrite("stageInventoryImportReviewRowsForPos");
export const finalizeTrustedInventoryFromProductPageOperationDefinition =
  inventoryImportStoreWrite("finalizeTrustedInventoryFromProductPage");

// ---------------------------------------------------------------------------
// inventory/categories - catalog.manage
// ---------------------------------------------------------------------------

export const createCategoryOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "inventory/categories:create",
  operationId: "inventory.categories.create",
  capability: "catalog.manage",
  scope: { kind: "store" as const, storeIdArg: "storeId" },
  readiness: { kind: "none" as const },
  effects: { mode: "none" as const },
  target: { protectDemoFoundation: { storeIdArg: "storeId" } },
  actors: CATALOG_ACTORS,
});

export const updateCategoryOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "inventory/categories:update",
  operationId: "inventory.categories.update",
  capability: "catalog.manage",
  scope: { kind: "store" as const, resolve: rowStoreScope("category", "id") },
  readiness: { kind: "none" as const },
  effects: { mode: "none" as const },
  target: { protectDemoFoundation: rowStoreTarget("category", "id") },
  actors: CATALOG_ACTORS,
});

export const removeCategoryOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "inventory/categories:remove",
  operationId: "inventory.categories.remove",
  capability: "catalog.manage",
  scope: { kind: "store" as const, resolve: rowStoreScope("category", "id") },
  readiness: { kind: "none" as const },
  effects: { mode: "none" as const },
  target: { protectDemoFoundation: rowStoreTarget("category", "id") },
  actors: CATALOG_ACTORS,
});

// ---------------------------------------------------------------------------
// inventory/colors - catalog.manage
// ---------------------------------------------------------------------------

export const createColorOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "inventory/colors:create",
  operationId: "inventory.colors.create",
  capability: "catalog.manage",
  scope: { kind: "store" as const, storeIdArg: "storeId" },
  readiness: { kind: "none" as const },
  effects: { mode: "none" as const },
  target: { protectDemoFoundation: { storeIdArg: "storeId" } },
  actors: CATALOG_ACTORS,
});

export const updateColorOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "inventory/colors:update",
  operationId: "inventory.colors.update",
  capability: "catalog.manage",
  scope: { kind: "store" as const, resolve: rowStoreScope("color", "id") },
  readiness: { kind: "none" as const },
  effects: { mode: "none" as const },
  target: { protectDemoFoundation: rowStoreTarget("color", "id") },
  actors: CATALOG_ACTORS,
});

export const removeColorOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "inventory/colors:remove",
  operationId: "inventory.colors.remove",
  capability: "catalog.manage",
  scope: { kind: "store" as const, resolve: rowStoreScope("color", "id") },
  readiness: { kind: "none" as const },
  effects: { mode: "none" as const },
  target: { protectDemoFoundation: rowStoreTarget("color", "id") },
  actors: CATALOG_ACTORS,
});

// ---------------------------------------------------------------------------
// inventory/complimentaryProduct - storefront.content.manage
// ---------------------------------------------------------------------------

/**
 * The retired guard bound all three ids at once
 * (`athenaUserId`/`organizationId`/`storeId`), and the guard denies when ANY of
 * them is a demo foundation id, so the binding object carries all three.
 */
const COMPLIMENTARY_CREATE_TARGET = {
  protectDemoFoundation: {
    athenaUserIdArg: "createdByUserId",
    organizationIdArg: "organizationId",
    storeIdArg: "storeId",
  },
} as const;

export const createComplimentaryCollectionOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "inventory/complimentaryProduct:createCollection",
  operationId: "inventory.complimentaryProduct.createCollection",
  capability: "storefront.content.manage",
  scope: { kind: "store" as const, storeIdArg: "storeId" },
  readiness: { kind: "none" as const },
  effects: { mode: "none" as const },
  target: COMPLIMENTARY_CREATE_TARGET,
  actors: CATALOG_ACTORS,
});

export const createComplimentaryProductOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "inventory/complimentaryProduct:createComplimentaryProduct",
  operationId: "inventory.complimentaryProduct.createComplimentaryProduct",
  capability: "storefront.content.manage",
  scope: { kind: "store" as const, storeIdArg: "storeId" },
  readiness: { kind: "none" as const },
  effects: { mode: "none" as const },
  target: COMPLIMENTARY_CREATE_TARGET,
  actors: CATALOG_ACTORS,
});

export const batchCreateComplimentaryProductsOperationDefinition =
  defineOperation({
    kind: "mutation" as const,
    functionName:
      "inventory/complimentaryProduct:batchCreateComplimentaryProducts",
    operationId:
      "inventory.complimentaryProduct.batchCreateComplimentaryProducts",
    capability: "storefront.content.manage",
    scope: { kind: "store" as const, storeIdArg: "storeId" },
    readiness: { kind: "none" as const },
    effects: { mode: "none" as const },
    target: COMPLIMENTARY_CREATE_TARGET,
    actors: CATALOG_ACTORS,
  });

export const toggleComplimentaryProductActiveOperationDefinition =
  defineOperation({
    kind: "mutation" as const,
    functionName:
      "inventory/complimentaryProduct:toggleComplimentaryProductActive",
    operationId:
      "inventory.complimentaryProduct.toggleComplimentaryProductActive",
    capability: "storefront.content.manage",
    scope: {
      kind: "store" as const,
      resolve: rowStoreScope("complimentaryProduct", "complimentaryProductId"),
    },
    readiness: { kind: "none" as const },
    effects: { mode: "none" as const },
    target: {
      protectDemoFoundation: rowStoreTarget(
        "complimentaryProduct",
        "complimentaryProductId",
      ),
    },
    actors: CATALOG_ACTORS,
  });

export const toggleComplimentaryCollectionActiveOperationDefinition =
  defineOperation({
    kind: "mutation" as const,
    functionName: "inventory/complimentaryProduct:toggleCollectionActive",
    operationId: "inventory.complimentaryProduct.toggleCollectionActive",
    capability: "storefront.content.manage",
    scope: {
      kind: "store" as const,
      resolve: rowStoreScope(
        "complimentaryProductsCollection",
        "collectionId",
      ),
    },
    readiness: { kind: "none" as const },
    effects: { mode: "none" as const },
    target: {
      protectDemoFoundation: rowStoreTarget(
        "complimentaryProductsCollection",
        "collectionId",
      ),
    },
    actors: CATALOG_ACTORS,
  });

// ---------------------------------------------------------------------------
// inventory/featuredItem - storefront.content.manage
// ---------------------------------------------------------------------------

export const createFeaturedItemOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "inventory/featuredItem:create",
  operationId: "inventory.featuredItem.create",
  capability: "storefront.content.manage",
  scope: { kind: "store" as const, storeIdArg: "storeId" },
  readiness: { kind: "none" as const },
  effects: { mode: "none" as const },
  actors: CATALOG_ACTORS,
});

export const removeFeaturedItemOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "inventory/featuredItem:remove",
  operationId: "inventory.featuredItem.remove",
  capability: "storefront.content.manage",
  scope: {
    kind: "store" as const,
    resolve: rowStoreScope("featuredItem", "id"),
  },
  readiness: { kind: "none" as const },
  effects: { mode: "none" as const },
  actors: CATALOG_ACTORS,
});

export const updateFeaturedItemRanksOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "inventory/featuredItem:updateRanks",
  operationId: "inventory.featuredItem.updateRanks",
  capability: "storefront.content.manage",
  scope: {
    kind: "store" as const,
    resolve: rankedRowsStoreScope("featuredItem"),
  },
  readiness: { kind: "none" as const },
  effects: { mode: "none" as const },
  actors: CATALOG_ACTORS,
});

// ---------------------------------------------------------------------------
// inventory/productSku - catalog.manage (+ administration.maintenance)
// ---------------------------------------------------------------------------

export const generateProductSkuUploadUrlOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "inventory/productSku:generateUploadUrl",
  operationId: "inventory.productSku.generateUploadUrl",
  capability: "catalog.manage",
  scope: { kind: "none" as const },
  readiness: { kind: "none" as const },
  effects: { mode: "none" as const },
  actors: CATALOG_ACTORS,
});

/**
 * The retired guard only fired on the image branch (`args.update.images`), so
 * the bound target reproduces that condition exactly rather than widening it to
 * every field update.
 */
export const updateProductSkuOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "inventory/productSku:update",
  operationId: "inventory.productSku.update",
  capability: "catalog.manage",
  scope: { kind: "store" as const, resolve: rowStoreScope("productSku", "id") },
  readiness: { kind: "none" as const },
  effects: { mode: "none" as const },
  target: {
    protectDemoFoundation: {
      resolve: async (
        ctx: ScopeResolverCtx,
        args: Record<string, unknown>,
      ): Promise<OperationTargetIds> => {
        const update = args.update as { images?: unknown } | undefined;
        if (!update?.images) return {};
        const id = idArg(args, "id");
        if (!id) return {};
        const sku = await ctx.db.get("productSku", id as never);
        return sku ? { storeId: sku.storeId } : {};
      },
    },
  },
  actors: CATALOG_ACTORS,
});

export const uploadProductSkuImagesOperationDefinition = defineOperation({
  kind: "action" as const,
  functionName: "inventory/productSku:uploadImages",
  operationId: "inventory.productSku.uploadImages",
  capability: "catalog.manage",
  scope: { kind: "store" as const, storeIdArg: "storeId" },
  readiness: { kind: "none" as const },
  effects: { mode: "none" as const },
  target: { protectDemoFoundation: { storeIdArg: "storeId" } },
  actors: CATALOG_ACTORS,
});

export const deleteProductSkuImagesOperationDefinition = defineOperation({
  kind: "action" as const,
  functionName: "inventory/productSku:deleteImages",
  operationId: "inventory.productSku.deleteImages",
  capability: "catalog.manage",
  scope: { kind: "none" as const },
  readiness: { kind: "none" as const },
  effects: { mode: "none" as const },
  target: { protectDemoFoundationExternalRefs: { arg: "imageUrls" } },
  actors: CATALOG_ACTORS,
});

export const nukeProblematicImagesOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "inventory/productSku:nukeProblematicImages",
  operationId: "inventory.productSku.nukeProblematicImages",
  capability: "administration.maintenance",
  scope: { kind: "none" as const },
  readiness: { kind: "none" as const },
  effects: { mode: "none" as const },
  actors: CATALOG_ACTORS,
});

export const makeAllProductsVisibleOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "inventory/productSku:makeAllProductsVisible",
  operationId: "inventory.productSku.makeAllProductsVisible",
  capability: "catalog.manage",
  scope: { kind: "none" as const },
  readiness: { kind: "none" as const },
  effects: { mode: "none" as const },
  actors: CATALOG_ACTORS,
});

export const backfillUndefinedSkuVisibilityOperationDefinition = defineOperation(
  {
    kind: "mutation" as const,
    functionName:
      "inventory/productSku:backfillUndefinedSkuVisibilityFromProducts",
    operationId:
      "inventory.productSku.backfillUndefinedSkuVisibilityFromProducts",
    capability: "catalog.manage",
    scope: { kind: "none" as const },
    readiness: { kind: "none" as const },
    effects: { mode: "none" as const },
    actors: CATALOG_ACTORS,
  },
);

// ---------------------------------------------------------------------------
// inventory/productUtil - administration.maintenance
// ---------------------------------------------------------------------------

/**
 * `clearAllCache` stays a public action: the Athena webapp calls it from the
 * products views (`StoreProductsView`, `ProductsListView`), so the plan's
 * "internalize if no client caller" branch does not apply and it is admitted as
 * `administration.maintenance` instead. `sharedDemo: "deny"` is the successor
 * to its `requireAuthenticatedNonDemoEffect` call.
 */
export const clearAllProductCacheOperationDefinition = defineOperation({
  kind: "action" as const,
  functionName: "inventory/productUtil:clearAllCache",
  operationId: "inventory.productUtil.clearAllCache",
  capability: "administration.maintenance",
  scope: { kind: "none" as const },
  readiness: { kind: "none" as const },
  effects: { mode: "none" as const },
  actors: CATALOG_ACTORS,
});

// ---------------------------------------------------------------------------
// inventory/products - catalog.manage (+ administration.destructive)
// ---------------------------------------------------------------------------

export const createProductOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "inventory/products:create",
  operationId: "inventory.products.create",
  capability: "catalog.manage",
  scope: { kind: "store" as const, storeIdArg: "storeId" },
  readiness: { kind: "none" as const },
  effects: { mode: "none" as const },
  target: { protectDemoFoundation: { storeIdArg: "storeId" } },
  actors: CATALOG_ACTORS,
});

export const createProductSkuOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "inventory/products:createSku",
  operationId: "inventory.products.createSku",
  capability: "catalog.manage",
  scope: { kind: "store" as const, resolve: rowStoreScope("product", "productId") },
  readiness: { kind: "none" as const },
  effects: { mode: "none" as const },
  target: { protectDemoFoundation: rowStoreTarget("product", "productId") },
  actors: CATALOG_ACTORS,
});

export const generateUniqueBarcodeOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "inventory/products:generateUniqueBarcode",
  operationId: "inventory.products.generateUniqueBarcode",
  capability: "catalog.manage",
  scope: { kind: "store" as const, storeIdArg: "storeId" },
  readiness: { kind: "none" as const },
  effects: { mode: "none" as const },
  actors: CATALOG_ACTORS,
});

export const updateProductSkuFieldsOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "inventory/products:updateSku",
  operationId: "inventory.products.updateSku",
  capability: "catalog.manage",
  scope: { kind: "store" as const, resolve: rowStoreScope("productSku", "id") },
  readiness: { kind: "none" as const },
  effects: { mode: "none" as const },
  target: { protectDemoFoundation: rowStoreTarget("productSku", "id") },
  actors: CATALOG_ACTORS,
});

export const updateProductOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "inventory/products:update",
  operationId: "inventory.products.update",
  capability: "catalog.manage",
  scope: { kind: "store" as const, resolve: rowStoreScope("product", "id") },
  readiness: { kind: "none" as const },
  effects: { mode: "none" as const },
  target: { protectDemoFoundation: rowStoreTarget("product", "id") },
  actors: CATALOG_ACTORS,
});

export const archiveProductOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "inventory/products:archive",
  operationId: "inventory.products.archive",
  capability: "catalog.manage",
  scope: { kind: "store" as const, storeIdArg: "storeId" },
  readiness: { kind: "none" as const },
  effects: { mode: "none" as const },
  target: { protectDemoFoundation: { storeIdArg: "storeId" } },
  actors: CATALOG_ACTORS,
});

export const unarchiveProductOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "inventory/products:unarchive",
  operationId: "inventory.products.unarchive",
  capability: "catalog.manage",
  scope: { kind: "store" as const, storeIdArg: "storeId" },
  readiness: { kind: "none" as const },
  effects: { mode: "none" as const },
  target: { protectDemoFoundation: { storeIdArg: "storeId" } },
  actors: CATALOG_ACTORS,
});

export const removeProductSkuOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "inventory/products:removeSku",
  operationId: "inventory.products.removeSku",
  capability: "catalog.manage",
  scope: { kind: "store" as const, resolve: rowStoreScope("productSku", "id") },
  readiness: { kind: "none" as const },
  effects: { mode: "none" as const },
  target: { protectDemoFoundation: rowStoreTarget("productSku", "id") },
  actors: CATALOG_ACTORS,
});

export const removeAllProductsForStoreOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "inventory/products:removeAllProductsForStore",
  operationId: "inventory.products.removeAllProductsForStore",
  capability: "administration.destructive",
  scope: { kind: "store" as const, storeIdArg: "storeId" },
  readiness: { kind: "none" as const },
  effects: { mode: "none" as const },
  target: { protectDemoFoundation: { storeIdArg: "storeId" } },
  actors: CATALOG_ACTORS,
});

/**
 * The retired guard ran once per SKU in the batch, and a single
 * `protectDemoFoundation` target can carry only one store id. The external-refs
 * guard is set-valued, and it denies when any ref names the demo store's
 * `/stores/<id>/` path, so resolving one ref per distinct SKU store reproduces
 * the per-row loop without weakening it.
 */
export const batchUpdateSkuPricesOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "inventory/products:batchUpdateSkuPrices",
  operationId: "inventory.products.batchUpdateSkuPrices",
  capability: "catalog.manage",
  scope: {
    kind: "store" as const,
    resolve: async (ctx: ScopeResolverCtx, args: Record<string, unknown>) => {
      const updates = args.updates;
      if (!Array.isArray(updates)) return {};
      for (const update of updates) {
        const id = (update as { id?: unknown })?.id;
        if (typeof id !== "string") continue;
        const sku = await ctx.db.get("productSku", id as never);
        if (sku) return { storeId: sku.storeId };
      }
      return {};
    },
  },
  readiness: { kind: "none" as const },
  effects: { mode: "none" as const },
  target: {
    protectDemoFoundationExternalRefs: {
      resolve: async (
        ctx: ScopeResolverCtx,
        args: Record<string, unknown>,
      ): Promise<readonly string[]> => {
        const updates = args.updates;
        if (!Array.isArray(updates)) return [];
        const storeIds = new Set<string>();
        for (const update of updates) {
          const id = (update as { id?: unknown })?.id;
          if (typeof id !== "string") continue;
          const sku = await ctx.db.get("productSku", id as never);
          if (sku) storeIds.add(sku.storeId);
        }
        return [...storeIds].map((storeId) => `/stores/${storeId}/`);
      },
    },
  },
  actors: CATALOG_ACTORS,
});

// ---------------------------------------------------------------------------
// inventory/promoCode - storefront.content.manage
// ---------------------------------------------------------------------------

export const createPromoCodeOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "inventory/promoCode:create",
  operationId: "inventory.promoCode.create",
  capability: "storefront.content.manage",
  scope: { kind: "store" as const, storeIdArg: "storeId" },
  readiness: { kind: "none" as const },
  effects: { mode: "none" as const },
  target: {
    protectDemoFoundation: {
      athenaUserIdArg: "createdByUserId",
      storeIdArg: "storeId",
    },
  },
  actors: CATALOG_ACTORS,
});

export const removePromoCodeOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "inventory/promoCode:remove",
  operationId: "inventory.promoCode.remove",
  capability: "storefront.content.manage",
  scope: { kind: "store" as const, resolve: rowStoreScope("promoCode", "id") },
  readiness: { kind: "none" as const },
  effects: { mode: "none" as const },
  target: { protectDemoFoundation: rowStoreTarget("promoCode", "id") },
  actors: CATALOG_ACTORS,
});

export const updatePromoCodeOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "inventory/promoCode:update",
  operationId: "inventory.promoCode.update",
  capability: "storefront.content.manage",
  scope: { kind: "store" as const, resolve: rowStoreScope("promoCode", "id") },
  readiness: { kind: "none" as const },
  effects: { mode: "none" as const },
  target: { protectDemoFoundation: rowStoreTarget("promoCode", "id") },
  actors: CATALOG_ACTORS,
});

// ---------------------------------------------------------------------------
// inventory/skuSearch - administration.maintenance
// ---------------------------------------------------------------------------

export const repairProductSkuSearchPageOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "inventory/skuSearch:repairProductSkuSearchPage",
  operationId: "inventory.skuSearch.repairProductSkuSearchPage",
  capability: "administration.maintenance",
  scope: { kind: "store" as const, storeIdArg: "storeId" },
  readiness: { kind: "none" as const },
  effects: { mode: "none" as const },
  actors: CATALOG_ACTORS,
});

export const removeStaleProductSkuSearchPageOperationDefinition =
  defineOperation({
    kind: "mutation" as const,
    functionName: "inventory/skuSearch:removeStaleProductSkuSearchPage",
    operationId: "inventory.skuSearch.removeStaleProductSkuSearchPage",
    capability: "administration.maintenance",
    scope: { kind: "store" as const, storeIdArg: "storeId" },
    readiness: { kind: "none" as const },
    effects: { mode: "none" as const },
    actors: CATALOG_ACTORS,
  });

// ---------------------------------------------------------------------------
// inventory/storeSchedule - store.configure
// ---------------------------------------------------------------------------

export const upsertStoreScheduleCommandOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "inventory/storeSchedule:upsertStoreScheduleCommand",
  operationId: "inventory.storeSchedule.upsertStoreScheduleCommand",
  capability: "store.configure",
  scope: { kind: "store" as const, storeIdArg: "storeId" },
  readiness: { kind: "none" as const },
  effects: { mode: "none" as const },
  actors: CATALOG_ACTORS,
});

// ---------------------------------------------------------------------------
// inventory/subcategories - catalog.manage
// ---------------------------------------------------------------------------

export const createSubcategoryOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "inventory/subcategories:create",
  operationId: "inventory.subcategories.create",
  capability: "catalog.manage",
  scope: { kind: "store" as const, storeIdArg: "storeId" },
  readiness: { kind: "none" as const },
  effects: { mode: "none" as const },
  target: { protectDemoFoundation: { storeIdArg: "storeId" } },
  actors: CATALOG_ACTORS,
});

export const updateSubcategoryOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "inventory/subcategories:update",
  operationId: "inventory.subcategories.update",
  capability: "catalog.manage",
  scope: { kind: "store" as const, resolve: rowStoreScope("subcategory", "id") },
  readiness: { kind: "none" as const },
  effects: { mode: "none" as const },
  target: { protectDemoFoundation: rowStoreTarget("subcategory", "id") },
  actors: CATALOG_ACTORS,
});

export const removeSubcategoryOperationDefinition = defineOperation({
  kind: "mutation" as const,
  functionName: "inventory/subcategories:remove",
  operationId: "inventory.subcategories.remove",
  capability: "catalog.manage",
  scope: { kind: "store" as const, resolve: rowStoreScope("subcategory", "id") },
  readiness: { kind: "none" as const },
  effects: { mode: "none" as const },
  target: { protectDemoFoundation: rowStoreTarget("subcategory", "id") },
  actors: CATALOG_ACTORS,
});

export const INVENTORY_CATALOG_DEFINITIONS: readonly OperationDefinition[] =
  [
    upsertBannerMessageOperationDefinition,
    removeBannerMessageOperationDefinition,
    createBestSellerOperationDefinition,
    removeBestSellerOperationDefinition,
    updateBestSellerRanksOperationDefinition,
    importInventoryOperationDefinition,
    saveInventoryImportReviewVersionOperationDefinition,
    stageInventoryImportReviewRowsForPosOperationDefinition,
    finalizeTrustedInventoryFromProductPageOperationDefinition,
    createCategoryOperationDefinition,
    updateCategoryOperationDefinition,
    removeCategoryOperationDefinition,
    createColorOperationDefinition,
    updateColorOperationDefinition,
    removeColorOperationDefinition,
    createComplimentaryCollectionOperationDefinition,
    createComplimentaryProductOperationDefinition,
    batchCreateComplimentaryProductsOperationDefinition,
    toggleComplimentaryProductActiveOperationDefinition,
    toggleComplimentaryCollectionActiveOperationDefinition,
    createFeaturedItemOperationDefinition,
    removeFeaturedItemOperationDefinition,
    updateFeaturedItemRanksOperationDefinition,
    generateProductSkuUploadUrlOperationDefinition,
    updateProductSkuOperationDefinition,
    uploadProductSkuImagesOperationDefinition,
    deleteProductSkuImagesOperationDefinition,
    nukeProblematicImagesOperationDefinition,
    makeAllProductsVisibleOperationDefinition,
    backfillUndefinedSkuVisibilityOperationDefinition,
    clearAllProductCacheOperationDefinition,
    createProductOperationDefinition,
    createProductSkuOperationDefinition,
    generateUniqueBarcodeOperationDefinition,
    updateProductSkuFieldsOperationDefinition,
    updateProductOperationDefinition,
    archiveProductOperationDefinition,
    unarchiveProductOperationDefinition,
    removeProductSkuOperationDefinition,
    removeAllProductsForStoreOperationDefinition,
    batchUpdateSkuPricesOperationDefinition,
    createPromoCodeOperationDefinition,
    removePromoCodeOperationDefinition,
    updatePromoCodeOperationDefinition,
    repairProductSkuSearchPageOperationDefinition,
    removeStaleProductSkuSearchPageOperationDefinition,
    upsertStoreScheduleCommandOperationDefinition,
    createSubcategoryOperationDefinition,
    updateSubcategoryOperationDefinition,
    removeSubcategoryOperationDefinition,
  ];
