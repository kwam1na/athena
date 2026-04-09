/* eslint-disable @convex-dev/no-collect-in-query -- Query refactors are tracked in V26-168, V26-169, and V26-170; this PR only hardens API boundaries. */
import {
  action,
  internalQuery,
  internalMutation,
  mutation,
  query,
} from "../_generated/server";
import { v } from "convex/values";
import { storeSchema } from "../schemas/inventory";
import { listItemsInR2Directory, uploadFileToR2 } from "../cloudflare/r2";
import { api, internal } from "../_generated/api";
import { Doc } from "../_generated/dataModel";
import {
  getUnknownStoreConfigRootKeys,
  isLegacyRootKey,
  mirrorLegacyKeys,
  normalizeStoreConfig,
  patchV2Config,
  removeLegacyRootKeysFromConfig,
  toV2Config,
} from "./storeConfigV2";

const entity = "store";
const CONFIG_MIGRATION_PAGE_SIZE = 50;

const toV2OnlyConfig = (existingConfig: unknown) => {
  const normalized = toV2Config(existingConfig);
  const withoutLegacy = removeLegacyRootKeysFromConfig(existingConfig);

  return {
    ...withoutLegacy,
    operations: normalized.operations,
    commerce: normalized.commerce,
    media: normalized.media,
    promotions: normalized.promotions,
    contact: normalized.contact,
    payments: normalized.payments,
  };
};

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
    // const reelVersions = await listItemsInR2Directory({
    //   directory: `stores/${args.organizationId}/assets/hero`,
    //   firstLevelOnly: true,
    // });

    return stores;
  },
});

export const getAllInternal = internalQuery({
  args: {
    organizationId: v.id("organization"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query(entity)
      .filter((q) => q.eq(q.field("organizationId"), args.organizationId))
      .collect();
  },
});

export const getAllByOrganization = action({
  args: {
    organizationId: v.id("organization"),
  },
  handler: async (ctx, args) => {
    const stores: Doc<"store">[] = await ctx.runQuery(
      internal.inventory.stores.getAllInternal,
      {
        organizationId: args.organizationId,
      }
    );

    const reelVersions = await Promise.all(
      stores.map((store) => {
        return listItemsInR2Directory({
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
    return await ctx.db.get("store", args.id);
  },
});

export const findById = internalQuery({
  args: {
    id: v.id(entity),
  },
  handler: async (ctx, args) => {
    const store = await ctx.db.get("store", args.id);

    return store;
  },
});

export const findByName = internalQuery({
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

export const getByIdOrSlug = internalQuery({
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

    return await ctx.db.get("store", id);
  },
});

export const update = mutation({
  args: {
    id: v.id(entity),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch("store", args.id, { name: args.name });

    return await ctx.db.get("store", args.id);
  },
});

export const remove = mutation({
  args: {
    id: v.id(entity),
  },
  handler: async (ctx, args) => {
    await ctx.db.delete("store", args.id);

    return { message: "OK" };
  },
});

export const updateConfig = internalMutation({
  args: {
    id: v.id(entity),
    config: v.record(v.string(), v.any()),
  },
  handler: async (ctx, args) => {
    const normalized = toV2Config(args.config);
    const config = mirrorLegacyKeys(normalized, args.config);

    await ctx.db.patch("store", args.id, { config });

    return await ctx.db.get("store", args.id);
  },
});

export const patchConfigV2 = mutation({
  args: {
    id: v.id(entity),
    patch: v.record(v.string(), v.any()),
    mirrorLegacy: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const store = await ctx.db.get("store", args.id);
    if (!store) {
      throw new Error("Store not found");
    }

    const nextV2Config = patchV2Config(store.config, args.patch);
    const shouldMirrorLegacy = args.mirrorLegacy !== false;
    const config = shouldMirrorLegacy
      ? mirrorLegacyKeys(nextV2Config, store.config)
      : toV2OnlyConfig(store.config ? { ...store.config, ...nextV2Config } : nextV2Config);

    await ctx.db.patch("store", args.id, { config });

    return await ctx.db.get("store", args.id);
  },
});

export const patchConfigV2Internal = internalMutation({
  args: {
    id: v.id(entity),
    patch: v.record(v.string(), v.any()),
  },
  handler: async (ctx, args) => {
    const store = await ctx.db.get("store", args.id);

    if (!store) {
      throw new Error("Store not found");
    }

    const nextConfig = patchV2Config(store.config, args.patch);

    await ctx.db.patch("store", args.id, { config: nextConfig });

    return await ctx.db.get("store", args.id);
  },
});

export const preflightConfigKeys = query({
  args: {},
  handler: async (ctx) => {
    const stores = await ctx.db.query(entity).collect();

    const keyCounts: Record<string, number> = {};
    const unknownKeyCounts: Record<string, number> = {};
    const storesWithUnknownKeys: Array<{
      storeId: string;
      storeName: string;
      unknownKeys: string[];
    }> = [];

    let storesWithConfig = 0;

    for (const store of stores) {
      if (!store.config || typeof store.config !== "object") {
        continue;
      }

      storesWithConfig += 1;

      for (const key of Object.keys(store.config)) {
        keyCounts[key] = (keyCounts[key] || 0) + 1;
      }

      const unknownKeys = getUnknownStoreConfigRootKeys(store.config);
      if (unknownKeys.length > 0) {
        storesWithUnknownKeys.push({
          storeId: store._id,
          storeName: store.name,
          unknownKeys,
        });

        for (const key of unknownKeys) {
          unknownKeyCounts[key] = (unknownKeyCounts[key] || 0) + 1;
        }
      }
    }

    return {
      totalStores: stores.length,
      storesWithConfig,
      keyCounts,
      unknownKeyCounts,
      storesWithUnknownKeys,
    };
  },
});

export const migrateConfigToV2Page = mutation({
  args: {
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db.query(entity).paginate({
      numItems: CONFIG_MIGRATION_PAGE_SIZE,
      cursor: args.cursor ?? null,
    });

    let migratedCount = 0;

    for (const store of page.page) {
      const currentConfig = store.config || {};
      const nextConfig = mirrorLegacyKeys(toV2Config(currentConfig), currentConfig);

      if (JSON.stringify(currentConfig) === JSON.stringify(nextConfig)) {
        continue;
      }

      await ctx.db.patch("store", store._id, { config: nextConfig });
      migratedCount += 1;
    }

    return {
      success: true,
      processedCount: page.page.length,
      migratedCount,
      isDone: page.isDone,
      cursor: page.continueCursor,
    };
  },
});

export const cleanupLegacyConfigKeysPage = mutation({
  args: {
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db.query(entity).paginate({
      numItems: CONFIG_MIGRATION_PAGE_SIZE,
      cursor: args.cursor ?? null,
    });

    let cleanedCount = 0;
    let removedLegacyKeyCount = 0;

    for (const store of page.page) {
      const currentConfig = store.config || {};
      const currentKeys = Object.keys(currentConfig);
      const legacyKeys = currentKeys.filter((key) => isLegacyRootKey(key));
      const nextConfig = toV2OnlyConfig(currentConfig);

      if (JSON.stringify(currentConfig) === JSON.stringify(nextConfig)) {
        continue;
      }

      await ctx.db.patch("store", store._id, { config: nextConfig });
      cleanedCount += 1;
      removedLegacyKeyCount += legacyKeys.length;
    }

    return {
      success: true,
      processedCount: page.page.length,
      cleanedCount,
      removedLegacyKeyCount,
      isDone: page.isDone,
      cursor: page.continueCursor,
    };
  },
});

export const createImageAsset = internalMutation({
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
    const store = await ctx.db.get("store", args.storeId);
    const normalizedConfig = normalizeStoreConfig(store?.config);
    const taxConfig = normalizedConfig.commerce.tax;

    if (!store || !taxConfig?.enabled) {
      return {
        taxAmount: 0,
        totalWithTax: args.amount,
        taxRate: 0,
        taxName: "Tax",
      };
    }

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
      return uploadFileToR2(
        imgBuffer,
        `stores/${args.storeId}/assets/${crypto.randomUUID()}.webp`
      );
    });
    const images = (await Promise.all(uploadPromises)).filter(
      (url) => url !== undefined
    );

    await Promise.all(
      images.map((url) =>
        ctx.runMutation(internal.inventory.stores.createImageAsset, {
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
    const versions = await listItemsInR2Directory({
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

    await ctx.runMutation(internal.inventory.stores.updateConfig, {
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
    const versions = await listItemsInR2Directory({
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
      const normalizedConfig = normalizeStoreConfig(store.config);
      const fulfillment = normalizedConfig.commerce.fulfillment;
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
        const nextConfig = mirrorLegacyKeys(
          patchV2Config(store.config, {
            commerce: { fulfillment: updates },
          }),
          store.config,
        );

        await ctx.db.patch("store", store._id, {
          config: nextConfig,
        });
      }
    }

    return null;
  },
});
