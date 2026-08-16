/* eslint-disable @convex-dev/no-collect-in-query -- Query refactors are tracked in V26-168, V26-169, and V26-170; this PR only hardens API boundaries. */
import {
  action,
  internalQuery,
  internalMutation,
  mutation,
  query,
} from "../_generated/server";
import { v, type Infer } from "convex/values";
import { storeSchema } from "../schemas/inventory";
import { listItemsInR2Directory, uploadFileToR2 } from "../cloudflare/r2";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  getUnknownStoreConfigRootKeys,
  isLegacyRootKey,
  mirrorLegacyKeys,
  normalizeStoreConfig,
  patchV2Config,
  removeLegacyRootKeysFromConfig,
  toV2Config,
} from "./storeConfigV2";
import { ok, userError } from "../../shared/commandResult";
import { normalizeCurrencyCode } from "../../shared/reportsContract";
import { commandResultValidator } from "../lib/commandResultValidators";
import {
  admitPublicAction,
  admitPublicMutation,
  admitPublicQuery,
} from "../platform/operationAdmission";
import { listOrganizationStoresReadDefinition } from "../operationAdmission/readDefinitions";
import {
  calculateStoreTaxReadDefinition,
  getStoreByIdReadDefinition,
  getStoreImageAssetsReadDefinition,
  preflightStoreConfigKeysReadDefinition,
} from "../operationAdmission/domains/u4_inventoryIdentity_readDefinitions";
import {
  cleanupLegacyStoreConfigKeysPageOperationDefinition,
  createStoreOperationDefinition,
  getStoreReelVersionsOperationDefinition,
  listStoresByOrganizationOperationDefinition,
  migrateStoreConfigToV2PageOperationDefinition,
  patchStoreConfigV2CommandOperationDefinition,
  patchStoreConfigV2OperationDefinition,
  removeStoreOperationDefinition,
  updateStoreLandingPageReelOperationDefinition,
  updateStoreOperationDefinition,
  uploadStoreImageAssetsOperationDefinition,
} from "../operationAdmission/domains/u4_inventoryIdentity_definitions";
import type {
  OperationMutationCtx,
  OperationQueryCtx,
} from "../operationAdmission/types";
import type { MutationCtx } from "../_generated/server";

const entity = "store";
const CONFIG_MIGRATION_PAGE_SIZE = 50;
const WEEKLY_ACCEPTED_DELETE_BATCH_SIZE = 100;

/**
 * Delete the weekly tables introduced by the EOW report for one store.
 *
 * Current and dirty rows are singletons. Accepted history is deleted in small
 * batches. A full batch schedules another mutation, so removing a store cannot
 * leave an older accepted baseline (or its inline amendment) behind or turn
 * one mutation into an unbounded cleanup. There is no separate weekly
 * diagnostics table in V1.
 */
export async function deleteWeeklyReportingForStoreWithCtx(
  ctx: MutationCtx,
  storeId: Id<"store">,
): Promise<{ deletedAcceptedRows: number; hasMore: boolean }> {
  const [current, dirty] = await Promise.all([
    ctx.db
      .query("reportWeekCurrent")
      .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
      .unique(),
    ctx.db
      .query("reportDirtyWeek")
      .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
      .unique(),
  ]);

  await Promise.all([
    ...(current ? [ctx.db.delete("reportWeekCurrent", current._id)] : []),
    ...(dirty ? [ctx.db.delete("reportDirtyWeek", dirty._id)] : []),
  ]);

  const accepted = await ctx.db
    .query("reportWeekAccepted")
    .withIndex("by_storeId_cycleStartDate", (q) => q.eq("storeId", storeId))
    .take(WEEKLY_ACCEPTED_DELETE_BATCH_SIZE);
  await Promise.all(
    accepted.map((row) => ctx.db.delete("reportWeekAccepted", row._id)),
  );
  return {
    deletedAcceptedRows: accepted.length,
    hasMore: accepted.length === WEEKLY_ACCEPTED_DELETE_BATCH_SIZE,
  };
}

export async function removeStoreWithCtx(
  ctx: MutationCtx,
  storeId: Id<"store">,
): Promise<boolean> {
  const store = await ctx.db.get("store", storeId);
  if (!store) return true;

  const cleanup = await deleteWeeklyReportingForStoreWithCtx(ctx, storeId);
  if (cleanup.hasMore) {
    await ctx.scheduler.runAfter(
      0,
      internal.inventory.stores.continueStoreRemoval,
      { storeId },
    );
    return false;
  }
  await ctx.db.delete("store", storeId);
  return true;
}

export const continueStoreRemoval = internalMutation({
  args: { storeId: v.id("store") },
  handler: async (ctx, args) => removeStoreWithCtx(ctx, args.storeId),
});

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
  handler: admitPublicQuery(
    listOrganizationStoresReadDefinition,
    async (
      ctx: OperationQueryCtx,
      args: { organizationId: Id<"organization"> },
    ) => {
      const admittedActor = ctx.operationAdmission.actor;
      if (
        admittedActor.kind === "shared_demo" &&
        args.organizationId !== admittedActor.organizationId
      )
        return [];
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
  ),
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
  // Retired here, re-expressed on the definition:
  // `sharedDemo.actor.requireAuthenticatedNonDemoEffect` -> `normalUser:
  // "admit"` + `sharedDemo: "deny"` + `public: "deny"`, and
  // `requireNonDemoFoundationMutation({ organizationId })` ->
  // `target.protectDemoFoundation` bound to `organizationId`.
  handler: admitPublicAction(
    listStoresByOrganizationOperationDefinition,
    async (ctx, args: { organizationId: Id<"organization"> }) => {
    const stores: Doc<"store">[] = await ctx.runQuery(
      internal.inventory.stores.getAllInternal,
      {
        organizationId: args.organizationId,
      },
    );

    const reelVersions = await Promise.all(
      stores.map((store) => {
        return listItemsInR2Directory({
          directory: `stores/${store._id}/assets/hero`,
          firstLevelOnly: true,
        });
      }),
    );

    const storesWithReelVersions = stores.map((store) => {
      const storeReelVersions = reelVersions.find((reelVersion) =>
        reelVersion.directory.includes(store._id),
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
  ),
});

export const getById = query({
  args: {
    id: v.id(entity),
  },
  handler: admitPublicQuery(
    getStoreByIdReadDefinition,
    async (ctx: OperationQueryCtx, args: { id: Id<"store"> }) => {
      return await ctx.db.get("store", args.id);
    },
  ),
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
            q.eq(q.field("organizationId"), args.organizationId),
          ),
          q.and(
            q.eq(q.field("slug"), args.identifier),
            q.eq(q.field("organizationId"), args.organizationId),
          ),
        ),
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
  // `requireNonDemoFoundationMutation({ organizationId })` retired here and
  // re-expressed as `target.protectDemoFoundation` bound to `organizationId`.
  handler: admitPublicMutation(
    createStoreOperationDefinition,
    async (
      ctx: OperationMutationCtx,
      args: Infer<typeof storeSchema>,
    ) => {
    // The store-creation form takes currency as free text, so it has shipped
    // values like "ghs" and " GHS ". Daily Close stamps report facts from
    // `store.currency` while POS facts carry the canonical uppercase code; a
    // day holding both used to read as mixed-currency and get excluded, which
    // blanked every weekly total. Normalize once, here, so the stored value is
    // canonical and no downstream reader has to guess.
    const id = await ctx.db.insert(entity, {
      ...args,
      currency: normalizeCurrencyCode(args.currency),
    });

    return await ctx.db.get("store", id);
    },
  ),
});

export const update = mutation({
  args: {
    id: v.id(entity),
    name: v.string(),
  },
  // `requireNonDemoFoundationMutation({ storeId: id })` retired here and
  // re-expressed as `target.protectDemoFoundation` bound to `id`.
  handler: admitPublicMutation(
    updateStoreOperationDefinition,
    async (
      ctx: OperationMutationCtx,
      args: { id: Id<"store">; name: string },
    ) => {
      await ctx.db.patch("store", args.id, { name: args.name });

      return await ctx.db.get("store", args.id);
    },
  ),
});

export const remove = mutation({
  args: {
    id: v.id(entity),
  },
  // Retired here, re-expressed on the definition:
  // `requireNonDemoFoundationMutation({ storeId: id })` ->
  // `target.protectDemoFoundation` bound to `id`, and
  // `requireSharedDemoCapabilityIfApplicable(ctx, "administration.destructive")`
  // -> `capability: "administration.destructive"` + `sharedDemo: "deny"`.
  handler: admitPublicMutation(
    removeStoreOperationDefinition,
    async (ctx: OperationMutationCtx, args: { id: Id<"store"> }) => {
      await removeStoreWithCtx(ctx, args.id);

      return { message: "OK" };
    },
  ),
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
  // `requireNonDemoFoundationMutation({ storeId: id })` retired here and
  // re-expressed as `target.protectDemoFoundation` bound to `id`.
  handler: admitPublicMutation(
    patchStoreConfigV2OperationDefinition,
    async (
      ctx: OperationMutationCtx,
      args: {
        id: Id<"store">;
        patch: Record<string, any>;
        mirrorLegacy?: boolean;
      },
    ) => {
    const store = await ctx.db.get("store", args.id);
    if (!store) {
      throw new Error("Store not found");
    }

    const nextV2Config = patchV2Config(store.config, args.patch);
    const shouldMirrorLegacy = args.mirrorLegacy !== false;
    const config = shouldMirrorLegacy
      ? mirrorLegacyKeys(nextV2Config, store.config)
      : toV2OnlyConfig(
          store.config ? { ...store.config, ...nextV2Config } : nextV2Config,
        );

    await ctx.db.patch("store", args.id, { config });

    return await ctx.db.get("store", args.id);
    },
  ),
});

export const patchConfigV2Command = mutation({
  args: {
    id: v.id(entity),
    patch: v.record(v.string(), v.any()),
    mirrorLegacy: v.optional(v.boolean()),
  },
  returns: commandResultValidator(v.any()),
  // Retired here, re-expressed on the definition:
  // `requireNonDemoFoundationMutation({ storeId: id })` ->
  // `target.protectDemoFoundation` bound to `id`, and
  // `requireSharedDemoCapabilityIfApplicable(ctx, "integrations.manage")` ->
  // `capability: "integrations.manage"` + `sharedDemo: "deny"`.
  handler: admitPublicMutation(
    patchStoreConfigV2CommandOperationDefinition,
    async (
      ctx: OperationMutationCtx,
      args: {
        id: Id<"store">;
        patch: Record<string, any>;
        mirrorLegacy?: boolean;
      },
    ) => {
    const store = await ctx.db.get("store", args.id);
    if (!store) {
      return userError({
        code: "not_found",
        message: "Store not found.",
      });
    }

    const nextV2Config = patchV2Config(store.config, args.patch);
    const shouldMirrorLegacy = args.mirrorLegacy !== false;
    const config = shouldMirrorLegacy
      ? mirrorLegacyKeys(nextV2Config, store.config)
      : toV2OnlyConfig(
          store.config ? { ...store.config, ...nextV2Config } : nextV2Config,
        );

    await ctx.db.patch("store", args.id, { config });

    return ok(await ctx.db.get("store", args.id));
    },
  ),
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
  handler: admitPublicQuery(
    preflightStoreConfigKeysReadDefinition,
    async (ctx: OperationQueryCtx) => {
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
  ),
});

export const migrateConfigToV2Page = mutation({
  args: {
    cursor: v.optional(v.string()),
  },
  // `requireAuthenticatedAthenaUserWithCtx(ctx)` retired here: the definition
  // declares `normalUser: "admit"` with `sharedDemo`/`public` denied.
  handler: admitPublicMutation(
    migrateStoreConfigToV2PageOperationDefinition,
    async (ctx: OperationMutationCtx, args: { cursor?: string }) => {
    const page = await ctx.db.query(entity).paginate({
      numItems: CONFIG_MIGRATION_PAGE_SIZE,
      cursor: args.cursor ?? null,
    });

    let migratedCount = 0;

    for (const store of page.page) {
      const currentConfig = store.config || {};
      const nextConfig = mirrorLegacyKeys(
        toV2Config(currentConfig),
        currentConfig,
      );

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
  ),
});

export const cleanupLegacyConfigKeysPage = mutation({
  args: {
    cursor: v.optional(v.string()),
  },
  // `requireAuthenticatedAthenaUserWithCtx(ctx)` retired here: the definition
  // declares `normalUser: "admit"` with `sharedDemo`/`public` denied.
  handler: admitPublicMutation(
    cleanupLegacyStoreConfigKeysPageOperationDefinition,
    async (ctx: OperationMutationCtx, args: { cursor?: string }) => {
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
  ),
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
  handler: admitPublicQuery(
    calculateStoreTaxReadDefinition,
    async (
      ctx: OperationQueryCtx,
      args: { storeId: Id<"store">; amount: number },
    ) => {
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
  ),
});

export const getImageAssets = query({
  args: {
    storeId: v.id(entity),
  },
  handler: admitPublicQuery(
    getStoreImageAssetsReadDefinition,
    async (ctx: OperationQueryCtx, args: { storeId: Id<"store"> }) => {
      const assets = await ctx.db
        .query("storeAsset")
        .filter((q) => q.eq(q.field("storeId"), args.storeId))
        .collect();

      return assets;
    },
  ),
});

export const uploadImageAssets = action({
  args: {
    images: v.array(v.bytes()),
    storeId: v.id("store"),
  },
  // Retired here, re-expressed on the definition:
  // `requireAuthenticatedNonDemoEffect` -> `normalUser: "admit"` +
  // `sharedDemo: "deny"` + `public: "deny"`; `requireNonDemoFoundationMutation`
  // -> `target.protectDemoFoundation` bound to `storeId`.
  handler: admitPublicAction(
    uploadStoreImageAssetsOperationDefinition,
    async (ctx, args: { images: ArrayBuffer[]; storeId: Id<"store"> }) => {
    const uploadPromises = args.images.map(async (imgBuffer) => {
      return uploadFileToR2(
        imgBuffer,
        `stores/${args.storeId}/assets/${crypto.randomUUID()}.webp`,
      );
    });
    const images = (await Promise.all(uploadPromises)).filter(
      (url) => url !== undefined,
    );

    await Promise.all(
      images.map((url) =>
        ctx.runMutation(internal.inventory.stores.createImageAsset, {
          storeId: args.storeId,
          url,
        }),
      ),
    );

    return { success: true, images };
    },
  ),
});

export const updateLandingPageReel = action({
  args: {
    storeId: v.id(entity),
    data: v.object({
      reelVersion: v.string(),
    }),
    config: v.record(v.string(), v.any()),
  },
  // Retired here, re-expressed on the definition:
  // `requireAuthenticatedNonDemoEffect` -> `normalUser: "admit"` +
  // `sharedDemo: "deny"` + `public: "deny"`; `requireNonDemoFoundationMutation`
  // -> `target.protectDemoFoundation` bound to `storeId`.
  handler: admitPublicAction(
    updateStoreLandingPageReelOperationDefinition,
    async (
      ctx,
      args: {
        storeId: Id<"store">;
        data: { reelVersion: string };
        config: Record<string, any>;
      },
    ) => {
    const versions = await listItemsInR2Directory({
      directory: `stores/${args.storeId}/assets/hero`,
      firstLevelOnly: true,
    });

    const doesVersionExist = versions?.items?.some((version) =>
      version.key.includes(`hero/v${args.data.reelVersion}`),
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
  ),
});

export const getReelVersions = action({
  args: {
    storeId: v.id(entity),
  },
  // Retired here, re-expressed on the definition:
  // `requireAuthenticatedNonDemoEffect` -> `normalUser: "admit"` +
  // `sharedDemo: "deny"` + `public: "deny"`; `requireNonDemoFoundationMutation`
  // -> `target.protectDemoFoundation` bound to `storeId`.
  handler: admitPublicAction(
    getStoreReelVersionsOperationDefinition,
    async (ctx, args: { storeId: Id<"store"> }) => {
      const versions = await listItemsInR2Directory({
        directory: `stores/${args.storeId}/assets/hero`,
        firstLevelOnly: true,
      });

      return versions;
    },
  ),
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
