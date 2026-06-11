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

const POS_OPERATIONAL_CATEGORY_SLUGS = new Set([
  "pos-pending-checkout",
  "pos-quick-add",
]);

function isTrustedCatalogResult(args: {
  product: NonNullable<Awaited<ReturnType<typeof getProductById>>>;
  sku: Doc<"productSku">;
  category?: Awaited<ReturnType<typeof getCategoryById>>;
}) {
  const isReservedPosOperationalProduct = args.category?.slug
    ? POS_OPERATIONAL_CATEGORY_SLUGS.has(args.category.slug)
    : false;

  return (
    args.product.availability !== "archived" &&
    args.product.availability !== "draft" &&
    (args.product.isVisible !== false || isReservedPosOperationalProduct) &&
    args.sku.isVisible !== false
  );
}

async function mapSkuToCatalogResult(
  ctx: QueryCtx,
  args: {
    product: Awaited<ReturnType<typeof getProductById>>;
    sku: Doc<"productSku">;
    category?: Awaited<ReturnType<typeof getCategoryById>>;
    categoryName?: string;
  },
): Promise<CatalogResult | null> {
  const category =
    args.category ?? (args.product ? await getCategoryById(ctx, args.product.categoryId) : null);

  if (
    !args.product ||
    !isTrustedCatalogResult({
      product: args.product,
      sku: args.sku,
      category,
    }) ||
    !args.sku.netPrice
  ) {
    return null;
  }

  const categoryName = args.categoryName ?? category?.name ?? "";
  const color = (await getColorById(ctx, args.sku.color))?.name ?? "";

  return {
    id: args.sku._id,
    name: args.product.name,
    sku: args.sku.sku || "",
    barcode: args.sku.barcode || "",
    price: args.sku.netPrice || args.sku.price,
    category: categoryName,
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
    const category =
      product?.storeId === args.storeId
        ? await getCategoryById(ctx, product.categoryId)
        : null;

    if (
      product?.storeId === args.storeId &&
      product.availability !== "archived" &&
      product.availability !== "draft" &&
      (product.isVisible !== false ||
        POS_OPERATIONAL_CATEGORY_SLUGS.has(category?.slug ?? ""))
    ) {
      const productSkus = await listProductSkusByProductId(ctx, product._id);
      const categoryName = category?.name || "";
      const results = await Promise.all(
        productSkus.map((sku) =>
          mapSkuToCatalogResult(ctx, {
            product,
            sku,
            category,
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
    const category =
      product?.storeId === args.storeId
        ? await getCategoryById(ctx, product.categoryId)
        : null;

    if (
      product?.storeId === args.storeId &&
      product.availability !== "archived" &&
      product.availability !== "draft" &&
      (product.isVisible !== false ||
        POS_OPERATIONAL_CATEGORY_SLUGS.has(category?.slug ?? ""))
    ) {
      const allSkus = await listProductSkusByProductId(ctx, product._id);
      const categoryName = category?.name || "";
      const results = await Promise.all(
        allSkus.map((productSku) =>
          mapSkuToCatalogResult(ctx, {
            product,
            sku: productSku,
            category,
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
  const category =
    product?.storeId === args.storeId
      ? await getCategoryById(ctx, product.categoryId)
      : null;
  if (
    !product ||
    product.availability === "archived" ||
    product.availability === "draft" ||
    (product.isVisible === false &&
      !POS_OPERATIONAL_CATEGORY_SLUGS.has(category?.slug ?? ""))
  ) {
    return null;
  }

  return mapSkuToCatalogResult(ctx, {
    product,
    sku,
    category,
  });
}
