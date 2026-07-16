/* eslint-disable @convex-dev/no-collect-in-query -- Query refactors are tracked in V26-168, V26-169, and V26-170; this PR only hardens API boundaries. */
import {
  action,
  internalQuery,
  internalMutation,
  mutation,
  query,
  type MutationCtx,
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
import { getSharedDemoActorWithCtx, requireSharedDemoCapabilityIfApplicable } from "../sharedDemo/actor";
import { ok, userError } from "../../shared/commandResult";
import { requireNonDemoFoundationMutation } from "../sharedDemo/foundation";
import { commandResultValidator } from "../lib/commandResultValidators";
import {
  requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx,
} from "../lib/athenaUserAuth";
import { getAuthenticatedActorWithCtx } from "../lib/authenticatedActor";
import type { ServicePrincipalFoundationMutationCtx } from "../schemas/servicePrincipals";
import {
  decommissionServicePrincipalAuthBinding,
  reconcileServicePrincipal,
  STORE_SERVICE_PRINCIPAL_STABLE_KEY,
  transitionServicePrincipal,
} from "../servicePrincipals/lifecycle";
import { recordOperationalEventWithCtx } from "../operations/operationalEvents";

const entity = "store";
const CONFIG_MIGRATION_PAGE_SIZE = 50;

type StoreMutationCtx = Parameters<typeof getAuthenticatedActorWithCtx>[0] & {
  db: MutationCtx["db"];
};

function servicePrincipalFoundationCtx(
  ctx: StoreMutationCtx,
): ServicePrincipalFoundationMutationCtx {
  return ctx as unknown as ServicePrincipalFoundationMutationCtx;
}

async function requireStoreLifecycleFullAdmin(
  ctx: StoreMutationCtx,
  args: {
    createdByUserId?: Doc<"athenaUser">["_id"];
    organizationId: Doc<"organization">["_id"];
  },
) {
  const actor = await getAuthenticatedActorWithCtx(ctx);
  if (
    actor?.kind !== "human" ||
    (args.createdByUserId !== undefined &&
      actor.athenaUserId !== args.createdByUserId)
  ) {
    throw new Error("A full administrator is required for this store.");
  }
  await requireOrganizationMemberRoleWithCtx(ctx, {
    allowedRoles: ["full_admin"],
    failureMessage: "A full administrator is required for this store.",
    organizationId: args.organizationId,
    userId: actor.athenaUserId,
  });
  return actor;
}

export async function createStoreWithLifecycleWithCtx(
  ctx: StoreMutationCtx,
  args: Omit<Doc<"store">, "_creationTime" | "_id">,
  options: { now?: number } = {},
) {
  requireNonDemoFoundationMutation({ organizationId: args.organizationId });
  const actor = await requireStoreLifecycleFullAdmin(ctx, {
    createdByUserId: args.createdByUserId,
    organizationId: args.organizationId,
  });
  const now = options.now ?? Date.now();
  const storeId = await ctx.db.insert("store", args);
  const principal = await reconcileServicePrincipal(
    servicePrincipalFoundationCtx(ctx),
    {
      organizationId: args.organizationId,
      storeId,
      correlationId: `store-create:${storeId}`,
      now,
      stableKey: STORE_SERVICE_PRINCIPAL_STABLE_KEY,
    },
  );
  await recordOperationalEventWithCtx(ctx as MutationCtx, {
    actorType: "human",
    actorUserId: actor.athenaUserId,
    eventType: "service_principal.reconciled",
    message: "Store service authority was reconciled.",
    organizationId: args.organizationId,
    servicePrincipalId: principal.servicePrincipalId,
    storeId,
    subjectId: String(principal.servicePrincipalId),
    subjectType: "service_principal",
  });
  return ctx.db.get("store", storeId);
}

export async function decommissionStoreServicePrincipalWithCtx(
  ctx: StoreMutationCtx,
  args: {
    actorUserId: Doc<"athenaUser">["_id"];
    store: Doc<"store">;
  },
  options: { now?: number } = {},
) {
  const now = options.now ?? Date.now();
  const foundationCtx = servicePrincipalFoundationCtx(ctx);
  const principals = await foundationCtx.db
    .query("servicePrincipal")
    .withIndex(
      "by_organizationId_and_storeId_and_stableKey",
      (query) =>
        query
          .eq("organizationId", args.store.organizationId)
          .eq("storeId", args.store._id)
          .eq("stableKey", STORE_SERVICE_PRINCIPAL_STABLE_KEY),
    )
    .take(2);
  if (principals.length > 1) throw new Error("duplicate_principal");
  const principal = principals[0];
  if (!principal) return null;

  const bindings = await foundationCtx.db
    .query("servicePrincipalAuthBinding")
    .withIndex("by_servicePrincipalId", (query) =>
      query.eq("servicePrincipalId", principal._id),
    )
    .take(2);
  if (bindings.length > 1) throw new Error("auth_binding_duplicated");
  const binding = bindings[0];
  if (binding) {
    await decommissionServicePrincipalAuthBinding(foundationCtx, {
      correlationId: `store-delete:${args.store._id}`,
      expectedRevision: binding.revision,
      now,
      servicePrincipalAuthBindingId: binding._id,
    });
  }
  await transitionServicePrincipal(foundationCtx, {
    correlationId: `store-delete:${args.store._id}`,
    expectedRevision: principal.lifecycleRevision,
    nextStatus: "decommissioned",
    now,
    servicePrincipalId: principal._id,
  });
  await recordOperationalEventWithCtx(ctx as MutationCtx, {
    actorType: "human",
    actorUserId: args.actorUserId,
    eventType: "service_principal.decommissioned",
    message: "Store service authority was decommissioned.",
    organizationId: args.store.organizationId,
    servicePrincipalId: principal._id,
    storeId: args.store._id,
    subjectId: String(principal._id),
    subjectType: "service_principal",
  });
  return { servicePrincipalId: principal._id };
}

export async function removeStoreWithLifecycleWithCtx(
  ctx: StoreMutationCtx,
  args: { id: Doc<"store">["_id"] },
  options: { now?: number } = {},
) {
  requireNonDemoFoundationMutation({ storeId: args.id });
  await requireSharedDemoCapabilityIfApplicable(
    ctx,
    "administration.destructive",
  );
  const store = await ctx.db.get("store", args.id);
  if (!store) throw new Error("Store not found.");
  const actor = await requireStoreLifecycleFullAdmin(ctx, {
    organizationId: store.organizationId,
  });
  await decommissionStoreServicePrincipalWithCtx(
    ctx,
    { actorUserId: actor.athenaUserId, store },
    options,
  );
  await ctx.db.delete("store", args.id);
  return { message: "OK" };
}

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
    const demoActor = await getSharedDemoActorWithCtx(ctx);
    if (demoActor && args.organizationId !== demoActor.organizationId) return [];
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
    await ctx.runQuery(
      (internal as any).sharedDemo.actor.requireAuthenticatedNonDemoEffect,
      {},
    );
    requireNonDemoFoundationMutation({ organizationId: args.organizationId });
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
    return createStoreWithLifecycleWithCtx(ctx, args);
  },
});

export const update = mutation({
  args: {
    id: v.id(entity),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    requireNonDemoFoundationMutation({ storeId: args.id });
    await ctx.db.patch("store", args.id, { name: args.name });

    return await ctx.db.get("store", args.id);
  },
});

export const remove = mutation({
  args: {
    id: v.id(entity),
  },
  handler: async (ctx, args) => {
    return removeStoreWithLifecycleWithCtx(ctx, args);
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
    requireNonDemoFoundationMutation({ storeId: args.id });
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

export const patchConfigV2Command = mutation({
  args: {
    id: v.id(entity),
    patch: v.record(v.string(), v.any()),
    mirrorLegacy: v.optional(v.boolean()),
  },
  returns: commandResultValidator(v.any()),
  handler: async (ctx, args) => {
    requireNonDemoFoundationMutation({ storeId: args.id });
    await requireSharedDemoCapabilityIfApplicable(ctx, "integrations.manage");
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
      : toV2OnlyConfig(store.config ? { ...store.config, ...nextV2Config } : nextV2Config);

    await ctx.db.patch("store", args.id, { config });

    return ok(await ctx.db.get("store", args.id));
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
    await requireAuthenticatedAthenaUserWithCtx(ctx);
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
    await requireAuthenticatedAthenaUserWithCtx(ctx);
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
    await ctx.runQuery(
      (internal as any).sharedDemo.actor.requireAuthenticatedNonDemoEffect,
      {},
    );
    requireNonDemoFoundationMutation({ storeId: args.storeId });
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
    await ctx.runQuery(
      (internal as any).sharedDemo.actor.requireAuthenticatedNonDemoEffect,
      {},
    );
    requireNonDemoFoundationMutation({ storeId: args.storeId });
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
    await ctx.runQuery(
      (internal as any).sharedDemo.actor.requireAuthenticatedNonDemoEffect,
      {},
    );
    requireNonDemoFoundationMutation({ storeId: args.storeId });
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
