import type { Doc, Id } from "../../../_generated/dataModel";
import type { QueryCtx } from "../../../_generated/server";
import {
  readActiveHeldQuantitiesForStoreSkus,
  validateInventoryAvailability,
} from "../../../inventory/helpers/inventoryHolds";
import {
  isPosCatalogVisible,
  isProjectionProductPosCatalogVisible,
  isProjectionSkuPosCatalogVisible,
} from "../../../../shared/posCatalogVisibility";

type InventoryImportProvisionalSkuId = Id<"inventoryImportProvisionalSku">;

type RegisterCatalogRow = {
  id: Id<"productSku"> | InventoryImportProvisionalSkuId;
  catalogRowKey?: string;
  productSkuId: Id<"productSku">;
  skuId: Id<"productSku">;
  productId: Id<"product">;
  inventoryImportProvisionalSkuId?: InventoryImportProvisionalSkuId;
  pendingCheckoutItemId?: Id<"posPendingCheckoutItem">;
  pendingCheckoutAliasState?: "linked_to_catalog";
  pendingCheckoutAliasLookupCode?: string;
  pendingCheckoutAliasName?: string;
  pendingCheckoutAliasPrice?: number;
  pendingCheckoutAliasTrustedName?: string;
  pendingCheckoutAliasTrustedSku?: string;
  pendingCheckoutAliasTrustedCategory?: string;
  pendingCheckoutAliasTrustedDescription?: string;
  linkedPendingCheckoutItemIds?: Array<Id<"posPendingCheckoutItem">>;
  linkedPendingCheckoutLocalEventIds?: string[];
  suppressedPendingCheckoutItemIds?: Array<Id<"posPendingCheckoutItem">>;
  suppressedPendingCheckoutLocalEventIds?: string[];
  suppressFromRegisterSearch?: true;
  name: string;
  sku: string;
  barcode: string;
  price: number;
  category: string;
  description: string;
  image: string | null;
  size: string;
  length: number | null;
  color: string;
  areProcessingFeesAbsorbed: boolean;
  availabilityPolicy: RegisterCatalogAvailabilityPolicy;
};

type RegisterCatalogAvailabilityPolicy =
  | "trusted_inventory"
  | "active_provisional_import"
  | "pending_checkout";

type RegisterCatalogAvailabilityRow = {
  productSkuId: Id<"productSku">;
  skuId: Id<"productSku">;
  inventoryImportProvisionalSkuId?: InventoryImportProvisionalSkuId;
  inStock: boolean;
  quantityAvailable: number;
  availabilityPolicy: RegisterCatalogAvailabilityPolicy;
};

type InventoryImportProvisionalSku = {
  _id: InventoryImportProvisionalSkuId;
  storeId: Id<"store">;
  status: "active" | "finalized" | "rejected" | "closed";
  posExposureStatus: "available" | "hidden";
  productId: Id<"product">;
  productSkuId: Id<"productSku">;
  importedProductName: string;
  importedSku?: string;
  importedBarcode?: string;
  importedCategory?: string;
  importedColor?: string;
  importedLength?: number;
  importedPrice: number;
  importedQuantity: number;
  importedSize?: string;
  provisionalQuantitySold?: number;
  provisionalTransactionCount?: number;
};

type PosPendingCheckoutItem = Pick<
  Doc<"posPendingCheckoutItem">,
  | "_id"
  | "approvedProductSkuId"
  | "evidence"
  | "lookupCode"
  | "name"
  | "provisionalProductId"
  | "provisionalProductSkuId"
  | "provisionalPrice"
  | "status"
  | "storeId"
>;

type LinkedPendingCheckoutItem = Pick<
  Doc<"posPendingCheckoutItem">,
  | "_id"
  | "approvedProductSkuId"
  | "evidence"
  | "lookupCode"
  | "name"
  | "provisionalPrice"
  | "provisionalProductId"
  | "provisionalProductSkuId"
>;

export const REGISTER_CATALOG_AVAILABILITY_LIMIT = 50;
const REGISTER_CATALOG_PROVISIONAL_IMPORT_LIMIT = 5_000;
const POS_OPERATIONAL_CATEGORY_SLUGS = new Set([
  "legacy-import",
  "pos-pending-checkout",
  "pos-quick-add",
]);

function isDraftAllowedInTrustedRegisterCatalog(categorySlug?: string) {
  return (
    categorySlug === "legacy-import" || categorySlug === "pos-pending-checkout"
  );
}

async function readCategoryDoc(
  ctx: QueryCtx,
  cache: Map<Id<"category">, Doc<"category"> | null>,
  categoryId: Id<"category">,
) {
  const cached = cache.get(categoryId);
  if (cached !== undefined) {
    return cached;
  }

  const category = await ctx.db.get("category", categoryId);
  cache.set(categoryId, category);

  return category;
}

function mapProjectionToRegisterCatalogRow(args: {
  linkedPendingCheckoutLocalEventIds?: string[];
  linkedPendingCheckoutItemIds?: Array<Id<"posPendingCheckoutItem">>;
  pendingCheckoutItem?: PosPendingCheckoutItem;
  projection: Doc<"productSkuSearch">;
  suppressedPendingCheckoutItemIds?: Array<Id<"posPendingCheckoutItem">>;
  suppressedPendingCheckoutLocalEventIds?: string[];
}): RegisterCatalogRow {
  const linkedPendingCheckoutItemIds =
    args.linkedPendingCheckoutItemIds?.filter(Boolean) ?? [];
  const linkedPendingCheckoutLocalEventIds =
    args.linkedPendingCheckoutLocalEventIds?.filter(Boolean) ?? [];
  const suppressedPendingCheckoutItemIds =
    args.suppressedPendingCheckoutItemIds?.filter(Boolean) ?? [];
  const suppressedPendingCheckoutLocalEventIds =
    args.suppressedPendingCheckoutLocalEventIds?.filter(Boolean) ?? [];
  const pendingCheckoutItemId = args.pendingCheckoutItem?._id;

  return {
    id: args.projection.productSkuId,
    productSkuId: args.projection.productSkuId,
    skuId: args.projection.productSkuId,
    productId: args.projection.productId,
    ...(pendingCheckoutItemId ? { pendingCheckoutItemId } : {}),
    ...(linkedPendingCheckoutItemIds.length > 0
        ? {
            linkedPendingCheckoutItemIds,
            ...(linkedPendingCheckoutLocalEventIds.length > 0
              ? { linkedPendingCheckoutLocalEventIds }
              : {}),
          }
        : {}),
    ...(suppressedPendingCheckoutItemIds.length > 0
      ? { suppressedPendingCheckoutItemIds }
      : {}),
    ...(suppressedPendingCheckoutLocalEventIds.length > 0
      ? { suppressedPendingCheckoutLocalEventIds }
      : {}),
    name: args.projection.productName,
    sku: args.projection.sku ?? "",
    barcode: args.projection.barcode ?? "",
    price:
      args.pendingCheckoutItem?.provisionalPrice ??
      getRegisterCatalogProjectionPrice(args.projection),
    category: args.projection.categoryName ?? "",
    description: args.projection.productDescription ?? "",
    image: args.projection.images[0] ?? null,
    size: args.projection.size ?? "",
    length: args.projection.length ?? null,
    color: args.projection.colorName ?? "",
    areProcessingFeesAbsorbed:
      args.projection.productProcessingFeesAbsorbed ?? false,
    availabilityPolicy: args.pendingCheckoutItem
      ? "pending_checkout"
      : "trusted_inventory",
  };
}

function mapLinkedPendingCheckoutAliasToRegisterCatalogRow(args: {
  item: LinkedPendingCheckoutItem;
  projection: Doc<"productSkuSearch">;
}): RegisterCatalogRow {
  const linkedPendingCheckoutLocalEventIds =
    args.item.evidence.localEventIds?.filter(Boolean) ?? [];

  return {
    id: args.projection.productSkuId,
    catalogRowKey: `pending-checkout-alias:${args.item._id}`,
    productSkuId: args.projection.productSkuId,
    skuId: args.projection.productSkuId,
    productId: args.projection.productId,
    pendingCheckoutItemId: args.item._id,
    pendingCheckoutAliasState: "linked_to_catalog",
    linkedPendingCheckoutItemIds: [args.item._id],
    ...(linkedPendingCheckoutLocalEventIds.length > 0
      ? { linkedPendingCheckoutLocalEventIds }
      : {}),
    ...(args.item.lookupCode
      ? { pendingCheckoutAliasLookupCode: args.item.lookupCode }
      : {}),
    pendingCheckoutAliasName: args.item.name,
    pendingCheckoutAliasPrice: args.item.provisionalPrice,
    pendingCheckoutAliasTrustedName: args.projection.productName,
    pendingCheckoutAliasTrustedSku: args.projection.sku ?? "",
    pendingCheckoutAliasTrustedCategory: args.projection.categoryName ?? "",
    pendingCheckoutAliasTrustedDescription:
      args.projection.productDescription ?? "",
    name: args.item.name,
    sku: args.item.lookupCode ?? args.projection.sku ?? "",
    barcode: args.projection.barcode ?? "",
    price: args.item.provisionalPrice,
    category: "Pending checkout",
    description: args.projection.productDescription ?? "",
    image: args.projection.images[0] ?? null,
    size: args.projection.size ?? "",
    length: args.projection.length ?? null,
    color: args.projection.colorName ?? "",
    areProcessingFeesAbsorbed:
      args.projection.productProcessingFeesAbsorbed ?? false,
    availabilityPolicy: "trusted_inventory",
  };
}

function mapSuppressedPendingCheckoutItemToRegisterCatalogRow(args: {
  item: PosPendingCheckoutItem | LinkedPendingCheckoutItem;
  product: Doc<"product">;
  sku: Doc<"productSku">;
}): RegisterCatalogRow {
  const suppressedLocalEventIds =
    args.item.evidence.localEventIds?.filter(Boolean) ?? [];

  return {
    id: args.sku._id,
    catalogRowKey: `suppressed-pending-checkout:${args.item._id}`,
    productSkuId: args.sku._id,
    skuId: args.sku._id,
    productId: args.product._id,
    pendingCheckoutItemId: args.item._id,
    suppressedPendingCheckoutItemIds: [args.item._id],
    ...(suppressedLocalEventIds.length > 0
      ? { suppressedPendingCheckoutLocalEventIds: suppressedLocalEventIds }
      : {}),
    name: args.item.name,
    sku: args.item.lookupCode ?? args.sku.sku ?? "",
    barcode: args.sku.barcode ?? "",
    price: args.item.provisionalPrice,
    category: "Pending checkout",
    description: args.product.description ?? "",
    image: args.sku.images?.[0] ?? null,
    size: args.sku.size ?? "",
    length: args.sku.length ?? null,
    color: "",
    areProcessingFeesAbsorbed: false,
    availabilityPolicy: "pending_checkout",
    suppressFromRegisterSearch: true,
  };
}

function mapProvisionalSkuToRegisterCatalogRow(
  provisionalSku: InventoryImportProvisionalSku,
  projection?: Doc<"productSkuSearch">,
): RegisterCatalogRow | null {
  if (!provisionalSku.productId || !provisionalSku.productSkuId) {
    return null;
  }

  return {
    id: provisionalSku._id,
    productSkuId: provisionalSku.productSkuId,
    skuId: provisionalSku.productSkuId,
    productId: provisionalSku.productId,
    inventoryImportProvisionalSkuId: provisionalSku._id,
    name: provisionalSku.importedProductName,
    sku: projection?.sku || provisionalSku.importedSku || "",
    barcode: projection?.barcode || provisionalSku.importedBarcode || "",
    price: provisionalSku.importedPrice,
    category: projection?.categoryName ?? provisionalSku.importedCategory ?? "",
    description: projection?.productDescription ?? "",
    image: projection?.images[0] ?? null,
    size: projection?.size ?? provisionalSku.importedSize ?? "",
    length: projection?.length ?? provisionalSku.importedLength ?? null,
    color: projection?.colorName ?? provisionalSku.importedColor ?? "",
    areProcessingFeesAbsorbed:
      projection?.productProcessingFeesAbsorbed ?? false,
    availabilityPolicy: "active_provisional_import",
  };
}

function getRegisterCatalogPrice(sku: Doc<"productSku">) {
  return sku.netPrice ?? sku.price;
}

function getRegisterCatalogProjectionPrice(
  projection: Doc<"productSkuSearch">,
) {
  return projection.netPrice ?? projection.price;
}

export function isTrustedRegisterCatalogSku(args: {
  product: Doc<"product">;
  sku: Doc<"productSku">;
  category?: Doc<"category"> | null;
}) {
  const isReservedPosOperationalProduct = args.category?.slug
    ? POS_OPERATIONAL_CATEGORY_SLUGS.has(args.category.slug)
    : false;
  const isDraftAllowed = isDraftAllowedInTrustedRegisterCatalog(
    args.category?.slug,
  );

  return (
    args.product.availability !== "archived" &&
    (args.product.availability !== "draft" || isDraftAllowed) &&
    (isPosCatalogVisible(args.product) || isReservedPosOperationalProduct) &&
    (isPosCatalogVisible(args.sku) || isDraftAllowed)
  );
}

function isTrustedRegisterCatalogProjection(
  projection: Doc<"productSkuSearch">,
) {
  const isReservedPosOperationalProduct = projection.categorySlug
    ? POS_OPERATIONAL_CATEGORY_SLUGS.has(projection.categorySlug)
    : false;
  const isDraftAllowed = isDraftAllowedInTrustedRegisterCatalog(
    projection.categorySlug,
  );

  return (
    projection.productAvailability !== "archived" &&
    (projection.productAvailability !== "draft" || isDraftAllowed) &&
    (isProjectionProductPosCatalogVisible(projection) ||
      isReservedPosOperationalProduct) &&
    (isProjectionSkuPosCatalogVisible(projection) || isDraftAllowed)
  );
}

async function listScopedRegisterCatalogProjections(
  ctx: QueryCtx,
  args: {
    activeProvisionalProductSkuIds: Set<Id<"productSku">>;
    linkedPendingCheckoutProvisionalProductSkuIds?: Set<Id<"productSku">>;
    suppressedPendingCheckoutProvisionalProductSkuIds?: Set<Id<"productSku">>;
    storeId: Id<"store">;
  },
) {
  const rows: Array<Doc<"productSkuSearch">> = [];
  const projectionsBySkuId = new Map<
    Id<"productSku">,
    Doc<"productSkuSearch">
  >();
  const seenSkuIds = new Set<Id<"productSku">>();
  // Convex allows only one paginated query per function; this POS snapshot must read the store catalog in one query.
  // eslint-disable-next-line @convex-dev/no-collect-in-query
  const projections = await ctx.db
    .query("productSkuSearch")
    .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
    .collect();

  for (const projection of projections.sort(
    (left, right) => left.productSkuCreationTime - right.productSkuCreationTime,
  )) {
    if (seenSkuIds.has(projection.productSkuId)) {
      continue;
    }
    seenSkuIds.add(projection.productSkuId);
    projectionsBySkuId.set(projection.productSkuId, projection);

    if (
      args.linkedPendingCheckoutProvisionalProductSkuIds?.has(
        projection.productSkuId,
      )
    ) {
      continue;
    }
    if (
      args.suppressedPendingCheckoutProvisionalProductSkuIds?.has(
        projection.productSkuId,
      )
    ) {
      continue;
    }

    if (!isTrustedRegisterCatalogProjection(projection)) {
      continue;
    }

    if (
      projection.categorySlug === "legacy-import" &&
      (projection.productAvailability === "draft" ||
        !isProjectionProductPosCatalogVisible(projection) ||
        !isProjectionSkuPosCatalogVisible(projection)) &&
      args.activeProvisionalProductSkuIds.has(projection.productSkuId)
    ) {
      continue;
    }

    if (getRegisterCatalogProjectionPrice(projection) <= 0) {
      continue;
    }

    rows.push(projection);
  }

  return { projectionsBySkuId, rows };
}

async function listScopedRegisterCatalogAvailabilitySkus(
  ctx: QueryCtx,
  args: {
    activeProvisionalProductSkuIds: Set<Id<"productSku">>;
    storeId: Id<"store">;
  },
) {
  const rows: Array<Doc<"productSku">> = [];
  const categoryCache = new Map<Id<"category">, Doc<"category"> | null>();
  const productCache = new Map<Id<"product">, Doc<"product"> | null>();
  // Convex allows only one paginated query per function; this POS snapshot must read the store catalog in one query.
  // eslint-disable-next-line @convex-dev/no-collect-in-query
  const skus = await ctx.db
    .query("productSku")
    .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
    .collect();

  for (const sku of skus) {
    if (getRegisterCatalogPrice(sku) <= 0) {
      continue;
    }

    let product = productCache.get(sku.productId);

    if (product === undefined) {
      product = (await ctx.db.get("product", sku.productId)) ?? null;
      productCache.set(sku.productId, product);
    }

    if (!product || product.storeId !== args.storeId) {
      continue;
    }

    const needsOperationalCategoryCheck =
      product.availability === "draft" ||
      !isPosCatalogVisible(product) ||
      !isPosCatalogVisible(sku);
    const category = needsOperationalCategoryCheck
      ? await readCategoryDoc(ctx, categoryCache, product.categoryId)
      : null;

    if (!isTrustedRegisterCatalogSku({ product, sku, category })) {
      continue;
    }

    if (
      category?.slug === "legacy-import" &&
      args.activeProvisionalProductSkuIds.has(sku._id)
    ) {
      continue;
    }

    rows.push(sku);
  }

  return rows;
}

function isActiveProvisionalImportSkuForStore(
  row: InventoryImportProvisionalSku | null,
  args: {
    storeId: Id<"store">;
    productId?: Id<"product">;
    productSkuId?: Id<"productSku">;
  },
) {
  return (
    row?.storeId === args.storeId &&
    row.status === "active" &&
    row.posExposureStatus === "available" &&
    (!args.productId || row.productId === args.productId) &&
    (!args.productSkuId || row.productSkuId === args.productSkuId)
  );
}

async function queryActiveProvisionalImportSkusForStore(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
  },
): Promise<InventoryImportProvisionalSku[]> {
  const db = ctx.db as unknown as {
    query(table: "inventoryImportProvisionalSku"): {
      withIndex(
        index: "by_storeId_status",
        apply: (q: ProvisionalIndexBuilder<"storeId" | "status">) => unknown,
      ): {
        take(limit: number): Promise<InventoryImportProvisionalSku[]>;
      };
    };
  };

  const rows = await db
    .query("inventoryImportProvisionalSku")
    .withIndex("by_storeId_status", (q) =>
      q.eq("storeId", args.storeId).eq("status", "active"),
    )
    .take(REGISTER_CATALOG_PROVISIONAL_IMPORT_LIMIT);

  return rows.filter((row) =>
    isActiveProvisionalImportSkuForStore(row, { storeId: args.storeId }),
  );
}

export async function readActiveProvisionalImportSkuForStoreSku(
  ctx: Pick<QueryCtx, "db">,
  args: {
    storeId: Id<"store">;
    productId?: Id<"product">;
    productSkuId: Id<"productSku">;
    provisionalSkuId?: InventoryImportProvisionalSkuId;
  },
): Promise<InventoryImportProvisionalSku | null> {
  const db = ctx.db as unknown as {
    get(
      table: "inventoryImportProvisionalSku",
      id: InventoryImportProvisionalSkuId,
    ): Promise<InventoryImportProvisionalSku | null>;
    query(table: "inventoryImportProvisionalSku"): {
      withIndex(
        index: "by_storeId_productSkuId_status",
        apply: (
          q: ProvisionalIndexBuilder<"storeId" | "productSkuId" | "status">,
        ) => unknown,
      ): {
        first(): Promise<InventoryImportProvisionalSku | null>;
      };
    };
  };

  if (args.provisionalSkuId) {
    const row = await db.get(
      "inventoryImportProvisionalSku",
      args.provisionalSkuId,
    );
    return isActiveProvisionalImportSkuForStore(row, args) ? row : null;
  }

  const row = await db
    .query("inventoryImportProvisionalSku")
    .withIndex("by_storeId_productSkuId_status", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("productSkuId", args.productSkuId)
        .eq("status", "active"),
    )
    .first();

  return isActiveProvisionalImportSkuForStore(row, args) ? row : null;
}

async function queryActivePendingCheckoutItemsForStore(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
  },
) {
  const statuses: Array<Doc<"posPendingCheckoutItem">["status"]> = [
    "pending_review",
    "flagged",
  ];
  const rows = await Promise.all(
    statuses.map((status) =>
      ctx.db
        .query("posPendingCheckoutItem")
        .withIndex("by_storeId_status_updatedAt", (q) =>
          q.eq("storeId", args.storeId).eq("status", status),
        )
        .take(5_000),
    ),
  );

  return rows.flat();
}

async function queryLinkedPendingCheckoutItemsForStore(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
  },
) {
  return ctx.db
    .query("posPendingCheckoutItem")
    .withIndex("by_storeId_status_approvedProductSkuId", (q) =>
      q.eq("storeId", args.storeId).eq("status", "linked_to_catalog"),
    )
    .take(5_000);
}

async function isLinkedPendingCheckoutAliasVisible(
  ctx: QueryCtx,
  args: {
    item: LinkedPendingCheckoutItem;
    productCache: Map<Id<"product">, Doc<"product"> | null>;
    skuCache: Map<Id<"productSku">, Doc<"productSku"> | null>;
    storeId: Id<"store">;
  },
) {
  let productId = args.item.provisionalProductId;

  if (args.item.provisionalProductSkuId) {
    let sku = args.skuCache.get(args.item.provisionalProductSkuId);
    if (sku === undefined) {
      sku = await ctx.db.get("productSku", args.item.provisionalProductSkuId);
      args.skuCache.set(args.item.provisionalProductSkuId, sku);
    }
    if (!sku || sku.storeId !== args.storeId) {
      return false;
    }
    productId = sku.productId;
  }

  if (!productId) {
    return true;
  }

  let product = args.productCache.get(productId);
  if (product === undefined) {
    product = await ctx.db.get("product", productId);
    args.productCache.set(productId, product);
  }

  return (
    product !== null &&
    product.storeId === args.storeId &&
    product.availability !== "archived"
  );
}

async function isLinkedPendingCheckoutApprovedSkuVisible(
  ctx: QueryCtx,
  args: {
    item: LinkedPendingCheckoutItem;
    categoryCache: Map<Id<"category">, Doc<"category"> | null>;
    productCache: Map<Id<"product">, Doc<"product"> | null>;
    skuCache: Map<Id<"productSku">, Doc<"productSku"> | null>;
    storeId: Id<"store">;
  },
) {
  if (!args.item.approvedProductSkuId) {
    return false;
  }

  let sku = args.skuCache.get(args.item.approvedProductSkuId);
  if (sku === undefined) {
    sku = await ctx.db.get("productSku", args.item.approvedProductSkuId);
    args.skuCache.set(args.item.approvedProductSkuId, sku);
  }
  if (!sku || sku.storeId !== args.storeId) {
    return false;
  }

  let product = args.productCache.get(sku.productId);
  if (product === undefined) {
    product = await ctx.db.get("product", sku.productId);
    args.productCache.set(sku.productId, product);
  }
  if (!product || product.storeId !== args.storeId) {
    return false;
  }

  const category = await readCategoryDoc(
    ctx,
    args.categoryCache,
    product.categoryId,
  );

  return isTrustedRegisterCatalogSku({
    category,
    product,
    sku,
  });
}

async function isPendingCheckoutItemVisible(
  ctx: QueryCtx,
  args: {
    item: Pick<
      Doc<"posPendingCheckoutItem">,
      "provisionalProductId" | "provisionalProductSkuId"
    >;
    productCache: Map<Id<"product">, Doc<"product"> | null>;
    skuCache: Map<Id<"productSku">, Doc<"productSku"> | null>;
    storeId: Id<"store">;
  },
) {
  let productId = args.item.provisionalProductId;

  if (args.item.provisionalProductSkuId) {
    let sku = args.skuCache.get(args.item.provisionalProductSkuId);
    if (sku === undefined) {
      sku = await ctx.db.get("productSku", args.item.provisionalProductSkuId);
      args.skuCache.set(args.item.provisionalProductSkuId, sku);
    }
    if (!sku || sku.storeId !== args.storeId) {
      return false;
    }
    productId = sku.productId;
  }

  if (!productId) {
    return true;
  }

  let product = args.productCache.get(productId);
  if (product === undefined) {
    product = await ctx.db.get("product", productId);
    args.productCache.set(productId, product);
  }

  return (
    product !== null &&
    product.storeId === args.storeId &&
    product.availability !== "archived"
  );
}

async function readActivePendingCheckoutItemForStoreSku(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
    productSkuId: Id<"productSku">;
  },
): Promise<PosPendingCheckoutItem | null> {
  const row = await ctx.db
    .query("posPendingCheckoutItem")
    .withIndex("by_storeId_provisionalProductSkuId", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("provisionalProductSkuId", args.productSkuId),
    )
    .first();

  return row?.status === "pending_review" || row?.status === "flagged"
    ? row
    : null;
}

async function readActiveLegacyImportProvisionalPolicyRow(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
    sku: Doc<"productSku">;
  },
) {
  const product = await ctx.db.get("product", args.sku.productId);
  const category =
    product?.storeId === args.storeId
      ? await ctx.db.get("category", product.categoryId)
      : null;

  if (
    category?.slug !== "legacy-import" ||
    !product ||
    product.availability === "archived" ||
    (product.availability !== "draft" &&
      isPosCatalogVisible(product) &&
      isPosCatalogVisible(args.sku))
  ) {
    return null;
  }

  return readActiveProvisionalImportSkuForStoreSku(ctx, {
    storeId: args.storeId,
    productId: product._id,
    productSkuId: args.sku._id,
  });
}

type ProvisionalIndexBuilder<TField extends string> = {
  eq(field: TField, value: unknown): ProvisionalIndexBuilder<TField>;
};

export async function listRegisterCatalog(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
  },
) {
  const rows: RegisterCatalogRow[] = [];
  const activeProvisionalSkus = await queryActiveProvisionalImportSkusForStore(
    ctx,
    args,
  );
  const activeProvisionalProductSkuIds = new Set(
    activeProvisionalSkus.flatMap((row) =>
      row.productSkuId ? [row.productSkuId] : [],
    ),
  );
  const pendingCheckoutItemSkuCache = new Map<
    Id<"productSku">,
    Doc<"productSku"> | null
  >();
  const pendingCheckoutItemProductCache = new Map<
    Id<"product">,
    Doc<"product"> | null
  >();
  const visiblePendingCheckoutItems = [];
  const suppressedPendingCheckoutRows: RegisterCatalogRow[] = [];
  const suppressedPendingCheckoutProvisionalProductSkuIds = new Set<
    Id<"productSku">
  >();
  for (const item of await queryActivePendingCheckoutItemsForStore(ctx, args)) {
    const visible = await isPendingCheckoutItemVisible(ctx, {
      item,
      productCache: pendingCheckoutItemProductCache,
      skuCache: pendingCheckoutItemSkuCache,
      storeId: args.storeId,
    });
    if (visible) {
      visiblePendingCheckoutItems.push(item);
      continue;
    }

    if (item.provisionalProductSkuId) {
      suppressedPendingCheckoutProvisionalProductSkuIds.add(
        item.provisionalProductSkuId,
      );
      const sku = pendingCheckoutItemSkuCache.get(item.provisionalProductSkuId);
      const product = sku?.productId
        ? pendingCheckoutItemProductCache.get(sku.productId)
        : item.provisionalProductId
          ? pendingCheckoutItemProductCache.get(item.provisionalProductId)
          : null;
      if (sku && product) {
        suppressedPendingCheckoutRows.push(
          mapSuppressedPendingCheckoutItemToRegisterCatalogRow({
            item,
            product,
            sku,
          }),
        );
      }
    }
  }
  const pendingCheckoutItemsBySkuId = new Map(
    visiblePendingCheckoutItems.flatMap((item) =>
      item.provisionalProductSkuId
        ? [[item.provisionalProductSkuId, item]]
        : [],
    ),
  );
  const linkedPendingCheckoutItemIdsBySkuId = new Map<
    Id<"productSku">,
    Array<Id<"posPendingCheckoutItem">>
  >();
  const linkedPendingCheckoutLocalEventIdsBySkuId = new Map<
    Id<"productSku">,
    string[]
  >();
  const suppressedPendingCheckoutItemIdsBySkuId = new Map<
    Id<"productSku">,
    Array<Id<"posPendingCheckoutItem">>
  >();
  const suppressedPendingCheckoutLocalEventIdsBySkuId = new Map<
    Id<"productSku">,
    string[]
  >();
  const linkedPendingCheckoutItemsBySkuId = new Map<
    Id<"productSku">,
    LinkedPendingCheckoutItem[]
  >();
  const linkedPendingCheckoutProvisionalProductSkuIds = new Set<
    Id<"productSku">
  >();
  const linkedPendingCheckoutSkuCache = new Map<
    Id<"productSku">,
    Doc<"productSku"> | null
  >();
  const linkedPendingCheckoutProductCache = new Map<
    Id<"product">,
    Doc<"product"> | null
  >();
  const linkedPendingCheckoutCategoryCache = new Map<
    Id<"category">,
    Doc<"category"> | null
  >();
  const suppressLinkedPendingCheckoutItem = async (
    item: LinkedPendingCheckoutItem,
  ) => {
    if (item.provisionalProductSkuId) {
      suppressedPendingCheckoutProvisionalProductSkuIds.add(
        item.provisionalProductSkuId,
      );
      let sku = linkedPendingCheckoutSkuCache.get(item.provisionalProductSkuId);
      if (sku === undefined) {
        sku = await ctx.db.get("productSku", item.provisionalProductSkuId);
        linkedPendingCheckoutSkuCache.set(item.provisionalProductSkuId, sku);
      }
      const productId = sku?.productId ?? item.provisionalProductId;
      let product = productId
        ? linkedPendingCheckoutProductCache.get(productId)
        : null;
      if (productId && product === undefined) {
        product = await ctx.db.get("product", productId);
        linkedPendingCheckoutProductCache.set(productId, product);
      }
      if (sku && product) {
        suppressedPendingCheckoutRows.push(
          mapSuppressedPendingCheckoutItemToRegisterCatalogRow({
            item,
            product,
            sku,
          }),
        );
      }
    }

    if (!item.approvedProductSkuId) {
      return;
    }

    const suppressedIds =
      suppressedPendingCheckoutItemIdsBySkuId.get(item.approvedProductSkuId) ??
      [];
    suppressedIds.push(item._id);
    suppressedPendingCheckoutItemIdsBySkuId.set(
      item.approvedProductSkuId,
      suppressedIds,
    );
    const suppressedLocalEventIds =
      suppressedPendingCheckoutLocalEventIdsBySkuId.get(
        item.approvedProductSkuId,
      ) ?? [];
    suppressedLocalEventIds.push(...(item.evidence.localEventIds ?? []));
    suppressedPendingCheckoutLocalEventIdsBySkuId.set(
      item.approvedProductSkuId,
      suppressedLocalEventIds,
    );
  };
  for (const item of await queryLinkedPendingCheckoutItemsForStore(ctx, args)) {
    if (!item.approvedProductSkuId) {
      continue;
    }
    const aliasVisible = await isLinkedPendingCheckoutAliasVisible(ctx, {
      item,
      productCache: linkedPendingCheckoutProductCache,
      skuCache: linkedPendingCheckoutSkuCache,
      storeId: args.storeId,
    });
    if (!aliasVisible) {
      await suppressLinkedPendingCheckoutItem(item);
      continue;
    }

    const approvedSkuVisible = await isLinkedPendingCheckoutApprovedSkuVisible(
      ctx,
      {
        item,
        categoryCache: linkedPendingCheckoutCategoryCache,
        productCache: linkedPendingCheckoutProductCache,
        skuCache: linkedPendingCheckoutSkuCache,
        storeId: args.storeId,
      },
    );
    if (!approvedSkuVisible) {
      await suppressLinkedPendingCheckoutItem(item);
      continue;
    }
    if (item.provisionalProductSkuId) {
      linkedPendingCheckoutProvisionalProductSkuIds.add(
        item.provisionalProductSkuId,
      );
    }
    const linkedItems =
      linkedPendingCheckoutItemsBySkuId.get(item.approvedProductSkuId) ?? [];
    linkedItems.push(item);
    linkedPendingCheckoutItemsBySkuId.set(
      item.approvedProductSkuId,
      linkedItems,
    );
    const linkedIds =
      linkedPendingCheckoutItemIdsBySkuId.get(item.approvedProductSkuId) ?? [];
    linkedIds.push(item._id);
    linkedPendingCheckoutItemIdsBySkuId.set(
      item.approvedProductSkuId,
      linkedIds,
    );
    const linkedLocalEventIds =
      linkedPendingCheckoutLocalEventIdsBySkuId.get(
        item.approvedProductSkuId,
      ) ?? [];
    linkedLocalEventIds.push(...(item.evidence.localEventIds ?? []));
    linkedPendingCheckoutLocalEventIdsBySkuId.set(
      item.approvedProductSkuId,
      linkedLocalEventIds,
    );
  }
  const trustedAvailableSkuIds = new Set<Id<"productSku">>();

  const catalogProjectionSnapshot = await listScopedRegisterCatalogProjections(
    ctx,
    {
      activeProvisionalProductSkuIds,
      linkedPendingCheckoutProvisionalProductSkuIds,
      suppressedPendingCheckoutProvisionalProductSkuIds,
      storeId: args.storeId,
    },
  );

  for (const projection of catalogProjectionSnapshot.rows) {
    if (projection.quantityAvailable > 0) {
      trustedAvailableSkuIds.add(projection.productSkuId);
    }
    const linkedPendingCheckoutItems = linkedPendingCheckoutItemsBySkuId.get(
      projection.productSkuId,
    );
    rows.push(
      mapProjectionToRegisterCatalogRow({
        projection,
        linkedPendingCheckoutItemIds: linkedPendingCheckoutItemIdsBySkuId.get(
          projection.productSkuId,
        ),
        linkedPendingCheckoutLocalEventIds:
          linkedPendingCheckoutLocalEventIdsBySkuId.get(
            projection.productSkuId,
          ),
        suppressedPendingCheckoutItemIds:
          suppressedPendingCheckoutItemIdsBySkuId.get(projection.productSkuId),
        suppressedPendingCheckoutLocalEventIds:
          suppressedPendingCheckoutLocalEventIdsBySkuId.get(
            projection.productSkuId,
          ),
        pendingCheckoutItem: pendingCheckoutItemsBySkuId.get(
          projection.productSkuId,
        ),
      }),
    );
    if (linkedPendingCheckoutItems && linkedPendingCheckoutItems.length > 0) {
      for (const item of linkedPendingCheckoutItems) {
        rows.push(
          mapLinkedPendingCheckoutAliasToRegisterCatalogRow({
            item,
            projection,
          }),
        );
      }
    }
  }

  for (const provisionalSku of activeProvisionalSkus) {
    if (
      !provisionalSku.productSkuId ||
      trustedAvailableSkuIds.has(provisionalSku.productSkuId) ||
      provisionalSku.importedPrice <= 0
    ) {
      continue;
    }

    const projection = catalogProjectionSnapshot.projectionsBySkuId.get(
      provisionalSku.productSkuId,
    );
    if (projection?.productAvailability === "archived") {
      continue;
    }

    const row = mapProvisionalSkuToRegisterCatalogRow(
      provisionalSku,
      projection,
    );
    if (row) {
      rows.push(row);
    }
  }

  return rows.concat(suppressedPendingCheckoutRows);
}

export async function listRegisterCatalogAvailability(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
    productSkuIds: Array<Id<"productSku">>;
  },
) {
  const requestedSkuIds = Array.from(new Set(args.productSkuIds)).slice(
    0,
    REGISTER_CATALOG_AVAILABILITY_LIMIT,
  );
  const rows: RegisterCatalogAvailabilityRow[] = [];

  for (const productSkuId of requestedSkuIds) {
    const sku = await ctx.db.get("productSku", productSkuId);

    if (!sku || sku.storeId !== args.storeId) {
      continue;
    }

    const product = await ctx.db.get("product", sku.productId);

    if (
      product &&
      (product.storeId !== args.storeId || product.availability === "archived")
    ) {
      continue;
    }

    const availability = await validateInventoryAvailability(
      ctx.db,
      sku._id,
      1,
      {
        storeId: args.storeId,
      },
    );
    const quantityAvailable = availability.available ?? 0;

    const activeLegacyImportProvisionalPolicy =
      await readActiveLegacyImportProvisionalPolicyRow(ctx, {
        storeId: args.storeId,
        sku,
      });
    if (activeLegacyImportProvisionalPolicy) {
      rows.push({
        productSkuId: sku._id,
        skuId: sku._id,
        inventoryImportProvisionalSkuId:
          activeLegacyImportProvisionalPolicy._id,
        inStock: true,
        quantityAvailable: 0,
        availabilityPolicy: "active_provisional_import",
      });
      continue;
    }

    if (quantityAvailable > 0) {
      rows.push({
        productSkuId: sku._id,
        skuId: sku._id,
        inStock: true,
        quantityAvailable,
        availabilityPolicy: "trusted_inventory",
      });
      continue;
    }

    const provisionalSku = await readActiveProvisionalImportSkuForStoreSku(
      ctx,
      {
        storeId: args.storeId,
        productId: product?._id ?? sku.productId,
        productSkuId: sku._id,
      },
    );
    if (provisionalSku) {
      rows.push({
        productSkuId: sku._id,
        skuId: sku._id,
        inventoryImportProvisionalSkuId: provisionalSku._id,
        inStock: true,
        quantityAvailable: 0,
        availabilityPolicy: "active_provisional_import",
      });
      continue;
    }

    const pendingCheckoutItem = await readActivePendingCheckoutItemForStoreSku(
      ctx,
      {
        storeId: args.storeId,
        productSkuId: sku._id,
      },
    );
    if (pendingCheckoutItem) {
      rows.push({
        productSkuId: sku._id,
        skuId: sku._id,
        inStock: true,
        quantityAvailable: 0,
        availabilityPolicy: "pending_checkout",
      });
      continue;
    }

    rows.push({
      productSkuId: sku._id,
      skuId: sku._id,
      inStock: quantityAvailable > 0,
      quantityAvailable,
      availabilityPolicy: "trusted_inventory",
    });
  }

  return rows;
}

export async function listRegisterCatalogAvailabilitySnapshot(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
  },
) {
  const activeProvisionalSkus = await queryActiveProvisionalImportSkusForStore(
    ctx,
    args,
  );
  const activeProvisionalProductSkuIds = new Set(
    activeProvisionalSkus.map((row) => row.productSkuId),
  );
  const catalogSkus = await listScopedRegisterCatalogAvailabilitySkus(ctx, {
    activeProvisionalProductSkuIds,
    storeId: args.storeId,
  });
  const heldQuantities = await readActiveHeldQuantitiesForStoreSkus(ctx.db, {
    storeId: args.storeId,
    skuIds: catalogSkus.map((sku) => sku._id),
  });
  const pendingCheckoutItemsBySkuId = new Map(
    (await queryActivePendingCheckoutItemsForStore(ctx, args)).flatMap(
      (item) =>
        item.provisionalProductSkuId
          ? [[item.provisionalProductSkuId, item]]
          : [],
    ),
  );

  const trustedRows = catalogSkus.map((sku): RegisterCatalogAvailabilityRow => {
    const pendingCheckoutItem = pendingCheckoutItemsBySkuId.get(sku._id);
    if (pendingCheckoutItem) {
      return {
        productSkuId: sku._id,
        skuId: sku._id,
        inStock: true,
        quantityAvailable: 0,
        availabilityPolicy: "pending_checkout",
      };
    }

    const quantityAvailable = Math.max(
      0,
      sku.quantityAvailable - (heldQuantities.get(sku._id) ?? 0),
    );

    return {
      productSkuId: sku._id,
      skuId: sku._id,
      inStock: quantityAvailable > 0,
      quantityAvailable,
      availabilityPolicy: "trusted_inventory",
    };
  });

  const trustedAvailableSkuIds = new Set(
    trustedRows
      .filter((row) => row.quantityAvailable > 0)
      .map((row) => row.productSkuId),
  );
  const provisionalRows: RegisterCatalogAvailabilityRow[] = [];
  for (const provisionalSku of activeProvisionalSkus) {
    if (trustedAvailableSkuIds.has(provisionalSku.productSkuId)) {
      continue;
    }

    const sku = await ctx.db.get("productSku", provisionalSku.productSkuId);
    if (!sku || sku.storeId !== args.storeId) {
      continue;
    }
    const product = await ctx.db.get("product", sku.productId);
    if (
      product &&
      (product.storeId !== args.storeId || product.availability === "archived")
    ) {
      continue;
    }
    provisionalRows.push({
      productSkuId: sku._id,
      skuId: sku._id,
      inventoryImportProvisionalSkuId: provisionalSku._id,
      inStock: true,
      quantityAvailable: 0,
      availabilityPolicy: "active_provisional_import",
    });
  }

  return trustedRows.concat(provisionalRows);
}
