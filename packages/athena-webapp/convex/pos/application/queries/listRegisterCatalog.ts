import type { Doc, Id } from "../../../_generated/dataModel";
import type { QueryCtx } from "../../../_generated/server";

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
  inStock: boolean;
  quantityAvailable: number;
  areProcessingFeesAbsorbed: boolean;
};

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
    price: args.sku.netPrice ?? args.sku.price,
    category: args.category,
    description: args.product.description ?? "",
    image: args.sku.images[0] ?? null,
    size: args.sku.size ?? "",
    length: args.sku.length ?? null,
    color: args.color,
    inStock: args.sku.quantityAvailable > 0,
    quantityAvailable: args.sku.quantityAvailable,
    areProcessingFeesAbsorbed: args.product.areProcessingFeesAbsorbed ?? false,
  };
}

export async function listRegisterCatalog(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
  },
) {
  const rows: RegisterCatalogRow[] = [];
  const productCache = new Map<Id<"product">, Doc<"product"> | null>();
  const categoryCache = new Map<Id<"category">, string>();
  const colorCache = new Map<Id<"color">, string>();

  for await (const sku of ctx.db
    .query("productSku")
    .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))) {
    let product = productCache.get(sku.productId);

    if (product === undefined) {
      product = (await ctx.db.get("product", sku.productId)) ?? null;
      productCache.set(sku.productId, product);
    }

    if (!product || product.storeId !== args.storeId) {
      continue;
    }

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
