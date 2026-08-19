import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx,
} from "../lib/athenaUserAuth";
import {
  admitPublicMutation,
  admitPublicQuery,
} from "../platform/operationAdmission";
import {
  removeBannerMessageOperationDefinition,
  upsertBannerMessageOperationDefinition,
} from "../operationAdmission/domains/inventoryCatalog_definitions";
import {
  getBannerMessageReadDefinition,
  getPublicActiveBannerMessageReadDefinition,
} from "../operationAdmission/domains/inventoryCatalog_readDefinitions";
import type {
  OperationMutationCtx,
  OperationQueryCtx,
} from "../operationAdmission/types";

const entity = "bannerMessage";

type BannerMessageLike = {
  _id?: unknown;
  _creationTime?: unknown;
  storeId?: unknown;
  heading?: string;
  message?: string;
  active: boolean;
  countdownEndsAt?: number;
} | null;

export type PublicBannerMessage = {
  heading?: string;
  message?: string;
  countdownEndsAt?: number;
};

async function requireHomepageStoreAdmin(
  ctx: QueryCtx | MutationCtx,
  storeId: Id<"store">,
) {
  const store = await ctx.db.get("store", storeId);
  if (!store) {
    throw new Error("Store not found.");
  }

  const athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
  await requireOrganizationMemberRoleWithCtx(ctx, {
    allowedRoles: ["full_admin"],
    failureMessage: "You do not have access to manage homepage content.",
    organizationId: store.organizationId,
    userId: athenaUser._id,
  });

  return store;
}

export const publicBannerMessageValidator = v.union(
  v.null(),
  v.object({
    heading: v.optional(v.string()),
    message: v.optional(v.string()),
    countdownEndsAt: v.optional(v.number()),
  }),
);

const normalizeDisplayText = (value?: string) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

export const presentPublicBannerMessage = (
  bannerMessage: BannerMessageLike,
  nowMs: number,
): PublicBannerMessage | null => {
  if (!bannerMessage?.active) {
    return null;
  }

  if (
    bannerMessage.countdownEndsAt !== undefined &&
    bannerMessage.countdownEndsAt <= nowMs
  ) {
    return null;
  }

  const heading = normalizeDisplayText(bannerMessage.heading);
  const message = normalizeDisplayText(bannerMessage.message);

  if (!heading && !message) {
    return null;
  }

  return {
    ...(heading ? { heading } : {}),
    ...(message ? { message } : {}),
    ...(bannerMessage.countdownEndsAt !== undefined
      ? { countdownEndsAt: bannerMessage.countdownEndsAt }
      : {}),
  };
};

export const expireActiveBannerMessage = internalMutation({
  args: {
    storeId: v.id("store"),
    countdownEndsAt: v.number(),
  },
  handler: async (ctx, args) => {
    const bannerMessage = await ctx.db
      .query(entity)
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .filter((q) => q.eq(q.field("active"), true))
      .first();

    if (
      bannerMessage &&
      bannerMessage.countdownEndsAt === args.countdownEndsAt &&
      bannerMessage.active
    ) {
      await ctx.db.patch("bannerMessage", bannerMessage._id, { active: false });
    }
  },
});

export const get = query({
  args: {
    storeId: v.id("store"),
  },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("bannerMessage"),
      _creationTime: v.number(),
      storeId: v.id("store"),
      heading: v.optional(v.string()),
      message: v.optional(v.string()),
      active: v.boolean(),
      countdownEndsAt: v.optional(v.number()),
    })
  ),
  handler: admitPublicQuery(
    getBannerMessageReadDefinition,
    async (ctx: OperationQueryCtx, args: { storeId: Id<"store"> }) => {
      return (
        (await ctx.db
          .query(entity)
          .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
          .first()) ?? null
      );
    },
  ),
});

async function getPublicActiveBannerMessageWithCtx(
  ctx: QueryCtx,
  args: { storeId: Id<"store">; nowMs: number },
) {
  const bannerMessage = await ctx.db
    .query(entity)
    .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
    .first();

  return presentPublicBannerMessage(bannerMessage, args.nowMs);
}

export const getPublicActive = query({
  args: {
    storeId: v.id("store"),
    nowMs: v.number(),
  },
  returns: publicBannerMessageValidator,
  handler: admitPublicQuery(
    getPublicActiveBannerMessageReadDefinition,
    async (
      ctx: OperationQueryCtx,
      args: { storeId: Id<"store">; nowMs: number },
    ) => getPublicActiveBannerMessageWithCtx(ctx, args),
  ),
});

/**
 * Internal sibling for the anonymous `GET /banner-message` route. The public
 * export stays until wave B2 flips the route to this reference.
 */
export const getPublicActiveInternal = internalQuery({
  args: {
    storeId: v.id("store"),
    nowMs: v.number(),
  },
  returns: publicBannerMessageValidator,
  handler: async (ctx, args) => getPublicActiveBannerMessageWithCtx(ctx, args),
});

export const upsert = mutation({
  args: {
    storeId: v.id("store"),
    heading: v.optional(v.string()),
    message: v.optional(v.string()),
    active: v.boolean(),
    countdownEndsAt: v.optional(v.number()),
    currentTimeMs: v.number(),
  },
  returns: v.object({
    _id: v.id("bannerMessage"),
    _creationTime: v.number(),
    storeId: v.id("store"),
    heading: v.optional(v.string()),
    message: v.optional(v.string()),
    active: v.boolean(),
    countdownEndsAt: v.optional(v.number()),
  }),
  handler: admitPublicMutation(
    upsertBannerMessageOperationDefinition,
    async (
      ctx: OperationMutationCtx,
      args: {
        storeId: Id<"store">;
        heading?: string;
        message?: string;
        active: boolean;
        countdownEndsAt?: number;
        currentTimeMs: number;
      },
    ) => {
    await requireHomepageStoreAdmin(ctx, args.storeId);

    const shouldActivate =
      args.active &&
      (!args.countdownEndsAt || args.countdownEndsAt > args.currentTimeMs);

    const existing = await ctx.db
      .query(entity)
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .first();

    if (existing) {
      await ctx.db.patch("bannerMessage", existing._id, {
        heading: args.heading,
        message: args.message,
        active: shouldActivate,
        countdownEndsAt: args.countdownEndsAt,
      });

      if (shouldActivate && args.countdownEndsAt) {
        await ctx.scheduler.runAt(
          args.countdownEndsAt,
          internal.inventory.bannerMessage.expireActiveBannerMessage,
          {
            storeId: args.storeId,
            countdownEndsAt: args.countdownEndsAt,
          }
        );
      }

      const updated = await ctx.db.get("bannerMessage", existing._id);
      if (!updated) {
        throw new Error("Failed to get updated banner message");
      }
      return updated;
    }

    const id = await ctx.db.insert(entity, {
      storeId: args.storeId,
      heading: args.heading,
      message: args.message,
      active: shouldActivate,
      countdownEndsAt: args.countdownEndsAt,
    });

    if (shouldActivate && args.countdownEndsAt) {
      await ctx.scheduler.runAt(
        args.countdownEndsAt,
        internal.inventory.bannerMessage.expireActiveBannerMessage,
        {
          storeId: args.storeId,
          countdownEndsAt: args.countdownEndsAt,
        }
      );
    }

    const created = await ctx.db.get("bannerMessage", id);
    if (!created) {
      throw new Error("Failed to get created banner message");
    }
    return created;
    },
  ),
});

export const remove = mutation({
  args: {
    id: v.id(entity),
  },
  returns: v.boolean(),
  handler: admitPublicMutation(
    removeBannerMessageOperationDefinition,
    async (ctx: OperationMutationCtx, args: { id: Id<"bannerMessage"> }) => {
      const existing = await ctx.db.get("bannerMessage", args.id);
      if (!existing) {
        return true;
      }

      await requireHomepageStoreAdmin(ctx, existing.storeId);
      await ctx.db.delete("bannerMessage", args.id);
      return true;
    },
  ),
});
