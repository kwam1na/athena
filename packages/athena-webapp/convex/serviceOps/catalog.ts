/* eslint-disable @convex-dev/no-collect-in-query -- V26-276 ships store-scoped service catalog management before pagination; truncating the indexed catalog reads would hide valid services from staff and admins. */

import { mutation, query } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { toSlug } from "../utils";

export function buildServiceCatalogItem(args: {
  basePrice?: number;
  depositType: "none" | "flat" | "percentage";
  depositValue?: number;
  description?: string;
  durationMinutes: number;
  name: string;
  organizationId?: Id<"organization">;
  pricingModel: "fixed" | "starting_at" | "quote_after_consultation";
  requiresManagerApproval: boolean;
  serviceMode: "same_day" | "consultation" | "repair" | "revamp";
  storeId: Id<"store">;
}) {
  if (args.durationMinutes <= 0) {
    throw new Error("Service duration must be greater than zero");
  }

  if (args.depositType === "percentage") {
    if (
      args.depositValue === undefined ||
      args.depositValue < 1 ||
      args.depositValue > 100
    ) {
      throw new Error("Percentage deposit must be between 1 and 100");
    }
  }

  if (args.depositType === "flat") {
    if (args.depositValue === undefined || args.depositValue <= 0) {
      throw new Error("Flat deposit must be greater than zero");
    }
  }

  if (args.depositType === "none" && args.depositValue !== undefined) {
    throw new Error("Deposit value is only allowed when a deposit type is set");
  }

  if (args.pricingModel === "fixed" && (args.basePrice ?? 0) <= 0) {
    throw new Error("Fixed-price services require a base price");
  }

  const now = Date.now();

  return {
    ...args,
    createdAt: now,
    slug: toSlug(args.name),
    status: "active" as const,
    updatedAt: now,
  };
}

export const listServiceCatalogItems = query({
  args: {
    status: v.optional(v.union(v.literal("active"), v.literal("archived"))),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    if (args.status) {
      return ctx.db
        .query("serviceCatalog")
        .withIndex("by_storeId_status", (q) =>
          q.eq("storeId", args.storeId).eq("status", args.status!)
        )
        .collect();
    }

    return ctx.db
      .query("serviceCatalog")
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .collect();
  },
});

export const createServiceCatalogItem = mutation({
  args: {
    basePrice: v.optional(v.number()),
    depositType: v.union(
      v.literal("none"),
      v.literal("flat"),
      v.literal("percentage")
    ),
    depositValue: v.optional(v.number()),
    description: v.optional(v.string()),
    durationMinutes: v.number(),
    name: v.string(),
    pricingModel: v.union(
      v.literal("fixed"),
      v.literal("starting_at"),
      v.literal("quote_after_consultation")
    ),
    requiresManagerApproval: v.boolean(),
    serviceMode: v.union(
      v.literal("same_day"),
      v.literal("consultation"),
      v.literal("repair"),
      v.literal("revamp")
    ),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    const catalogItem = buildServiceCatalogItem(args);
    const existingCatalogItem = await ctx.db
      .query("serviceCatalog")
      .withIndex("by_storeId_slug", (q) =>
        q.eq("storeId", args.storeId).eq("slug", catalogItem.slug)
      )
      .first();

    if (existingCatalogItem) {
      throw new Error("A service catalog item with this name already exists.");
    }

    const catalogItemId = await ctx.db.insert("serviceCatalog", catalogItem);
    return ctx.db.get("serviceCatalog", catalogItemId);
  },
});

export const updateServiceCatalogItem = mutation({
  args: {
    basePrice: v.optional(v.number()),
    depositType: v.optional(
      v.union(v.literal("none"), v.literal("flat"), v.literal("percentage"))
    ),
    depositValue: v.optional(v.number()),
    description: v.optional(v.string()),
    durationMinutes: v.optional(v.number()),
    name: v.optional(v.string()),
    pricingModel: v.optional(
      v.union(
        v.literal("fixed"),
        v.literal("starting_at"),
        v.literal("quote_after_consultation")
      )
    ),
    requiresManagerApproval: v.optional(v.boolean()),
    serviceCatalogId: v.id("serviceCatalog"),
    serviceMode: v.optional(
      v.union(
        v.literal("same_day"),
        v.literal("consultation"),
        v.literal("repair"),
        v.literal("revamp")
      )
    ),
  },
  handler: async (ctx, args) => {
    const existingCatalogItem = await ctx.db.get(
      "serviceCatalog",
      args.serviceCatalogId
    );

    if (!existingCatalogItem) {
      throw new Error("Service catalog item not found.");
    }

    const nextCatalogItem = buildServiceCatalogItem({
      basePrice:
        args.basePrice === undefined ? existingCatalogItem.basePrice : args.basePrice,
      depositType: args.depositType ?? existingCatalogItem.depositType,
      depositValue:
        args.depositValue === undefined
          ? existingCatalogItem.depositValue
          : args.depositValue,
      description:
        args.description === undefined
          ? existingCatalogItem.description
          : args.description,
      durationMinutes:
        args.durationMinutes ?? existingCatalogItem.durationMinutes,
      name: args.name ?? existingCatalogItem.name,
      organizationId: existingCatalogItem.organizationId,
      pricingModel: args.pricingModel ?? existingCatalogItem.pricingModel,
      requiresManagerApproval:
        args.requiresManagerApproval ?? existingCatalogItem.requiresManagerApproval,
      serviceMode: args.serviceMode ?? existingCatalogItem.serviceMode,
      storeId: existingCatalogItem.storeId,
    });

    const conflictingCatalogItem = await ctx.db
      .query("serviceCatalog")
      .withIndex("by_storeId_slug", (q) =>
        q.eq("storeId", existingCatalogItem.storeId).eq("slug", nextCatalogItem.slug)
      )
      .first();

    if (
      conflictingCatalogItem &&
      conflictingCatalogItem._id !== existingCatalogItem._id
    ) {
      throw new Error("A service catalog item with this name already exists.");
    }

    await ctx.db.patch("serviceCatalog", args.serviceCatalogId, {
      ...nextCatalogItem,
      createdAt: existingCatalogItem.createdAt,
      status: existingCatalogItem.status,
    });

    return ctx.db.get("serviceCatalog", args.serviceCatalogId);
  },
});

export const archiveServiceCatalogItem = mutation({
  args: {
    serviceCatalogId: v.id("serviceCatalog"),
  },
  handler: async (ctx, args) => {
    const existingCatalogItem = await ctx.db.get(
      "serviceCatalog",
      args.serviceCatalogId
    );

    if (!existingCatalogItem) {
      throw new Error("Service catalog item not found.");
    }

    await ctx.db.patch("serviceCatalog", args.serviceCatalogId, {
      status: "archived",
      updatedAt: Date.now(),
    });

    return ctx.db.get("serviceCatalog", args.serviceCatalogId);
  },
});
