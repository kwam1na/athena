import {
  action,
  internalMutation,
  mutation,
  query,
} from "../_generated/server";
import { v } from "convex/values";
import { storeSchema } from "../schemas/inventory";
import { listItemsInS3Directory, uploadFileToS3 } from "../aws/aws";
import { api } from "../_generated/api";
import { Doc } from "../_generated/dataModel";

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

    // // const reelVersions = await ctx.
    // const reelVersions = await listItemsInS3Directory({
    //   directory: `stores/${args.organizationId}/assets/hero`,
    //   firstLevelOnly: true,
    // });

    return stores;
  },
});

export const getAllByOrganization = action({
  args: {
    organizationId: v.id("organization"),
  },
  handler: async (ctx, args) => {
    const stores: Doc<"store">[] = await ctx.runQuery(
      api.inventory.stores.getAll,
      {
        organizationId: args.organizationId,
      }
    );

    const reelVersions = await Promise.all(
      stores.map((store) => {
        return listItemsInS3Directory({
          directory: `stores/${store._id}/assets/hero`,
          firstLevelOnly: true,
        });
      })
    );

    const storesWithReelVersions = stores.map((store) => {
      const storeReelVersions = reelVersions.find((reelVersion) =>
        reelVersion.directory.includes(store._id)
      );

      const extractedVersions =
        storeReelVersions?.items
          ?.map((item) => {
            const match = item.key.match(/hero\/v(\d+)/);
            return match ? match[1] : null;
          })
          .filter(Boolean) || [];

      return {
        ...store,
        config: {
          ...store.config,
          reelVersions: extractedVersions,
        },
      };
    });

    return { storesWithReelVersions };
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

export const calculateTax = query({
  args: {
    storeId: v.id(entity),
    amount: v.number(),
  },
  returns: v.object({
    taxAmount: v.number(),
    totalWithTax: v.number(),
    taxRate: v.number(),
    taxName: v.string(),
  }),
  handler: async (ctx, args) => {
    const store = await ctx.db.get(args.storeId);

    if (!store || !store.config?.tax?.enabled) {
      return {
        taxAmount: 0,
        totalWithTax: args.amount,
        taxRate: 0,
        taxName: "Tax",
      };
    }

    const taxConfig = store.config.tax;
    const taxRate = taxConfig.rate || 0;
    const taxName = taxConfig.name || "Tax";

    let taxAmount: number;
    let totalWithTax: number;

    if (taxConfig.includedInPrice) {
      // Tax is included in the price, so we need to extract it
      taxAmount = (args.amount * taxRate) / (100 + taxRate);
      totalWithTax = args.amount;
    } else {
      // Tax is added on top of the price
      taxAmount = (args.amount * taxRate) / 100;
      totalWithTax = args.amount + taxAmount;
    }

    return {
      taxAmount: Math.round(taxAmount * 100) / 100, // Round to 2 decimal places
      totalWithTax: Math.round(totalWithTax * 100) / 100,
      taxRate,
      taxName,
    };
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

export const updateLandingPageReel = action({
  args: {
    storeId: v.id(entity),
    data: v.object({
      reelVersion: v.string(),
    }),
    config: v.record(v.string(), v.any()),
  },
  handler: async (ctx, args) => {
    const versions = await listItemsInS3Directory({
      directory: `stores/${args.storeId}/assets/hero`,
      firstLevelOnly: true,
    });

    const doesVersionExist = versions?.items?.some((version) =>
      version.key.includes(`hero/v${args.data.reelVersion}`)
    );

    if (!doesVersionExist) {
      return {
        success: false,
        errorMessage: "Version does not exist",
      };
    }

    await ctx.runMutation(api.inventory.stores.updateConfig, {
      id: args.storeId,
      config: args.config,
    });

    return { success: true };
  },
});

export const getReelVersions = action({
  args: {
    storeId: v.id(entity),
  },
  handler: async (ctx, args) => {
    const versions = await listItemsInS3Directory({
      directory: `stores/${args.storeId}/assets/hero`,
      firstLevelOnly: true,
    });

    return versions;
  },
});

export const clearExpiredRestrictions = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    const stores = await ctx.db.query(entity).collect();

    for (const store of stores) {
      const fulfillment = store.config?.fulfillment;
      if (!fulfillment) continue;

      let needsUpdate = false;
      const updates = { ...fulfillment };

      // Check pickup restriction
      if (fulfillment.pickupRestriction?.isActive) {
        const endTime = fulfillment.pickupRestriction.endTime;
        if (endTime && now > endTime) {
          updates.pickupRestriction = {
            ...fulfillment.pickupRestriction,
            isActive: false,
          };
          needsUpdate = true;
        }
      }

      // Check delivery restriction
      if (fulfillment.deliveryRestriction?.isActive) {
        const endTime = fulfillment.deliveryRestriction.endTime;
        if (endTime && now > endTime) {
          updates.deliveryRestriction = {
            ...fulfillment.deliveryRestriction,
            isActive: false,
          };
          needsUpdate = true;
        }
      }

      if (needsUpdate) {
        await ctx.db.patch(store._id, {
          config: { ...store.config, fulfillment: updates },
        });
      }
    }

    return null;
  },
});
