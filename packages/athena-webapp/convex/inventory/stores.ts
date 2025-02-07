import { action, mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { storeSchema } from "../schemas/inventory";
import { uploadFileToS3 } from "../aws/aws";
import { api } from "../_generated/api";

const entity = "store";

export const getAll = query({
  args: {
    organizationId: v.id("organization"),
  },
  handler: async (ctx, args) => {
    const stores = await ctx.db
      .query(entity)
      .filter((q) => q.eq(q.field("organizationId"), args.organizationId))
      .collect();

    return stores;
  },
});

export const getById = query({
  args: {
    id: v.id(entity),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const findById = query({
  args: {
    id: v.id(entity),
  },
  handler: async (ctx, args) => {
    const store = await ctx.db.get(args.id);

    return store;
  },
});

export const findByName = query({
  args: {
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const store = await ctx.db
      .query(entity)
      .filter((q) => q.eq(q.field("name"), args.name))
      .first();

    return store;
  },
});

export const getByIdOrSlug = query({
  args: {
    identifier: v.union(v.id(entity), v.string()),
    organizationId: v.id("organization"),
  },
  handler: async (ctx, args) => {
    const store = await ctx.db
      .query(entity)
      .filter((q) =>
        q.or(
          q.and(
            q.eq(q.field("_id"), args.identifier),
            q.eq(q.field("organizationId"), args.organizationId)
          ),
          q.and(
            q.eq(q.field("slug"), args.identifier),
            q.eq(q.field("organizationId"), args.organizationId)
          )
        )
      )
      .first();

    if (!store) {
      return null;
    }

    return store;
  },
});

export const create = mutation({
  args: storeSchema,
  handler: async (ctx, args) => {
    const id = await ctx.db.insert(entity, args);

    return await ctx.db.get(id);
  },
});

export const update = mutation({
  args: {
    id: v.id(entity),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { name: args.name });

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

export const updateConfig = mutation({
  args: {
    id: v.id(entity),
    config: v.record(v.string(), v.any()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { config: args.config });

    return await ctx.db.get(args.id);
  },
});

export const createImageAsset = mutation({
  args: {
    storeId: v.id(entity),
    url: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("storeAsset", {
      url: args.url,
      storeId: args.storeId,
    });

    return { success: true };
  },
});

export const getImageAssets = query({
  args: {
    storeId: v.id(entity),
  },
  handler: async (ctx, args) => {
    const assets = await ctx.db
      .query("storeAsset")
      .filter((q) => q.eq(q.field("storeId"), args.storeId))
      .collect();

    return assets;
  },
});

export const uploadImageAssets = action({
  args: {
    images: v.array(v.bytes()),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    const uploadPromises = args.images.map(async (imgBuffer) => {
      return uploadFileToS3(
        imgBuffer,
        `stores/${args.storeId}/assets/${crypto.randomUUID()}.webp`
      );
    });
    const images = (await Promise.all(uploadPromises)).filter(
      (url) => url !== undefined
    );

    await Promise.all(
      images.map((url) =>
        ctx.runMutation(api.inventory.stores.createImageAsset, {
          storeId: args.storeId,
          url,
        })
      )
    );

    return { success: true, images };
  },
});
