import type { Doc, Id } from "../../../_generated/dataModel";
import type { QueryCtx } from "../../../_generated/server";

import {
  findStoreSkuByBarcode,
  findStoreSkuBySku,
  getCategoryById,
  getColorById,
  getProductById,
  isConvexProductId,
  listMatchingStoreSkus,
  listProductSkusByProductId,
} from "../../infrastructure/repositories/catalogRepository";

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

async function mapSkuToCatalogResult(
  ctx: QueryCtx,
  args: {
    product: Awaited<ReturnType<typeof getProductById>>;
    sku: Doc<"productSku">;
    categoryName?: string;
  },
): Promise<CatalogResult | null> {
  if (
    !args.product ||
    args.product.availability === "archived" ||
    !args.sku.netPrice
  ) {
    return null;
  }

  const category =
    args.categoryName ??
    (await getCategoryById(ctx, args.product.categoryId))?.name ??
    "";
  const color = (await getColorById(ctx, args.sku.color))?.name ?? "";

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

export async function searchProducts(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
    searchQuery: string;
  },
) {
  if (!args.searchQuery.trim()) {
    return [];
  }

  const query = args.searchQuery.toLowerCase().trim();

  if (isConvexProductId(query)) {
    const product = await getProductById(ctx, query as Id<"product">);

    if (product?.storeId === args.storeId && product.availability !== "archived") {
      const productSkus = await listProductSkusByProductId(ctx, product._id);
      const categoryName =
        (await getCategoryById(ctx, product.categoryId))?.name || "";
      const results = await Promise.all(
        productSkus.map((sku) =>
          mapSkuToCatalogResult(ctx, {
            product,
            sku,
            categoryName,
          }),
        ),
      );

      return results.filter((result): result is CatalogResult => result !== null);
    }
  }

  const matchingSkus = await listMatchingStoreSkus(ctx, {
    storeId: args.storeId,
    searchQuery: query,
  });
  const results = await Promise.all(
    matchingSkus.map(({ product, sku }) =>
      mapSkuToCatalogResult(ctx, {
        product,
        sku,
      }),
    ),
  );

  return results.filter((result): result is CatalogResult => result !== null);
}

export async function lookupByBarcode(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
    barcode: string;
  },
): Promise<CatalogResult | CatalogResult[] | null> {
  if (!args.barcode.trim()) {
    return null;
  }

  let sku = await findStoreSkuByBarcode(ctx, args);

  if (!sku) {
    sku = await findStoreSkuBySku(ctx, {
      storeId: args.storeId,
      sku: args.barcode,
    });
  }

  if (!sku) {
    const product = isConvexProductId(args.barcode)
      ? await getProductById(ctx, args.barcode as Id<"product">)
      : null;

    if (product?.storeId === args.storeId && product.availability !== "archived") {
      const allSkus = await listProductSkusByProductId(ctx, product._id);
      const categoryName =
        (await getCategoryById(ctx, product.categoryId))?.name || "";
      const results = await Promise.all(
        allSkus.map((productSku) =>
          mapSkuToCatalogResult(ctx, {
            product,
            sku: productSku,
            categoryName,
          }),
        ),
      );

      return results.filter((result): result is CatalogResult => result !== null);
    }
  }

  if (!sku) {
    return null;
  }

  const product = await getProductById(ctx, sku.productId);
  if (!product || product.availability === "archived") {
    return null;
  }

  return mapSkuToCatalogResult(ctx, {
    product,
    sku,
  });
}
