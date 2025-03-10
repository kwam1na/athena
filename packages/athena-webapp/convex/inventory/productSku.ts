import { v } from "convex/values";
import { action, mutation, query } from "../_generated/server";
import { deleteFileInS3, uploadFileToS3 } from "../aws/aws";

export const generateUploadUrl = mutation(async (ctx) => {
  return await ctx.storage.generateUploadUrl();
});

export const getById = query({
  args: { id: v.id("productSku") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const retrieve = query({
  args: { id: v.id("productSku") },
  handler: async (ctx, args) => {
    const s = await ctx.db.get(args.id);
    if (s) {
      const product = await ctx.db.get(s.productId);

      return { ...s, productName: product?.name };
    }
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
