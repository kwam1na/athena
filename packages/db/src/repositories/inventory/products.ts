import {
  db,
  toSlug,
  type ProductRequest,
  type ProductSKU,
  type ProductSKURequest,
} from "../../index";
import { eq, sql } from "drizzle-orm";
import { products, productSkus } from "../../models/schema";

function generateSKU({
  storeId,
  categoryId,
  subcategoryId,
  productId,
  variantId,
}: {
  storeId: number;
  categoryId: number;
  subcategoryId: number;
  productId: number;
  variantId: number;
}): string {
  // Format IDs to be fixed-length by padding them
  const formattedStoreId = storeId.toString().padStart(3, "0");
  const formattedCategoryId = categoryId.toString().padStart(3, "0");
  const formattedSubcategoryId = subcategoryId.toString().padStart(3, "0");
  const formattedProductId = productId.toString().padStart(5, "0");
  const formattedVariantId = variantId.toString().padStart(3, "0");

  // Generate the SKU
  return `${formattedStoreId}-${formattedCategoryId}-${formattedSubcategoryId}-${formattedProductId}-${formattedVariantId}`;
}

// Helper function to calculate total inventory count
const calculateTotalInventoryCount = (skus: ProductSKU[]): number => {
  return skus.reduce((total, sku) => total + (sku.inventoryCount || 0), 0);
};

// Helper function to process a single product result
const processProductResult = (data: any): any => {
  const { product } = data;
  return {
    ...product,
    skus: data.skus,
    inventoryCount: calculateTotalInventoryCount(data.skus),
  };
};

export const productsRepository = {
  getAll: async (storeId: number) => {
    const res = await db
      .select({
        product: products,
        skus: sql`
      ARRAY_AGG(
        json_build_object(
          'id', product_skus.id,
          'sku', product_skus.sku,
          'price', product_skus.price,
          'inventoryCount', product_skus.inventory_count,
          'unitCost', product_skus.unit_cost,
          'color', product_skus.color,
          'images', product_skus.images,
          'createdAt', product_skus.created_at,
          'updatedAt', product_skus.updated_at
        )
      )`.as("skus"),
      })
      .from(products)
      .leftJoin(productSkus, eq(products.id, productSkus.productId))
      .groupBy(products.id)
      .where(eq(products.storeId, storeId));

    return res.map(processProductResult);
  },

  getBySlug: async (slug: string) => {
    const res = await db
      .select({
        product: products,
        skus: productSkus,
      })
      .from(products)
      .leftJoin(productSkus, eq(products.id, productSkus.productId))
      .where(eq(products.slug, slug));

    if (res.length === 0) return null;

    const skus = res.map((r) => r.skus).filter(Boolean);

    const invetoryCount = calculateTotalInventoryCount(skus as ProductSKU[]);

    const { product } = res[0];

    return { ...product, invetoryCount, skus };
  },

  getById: async (id: number) => {
    const res = await db
      .select({
        product: products,
        skus: productSkus,
      })
      .from(products)
      .leftJoin(productSkus, eq(products.id, productSkus.productId))
      .where(eq(products.id, id));

    if (res.length === 0) return null;

    const skus = res.map((r) => r.skus).filter(Boolean);

    const invetoryCount = calculateTotalInventoryCount(skus as ProductSKU[]);

    const { product } = res[0];

    return { ...product, invetoryCount, skus };
  },

  create: async (data: ProductRequest) => {
    const params = { ...data, slug: toSlug(data.name) };

    const res = await db.insert(products).values(params).returning();

    return res[0];
  },

  createSku: async (data: ProductSKURequest) => {
    // Fetch the product to get necessary details for SKU generation
    const product = await db
      .select()
      .from(products)
      .where(eq(products.id, data.productId))
      .limit(1);

    if (!product[0]) {
      throw new Error(`Product with id ${data.productId} not found`);
    }

    // Count existing SKUs for this product to determine the variant ID
    const existingSkusCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(productSkus)
      .where(eq(productSkus.productId, data.productId));

    const variantId = existingSkusCount[0].count + 1;

    // Generate SKU if not provided
    const sku =
      data.sku ||
      generateSKU({
        storeId: product[0].storeId,
        categoryId: product[0].categoryId,
        subcategoryId: product[0].subcategoryId,
        productId: product[0].id,
        variantId: variantId,
      });

    // Prepare data for insertion
    const skuData = {
      ...data,
      sku: sku,
    };

    // Insert the new SKU
    const res = await db.insert(productSkus).values(skuData).returning();
    return res[0];
  },

  update: async (id: number, data: Partial<ProductRequest>) => {
    const params = {
      ...data,
      ...(data.name && { slug: toSlug(data.name) }),
      updatedAt: new Date(),
    };

    const res = await db
      .update(products)
      .set(params)
      .where(eq(products.id, id))
      .returning();

    return res[0];
  },

  updateSku: async (id: number, data: Partial<ProductSKURequest>) => {
    const params = {
      ...data,
      updatedAt: new Date(),
    };

    const res = await db
      .update(productSkus)
      .set(params)
      .where(eq(productSkus.id, id))
      .returning();

    return res[0];
  },

  delete: async (id: number) => {
    const res = await db
      .delete(products)
      .where(eq(products.id, id))
      .returning();

    return res[0];
  },

  deleteAllByStoreId: async (storeId: number) => {
    const res = await db
      .delete(products)
      .where(eq(products.storeId, storeId))
      .returning();

    return res[0];
  },
};