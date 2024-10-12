import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { productSchema, productSkuSchema } from "../schemas/inventory";
import { ProductSku } from "../../types";

const entity = "product";

function generateSKU({
  storeId,
  productId,
  skuId,
}: {
  storeId: string;
  productId: string;
  skuId: string;
}): string {
  // Helper function to encode IDs into base36 and pad as needed
  const encodeBase36 = (id: string, length: number) => {
    const subset = id.substring(id.length - length);
    return parseInt(subset, 36).toString(36).toUpperCase();
  };

  // Take the first 4 characters of storeId, first 3 of productId, and first 3 of skuId
  const storeCode = encodeBase36(storeId, 4);
  const productCode = encodeBase36(productId, 3);
  const skuCode = encodeBase36(skuId, 3);

  // Concatenate the parts to form the SKU
  return `${storeCode}-${productCode}-${skuCode}`;
}

// Helper function to calculate total inventory count
const calculateTotalInventoryCount = (skus: ProductSku[]): number => {
  return skus.reduce((total, sku) => total + (sku.inventoryCount || 0), 0);
};

export const getAll = query({
  args: {
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    const products = await ctx.db
      .query(entity)
      .filter((q) => q.eq(q.field("storeId"), args.storeId))
      .collect();

    const skus = await ctx.db
      .query("productSku")
      .filter((q) => q.eq(q.field("storeId"), args.storeId))
      .collect();

    type SkusByProductId = { [key: string]: (typeof skus)[0][] };

    // Map SKUs by productId for easier lookup
    const skusByProductId: SkusByProductId = skus.reduce(
      (acc: SkusByProductId, sku) => {
        if (!acc[sku.productId]) {
          acc[sku.productId] = [];
        }
        acc[sku.productId].push(sku);
        return acc;
      },
      {}
    );

    // Add SKUs to their corresponding products
    const productsWithSkus = products.map((product) => ({
      ...product,
      inventoryCount: calculateTotalInventoryCount(
        skusByProductId[product._id]
      ),
      skus: skusByProductId[product._id] || [],
    }));

    return productsWithSkus;
  },
});

export const getById = query({
  args: {
    id: v.id(entity),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    const product = await ctx.db
      .query(entity)
      .filter((q) =>
        q.and(
          q.eq(q.field("_id"), args.id),
          q.eq(q.field("storeId"), args.storeId)
        )
      )
      .first();

    const skus = await ctx.db
      .query("productSku")
      .filter((q) =>
        q.and(
          q.eq(q.field("storeId"), args.storeId),
          q.eq(q.field("productId"), product?._id)
        )
      )
      .collect();

    let category: string | undefined;

    if (product) {
      const productCategory = await ctx.db.get(product.categoryId);
      category = productCategory?.name;
    }

    const skusWithCategory = skus.map((sku) => ({
      ...sku,
      productCategory: category,
      productName: product?.name,
    }));

    return {
      ...product,
      inventoryCount: calculateTotalInventoryCount(skus),
      skus: skusWithCategory,
    };
  },
});

export const getBySlug = query({
  args: {
    slug: v.string(),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    const product = await ctx.db
      .query(entity)
      .filter((q) =>
        q.and(
          q.eq(q.field("slug"), args.slug),
          q.eq(q.field("storeId"), args.storeId)
        )
      )
      .first();

    if (!product) {
      return null;
    }

    const skus = await ctx.db
      .query("productSku")
      .filter((q) =>
        q.and(
          q.eq(q.field("storeId"), args.storeId),
          q.eq(q.field("productId"), product?._id)
        )
      )
      .collect();

    let category: string | undefined;

    if (product) {
      const productCategory = await ctx.db.get(product.categoryId);
      category = productCategory?.name;
    }

    const skusWithCategory = skus.map((sku) => ({
      ...sku,
      productCategory: category,
      productName: product?.name,
    }));

    return {
      ...product,
      inventoryCount: calculateTotalInventoryCount(skus),
      skus: skusWithCategory,
    };
  },
});

export const getByIdOrSlug = query({
  args: {
    identifier: v.union(v.id(entity), v.string()),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    const product = await ctx.db
      .query(entity)
      .filter((q) =>
        q.or(
          q.and(
            q.eq(q.field("slug"), args.identifier),
            q.eq(q.field("storeId"), args.storeId)
          ),
          q.and(
            q.eq(q.field("_id"), args.identifier),
            q.eq(q.field("storeId"), args.storeId)
          )
        )
      )
      .first();

    if (!product) {
      return null;
    }

    const skus = await ctx.db
      .query("productSku")
      .filter((q) =>
        q.and(
          q.eq(q.field("storeId"), args.storeId),
          q.eq(q.field("productId"), product?._id)
        )
      )
      .collect();

    let category: string | undefined;

    if (product) {
      const productCategory = await ctx.db.get(product.categoryId);
      category = productCategory?.name;
    }

    const skusWithCategory = skus.map((sku) => ({
      ...sku,
      productCategory: category,
      productName: product?.name,
    }));

    return {
      ...product,
      inventoryCount: calculateTotalInventoryCount(skus),
      skus: skusWithCategory,
    };
  },
});

export const create = mutation({
  args: productSchema,
  handler: async (ctx, args) => {
    const id = await ctx.db.insert(entity, args);

    return await ctx.db.get(id);
  },
});

export const createSku = mutation({
  args: productSkuSchema,
  handler: async (ctx, args) => {
    // Fetch the product to verify existence and fetch storeId
    const product = await ctx.db
      .query("product")
      .filter((q) => q.eq(q.field("_id"), args.productId))
      .first();

    if (!product) {
      throw new Error(`Product with id ${args.productId} not found`);
    }

    // Insert a temporary SKU with "TEMP_SKU"
    const tempSkuData = {
      ...args,
      sku: "TEMP_SKU",
    };

    const tempSkuId = await ctx.db.insert("productSku", tempSkuData);

    // Generate SKU if not provided
    const sku =
      args.sku ||
      generateSKU({
        storeId: product.storeId,
        productId: product._id,
        skuId: tempSkuId,
      });

    // Update the temporary SKU with the generated or provided SKU
    await ctx.db.patch(tempSkuId, { sku });

    return await ctx.db.get(tempSkuId);
  },
});

export const updateSku = mutation({
  args: {
    id: v.id("productSku"),
    images: v.optional(v.array(v.string())),
    length: v.optional(v.number()),
    size: v.optional(v.string()),
    color: v.optional(v.string()),
    sku: v.optional(v.string()),
    price: v.optional(v.number()),
    inventoryCount: v.optional(v.number()),
    unitCost: v.optional(v.number()),
    attributes: v.optional(v.object({})),
  },
  handler: async (ctx, args) => {
    const { id, ...rest } = args;
    await ctx.db.patch(args.id, {
      ...rest,
      size: args.size ?? undefined,
      length: args.length ?? undefined,
      color: args.color ?? undefined,
    });

    return await ctx.db.get(args.id);
  },
});

export const update = mutation({
  args: {
    id: v.id(entity),
    availability: v.optional(
      v.union(v.literal("draft"), v.literal("live"), v.literal("archived"))
    ),
    name: v.optional(v.string()),
    slug: v.optional(v.string()),
    currency: v.optional(v.string()),
    categoryId: v.optional(v.id("category")),
    subcategoryId: v.optional(v.id("subcategory")),
    description: v.optional(v.string()),
    inventoryCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { id, ...rest } = args;
    await ctx.db.patch(args.id, { ...rest });

    return await ctx.db.get(args.id);
  },
});

export const remove = mutation({
  args: {
    id: v.id(entity),
  },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);

    return { message: "OK" };
  },
});

export const removeSku = mutation({
  args: {
    id: v.id("productSku"),
  },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);

    return { message: "OK" };
  },
});

export const removeAllProductsForStore = mutation({
  args: {
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    const products = await ctx.db
      .query("product")
      .filter((q) => q.eq(q.field("storeId"), args.storeId))
      .collect();

    const skus = await ctx.db
      .query("productSku")
      .filter((q) => q.eq(q.field("storeId"), args.storeId))
      .collect();

    // Delete all SKUs using Promise.all
    await Promise.all(skus.map((sku) => ctx.db.delete(sku._id)));

    // Delete all products using Promise.all
    await Promise.all(products.map((product) => ctx.db.delete(product._id)));
  },
});
