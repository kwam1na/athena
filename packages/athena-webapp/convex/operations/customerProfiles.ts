import {
  internalMutation,
  internalQuery,
  MutationCtx,
} from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import {
  buildCustomerProfileDraft,
  findMatchingCustomerProfile,
  normalizeLookupValue,
} from "./helpers/linking";

type EnsureCustomerProfileArgs = {
  storeFrontUserId?: Id<"storeFrontUser">;
  guestId?: Id<"guest">;
  posCustomerId?: Id<"posCustomer">;
  fallbackStoreId?: Id<"store">;
  fallbackOrganizationId?: Id<"organization">;
};

function compactRecord<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, fieldValue]) => fieldValue !== undefined)
  ) as Partial<T>;
}

async function loadCustomerSources(
  ctx: MutationCtx,
  args: EnsureCustomerProfileArgs
) {
  const storeFrontUser = args.storeFrontUserId
    ? await ctx.db.get(args.storeFrontUserId)
    : null;
  const guest = args.guestId ? await ctx.db.get(args.guestId) : null;
  const posCustomer = args.posCustomerId ? await ctx.db.get(args.posCustomerId) : null;

  return { storeFrontUser, guest, posCustomer };
}

async function findExistingProfile(
  ctx: MutationCtx,
  draft: ReturnType<typeof buildCustomerProfileDraft>,
  args: EnsureCustomerProfileArgs
) {
  if (args.storeFrontUserId) {
    const linked = await ctx.db
      .query("customerProfile")
      .withIndex("by_storeFrontUserId", (q) =>
        q.eq("storeFrontUserId", args.storeFrontUserId!)
      )
      .first();

    if (linked) {
      return linked;
    }
  }

  if (args.guestId) {
    const linked = await ctx.db
      .query("customerProfile")
      .withIndex("by_guestId", (q) => q.eq("guestId", args.guestId!))
      .first();

    if (linked) {
      return linked;
    }
  }

  if (args.posCustomerId) {
    const linked = await ctx.db
      .query("customerProfile")
      .withIndex("by_posCustomerId", (q) => q.eq("posCustomerId", args.posCustomerId!))
      .first();

    if (linked) {
      return linked;
    }
  }

  const candidateProfiles = [];

  if (draft.email) {
    candidateProfiles.push(
      ...(await ctx.db
        .query("customerProfile")
        .withIndex("by_storeId_email", (q) =>
          q.eq("storeId", draft.storeId).eq("email", draft.email)
        )
        .collect())
    );
  }

  if (draft.phoneNumber) {
    candidateProfiles.push(
      ...(await ctx.db
        .query("customerProfile")
        .withIndex("by_storeId_phoneNumber", (q) =>
          q.eq("storeId", draft.storeId).eq("phoneNumber", draft.phoneNumber)
        )
        .collect())
    );
  }

  return findMatchingCustomerProfile(candidateProfiles, {
    storeId: draft.storeId,
    storeFrontUserId: args.storeFrontUserId,
    guestId: args.guestId,
    posCustomerId: args.posCustomerId,
    email: draft.email,
    phoneNumber: draft.phoneNumber,
  });
}

export const getById = internalQuery({
  args: {
    profileId: v.id("customerProfile"),
  },
  handler: async (ctx, args) => ctx.db.get(args.profileId),
});

export const getBySource = internalQuery({
  args: {
    storeFrontUserId: v.optional(v.id("storeFrontUser")),
    guestId: v.optional(v.id("guest")),
    posCustomerId: v.optional(v.id("posCustomer")),
    storeId: v.optional(v.id("store")),
    email: v.optional(v.string()),
    phoneNumber: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const storeId = args.storeId;

    if (args.storeFrontUserId) {
      return ctx.db
        .query("customerProfile")
        .withIndex("by_storeFrontUserId", (q) =>
          q.eq("storeFrontUserId", args.storeFrontUserId!)
        )
        .first();
    }

    if (args.guestId) {
      return ctx.db
        .query("customerProfile")
        .withIndex("by_guestId", (q) => q.eq("guestId", args.guestId!))
        .first();
    }

    if (args.posCustomerId) {
      return ctx.db
        .query("customerProfile")
        .withIndex("by_posCustomerId", (q) => q.eq("posCustomerId", args.posCustomerId!))
        .first();
    }

    if (!storeId) {
      return null;
    }

    const normalizedEmail = normalizeLookupValue(args.email);

    if (normalizedEmail) {
      const emailMatches = await ctx.db
        .query("customerProfile")
        .withIndex("by_storeId_email", (q) =>
          q.eq("storeId", storeId).eq("email", normalizedEmail)
        )
        .collect();

      const emailMatch = findMatchingCustomerProfile(emailMatches, {
        storeId,
        email: args.email,
        phoneNumber: args.phoneNumber,
      });

      if (emailMatch) {
        return emailMatch;
      }
    }

    if (!args.phoneNumber) {
      return null;
    }

    const phoneMatches = await ctx.db
      .query("customerProfile")
      .withIndex("by_storeId_phoneNumber", (q) =>
        q.eq("storeId", storeId).eq("phoneNumber", args.phoneNumber!)
      )
      .collect();

    return (
      findMatchingCustomerProfile(phoneMatches, {
        storeId,
        email: args.email,
        phoneNumber: args.phoneNumber,
      }) ?? null
    );
  },
});

export async function ensureCustomerProfileFromSourcesWithCtx(
  ctx: MutationCtx,
  args: EnsureCustomerProfileArgs
) {
  const sources = await loadCustomerSources(ctx, args);
  const draft = buildCustomerProfileDraft({
    ...sources,
    fallbackStoreId: args.fallbackStoreId,
    fallbackOrganizationId: args.fallbackOrganizationId,
  });
  const existing = await findExistingProfile(ctx, draft, args);

  if (existing) {
    const updates = compactRecord({
      fullName: draft.fullName,
      firstName: existing.firstName ?? draft.firstName,
      lastName: existing.lastName ?? draft.lastName,
      email: existing.email ?? draft.email,
      phoneNumber: existing.phoneNumber ?? draft.phoneNumber,
      preferredContactChannel:
        existing.preferredContactChannel ?? draft.preferredContactChannel,
      organizationId: existing.organizationId ?? draft.organizationId,
      storeFrontUserId: existing.storeFrontUserId ?? draft.storeFrontUserId,
      guestId: existing.guestId ?? draft.guestId,
      posCustomerId: existing.posCustomerId ?? draft.posCustomerId,
      status: existing.status ?? draft.status,
    });

    await ctx.db.patch(existing._id, updates);
    return ctx.db.get(existing._id);
  }

  const profileId = await ctx.db.insert("customerProfile", draft);
  return ctx.db.get(profileId);
}

export const ensureCustomerProfileFromSources = internalMutation({
  args: {
    storeFrontUserId: v.optional(v.id("storeFrontUser")),
    guestId: v.optional(v.id("guest")),
    posCustomerId: v.optional(v.id("posCustomer")),
    fallbackStoreId: v.optional(v.id("store")),
    fallbackOrganizationId: v.optional(v.id("organization")),
  },
  handler: (ctx, args) => ensureCustomerProfileFromSourcesWithCtx(ctx, args),
});
