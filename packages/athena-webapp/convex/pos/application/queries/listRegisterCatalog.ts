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
  importedPrice: number;
  importedQuantity: number;
  provisionalQuantitySold?: number;
  provisionalTransactionCount?: number;
};

type PosPendingCheckoutItem = Pick<
  Doc<"posPendingCheckoutItem">,
  "_id" | "provisionalProductSkuId" | "provisionalPrice" | "status" | "storeId"
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

async function readCategoryName(
  ctx: QueryCtx,
  cache: Map<Id<"category">, string>,
  categoryId: Id<"category">,
) {
  const cached = cache.get(categoryId);
  if (cached !== undefined) {
    return cached;
  }

  const category = await ctx.db.get("category", categoryId);
  const name = category?.name ?? "";
  cache.set(categoryId, name);

  return name;
}

async function readColorName(
  ctx: QueryCtx,
  cache: Map<Id<"color">, string>,
  colorId: Id<"color"> | undefined,
) {
  if (!colorId) {
    return "";
  }

  const cached = cache.get(colorId);
  if (cached !== undefined) {
    return cached;
  }

  const color = await ctx.db.get("color", colorId);
  const name = color?.name ?? "";
  cache.set(colorId, name);

  return name;
}

function mapSkuToRegisterCatalogRow(args: {
  product: Doc<"product">;
  sku: Doc<"productSku">;
  category: string;
  color: string;
  pendingCheckoutItem?: PosPendingCheckoutItem;
  provisionalSku?: InventoryImportProvisionalSku;
}): RegisterCatalogRow {
  return {
    id: args.provisionalSku?._id ?? args.sku._id,
    productSkuId: args.sku._id,
    skuId: args.sku._id,
    productId: args.product._id,
    ...(args.provisionalSku
      ? { inventoryImportProvisionalSkuId: args.provisionalSku._id }
      : {}),
    ...(args.pendingCheckoutItem
      ? { pendingCheckoutItemId: args.pendingCheckoutItem._id }
      : {}),
    name: args.provisionalSku?.importedProductName ?? args.product.name,
    sku: args.sku.sku || args.provisionalSku?.importedSku || "",
    barcode: args.sku.barcode || args.provisionalSku?.importedBarcode || "",
    price:
      args.pendingCheckoutItem?.provisionalPrice ??
      args.provisionalSku?.importedPrice ??
      getRegisterCatalogPrice(args.sku),
    category: args.category,
    description: args.product.description ?? "",
    image: args.sku.images[0] ?? null,
    size: args.sku.size ?? "",
    length: args.sku.length ?? null,
    color: args.color,
    areProcessingFeesAbsorbed: args.product.areProcessingFeesAbsorbed ?? false,
    availabilityPolicy: args.pendingCheckoutItem
      ? "pending_checkout"
      : args.provisionalSku
        ? "active_provisional_import"
        : "trusted_inventory",
  };
}

function getRegisterCatalogPrice(sku: Doc<"productSku">) {
  return sku.netPrice ?? sku.price;
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

async function listScopedRegisterCatalogSkus(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
  },
) {
  const rows: Array<{ product: Doc<"product">; sku: Doc<"productSku"> }> = [];
  const productCache = new Map<Id<"product">, Doc<"product"> | null>();
  // Convex allows only one paginated query per function; this POS snapshot must read the store catalog in one query.
  // eslint-disable-next-line @convex-dev/no-collect-in-query
  const skus = await ctx.db
    .query("productSku")
    .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
    .collect();

  for (const sku of skus) {
    let product = productCache.get(sku.productId);

    if (product === undefined) {
      product = (await ctx.db.get("product", sku.productId)) ?? null;
      productCache.set(sku.productId, product);
    }

    if (!product || product.storeId !== args.storeId) {
      continue;
    }

    const category = await ctx.db.get("category", product.categoryId);

    if (!isTrustedRegisterCatalogSku({ product, sku, category })) {
      continue;
    }

    if (
      category?.slug === "legacy-import" &&
      (product.availability === "draft" ||
        product.isVisible === false ||
        sku.isVisible === false) &&
      (await readActiveProvisionalImportSkuForStoreSku(ctx, {
        storeId: args.storeId,
        productId: product._id,
        productSkuId: sku._id,
      }))
    ) {
      continue;
    }

    if (getRegisterCatalogPrice(sku) <= 0) {
      continue;
    }

    rows.push({ product, sku });
  }

  return rows;
}

async function listScopedRegisterCatalogAvailabilitySkus(
  ctx: QueryCtx,
  args: {
    activeProvisionalProductSkuIds: Set<Id<"productSku">>;
    storeId: Id<"store">;
  },
) {
  const rows: Array<Doc<"productSku">> = [];
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
      ? await ctx.db.get("category", product.categoryId)
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
  const categoryCache = new Map<Id<"category">, string>();
  const colorCache = new Map<Id<"color">, string>();
  const pendingCheckoutItemsBySkuId = new Map(
    (await queryActivePendingCheckoutItemsForStore(ctx, args)).flatMap(
      (item) =>
        item.provisionalProductSkuId
          ? [[item.provisionalProductSkuId, item]]
          : [],
    ),
  );
  const trustedAvailableSkuIds = new Set<Id<"productSku">>();

  for (const { product, sku } of await listScopedRegisterCatalogSkus(
    ctx,
    args,
  )) {
    if (sku.quantityAvailable > 0) {
      trustedAvailableSkuIds.add(sku._id);
    }
    rows.push(
      mapSkuToRegisterCatalogRow({
        product,
        sku,
        category: await readCategoryName(
          ctx,
          categoryCache,
          product.categoryId,
        ),
        color: await readColorName(ctx, colorCache, sku.color),
        pendingCheckoutItem: pendingCheckoutItemsBySkuId.get(sku._id),
      }),
    );
  }

  for (const provisionalSku of await queryActiveProvisionalImportSkusForStore(
    ctx,
    args,
  )) {
    const [product, sku] = await Promise.all([
      ctx.db.get("product", provisionalSku.productId),
      ctx.db.get("productSku", provisionalSku.productSkuId),
    ]);

    if (
      !product ||
      !sku ||
      product.storeId !== args.storeId ||
      sku.storeId !== args.storeId ||
      sku.productId !== product._id ||
      trustedAvailableSkuIds.has(provisionalSku.productSkuId) ||
      provisionalSku.importedPrice <= 0
    ) {
      continue;
    }

    rows.push(
      mapSkuToRegisterCatalogRow({
        product,
        sku,
        category: await readCategoryName(
          ctx,
          categoryCache,
          product.categoryId,
        ),
        color: await readColorName(ctx, colorCache, sku.color),
        provisionalSku,
      }),
    );
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
        productId: sku.productId,
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
