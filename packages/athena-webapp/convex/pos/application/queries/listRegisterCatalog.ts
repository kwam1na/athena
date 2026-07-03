import type { Doc, Id } from "../../../_generated/dataModel";
import type { QueryCtx } from "../../../_generated/server";
import {
  readActiveHeldQuantitiesForStoreSkus,
  validateInventoryAvailability,
} from "../../../inventory/helpers/inventoryHolds";

type InventoryImportProvisionalSkuId = Id<"inventoryImportProvisionalSku">;

type RegisterCatalogRow = {
  id: Id<"productSku"> | InventoryImportProvisionalSkuId;
  productSkuId: Id<"productSku">;
  skuId: Id<"productSku">;
  productId: Id<"product">;
  inventoryImportProvisionalSkuId?: InventoryImportProvisionalSkuId;
  pendingCheckoutItemId?: Id<"posPendingCheckoutItem">;
  pendingCheckoutAliasState?: "linked_to_catalog";
  linkedPendingCheckoutItemIds?: Array<Id<"posPendingCheckoutItem">>;
  linkedPendingCheckoutLocalEventIds?: string[];
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
  | "provisionalProductSkuId"
  | "provisionalPrice"
  | "status"
  | "storeId"
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
}): RegisterCatalogRow {
  const linkedPendingCheckoutItemIds =
    args.linkedPendingCheckoutItemIds?.filter(Boolean) ?? [];
  const linkedPendingCheckoutLocalEventIds =
    args.linkedPendingCheckoutLocalEventIds?.filter(Boolean) ?? [];
  const pendingCheckoutItemId =
    args.pendingCheckoutItem?._id ?? linkedPendingCheckoutItemIds[0];

  return {
    id: args.projection.productSkuId,
    productSkuId: args.projection.productSkuId,
    skuId: args.projection.productSkuId,
    productId: args.projection.productId,
    ...(pendingCheckoutItemId ? { pendingCheckoutItemId } : {}),
    ...(!args.pendingCheckoutItem && linkedPendingCheckoutItemIds.length > 0
      ? {
          pendingCheckoutAliasState: "linked_to_catalog" as const,
          linkedPendingCheckoutItemIds,
          ...(linkedPendingCheckoutLocalEventIds.length > 0
            ? { linkedPendingCheckoutLocalEventIds }
            : {}),
        }
      : linkedPendingCheckoutItemIds.length > 0
        ? {
            linkedPendingCheckoutItemIds,
            ...(linkedPendingCheckoutLocalEventIds.length > 0
              ? { linkedPendingCheckoutLocalEventIds }
              : {}),
          }
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
    category:
      projection?.categoryName ?? provisionalSku.importedCategory ?? "",
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

function getRegisterCatalogProjectionPrice(projection: Doc<"productSkuSearch">) {
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
    (args.product.isVisible !== false || isReservedPosOperationalProduct) &&
    (args.sku.isVisible !== false || isDraftAllowed)
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
    (projection.productIsVisible !== false || isReservedPosOperationalProduct) &&
    (projection.isVisible !== false || isDraftAllowed)
  );
}

async function listScopedRegisterCatalogProjections(
  ctx: QueryCtx,
  args: {
    activeProvisionalProductSkuIds: Set<Id<"productSku">>;
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

    if (!isTrustedRegisterCatalogProjection(projection)) {
      continue;
    }

    if (
      projection.categorySlug === "legacy-import" &&
      (projection.productAvailability === "draft" ||
        projection.productIsVisible === false ||
        projection.isVisible === false) &&
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
      product.isVisible === false ||
      sku.isVisible === false;
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
      product.isVisible !== false &&
      args.sku.isVisible !== false)
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
  const pendingCheckoutItemsBySkuId = new Map(
    (await queryActivePendingCheckoutItemsForStore(ctx, args)).flatMap(
      (item) =>
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
  for (const item of await queryLinkedPendingCheckoutItemsForStore(ctx, args)) {
    if (!item.approvedProductSkuId) {
      continue;
    }
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
      storeId: args.storeId,
    },
  );

  for (const projection of catalogProjectionSnapshot.rows) {
    if (projection.quantityAvailable > 0) {
      trustedAvailableSkuIds.add(projection.productSkuId);
    }
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
        pendingCheckoutItem: pendingCheckoutItemsBySkuId.get(
          projection.productSkuId,
        ),
      }),
    );
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

  return rows;
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
