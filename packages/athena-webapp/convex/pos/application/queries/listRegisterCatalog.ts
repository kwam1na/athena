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
  | "active_provisional_import";

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

export const REGISTER_CATALOG_AVAILABILITY_LIMIT = 50;
const REGISTER_CATALOG_PROVISIONAL_IMPORT_LIMIT = 5_000;

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
    name: args.provisionalSku?.importedProductName ?? args.product.name,
    sku: args.provisionalSku?.importedSku ?? args.sku.sku ?? "",
    barcode: args.provisionalSku?.importedBarcode ?? args.sku.barcode ?? "",
    price: args.provisionalSku?.importedPrice ?? getRegisterCatalogPrice(args.sku),
    category: args.category,
    description: args.product.description ?? "",
    image: args.sku.images[0] ?? null,
    size: args.sku.size ?? "",
    length: args.sku.length ?? null,
    color: args.color,
    areProcessingFeesAbsorbed: args.product.areProcessingFeesAbsorbed ?? false,
    availabilityPolicy: args.provisionalSku
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
}) {
  return (
    args.product.availability !== "archived" &&
    args.product.availability !== "draft" &&
    args.product.isVisible !== false &&
    args.sku.isVisible !== false
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

    if (
      !product ||
      product.storeId !== args.storeId ||
      !isTrustedRegisterCatalogSku({ product, sku })
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
  const trustedSkuIds = new Set<Id<"productSku">>();

  for (const { product, sku } of await listScopedRegisterCatalogSkus(
    ctx,
    args,
  )) {
    trustedSkuIds.add(sku._id);
    rows.push(
      mapSkuToRegisterCatalogRow({
        product,
        sku,
        category: await readCategoryName(ctx, categoryCache, product.categoryId),
        color: await readColorName(ctx, colorCache, sku.color),
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
      provisionalSku.importedPrice <= 0
    ) {
      continue;
    }

    rows.push(
      mapSkuToRegisterCatalogRow({
        product,
        sku,
        category: await readCategoryName(ctx, categoryCache, product.categoryId),
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

    const provisionalSku = await readActiveProvisionalImportSkuForStoreSku(ctx, {
      storeId: args.storeId,
      productId: sku.productId,
      productSkuId: sku._id,
    });
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

    const availability = await validateInventoryAvailability(ctx.db, sku._id, 1, {
      storeId: args.storeId,
    });
    const quantityAvailable = availability.available ?? 0;

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
  const catalogSkus = await listScopedRegisterCatalogSkus(ctx, args);
  const heldQuantities = await readActiveHeldQuantitiesForStoreSkus(ctx.db, {
    storeId: args.storeId,
    skuIds: catalogSkus.map(({ sku }) => sku._id),
  });
  const activeProvisionalSkus = await queryActiveProvisionalImportSkusForStore(
    ctx,
    args,
  );

  const trustedRows = catalogSkus.map(({ sku }): RegisterCatalogAvailabilityRow => {
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

  const provisionalRows: RegisterCatalogAvailabilityRow[] = [];
  for (const provisionalSku of activeProvisionalSkus) {
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
