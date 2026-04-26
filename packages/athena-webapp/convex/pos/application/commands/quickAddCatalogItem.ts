import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";
import { toSlug } from "../../../utils";

type CatalogResult = {
  id: Id<"productSku">;
  name: string;
  sku: string;
  barcode: string;
  price: number;
  category: string;
  description: string;
  inStock: boolean;
  quantityAvailable: number;
  image: string | null;
  size: string;
  length: number | null;
  color: string;
  productId: Id<"product">;
  skuId: Id<"productSku">;
  areProcessingFeesAbsorbed: boolean;
};

const QUICK_ADD_CATEGORY_NAME = "POS quick add";
const QUICK_ADD_CATEGORY_SLUG = "pos-quick-add";
const QUICK_ADD_SUBCATEGORY_NAME = "Uncategorized";
const QUICK_ADD_SUBCATEGORY_SLUG = "uncategorized";

async function findOrCreateQuickAddCategory(
  ctx: MutationCtx,
  storeId: Id<"store">,
) {
  const existingCategory = await ctx.db
    .query("category")
    .filter((q) =>
      q.and(
        q.eq(q.field("storeId"), storeId),
        q.eq(q.field("slug"), QUICK_ADD_CATEGORY_SLUG),
      ),
    )
    .first();

  if (existingCategory) {
    return existingCategory;
  }

  const categoryId = await ctx.db.insert("category", {
    name: QUICK_ADD_CATEGORY_NAME,
    slug: QUICK_ADD_CATEGORY_SLUG,
    storeId,
  });

  return (await ctx.db.get("category", categoryId))!;
}

async function findOrCreateQuickAddSubcategory(
  ctx: MutationCtx,
  args: {
    storeId: Id<"store">;
    categoryId: Id<"category">;
  },
) {
  const existingSubcategory = await ctx.db
    .query("subcategory")
    .filter((q) =>
      q.and(
        q.eq(q.field("storeId"), args.storeId),
        q.eq(q.field("categoryId"), args.categoryId),
        q.eq(q.field("slug"), QUICK_ADD_SUBCATEGORY_SLUG),
      ),
    )
    .first();

  if (existingSubcategory) {
    return existingSubcategory;
  }

  const subcategoryId = await ctx.db.insert("subcategory", {
    name: QUICK_ADD_SUBCATEGORY_NAME,
    slug: QUICK_ADD_SUBCATEGORY_SLUG,
    categoryId: args.categoryId,
    storeId: args.storeId,
  });

  return (await ctx.db.get("subcategory", subcategoryId))!;
}

async function mapSkuToCatalogResult(
  ctx: MutationCtx,
  args: {
    product: Doc<"product">;
    sku: Doc<"productSku">;
    categoryName?: string;
  },
): Promise<CatalogResult> {
  const category =
    args.categoryName ??
    (await ctx.db.get("category", args.product.categoryId))?.name ??
    "";

  const color = args.sku.color
    ? ((await ctx.db.get("color", args.sku.color))?.name ?? "")
    : "";

  return {
    id: args.sku._id,
    name: args.product.name,
    sku: args.sku.sku || "",
    barcode: args.sku.barcode || "",
    price: args.sku.netPrice || args.sku.price,
    category,
    description: args.product.description || "",
    inStock: args.sku.quantityAvailable > 0,
    quantityAvailable: args.sku.quantityAvailable,
    image: args.sku.images?.[0] || null,
    size: args.sku.size || "",
    length: args.sku.length || null,
    color,
    productId: args.product._id,
    skuId: args.sku._id,
    areProcessingFeesAbsorbed: args.product.areProcessingFeesAbsorbed || false,
  };
}

async function findExistingSku(
  ctx: MutationCtx,
  args: {
    storeId: Id<"store">;
    lookupCode?: string;
  },
) {
  const lookupCode = args.lookupCode?.trim();
  if (!lookupCode) {
    return null;
  }

  const skuMatch = await ctx.db
    .query("productSku")
    .withIndex("by_storeId_sku", (q) =>
      q.eq("storeId", args.storeId).eq("sku", lookupCode),
    )
    .first();

  if (skuMatch) {
    return skuMatch;
  }

  return ctx.db
    .query("productSku")
    .withIndex("by_storeId_barcode", (q) =>
      q.eq("storeId", args.storeId).eq("barcode", lookupCode),
    )
    .first();
}

function isBarcodeLike(value: string): boolean {
  return /^[\d\s-]+$/.test(value);
}

function generateSKU({
  storeId,
  productId,
  skuId,
}: {
  storeId: string;
  productId: string;
  skuId: string;
}): string {
  const encodeBase36 = (id: string, length: number) => {
    const subset = id.substring(id.length - length);
    return parseInt(subset, 36).toString(36).toUpperCase();
  };

  const storeCode = encodeBase36(storeId, 4);
  const productCode = encodeBase36(productId, 3);
  const skuCode = encodeBase36(skuId, 3);

  return `${storeCode}-${productCode}-${skuCode}`;
}

export async function quickAddCatalogItem(
  ctx: MutationCtx,
  args: {
    storeId: Id<"store">;
    createdByUserId: Id<"athenaUser">;
    name: string;
    lookupCode?: string;
    productId?: Id<"product">;
    price: number;
    quantityAvailable: number;
  },
): Promise<CatalogResult> {
  const store = await ctx.db.get("store", args.storeId);
  if (!store) {
    throw new Error("Store not found");
  }

  const lookupCode = args.lookupCode?.trim();
  const existingSku = await findExistingSku(ctx, {
    storeId: args.storeId,
    lookupCode,
  });

  if (existingSku) {
    const existingProduct = await ctx.db.get("product", existingSku.productId);
    if (existingProduct) {
      return mapSkuToCatalogResult(ctx, {
        product: existingProduct,
        sku: existingSku,
      });
    }
  }

  const quantityAvailable = Math.max(0, Math.trunc(args.quantityAvailable));
  let productId = args.productId;

  if (!productId) {
    const category = await findOrCreateQuickAddCategory(ctx, args.storeId);
    const subcategory = await findOrCreateQuickAddSubcategory(ctx, {
      storeId: args.storeId,
      categoryId: category._id,
    });
    const productName = args.name.trim() || lookupCode || "Quick add item";
    productId = (await ctx.db.insert("product", {
      availability: "live",
      areProcessingFeesAbsorbed: false,
      attributes: {},
      categoryId: category._id,
      createdByUserId: args.createdByUserId,
      currency: store.currency,
      description: "",
      inventoryCount: quantityAvailable,
      isVisible: false,
      name: productName,
      organizationId: store.organizationId,
      quantityAvailable,
      slug: toSlug(productName),
      storeId: args.storeId,
      subcategoryId: subcategory._id,
    })) as Id<"product">;
  }

  const product = await ctx.db.get("product", productId);
  if (!product || String(product.storeId) !== String(args.storeId)) {
    throw new Error("Product not found");
  }

  const productName = product.name;
  if (productName === undefined) {
    throw new Error("Product not found");
  }

  const barcode =
    lookupCode && isBarcodeLike(lookupCode) ? lookupCode : undefined;
  const requestedSku = barcode ? undefined : lookupCode;
  const skuId = await ctx.db.insert("productSku", {
    attributes: {},
    barcode,
    images: [],
    inventoryCount: quantityAvailable,
    isVisible: true,
    netPrice: args.price,
    price: args.price,
    productId,
    productName,
    quantityAvailable,
    sku: "TEMP_SKU",
    storeId: args.storeId,
  });

  const sku =
    requestedSku ||
    generateSKU({
      storeId: args.storeId,
      productId,
      skuId,
    });
  await ctx.db.patch("productSku", skuId, { sku });

  const productSku = (await ctx.db.get("productSku", skuId))!;

  return mapSkuToCatalogResult(ctx, {
    product,
    sku: productSku,
  });
}
