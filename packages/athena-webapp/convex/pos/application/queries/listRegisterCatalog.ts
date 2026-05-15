import type { Doc, Id } from "../../../_generated/dataModel";
import type { QueryCtx } from "../../../_generated/server";
import {
  readActiveHeldQuantitiesForStoreSkus,
  validateInventoryAvailability,
} from "../../../inventory/helpers/inventoryHolds";

type RegisterCatalogRow = {
  id: Id<"productSku">;
  productSkuId: Id<"productSku">;
  skuId: Id<"productSku">;
  productId: Id<"product">;
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
};

type RegisterCatalogAvailabilityRow = {
  productSkuId: Id<"productSku">;
  skuId: Id<"productSku">;
  inStock: boolean;
  quantityAvailable: number;
};

export const REGISTER_CATALOG_AVAILABILITY_LIMIT = 50;

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
}): RegisterCatalogRow {
  return {
    id: args.sku._id,
    productSkuId: args.sku._id,
    skuId: args.sku._id,
    productId: args.product._id,
    name: args.product.name,
    sku: args.sku.sku ?? "",
    barcode: args.sku.barcode ?? "",
    price: getRegisterCatalogPrice(args.sku),
    category: args.category,
    description: args.product.description ?? "",
    image: args.sku.images[0] ?? null,
    size: args.sku.size ?? "",
    length: args.sku.length ?? null,
    color: args.color,
    areProcessingFeesAbsorbed: args.product.areProcessingFeesAbsorbed ?? false,
  };
}

function getRegisterCatalogPrice(sku: Doc<"productSku">) {
  return sku.netPrice ?? sku.price;
}

async function listScopedRegisterCatalogSkus(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
  },
) {
  const rows: Array<{ product: Doc<"product">; sku: Doc<"productSku"> }> = [];
  const productCache = new Map<Id<"product">, Doc<"product"> | null>();

  for await (const sku of ctx.db
    .query("productSku")
    .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))) {
    let product = productCache.get(sku.productId);

    if (product === undefined) {
      product = (await ctx.db.get("product", sku.productId)) ?? null;
      productCache.set(sku.productId, product);
    }

    if (
      !product ||
      product.storeId !== args.storeId ||
      product.availability === "archived"
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

export async function listRegisterCatalog(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
  },
) {
  const rows: RegisterCatalogRow[] = [];
  const categoryCache = new Map<Id<"category">, string>();
  const colorCache = new Map<Id<"color">, string>();

  for (const { product, sku } of await listScopedRegisterCatalogSkus(
    ctx,
    args,
  )) {
    rows.push(
      mapSkuToRegisterCatalogRow({
        product,
        sku,
        category: await readCategoryName(ctx, categoryCache, product.categoryId),
        color: await readColorName(ctx, colorCache, sku.color),
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

    const availability = await validateInventoryAvailability(ctx.db, sku._id, 1, {
      storeId: args.storeId,
    });
    const quantityAvailable = availability.available ?? 0;

    rows.push({
      productSkuId: sku._id,
      skuId: sku._id,
      inStock: quantityAvailable > 0,
      quantityAvailable,
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

  return catalogSkus.map(({ sku }): RegisterCatalogAvailabilityRow => {
    const quantityAvailable = Math.max(
      0,
      sku.quantityAvailable - (heldQuantities.get(sku._id) ?? 0),
    );

    return {
      productSkuId: sku._id,
      skuId: sku._id,
      inStock: quantityAvailable > 0,
      quantityAvailable,
    };
  });
}
