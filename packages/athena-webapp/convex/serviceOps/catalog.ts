/* eslint-disable @convex-dev/no-collect-in-query -- V26-276 ships store-scoped service catalog management before pagination; truncating the indexed catalog reads would hide valid services from staff and admins. */

import { mutation, query, type QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { toSlug } from "../utils";
import { ok, userError, type CommandResult } from "../../shared/commandResult";
import { requireStoreMemberAccessWithCtx } from "../lib/storeMemberAccess";
import { withOperationReadAdmission } from "../operationAdmission/publicQuery";
import { listPosServiceCatalogSnapshotReadDefinition } from "../operationAdmission/readDefinitions";
import { requireReadySharedDemoStoreCapabilityIfApplicable } from "../sharedDemo/actor";

type ServiceCatalogPricingModel =
  "fixed" | "starting_at" | "quote_after_consultation";

type ServiceCatalogDepositType = "none" | "flat" | "percentage";

type PosServiceCatalogRowInput = {
  _id: Id<"serviceCatalog">;
  basePrice?: number;
  depositType: ServiceCatalogDepositType;
  depositValue?: number;
  description?: string;
  name: string;
  pricingModel: ServiceCatalogPricingModel;
  requiresManagerApproval: boolean;
  serviceMode: "same_day" | "consultation" | "repair" | "revamp";
  status: "active" | "archived";
  updatedAt: number;
};

type PosServiceCatalogSnapshotCtx = Pick<QueryCtx, "db">;

const posServiceCatalogCheckoutReadinessValidator = v.union(
  v.object({
    canCheckoutDirectly: v.literal(true),
    message: v.string(),
    minimumAmount: v.optional(v.number()),
    reason: v.literal("fixed_price"),
    status: v.literal("ready"),
    suggestedAmount: v.optional(v.number()),
  }),
  v.object({
    canCheckoutDirectly: v.literal(false),
    message: v.string(),
    minimumAmount: v.optional(v.number()),
    reason: v.literal("starting_at_amount_required"),
    status: v.literal("amount_required"),
    suggestedAmount: v.optional(v.number()),
  }),
  v.object({
    canCheckoutDirectly: v.literal(false),
    message: v.string(),
    minimumAmount: v.optional(v.number()),
    reason: v.literal("quote_after_consultation_requires_case_or_amount"),
    requiresExistingCaseOrAmount: v.literal(true),
    status: v.literal("case_or_amount_required"),
    suggestedAmount: v.optional(v.number()),
  }),
);

const posServiceCatalogRowValidator = v.object({
  serviceCatalogId: v.id("serviceCatalog"),
  name: v.string(),
  description: v.optional(v.string()),
  serviceMode: v.union(
    v.literal("same_day"),
    v.literal("consultation"),
    v.literal("repair"),
    v.literal("revamp"),
  ),
  pricingModel: v.union(
    v.literal("fixed"),
    v.literal("starting_at"),
    v.literal("quote_after_consultation"),
  ),
  basePrice: v.optional(v.number()),
  depositType: v.union(
    v.literal("none"),
    v.literal("flat"),
    v.literal("percentage"),
  ),
  depositValue: v.optional(v.number()),
  requiresManagerApproval: v.boolean(),
  status: v.literal("active"),
  updatedAt: v.number(),
  checkoutReadiness: posServiceCatalogCheckoutReadinessValidator,
});

export function normalizeServiceCatalogNameKey(name: string) {
  return toSlug(name);
}

export function buildPosServiceCatalogRow(input: PosServiceCatalogRowInput) {
  if (input.status !== "active") {
    return null;
  }

  return {
    serviceCatalogId: input._id,
    name: input.name,
    ...(input.description ? { description: input.description } : {}),
    serviceMode: input.serviceMode,
    pricingModel: input.pricingModel,
    ...(input.basePrice !== undefined ? { basePrice: input.basePrice } : {}),
    depositType: input.depositType,
    ...(input.depositValue !== undefined
      ? { depositValue: input.depositValue }
      : {}),
    requiresManagerApproval: input.requiresManagerApproval,
    status: "active" as const,
    updatedAt: input.updatedAt,
    checkoutReadiness: buildPosServiceCheckoutReadiness(input),
  };
}

export async function listPosServiceCatalogSnapshotWithCtx(
  ctx: PosServiceCatalogSnapshotCtx,
  args: {
    storeId: Id<"store">;
  },
) {
  const store = await ctx.db.get("store", args.storeId);
  if (!store) {
    return [];
  }

  const rows = await ctx.db
    .query("serviceCatalog")
    .withIndex("by_storeId_status", (q) =>
      q.eq("storeId", args.storeId).eq("status", "active"),
    )
    .collect();

  return rows.flatMap((row) => {
    const posRow = buildPosServiceCatalogRow(row);
    return posRow ? [posRow] : [];
  });
}

function buildPosServiceCheckoutReadiness(input: PosServiceCatalogRowInput) {
  const depositAmount = suggestedDepositAmount(input);

  if (input.pricingModel === "fixed") {
    return {
      canCheckoutDirectly: true as const,
      message: "Ready for checkout.",
      ...(depositAmount !== undefined ? { minimumAmount: depositAmount } : {}),
      reason: "fixed_price" as const,
      status: "ready" as const,
      ...(input.basePrice !== undefined
        ? { suggestedAmount: input.basePrice }
        : {}),
    };
  }

  if (input.pricingModel === "starting_at") {
    return {
      canCheckoutDirectly: false as const,
      message: "Enter the service amount before checkout.",
      ...(depositAmount !== undefined
        ? { suggestedAmount: depositAmount }
        : {}),
      reason: "starting_at_amount_required" as const,
      status: "amount_required" as const,
    };
  }

  return {
    canCheckoutDirectly: false as const,
    message:
      "Attach a service case or enter the collected amount before checkout.",
    ...(depositAmount !== undefined ? { suggestedAmount: depositAmount } : {}),
    reason: "quote_after_consultation_requires_case_or_amount" as const,
    requiresExistingCaseOrAmount: true as const,
    status: "case_or_amount_required" as const,
  };
}

function suggestedDepositAmount(input: PosServiceCatalogRowInput) {
  if (input.depositType === "flat") {
    return input.depositValue;
  }

  if (
    input.depositType === "percentage" &&
    input.depositValue !== undefined &&
    input.basePrice !== undefined
  ) {
    return Math.ceil((input.basePrice * input.depositValue) / 100);
  }

  return undefined;
}

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
}): CommandResult<{
  basePrice?: number;
  createdAt: number;
  depositType: "none" | "flat" | "percentage";
  depositValue?: number;
  description?: string;
  durationMinutes: number;
  name: string;
  organizationId?: Id<"organization">;
  pricingModel: "fixed" | "starting_at" | "quote_after_consultation";
  requiresManagerApproval: boolean;
  serviceMode: "same_day" | "consultation" | "repair" | "revamp";
  slug: string;
  status: "active";
  storeId: Id<"store">;
  updatedAt: number;
}> {
  if (args.durationMinutes <= 0) {
    return userError({
      code: "validation_failed",
      message: "Service duration must be greater than zero.",
    });
  }

  if (args.depositType === "percentage") {
    if (
      args.depositValue === undefined ||
      args.depositValue < 1 ||
      args.depositValue > 100
    ) {
      return userError({
        code: "validation_failed",
        message: "Percentage deposit must be between 1 and 100.",
      });
    }
  }

  if (args.depositType === "flat") {
    if (args.depositValue === undefined || args.depositValue <= 0) {
      return userError({
        code: "validation_failed",
        message: "Flat deposit must be greater than zero.",
      });
    }
  }

  if (args.depositType === "none" && args.depositValue !== undefined) {
    return userError({
      code: "validation_failed",
      message: "Deposit value is only allowed when a deposit type is set.",
    });
  }

  if (args.pricingModel === "fixed" && (args.basePrice ?? 0) <= 0) {
    return userError({
      code: "validation_failed",
      message: "Fixed-price services require a base price.",
    });
  }

  const now = Date.now();

  return ok({
    ...args,
    createdAt: now,
    slug: normalizeServiceCatalogNameKey(args.name),
    status: "active" as const,
    updatedAt: now,
  });
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
          q.eq("storeId", args.storeId).eq("status", args.status!),
        )
        .collect();
    }

    return ctx.db
      .query("serviceCatalog")
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .collect();
  },
});

export const listPosServiceCatalogSnapshot = query({
  args: {
    storeId: v.id("store"),
  },
  returns: v.array(posServiceCatalogRowValidator),
  handler: withOperationReadAdmission(
    listPosServiceCatalogSnapshotReadDefinition,
    async (ctx, args: { storeId: Id<"store"> }) => {
      await requireStoreMemberAccessWithCtx(ctx, {
        allowedRoles: ["full_admin", "pos_only"],
        demoAccess: { kind: "read" },
        failureMessage: "You cannot view POS services for this store.",
        storeId: args.storeId,
      });

      return listPosServiceCatalogSnapshotWithCtx(ctx, args);
    },
  ),
});

export const createServiceCatalogItem = mutation({
  args: {
    basePrice: v.optional(v.number()),
    depositType: v.union(
      v.literal("none"),
      v.literal("flat"),
      v.literal("percentage"),
    ),
    depositValue: v.optional(v.number()),
    description: v.optional(v.string()),
    durationMinutes: v.number(),
    name: v.string(),
    pricingModel: v.union(
      v.literal("fixed"),
      v.literal("starting_at"),
      v.literal("quote_after_consultation"),
    ),
    requiresManagerApproval: v.boolean(),
    serviceMode: v.union(
      v.literal("same_day"),
      v.literal("consultation"),
      v.literal("repair"),
      v.literal("revamp"),
    ),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    await requireReadySharedDemoStoreCapabilityIfApplicable(
      ctx,
      "service.catalog.manage",
      args.storeId,
    );
    const catalogItemResult = buildServiceCatalogItem(args);
    if (catalogItemResult.kind === "user_error") {
      return catalogItemResult;
    }

    const catalogItem = catalogItemResult.data;
    const existingCatalogItem = await ctx.db
      .query("serviceCatalog")
      .withIndex("by_storeId_slug", (q) =>
        q.eq("storeId", args.storeId).eq("slug", catalogItem.slug),
      )
      .first();

    if (existingCatalogItem) {
      return userError({
        code: "conflict",
        message: "A service catalog item with this name already exists.",
      });
    }

    const catalogItemId = await ctx.db.insert("serviceCatalog", catalogItem);
    return ok(await ctx.db.get("serviceCatalog", catalogItemId));
  },
});

export const updateServiceCatalogItem = mutation({
  args: {
    basePrice: v.optional(v.union(v.number(), v.null())),
    depositType: v.optional(
      v.union(v.literal("none"), v.literal("flat"), v.literal("percentage")),
    ),
    depositValue: v.optional(v.union(v.number(), v.null())),
    description: v.optional(v.union(v.string(), v.null())),
    durationMinutes: v.optional(v.number()),
    name: v.optional(v.string()),
    pricingModel: v.optional(
      v.union(
        v.literal("fixed"),
        v.literal("starting_at"),
        v.literal("quote_after_consultation"),
      ),
    ),
    requiresManagerApproval: v.optional(v.boolean()),
    serviceCatalogId: v.id("serviceCatalog"),
    serviceMode: v.optional(
      v.union(
        v.literal("same_day"),
        v.literal("consultation"),
        v.literal("repair"),
        v.literal("revamp"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const existingCatalogItem = await ctx.db.get(
      "serviceCatalog",
      args.serviceCatalogId,
    );

    if (!existingCatalogItem) {
      return userError({
        code: "not_found",
        message: "Service catalog item not found.",
      });
    }

    await requireReadySharedDemoStoreCapabilityIfApplicable(
      ctx,
      "service.catalog.manage",
      existingCatalogItem.storeId,
    );

    const nextBasePrice =
      args.basePrice === null
        ? undefined
        : args.basePrice === undefined
          ? existingCatalogItem.basePrice
          : args.basePrice;
    const nextDepositValue =
      args.depositValue === null
        ? undefined
        : args.depositValue === undefined
          ? existingCatalogItem.depositValue
          : args.depositValue;
    const nextDescription =
      args.description === null
        ? undefined
        : args.description === undefined
          ? existingCatalogItem.description
          : args.description;

    const nextCatalogItemResult = buildServiceCatalogItem({
      basePrice: nextBasePrice,
      depositType: args.depositType ?? existingCatalogItem.depositType,
      depositValue: nextDepositValue,
      description: nextDescription,
      durationMinutes:
        args.durationMinutes ?? existingCatalogItem.durationMinutes,
      name: args.name ?? existingCatalogItem.name,
      organizationId: existingCatalogItem.organizationId,
      pricingModel: args.pricingModel ?? existingCatalogItem.pricingModel,
      requiresManagerApproval:
        args.requiresManagerApproval ??
        existingCatalogItem.requiresManagerApproval,
      serviceMode: args.serviceMode ?? existingCatalogItem.serviceMode,
      storeId: existingCatalogItem.storeId,
    });
    if (nextCatalogItemResult.kind === "user_error") {
      return nextCatalogItemResult;
    }

    const nextCatalogItem = nextCatalogItemResult.data;

    const conflictingCatalogItem = await ctx.db
      .query("serviceCatalog")
      .withIndex("by_storeId_slug", (q) =>
        q
          .eq("storeId", existingCatalogItem.storeId)
          .eq("slug", nextCatalogItem.slug),
      )
      .first();

    if (
      conflictingCatalogItem &&
      conflictingCatalogItem._id !== existingCatalogItem._id
    ) {
      return userError({
        code: "conflict",
        message: "A service catalog item with this name already exists.",
      });
    }

    await ctx.db.patch("serviceCatalog", args.serviceCatalogId, {
      ...nextCatalogItem,
      createdAt: existingCatalogItem.createdAt,
      status: existingCatalogItem.status,
    });

    return ok(await ctx.db.get("serviceCatalog", args.serviceCatalogId));
  },
});

export const archiveServiceCatalogItem = mutation({
  args: {
    serviceCatalogId: v.id("serviceCatalog"),
  },
  handler: async (ctx, args) => {
    const existingCatalogItem = await ctx.db.get(
      "serviceCatalog",
      args.serviceCatalogId,
    );

    if (!existingCatalogItem) {
      return userError({
        code: "not_found",
        message: "Service catalog item not found.",
      });
    }

    await requireReadySharedDemoStoreCapabilityIfApplicable(
      ctx,
      "service.catalog.manage",
      existingCatalogItem.storeId,
    );

    await ctx.db.patch("serviceCatalog", args.serviceCatalogId, {
      status: "archived",
      updatedAt: Date.now(),
    });

    return ok(await ctx.db.get("serviceCatalog", args.serviceCatalogId));
  },
});
