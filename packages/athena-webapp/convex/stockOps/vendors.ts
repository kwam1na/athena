import { mutation, query, type MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { ok, userError, type CommandResult } from "../../shared/commandResult";
import { commandResultValidator } from "../lib/commandResultValidators";
import { requireStoreFullAdminAccess } from "./access";

const MAX_VENDORS = 200;

const createVendorArgs = {
  storeId: v.id("store"),
  name: v.string(),
  code: v.optional(v.string()),
  contactName: v.optional(v.string()),
  email: v.optional(v.string()),
  phoneNumber: v.optional(v.string()),
  notes: v.optional(v.string()),
  createdByUserId: v.optional(v.id("athenaUser")),
};

type CreateVendorArgs = {
  storeId: Id<"store">;
  name: string;
  code?: string;
  contactName?: string;
  email?: string;
  phoneNumber?: string;
  notes?: string;
  createdByUserId?: Id<"athenaUser">;
};

function trimOptional(value?: string | null) {
  const nextValue = value?.trim();
  return nextValue ? nextValue : undefined;
}

export function normalizeVendorLookupKey(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function mapCreateVendorError(
  error: unknown,
): CommandResult<never> | null {
  const message = error instanceof Error ? error.message : "";

  if (message === "Store not found.") {
    return userError({
      code: "not_found",
      message,
    });
  }

  if (message === "Vendor name is required.") {
    return userError({
      code: "validation_failed",
      message,
    });
  }

  if (message === "A vendor with this name already exists for this store.") {
    return userError({
      code: "conflict",
      message,
    });
  }

  return null;
}

export async function createVendorWithCtx(
  ctx: MutationCtx,
  args: CreateVendorArgs,
) {
  const { athenaUser, store } = await requireStoreFullAdminAccess(
    ctx,
    args.storeId,
  );

  const name = args.name.trim();
  if (!name) {
    throw new Error("Vendor name is required.");
  }

  const lookupKey = normalizeVendorLookupKey(name);
  const existingVendor = await ctx.db
    .query("vendor")
    .withIndex("by_storeId_lookupKey", (q) =>
      q.eq("storeId", args.storeId).eq("lookupKey", lookupKey),
    )
    .first();

  if (existingVendor) {
    throw new Error("A vendor with this name already exists for this store.");
  }

  const vendorId = await ctx.db.insert("vendor", {
    storeId: args.storeId,
    organizationId: store.organizationId,
    name,
    lookupKey,
    code: trimOptional(args.code),
    contactName: trimOptional(args.contactName),
    email: trimOptional(args.email)?.toLowerCase(),
    phoneNumber: trimOptional(args.phoneNumber),
    status: "active",
    notes: trimOptional(args.notes),
    createdByUserId: athenaUser._id,
    createdAt: Date.now(),
  });

  return ctx.db.get("vendor", vendorId);
}

export async function createVendorCommandWithCtx(
  ctx: MutationCtx,
  args: CreateVendorArgs,
): Promise<CommandResult<any>> {
  try {
    return ok(await createVendorWithCtx(ctx, args));
  } catch (error) {
    const result = mapCreateVendorError(error);

    if (result) {
      return result;
    }

    throw error;
  }
}

export const listVendors = query({
  args: {
    storeId: v.id("store"),
    status: v.optional(v.union(v.literal("active"), v.literal("inactive"))),
  },
  handler: async (ctx, args) => {
    await requireStoreFullAdminAccess(ctx, args.storeId);

    const vendors = args.status
      ? await ctx.db
          .query("vendor")
          .withIndex("by_storeId_status", (q) =>
            q.eq("storeId", args.storeId).eq("status", args.status!),
          )
          .take(MAX_VENDORS)
      : await ctx.db
          .query("vendor")
          .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
          .take(MAX_VENDORS);

    return vendors.sort((left, right) => left.name.localeCompare(right.name));
  },
});

export const createVendor = mutation({
  args: createVendorArgs,
  handler: createVendorWithCtx,
});

export const createVendorCommand = mutation({
  args: createVendorArgs,
  returns: commandResultValidator(v.any()),
  handler: async (ctx, args) => createVendorCommandWithCtx(ctx, args),
});
