/* eslint-disable @convex-dev/no-collect-in-query -- Query refactors are tracked in V26-168, V26-169, and V26-170; this PR only hardens API boundaries. */
import { v } from "convex/values";
import { action, internalQuery, mutation, query } from "../_generated/server";
import { deleteFileInR2, uploadFileToR2 } from "../cloudflare/r2";
import { getProductName } from "../utils";

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
  return await ctx.storage.generateUploadUrl();
}
});

export const getById = query({
  args: { id: v.id("productSku") },
  handler: async (ctx, args) => {
    const s = await ctx.db.get("productSku", args.id);
    if (!s) return null;

    // Fetch related product
    const product = await ctx.db.get("product", s.productId);
    // Fetch color (if present)
    const color = s.color ? await ctx.db.get("color", s.color) : null;
    // Fetch subcategory (from product)
    const subcategory = product?.subcategoryId
      ? await ctx.db.get("subcategory", product.subcategoryId)
      : null;
    // Fetch category (from product)
    const category = product?.categoryId
      ? await ctx.db.get("category", product.categoryId)
      : null;

    return {
      ...s,
      productName: product?.name,
      product,
      colorName: color?.name,
      color,
      productSubcategory: subcategory?.name,
      subcategory,
      productCategory: category?.name,
      category,
    };
  },
});

export const retrieve = internalQuery({
  args: { id: v.id("productSku") },
  handler: async (ctx, args) => {
    const s = await ctx.db.get("productSku", args.id);
    if (!s) return null;

    const product = await ctx.db.get("product", s.productId);
    const color = s.color ? await ctx.db.get("color", s.color) : null;
    const subcategory = product?.subcategoryId
      ? await ctx.db.get("subcategory", product.subcategoryId)
      : null;
    const category = product?.categoryId
      ? await ctx.db.get("category", product.categoryId)
      : null;

    return {
      ...s,
      productName: product?.name,
      product,
      colorName: color?.name,
      color,
      productSubcategory: subcategory?.name,
      subcategory,
      productCategory: category?.name,
      category,
    };
  },
});

export const getInventoryBySkuIds = query({
  args: { skuIds: v.array(v.id("productSku")) },
  returns: v.array(
    v.object({
      _id: v.id("productSku"),
      inventoryCount: v.number(),
      quantityAvailable: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    // Fetch all SKUs in parallel
    const skus = await Promise.all(
      args.skuIds.map((skuId) => ctx.db.get("productSku", skuId))
    );

    // Filter out nulls and return only inventory fields
    return skus
      .filter((sku): sku is NonNullable<typeof sku> => sku !== null)
      .map((sku) => ({
        _id: sku._id,
        inventoryCount: sku.inventoryCount,
        quantityAvailable: sku.quantityAvailable,
      }));
  },
});

export const update = mutation({
  args: { id: v.id("productSku"), update: v.record(v.string(), v.any()) },
  handler: async (ctx, args) => {
    if (args.update.images) {
      await ctx.db.patch("productSku", args.id, {
        images: args.update.images,
      });
    }
  },
});

export const uploadImages = action({
  args: {
    images: v.array(v.bytes()),
    storeId: v.id("store"),
    productId: v.id("product"),
  },
  handler: async (_, args) => {
    const uploadPromises = args.images.map(async (imgBuffer) => {
      return uploadFileToR2(
        imgBuffer,
        `stores/${args.storeId}/products/${args.productId}/${crypto.randomUUID()}.webp`
      );
    });
    const images = (await Promise.all(uploadPromises)).filter(
      (url) => url !== undefined
    );

    return { success: true, images };
  },
});

export const deleteImages = action({
  args: {
    imageUrls: v.array(v.string()),
  },
  handler: async (_, args) => {
    const deletePromises = args.imageUrls.map(async (url) => {
      return deleteFileInR2(url);
    });

    await Promise.all(deletePromises);

    return { success: true };
  },
});

export const nukeProblematicImages = mutation({
  args: {},
  handler: async (ctx) => {
    const productSkus = await ctx.db.query("productSku").collect();
    const publicUrl = process.env.R2_PUBLIC_URL;

    if (!publicUrl) throw new Error("Missing R2_PUBLIC_URL env var");

    const updates = productSkus.flatMap((sku) => {
      if (!Array.isArray(sku.images)) return [];

      const validImages = sku.images.filter(
        (img) => typeof img === "string" && img.includes(publicUrl)
      );

      if (validImages.length === sku.images.length) return [];

      return [
        ctx.db.patch("productSku", sku._id, { images: validImages }).then(() => {
          console.log(
            `✅ SKU ${sku._id}: removed ${sku.images.length - validImages.length} invalid images`
          );
        }),
      ];
    });

    await Promise.allSettled(updates);

    return { success: true };
  },
});

export const makeAllProductsVisible = mutation({
  args: {},
  handler: async (ctx) => {
    const productSkus = await ctx.db.query("product").collect();

    const updates = productSkus.map(async (sku) => {
      return ctx.db.patch("product", sku._id, { isVisible: true }).then(() => {
        console.log(`✅ SKU ${sku._id}: set isVisible to true`);
      });
    });

    await Promise.allSettled(updates);

    return { success: true, updatedCount: productSkus.length };
  },
});
