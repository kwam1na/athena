import { action, mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { productSchema, productSkuSchema } from "../schemas/inventory";
import { ProductSku } from "../../types";
import { Id } from "../_generated/dataModel";
import { api } from "../_generated/api";
import { deleteDirectoryInR2 } from "../cloudflare/r2";

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

function generateBarcode({
  storeId,
  productId,
  skuId,
}: {
  storeId: string;
  productId: string;
  skuId: string;
}): string {
  // Create numeric barcode from IDs
  // Take hash of combined IDs and convert to 12-digit number
  const combined = `${storeId}-${productId}-${skuId}`;
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    hash = (hash << 5) - hash + combined.charCodeAt(i);
    hash = hash & hash;
  }
  // Convert to positive 12-digit number
  const barcode = Math.abs(hash).toString().padStart(12, "0").slice(0, 12);
  return barcode;
}

// Helper function to calculate total inventory count
const calculateTotalInventoryCount = (skus: ProductSku[]): number => {
  if (!skus) return 0;
  return skus.reduce((total, sku) => total + (sku.inventoryCount || 0), 0);
};

const calculateTotalAvailableCount = (skus: ProductSku[]): number => {
  if (!skus) return 0;
  return skus.reduce((total, sku) => total + (sku.quantityAvailable || 0), 0);
};

export const getAll = query({
  args: {
    storeId: v.id("store"),
    color: v.optional(v.array(v.id("color"))),
    length: v.optional(v.array(v.number())),
    category: v.optional(v.array(v.string())),
    subcategory: v.optional(v.array(v.string())),
    isVisible: v.optional(v.boolean()),
    filters: v.optional(
      v.object({
        isMissingImages: v.optional(v.boolean()),
        isMissingPrice: v.optional(v.boolean()),
        isPriceZero: v.optional(v.boolean()),
      })
    ),
  },
  handler: async (ctx, args) => {
    let categoryId: Id<"category"> | undefined;
    let subcategoryId: Id<"subcategory"> | undefined;

    if (args.category && args.category.length > 0) {
      const categorySlug = args.category[0];
      const s = await ctx.db
        .query("category")
        .withIndex("by_storeId_slug", (q) =>
          q.eq("storeId", args.storeId).eq("slug", categorySlug)
        )
        .first();
      categoryId = s?._id;
    }

    if (args.category && !categoryId) {
      return [];
    }

    // this will fetch all products with the given subcategory.
    // not problematic because the subcategory name is the same as
    // the one in the db because the it's not set by the frontend
    if (args.subcategory && args.subcategory.length > 0) {
      const subcategorySlug = args.subcategory[0];
      let s;
      if (categoryId) {
        s = await ctx.db
          .query("subcategory")
          .withIndex("by_categoryId_slug", (q) =>
            q.eq("categoryId", categoryId).eq("slug", subcategorySlug)
          )
          .first();
      } else {
        s = await ctx.db
          .query("subcategory")
          .withIndex("by_slug", (q) => q.eq("slug", subcategorySlug))
          .first();
      }
      subcategoryId = s?._id;
    }

    if (args.subcategory && !subcategoryId) {
      return [];
    }

    // Use index for products query, then filter by category/subcategory in memory
    const allProducts = await ctx.db
      .query(entity)
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .collect();

    // Filter by category/subcategory in memory
    const products = allProducts.filter((product) => {
      if (subcategoryId) {
        return product.subcategoryId === subcategoryId;
      }
      if (categoryId) {
        return product.categoryId === categoryId;
      }
      return true;
    });

    // Use index for SKUs query, then filter colors/lengths in memory
    // (Convex indexes don't support dynamic OR conditions)
    const allSkus = await ctx.db
      .query("productSku")
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .collect();

    // Filter by color and length in memory
    const skus = allSkus.filter((sku) => {
      if (args.color && args.length) {
        const colorMatch = sku.color ? args.color.includes(sku.color) : false;
        const lengthMatch = sku.length && args.length.includes(sku.length);
        return colorMatch && lengthMatch;
      }
      if (args.color) {
        return sku.color ? args.color.includes(sku.color) : false;
      }
      if (args.length) {
        return sku.length && args.length.includes(sku.length);
      }
      return true;
    });

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

    // Filter by visibility if specified
    const visibleProducts =
      args.isVisible !== undefined
        ? products.filter((p) => p.isVisible === args.isVisible)
        : products;

    // Attach SKUs and inventory data to products
    const productsWithSkus = visibleProducts
      .map((product) => {
        const skus = skusByProductId[product._id] || [];
        const validSkus = skus
          .filter((sku) => {
            // If filtering for unresolved issues (missing images or prices)
            if (args.filters?.isMissingImages || args.filters?.isMissingPrice) {
              const hasMissingImage =
                args.filters?.isMissingImages && sku.images.length === 0;
              const hasMissingPrice =
                args.filters?.isMissingPrice &&
                (sku.price === 0 || sku.price === undefined);
              return hasMissingImage || hasMissingPrice;
            }
            // Default behavior: only show SKUs with valid prices
            return args.filters?.isPriceZero ? true : sku.price > 0;
          })
          .sort((a, b) => a.price - b.price);

        return {
          ...product,
          inventoryCount: calculateTotalInventoryCount(skus),
          quantityAvailable: calculateTotalAvailableCount(skus),
          skus: validSkus,
        };
      })
      .filter((product) => product.skus.length > 0);

    return productsWithSkus;
  },
});

export const getById = query({
  args: {
    id: v.id(entity),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    const product = await ctx.db.get(args.id);

    const skus = await ctx.db
      .query("productSku")
      .withIndex("by_productId", (q) => q.eq("productId", args.id))
      .collect();

    const colorIds = skus
      .map((sku) => sku.color)
      .filter((color): color is Id<"color"> => color !== undefined);

    const colors = await Promise.all(
      colorIds.map((colorId) => ctx.db.get(colorId))
    );

    const colorMap = colors.reduce(
      (acc: Record<Id<"color">, string>, color) => {
        if (color) {
          acc[color._id] = color.name;
        }
        return acc;
      },
      {} as Record<Id<"color">, string>
    );

    let category: string | undefined;

    if (product) {
      const productCategory = await ctx.db.get(product.categoryId);
      category = productCategory?.name;
    }

    const skusWithCategory = skus
      .map((sku) => ({
        ...sku,
        productCategory: category,
        productName: product?.name,
        colorName: sku.color ? colorMap[sku.color] : null,
      }))
      .filter((sku) => sku.isVisible || sku.isVisible === undefined);

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
      .withIndex("by_productId", (q) => q.eq("productId", product?._id))
      .collect();

    const colorIds = skus
      .map((sku) => sku.color)
      .filter((color): color is Id<"color"> => color !== undefined);

    const colors = await Promise.all(
      colorIds.map((colorId) => ctx.db.get(colorId))
    );

    const colorMap = colors.reduce(
      (acc: Record<Id<"color">, string>, color) => {
        if (color) {
          acc[color._id] = color.name; // Now TypeScript knows _id is a valid key
        }
        return acc;
      },
      {} as Record<Id<"color">, string>
    );

    let category: string | undefined;

    if (product) {
      const productCategory = await ctx.db.get(product.categoryId);
      category = productCategory?.name;
    }

    const skusWithCategory = skus
      .map((sku) => ({
        ...sku,
        productCategory: category,
        productName: product?.name,
        colorName: sku.color ? colorMap[sku.color] : null,
      }))
      .filter((sku) => sku.isVisible || sku.isVisible === undefined);

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
    filters: v.optional(
      v.object({
        isVisible: v.boolean(),
      })
    ),
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
      .withIndex("by_productId", (q) => q.eq("productId", product?._id))
      .collect();

    const colorIds = skus
      .map((sku) => sku.color)
      .filter((color): color is Id<"color"> => color !== undefined);

    const colors = await Promise.all(
      colorIds.map((colorId) => ctx.db.get(colorId))
    );

    const colorMap = colors.reduce(
      (acc: Record<Id<"color">, string>, color) => {
        if (color) {
          acc[color._id] = color.name; // Now TypeScript knows _id is a valid key
        }
        return acc;
      },
      {} as Record<Id<"color">, string>
    );

    let category: string | undefined;
    let subcategory: string | undefined;
    let categorySlug: string | undefined;
    let subcategorySlug: string | undefined;

    if (product) {
      const [productCategory, productSubcategory] = await Promise.all([
        await ctx.db.get(product.categoryId),
        ctx.db.get(product.subcategoryId),
      ]);

      category = productCategory?.name;
      subcategory = productSubcategory?.name;

      categorySlug = productCategory?.slug;
      subcategorySlug = productSubcategory?.slug;
    }

    const skusWithCategory = skus
      .map((sku) => ({
        ...sku,
        productCategory: category,
        productSubcategory: subcategory,
        productName: product?.name,
        productCategorySlug: categorySlug,
        productSubcategorySlug: subcategorySlug,
        colorName: sku.color ? colorMap[sku.color] : null,
      }))
      ?.sort((a, b) => {
        return a.price - b.price;
      })
      .filter((sku) =>
        args.filters?.isVisible
          ? sku.isVisible || sku.isVisible === undefined
          : true
      );
    // .filter((p) => p.price > 0);

    return {
      ...product,
      categoryName: category,
      subcategoryName: subcategory,
      categorySlug,
      subcategorySlug,
      inventoryCount: calculateTotalInventoryCount(skus),
      skus: skusWithCategory,
    };
  },
});

export const create = mutation({
  args: productSchema,
  handler: async (ctx, args) => {
    const id = await ctx.db.insert(entity, args);

    const product = await ctx.db.get(id);

    if (product) {
      await ctx.scheduler.runAfter(
        0,
        api.inventory.productUtil.invalidateProductCache,
        {
          storeId: product?.storeId,
        }
      );
    }

    return product;
  },
});

export const createSku = mutation({
  args: productSkuSchema,
  handler: async (ctx, args) => {
    // Validate quantityAvailable doesn't exceed stock
    if (
      args.quantityAvailable !== undefined &&
      args.inventoryCount !== undefined &&
      args.quantityAvailable > args.inventoryCount
    ) {
      throw new Error(
        `Quantity available (${args.quantityAvailable}) cannot exceed stock (${args.inventoryCount})`
      );
    }

    // Validate price is not zero
    // if (args.price === 0 || args.price === undefined) {
    //   throw new Error("Price cannot be zero or empty");
    // }

    // Fetch the product to verify existence and fetch storeId
    const product = await ctx.db
      .query("product")
      .filter((q) => q.eq(q.field("_id"), args.productId))
      .first();

    if (!product) {
      throw new Error(`Product with id ${args.productId} not found`);
    }

    if (args.barcode) {
      const skuWithBarcode = await ctx.db
        .query("productSku")
        .withIndex("by_storeId_barcode", (q) =>
          q.eq("storeId", product.storeId).eq("barcode", args.barcode)
        )
        .first();

      if (skuWithBarcode) {
        throw new Error(
          `Barcode ${args.barcode} already assigned to another SKU`
        );
      }
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

export const generateUniqueBarcode = mutation({
  args: {
    storeId: v.id("store"),
    productId: v.id("product"),
    skuId: v.id("productSku"),
  },
  returns: v.object({
    success: v.boolean(),
    barcode: v.optional(v.string()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    // Generate initial barcode
    let barcode = generateBarcode({
      storeId: args.storeId,
      productId: args.productId,
      skuId: args.skuId,
    });

    // Check for uniqueness within store
    let attempts = 0;
    const maxAttempts = 10;

    while (attempts < maxAttempts) {
      const existing = await ctx.db
        .query("productSku")
        .withIndex("by_storeId_barcode", (q) =>
          q.eq("storeId", args.storeId).eq("barcode", barcode)
        )
        .first();

      if (!existing) {
        // Update the SKU with the barcode
        await ctx.db.patch(args.skuId, { barcode, barcodeAutoGenerated: true });
        return { success: true, barcode };
      }

      // Add random suffix if collision
      barcode = generateBarcode({
        storeId: args.storeId,
        productId: args.productId,
        skuId: `${args.skuId}-${attempts}`,
      });
      attempts++;
    }

    return {
      success: false,
      error: "Could not generate unique barcode after multiple attempts",
    };
  },
});

export const getProductSku = query({
  args: {
    id: v.id("productSku"),
  },
  handler: async (ctx, args) => {
    const productSku = await ctx.db.get(args.id);

    let colorName;

    if (productSku?.color) {
      const color = await ctx.db.get(productSku.color);
      colorName = color?.name;
    }

    return {
      ...productSku,
      colorName,
    };
  },
});

export const updateSku = mutation({
  args: {
    id: v.id("productSku"),
    images: v.optional(v.array(v.string())),
    isVisible: v.optional(v.boolean()),
    length: v.optional(v.number()),
    size: v.optional(v.string()),
    color: v.optional(v.id("color")),
    weight: v.optional(v.string()),
    sku: v.optional(v.string()),
    barcode: v.optional(v.string()),
    barcodeAutoGenerated: v.optional(v.boolean()),
    quantityAvailable: v.optional(v.number()),
    price: v.optional(v.number()),
    netPrice: v.optional(v.number()),
    inventoryCount: v.optional(v.number()),
    unitCost: v.optional(v.number()),
    attributes: v.optional(v.record(v.string(), v.any())),
  },
  handler: async (ctx, args) => {
    // Get current SKU data for validation
    const currentSku = await ctx.db.get(args.id);
    if (!currentSku) throw new Error("SKU not found");

    // Determine final values for validation
    const finalQuantityAvailable =
      args.quantityAvailable ?? currentSku.quantityAvailable;
    const finalInventoryCount =
      args.inventoryCount ?? currentSku.inventoryCount;

    // Validate quantityAvailable doesn't exceed stock
    if (
      finalQuantityAvailable !== undefined &&
      finalInventoryCount !== undefined &&
      finalQuantityAvailable > finalInventoryCount
    ) {
      return {
        success: false,
        error: "Quantity available cannot exceed stock",
      };
    }

    console.log("args.barcode", args.barcode);

    if (args.barcode) {
      const skuWithBarcode = await ctx.db
        .query("productSku")
        .withIndex("by_storeId_barcode", (q) =>
          q.eq("storeId", currentSku.storeId).eq("barcode", args.barcode)
        )
        .first();

      if (skuWithBarcode && skuWithBarcode._id !== currentSku._id) {
        return {
          success: false,
          error: "Barcode assigned to another SKU",
        };
      }
    }

    // Build patch object with only explicitly provided fields (not undefined)
    // This automatically handles all fields without needing to list each one
    const patch = Object.fromEntries(
      Object.entries(args).filter(
        ([key, value]) => key !== "id" && value !== undefined
      )
    );

    await ctx.db.patch(args.id, patch);

    return await ctx.db.get(args.id);
  },
});

export const update = mutation({
  args: {
    id: v.id(entity),
    availability: v.optional(
      v.union(v.literal("draft"), v.literal("live"), v.literal("archived"))
    ),
    areProcessingFeesAbsorbed: v.optional(v.boolean()),
    attributes: v.optional(v.record(v.string(), v.any())),
    name: v.optional(v.string()),
    slug: v.optional(v.string()),
    currency: v.optional(v.string()),
    categoryId: v.optional(v.id("category")),
    subcategoryId: v.optional(v.id("subcategory")),
    description: v.optional(v.string()),
    inventoryCount: v.optional(v.number()),
    isVisible: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { id, ...rest } = args;

    if (args.name) {
      const allSkus = await ctx.db
        .query("productSku")
        .filter((q) => q.eq(q.field("productId"), id))
        .collect();

      await Promise.all(
        allSkus.map((sku) => ctx.db.patch(sku._id, { productName: args.name }))
      );
    }

    await ctx.db.patch(args.id, { ...rest });

    const product = await ctx.db.get(args.id);

    if (product) {
      await ctx.scheduler.runAfter(
        0,
        api.inventory.productUtil.invalidateProductCache,
        {
          storeId: product?.storeId,
        }
      );
    }

    return product;
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

export const clear = action({
  args: { id: v.id(entity), storeId: v.id("store") },
  handler: async (ctx, args) => {
    await Promise.all([
      await ctx.runMutation(api.inventory.products.remove, {
        id: args.id,
      }),
      await deleteDirectoryInR2(`stores/${args.storeId}/products/${args.id}`),
    ]);

    await ctx.runAction(api.inventory.productUtil.invalidateProductCache, {
      storeId: args.storeId,
    });
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

export const batchGet = query({
  args: {
    ids: v.array(v.id(entity)),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    const res: any[] = await Promise.all(
      args.ids.map((id) =>
        ctx.runQuery(api.inventory.products.getById, {
          id,
          storeId: args.storeId,
        })
      )
    );

    return res;
  },
});
