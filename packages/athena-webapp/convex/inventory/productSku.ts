import { v } from "convex/values";
import { action, mutation, query } from "../_generated/server";
import { deleteFileInS3, uploadFileToS3 } from "../aws/aws";

export const generateUploadUrl = mutation(async (ctx) => {
  return await ctx.storage.generateUploadUrl();
});

export const getById = query({
  args: { id: v.id("productSku") },
  handler: async (ctx, args) => {
    const s = await ctx.db.get(args.id);
    if (s && !s.productName) {
      const product = await ctx.db.get(s.productId);

      return { ...s, productName: product?.name };
    }

    return s;
  },
});

export const retrieve = query({
  args: { id: v.id("productSku") },
  handler: async (ctx, args) => {
    const s = await ctx.db.get(args.id);
    if (s && !s.productName) {
      const product = await ctx.db.get(s.productId);

      return { ...s, productName: product?.name };
    }

    return s;
  },
});

export const update = mutation({
  args: { id: v.id("productSku"), update: v.record(v.string(), v.any()) },
  handler: async (ctx, args) => {
    if (args.update.images) {
      await ctx.db.patch(args.id, {
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
      return uploadFileToS3(
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
      return deleteFileInS3(url);
    });

    await Promise.all(deletePromises);

    return { success: true };
  },
});

export const nukeProblematicImages = mutation({
  args: {},
  handler: async (ctx) => {
    const productSkus = await ctx.db.query("productSku").collect();
    const bucket = process.env.AWS_BUCKET;

    if (!bucket) throw new Error("Missing AWS_BUCKET env var");

    const updates = productSkus.flatMap((sku) => {
      if (!Array.isArray(sku.images)) return [];

      const validImages = sku.images.filter(
        (img) => typeof img === "string" && img.includes(bucket)
      );

      if (validImages.length === sku.images.length) return [];

      return [
        ctx.db.patch(sku._id, { images: validImages }).then(() => {
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
      return ctx.db.patch(sku._id, { isVisible: true }).then(() => {
        console.log(`✅ SKU ${sku._id}: set isVisible to true`);
      });
    });

    await Promise.allSettled(updates);

    return { success: true, updatedCount: productSkus.length };
  },
});
