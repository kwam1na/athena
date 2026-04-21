import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { requireStoreFullAdminAccess } from "./access";

const MAX_VENDORS = 200;

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
            q.eq("storeId", args.storeId).eq("status", args.status!)
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
  args: {
    storeId: v.id("store"),
    name: v.string(),
    code: v.optional(v.string()),
    contactName: v.optional(v.string()),
    email: v.optional(v.string()),
    phoneNumber: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdByUserId: v.optional(v.id("athenaUser")),
  },
  handler: async (ctx, args) => {
    const store = await ctx.db.get("store", args.storeId);
    if (!store) {
      throw new Error("Store not found.");
    }

    const name = args.name.trim();
    if (!name) {
      throw new Error("Vendor name is required.");
    }

    const lookupKey = normalizeVendorLookupKey(name);
    const existingVendor = await ctx.db
      .query("vendor")
      .withIndex("by_storeId_lookupKey", (q) =>
        q.eq("storeId", args.storeId).eq("lookupKey", lookupKey)
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
      createdByUserId: args.createdByUserId,
      createdAt: Date.now(),
    });

    return ctx.db.get("vendor", vendorId);
  },
});
