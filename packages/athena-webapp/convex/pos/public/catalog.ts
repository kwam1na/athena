import { v } from "convex/values";

import { mutation, query, type QueryCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import {
  requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx,
} from "../../lib/athenaUserAuth";
import { quickAddCatalogItem } from "../application/commands/quickAddCatalogItem";
import { createOrReusePendingCheckoutItem } from "../application/commands/createOrReusePendingCheckoutItem";
import { recordOperationalEventWithCtx } from "../../operations/operationalEvents";
import { updateOperationalWorkItemStatusWithCtx } from "../../operations/operationalWorkItems";
import {
  lookupByBarcode,
  searchProducts,
} from "../application/queries/searchCatalog";
import { findStoreSkuByBarcode } from "../infrastructure/repositories/catalogRepository";
import {
  REGISTER_CATALOG_AVAILABILITY_LIMIT,
  isTrustedRegisterCatalogSku,
  listRegisterCatalog,
  listRegisterCatalogAvailability as readRegisterCatalogAvailability,
  listRegisterCatalogAvailabilitySnapshot as readRegisterCatalogAvailabilitySnapshot,
} from "../application/queries/listRegisterCatalog";
import { isPosUsableRegisterSessionStatus } from "../../../shared/registerSessionStatus";

const catalogResultValidator = v.object({
  id: v.id("productSku"),
  name: v.string(),
  sku: v.string(),
  barcode: v.string(),
  price: v.number(),
  category: v.string(),
  description: v.string(),
  inStock: v.boolean(),
  quantityAvailable: v.number(),
  image: v.union(v.string(), v.null()),
  size: v.string(),
  length: v.union(v.number(), v.null()),
  color: v.string(),
  productId: v.id("product"),
  skuId: v.id("productSku"),
  areProcessingFeesAbsorbed: v.boolean(),
});

const registerCatalogRowValidator = v.object({
  id: v.id("productSku"),
  productSkuId: v.id("productSku"),
  skuId: v.id("productSku"),
  productId: v.id("product"),
  name: v.string(),
  sku: v.string(),
  barcode: v.string(),
  price: v.number(),
  category: v.string(),
  description: v.string(),
  image: v.union(v.string(), v.null()),
  size: v.string(),
  length: v.union(v.number(), v.null()),
  color: v.string(),
  areProcessingFeesAbsorbed: v.boolean(),
});

const registerCatalogAvailabilityValidator = v.object({
  productSkuId: v.id("productSku"),
  skuId: v.id("productSku"),
  inStock: v.boolean(),
  quantityAvailable: v.number(),
});

const pendingCheckoutResultValidator = v.object({
  id: v.id("posPendingCheckoutItem"),
  pendingCheckoutItemId: v.id("posPendingCheckoutItem"),
  name: v.string(),
  lookupCode: v.string(),
  price: v.number(),
  productId: v.id("product"),
  productSkuId: v.id("productSku"),
  quantitySold: v.number(),
  sku: v.string(),
  status: v.union(
    v.literal("pending_review"),
    v.literal("approved"),
    v.literal("linked_to_catalog"),
    v.literal("rejected"),
    v.literal("flagged"),
  ),
  reviewPriority: v.union(
    v.literal("normal"),
    v.literal("elevated"),
    v.literal("high"),
  ),
});

const pendingCheckoutReviewItemValidator = v.object({
  _id: v.id("posPendingCheckoutItem"),
  name: v.string(),
  lookupCode: v.optional(v.string()),
  provisionalPrice: v.number(),
  status: v.union(
    v.literal("pending_review"),
    v.literal("approved"),
    v.literal("linked_to_catalog"),
    v.literal("rejected"),
    v.literal("flagged"),
  ),
  reviewPriority: v.union(
    v.literal("normal"),
    v.literal("elevated"),
    v.literal("high"),
  ),
  evidence: v.any(),
  createdAt: v.number(),
  updatedAt: v.number(),
  createdFrom: v.union(v.literal("online"), v.literal("offline_sync")),
});

async function requireRegisterCatalogStoreAccess(
  ctx: Pick<QueryCtx, "auth" | "db">,
  args: {
    storeId: Id<"store">;
  },
) {
  const store = await ctx.db.get("store", args.storeId);
  if (!store) {
    throw new Error("Store not found.");
  }

  const athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
  await requireOrganizationMemberRoleWithCtx(ctx, {
    allowedRoles: ["full_admin", "pos_only"],
    failureMessage: "You cannot view register catalog availability for this store.",
    organizationId: store.organizationId,
    userId: athenaUser._id,
  });
}

async function requirePendingCheckoutSaleContext(
  ctx: Pick<QueryCtx, "auth" | "db">,
  args: {
    createdByStaffProfileId?: Id<"staffProfile">;
    registerSessionId?: Id<"registerSession">;
    storeId: Id<"store">;
    terminalId?: Id<"posTerminal">;
  },
) {
  if (
    !args.createdByStaffProfileId ||
    !args.registerSessionId ||
    !args.terminalId
  ) {
    throw new Error("Active register context is required to add this item.");
  }

  const [staffProfile, registerSession, terminal] = await Promise.all([
    ctx.db.get("staffProfile", args.createdByStaffProfileId),
    ctx.db.get("registerSession", args.registerSessionId),
    ctx.db.get("posTerminal", args.terminalId),
  ]);

  if (!staffProfile || staffProfile.storeId !== args.storeId) {
    throw new Error("Active staff context is required to add this item.");
  }
  if (staffProfile.status !== "active") {
    throw new Error("Active staff context is required to add this item.");
  }

  if (!terminal || terminal.storeId !== args.storeId) {
    throw new Error("Active register terminal is required to add this item.");
  }
  if (terminal.status !== "active") {
    throw new Error("Active register terminal is required to add this item.");
  }

  if (!registerSession || registerSession.storeId !== args.storeId) {
    throw new Error("An open register session is required to add this item.");
  }
  if (!isPosUsableRegisterSessionStatus(registerSession.status)) {
    throw new Error("An open register session is required to add this item.");
  }
  if (registerSession.terminalId !== args.terminalId) {
    throw new Error("The register session does not match this terminal.");
  }
  if (registerSession.openedByStaffProfileId !== staffProfile._id) {
    throw new Error("The active register session does not match this staff member.");
  }

  return {
    createdByStaffProfileId: staffProfile._id,
    registerSessionId: registerSession._id,
    terminalId: terminal._id,
  };
}

export const search = query({
  args: {
    storeId: v.id("store"),
    searchQuery: v.string(),
  },
  handler: async (ctx, args) => searchProducts(ctx, args),
});

export const listRegisterCatalogSnapshot = query({
  args: {
    storeId: v.id("store"),
  },
  returns: v.array(registerCatalogRowValidator),
  handler: async (ctx, args) => listRegisterCatalog(ctx, args),
});

export const listRegisterCatalogAvailability = query({
  args: {
    storeId: v.id("store"),
    productSkuIds: v.array(v.id("productSku")),
  },
  returns: v.array(registerCatalogAvailabilityValidator),
  handler: async (ctx, args) => {
    await requireRegisterCatalogStoreAccess(ctx, args);

    return readRegisterCatalogAvailability(ctx, {
      storeId: args.storeId,
      productSkuIds: args.productSkuIds.slice(
        0,
        REGISTER_CATALOG_AVAILABILITY_LIMIT,
      ),
    });
  },
});

export const listRegisterCatalogAvailabilitySnapshot = query({
  args: {
    storeId: v.id("store"),
  },
  returns: v.array(registerCatalogAvailabilityValidator),
  handler: async (ctx, args) => {
    await requireRegisterCatalogStoreAccess(ctx, args);

    return readRegisterCatalogAvailabilitySnapshot(ctx, args);
  },
});

export const barcodeLookup = query({
  args: {
    storeId: v.id("store"),
    barcode: v.string(),
  },
  returns: v.union(
    v.null(),
    catalogResultValidator,
    v.array(catalogResultValidator),
  ),
  handler: async (ctx, args) => lookupByBarcode(ctx, args),
});

export const quickAddSku = mutation({
  args: {
    storeId: v.id("store"),
    createdByUserId: v.id("athenaUser"),
    createdByStaffProfileId: v.optional(v.id("staffProfile")),
    name: v.string(),
    lookupCode: v.optional(v.string()),
    productId: v.optional(v.id("product")),
    productSkuId: v.optional(v.id("productSku")),
    price: v.number(),
    quantityAvailable: v.number(),
    registerSessionId: v.optional(v.id("registerSession")),
    terminalId: v.optional(v.id("posTerminal")),
  },
  returns: catalogResultValidator,
  handler: async (ctx, args) => {
    const store = await ctx.db.get("store", args.storeId);
    if (!store) {
      throw new Error("Store not found.");
    }

    const athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
    await requireOrganizationMemberRoleWithCtx(ctx, {
      allowedRoles: ["full_admin", "pos_only"],
      failureMessage: "You cannot quick add products for this store.",
      organizationId: store.organizationId,
      userId: athenaUser._id,
    });

    return quickAddCatalogItem(ctx, {
      ...args,
      createdByUserId: athenaUser._id,
    });
  },
});

export const createOrReusePendingCheckoutItemForSale = mutation({
  args: {
    storeId: v.id("store"),
    createdByStaffProfileId: v.optional(v.id("staffProfile")),
    name: v.string(),
    lookupCode: v.optional(v.string()),
    price: v.number(),
    quantitySold: v.number(),
    registerSessionId: v.optional(v.id("registerSession")),
    terminalId: v.optional(v.id("posTerminal")),
  },
  returns: pendingCheckoutResultValidator,
  handler: async (ctx, args) => {
    const store = await ctx.db.get("store", args.storeId);
    if (!store) {
      throw new Error("Store not found.");
    }

    const athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
    await requireOrganizationMemberRoleWithCtx(ctx, {
      allowedRoles: ["full_admin", "pos_only"],
      failureMessage:
        "You cannot add pending checkout items for this store.",
      organizationId: store.organizationId,
      userId: athenaUser._id,
    });

    const registerContext = await requirePendingCheckoutSaleContext(ctx, args);

    return createOrReusePendingCheckoutItem(ctx, {
      storeId: args.storeId,
      name: args.name,
      lookupCode: args.lookupCode,
      price: args.price,
      quantitySold: args.quantitySold,
      createdByUserId: athenaUser._id,
      ...registerContext,
      source: "online",
    });
  },
});

export const listPendingCheckoutItemsForReview = query({
  args: {
    storeId: v.id("store"),
  },
  returns: v.array(pendingCheckoutReviewItemValidator),
  handler: async (ctx, args) => {
    const store = await ctx.db.get("store", args.storeId);
    if (!store) {
      throw new Error("Store not found.");
    }

    const athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
    await requireOrganizationMemberRoleWithCtx(ctx, {
      allowedRoles: ["full_admin"],
      failureMessage:
        "You cannot review pending checkout items for this store.",
      organizationId: store.organizationId,
      userId: athenaUser._id,
    });

    const pendingItems = await ctx.db
      .query("posPendingCheckoutItem")
      .withIndex("by_storeId_status_updatedAt", (q) =>
        q.eq("storeId", args.storeId).eq("status", "pending_review"),
      )
      .order("desc")
      .take(100);
    const flaggedItems = await ctx.db
      .query("posPendingCheckoutItem")
      .withIndex("by_storeId_status_updatedAt", (q) =>
        q.eq("storeId", args.storeId).eq("status", "flagged"),
      )
      .order("desc")
      .take(100);

    return [...pendingItems, ...flaggedItems]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, 100);
  },
});

export const resolvePendingCheckoutItemReview = mutation({
  args: {
    storeId: v.id("store"),
    pendingCheckoutItemId: v.id("posPendingCheckoutItem"),
    status: v.union(
      v.literal("approved"),
      v.literal("linked_to_catalog"),
      v.literal("rejected"),
      v.literal("flagged"),
    ),
    note: v.optional(v.string()),
    approvedProductId: v.optional(v.id("product")),
    approvedProductSkuId: v.optional(v.id("productSku")),
  },
  returns: pendingCheckoutReviewItemValidator,
  handler: async (ctx, args) => {
    const store = await ctx.db.get("store", args.storeId);
    if (!store) {
      throw new Error("Store not found.");
    }

    const athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
    await requireOrganizationMemberRoleWithCtx(ctx, {
      allowedRoles: ["full_admin"],
      failureMessage:
        "You cannot resolve pending checkout items for this store.",
      organizationId: store.organizationId,
      userId: athenaUser._id,
    });

    const item = await ctx.db.get(
      "posPendingCheckoutItem",
      args.pendingCheckoutItemId,
    );
    if (!item || item.storeId !== args.storeId) {
      throw new Error("Pending checkout item not found.");
    }
    const approvedProduct = args.approvedProductId
      ? await ctx.db.get("product", args.approvedProductId)
      : null;
    const approvedSku = args.approvedProductSkuId
      ? await ctx.db.get("productSku", args.approvedProductSkuId)
      : null;
    if (
      args.status === "approved" ||
      args.status === "linked_to_catalog" ||
      args.approvedProductId ||
      args.approvedProductSkuId
    ) {
      if (
        !approvedProduct ||
        approvedProduct.storeId !== args.storeId ||
        !approvedSku ||
        approvedSku.storeId !== args.storeId ||
        approvedSku.productId !== approvedProduct._id ||
        approvedProduct._id === item.provisionalProductId ||
        approvedSku._id === item.provisionalProductSkuId ||
        !isTrustedRegisterCatalogSku({
          product: approvedProduct,
          sku: approvedSku,
        })
      ) {
        throw new Error("Choose a valid catalog product and SKU from this store.");
      }
    }

    const reviewedAt = Date.now();
    if (
      args.status === "linked_to_catalog" &&
      approvedSku &&
      item.lookupCode &&
      !approvedSku.barcode?.trim()
    ) {
      const existingBarcodeSku = await findStoreSkuByBarcode(ctx, {
        barcode: item.lookupCode,
        storeId: args.storeId,
      });
      if (existingBarcodeSku && existingBarcodeSku._id !== approvedSku._id) {
        throw new Error(
          "This lookup code already belongs to another catalog SKU.",
        );
      }

      await ctx.db.patch("productSku", approvedSku._id, {
        barcode: item.lookupCode,
        barcodeAutoGenerated: false,
      });
    }

    await ctx.db.patch("posPendingCheckoutItem", item._id, {
      approvedProductId: args.approvedProductId,
      approvedProductSkuId: args.approvedProductSkuId,
      reviewedAt,
      reviewedByUserId: athenaUser._id,
      reviewNote: args.note,
      status: args.status,
      updatedAt: reviewedAt,
    });

    if (item.operationalWorkItemId) {
      await updateOperationalWorkItemStatusWithCtx(ctx, {
        approvalState:
          args.status === "rejected"
            ? "rejected"
            : args.status === "flagged"
              ? "needs_review"
              : "approved",
        status: args.status === "flagged" ? "open" : "completed",
        workItemId: item.operationalWorkItemId,
      });
    }

    const reviewedItem = (await ctx.db.get(
      "posPendingCheckoutItem",
      item._id,
    ))!;
    await recordOperationalEventWithCtx(ctx, {
      actorUserId: athenaUser._id,
      eventType: "pos_pending_checkout_item_reviewed",
      message: `Pending checkout item ${reviewedItem.name} was marked ${args.status.replace(/_/g, " ")}.`,
      metadata: {
        approvedProductId: args.approvedProductId,
        approvedProductSkuId: args.approvedProductSkuId,
        attachedLookupCode:
          args.status === "linked_to_catalog" &&
          approvedSku &&
          item.lookupCode &&
          !approvedSku.barcode?.trim()
            ? item.lookupCode
            : undefined,
        pendingCheckoutItemId: reviewedItem._id,
        previousApprovedProductId: item.approvedProductId,
        previousApprovedProductSkuId: item.approvedProductSkuId,
        previousStatus: item.status,
        reviewNote: args.note,
        status: args.status,
      },
      organizationId: store.organizationId,
      storeId: args.storeId,
      subjectId: String(reviewedItem._id),
      subjectLabel: reviewedItem.name,
      subjectType: "pos_pending_checkout_item",
    });

    return reviewedItem;
  },
});
