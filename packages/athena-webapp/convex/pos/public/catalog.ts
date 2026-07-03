import { v } from "convex/values";

import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { commandResultValidator } from "../../lib/commandResultValidators";
import {
  requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx,
} from "../../lib/athenaUserAuth";
import { upsertProductSkuSearchProjection } from "../../inventory/skuSearch";
import { refreshCatalogSummaryWithCtx } from "../../inventory/catalogSummary";
import { quickAddCatalogItem } from "../application/commands/quickAddCatalogItem";
import { createOrReusePendingCheckoutItem } from "../application/commands/createOrReusePendingCheckoutItem";
import { recordInventoryMovementWithCtx } from "../../operations/inventoryMovements";
import { recordOperationalEventWithCtx } from "../../operations/operationalEvents";
import { updateOperationalWorkItemStatusWithCtx } from "../../operations/operationalWorkItems";
import {
  lookupByBarcode,
  searchProducts,
} from "../application/queries/searchCatalog";
import {
  hasPendingCheckoutTransactionAttribution,
  retirePendingCheckoutLookupAliasForItem,
  upsertPendingCheckoutLookupAlias,
} from "../application/pendingCheckoutSkuResolution";
import { findStoreSkuByBarcode } from "../infrastructure/repositories/catalogRepository";
import {
  REGISTER_CATALOG_AVAILABILITY_LIMIT,
  isTrustedRegisterCatalogSku,
  listRegisterCatalog,
  listRegisterCatalogAvailability as readRegisterCatalogAvailability,
  listRegisterCatalogAvailabilitySnapshot as readRegisterCatalogAvailabilitySnapshot,
} from "../application/queries/listRegisterCatalog";
import { isPosUsableRegisterSessionStatus } from "../../../shared/registerSessionStatus";
import { ok, userError } from "../../../shared/commandResult";

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
  availabilityPolicy: v.optional(
    v.union(
      v.literal("trusted_inventory"),
      v.literal("active_provisional_import"),
      v.literal("pending_checkout"),
    ),
  ),
  inventoryImportProvisionalSkuId: v.optional(
    v.id("inventoryImportProvisionalSku"),
  ),
  pendingCheckoutItemId: v.optional(v.id("posPendingCheckoutItem")),
  pendingCheckoutAliasState: v.optional(v.literal("linked_to_catalog")),
});

const registerCatalogRowValidator = v.object({
  id: v.union(v.id("productSku"), v.id("inventoryImportProvisionalSku")),
  productSkuId: v.id("productSku"),
  skuId: v.id("productSku"),
  productId: v.id("product"),
  inventoryImportProvisionalSkuId: v.optional(
    v.id("inventoryImportProvisionalSku"),
  ),
  pendingCheckoutItemId: v.optional(v.id("posPendingCheckoutItem")),
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
  availabilityPolicy: v.union(
    v.literal("trusted_inventory"),
    v.literal("active_provisional_import"),
    v.literal("pending_checkout"),
  ),
});

const registerCatalogAvailabilityValidator = v.object({
  productSkuId: v.id("productSku"),
  skuId: v.id("productSku"),
  inventoryImportProvisionalSkuId: v.optional(
    v.id("inventoryImportProvisionalSku"),
  ),
  inStock: v.boolean(),
  quantityAvailable: v.number(),
  availabilityPolicy: v.union(
    v.literal("trusted_inventory"),
    v.literal("active_provisional_import"),
    v.literal("pending_checkout"),
  ),
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

type PendingCheckoutReviewStatus =
  | "approved"
  | "linked_to_catalog"
  | "rejected"
  | "flagged";

type PendingCheckoutTrustedInventoryFinalizationArgs = {
  conversionRequestId: string;
  productId: Id<"product">;
  productSkuId: Id<"productSku">;
  provisionalSkuId: Id<"posPendingCheckoutItem">;
  reviewedInventoryCount: number;
  reviewedIsVisible: boolean;
  reviewedNetPrice?: number;
  reviewedPrice: number;
  reviewedQuantityAvailable: number;
  reviewedUnitCost?: number;
  saleEvidenceFingerprint: string;
  sourceSurface: "product_edit";
  storeId: Id<"store">;
  trustedSkuFingerprint: string;
};

function toPendingCheckoutReviewItem(item: Doc<"posPendingCheckoutItem">) {
  return {
    _id: item._id,
    ...(item.lookupCode ? { lookupCode: item.lookupCode } : {}),
    createdAt: item.createdAt,
    createdFrom: item.createdFrom,
    evidence: item.evidence,
    name: item.name,
    provisionalPrice: item.provisionalPrice,
    reviewPriority: item.reviewPriority,
    status: item.status,
    updatedAt: item.updatedAt,
  };
}

export function mapPendingCheckoutReviewStatusToWorkItemPatch(
  status: PendingCheckoutReviewStatus,
) {
  if (status === "flagged") {
    return {
      approvalState: "needs_review" as const,
      status: "open" as const,
    };
  }

  return {
    approvalState:
      status === "rejected" ? ("rejected" as const) : ("approved" as const),
    status: "completed" as const,
  };
}

function buildPendingCheckoutSaleEvidenceFingerprint(
  item: Doc<"posPendingCheckoutItem">,
) {
  return stableStringify({
    lastPosTransactionId: item.evidence.lastPosTransactionId,
    lastRegisterSessionId: item.evidence.lastRegisterSessionId,
    lastSeenAt: item.evidence.lastSeenAt,
    totalQuantitySold: item.evidence.totalQuantitySold,
    transactionCount: item.evidence.transactionCount,
    updatedAt: item.updatedAt,
  });
}

function buildTrustedSkuFingerprint(productSku: Doc<"productSku">) {
  return stableStringify({
    inventoryCount: productSku.inventoryCount,
    isVisible: productSku.isVisible,
    netPrice: productSku.netPrice,
    price: productSku.price,
    quantityAvailable: productSku.quantityAvailable,
    unitCost: productSku.unitCost,
  });
}

function validateReviewedTrustedInventoryFields(
  args: PendingCheckoutTrustedInventoryFinalizationArgs,
) {
  if (
    !Number.isInteger(args.reviewedInventoryCount) ||
    args.reviewedInventoryCount < 0
  ) {
    return userError({
      code: "validation_failed",
      message: "Stock must be a non-negative whole number.",
    });
  }

  if (
    !Number.isInteger(args.reviewedQuantityAvailable) ||
    args.reviewedQuantityAvailable < 0
  ) {
    return userError({
      code: "validation_failed",
      message: "Quantity available must be a non-negative whole number.",
    });
  }

  if (args.reviewedQuantityAvailable > args.reviewedInventoryCount) {
    return userError({
      code: "validation_failed",
      message: "Quantity available cannot exceed stock.",
    });
  }

  if (!args.reviewedIsVisible) {
    return userError({
      code: "precondition_failed",
      message: "Make this SKU visible before finalizing trusted inventory.",
    });
  }

  if (!Number.isFinite(args.reviewedPrice) || args.reviewedPrice <= 0) {
    return userError({
      code: "validation_failed",
      message: "Price is required before finalizing trusted inventory.",
    });
  }

  if (
    args.reviewedNetPrice !== undefined &&
    (!Number.isFinite(args.reviewedNetPrice) || args.reviewedNetPrice < 0)
  ) {
    return userError({
      code: "validation_failed",
      message: "Net price must be zero or greater.",
    });
  }

  if (
    args.reviewedUnitCost !== undefined &&
    (!Number.isFinite(args.reviewedUnitCost) || args.reviewedUnitCost < 0)
  ) {
    return userError({
      code: "validation_failed",
      message: "Unit cost must be zero or greater.",
    });
  }

  return null;
}

function buildPendingCheckoutFinalizationPayloadHash(
  args: PendingCheckoutTrustedInventoryFinalizationArgs,
) {
  return stableStringify({
    productId: args.productId,
    productSkuId: args.productSkuId,
    provisionalSkuId: args.provisionalSkuId,
    reviewedInventoryCount: args.reviewedInventoryCount,
    reviewedIsVisible: args.reviewedIsVisible,
    reviewedNetPrice: args.reviewedNetPrice,
    reviewedPrice: args.reviewedPrice,
    reviewedQuantityAvailable: args.reviewedQuantityAvailable,
    reviewedUnitCost: args.reviewedUnitCost,
    saleEvidenceFingerprint: args.saleEvidenceFingerprint,
    sourceSurface: args.sourceSurface,
    storeId: args.storeId,
    trustedSkuFingerprint: args.trustedSkuFingerprint,
  });
}

function omitUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

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
    failureMessage:
      "You cannot view register catalog availability for this store.",
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
    throw new Error(
      "The active register session does not match this staff member.",
    );
  }

  return {
    createdByStaffProfileId: staffProfile._id,
    registerSessionId: registerSession._id,
    terminalId: terminal._id,
  };
}

async function requirePendingCheckoutReviewAccess(
  ctx: Pick<QueryCtx | MutationCtx, "auth" | "db">,
  args: { storeId: Id<"store"> },
) {
  const store = await ctx.db.get("store", args.storeId);
  if (!store) {
    throw new Error("Store not found.");
  }

  const athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
  await requireOrganizationMemberRoleWithCtx(ctx, {
    allowedRoles: ["full_admin"],
    failureMessage: "You cannot review pending checkout items for this store.",
    organizationId: store.organizationId,
    userId: athenaUser._id,
  });

  return { athenaUser, store };
}

async function listPendingCheckoutProductPageBindingWithCtx(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  args: {
    productSkuId: Id<"productSku">;
    storeId: Id<"store">;
  },
) {
  const rows = (
    await ctx.db
      .query("posPendingCheckoutItem")
      .withIndex("by_storeId_provisionalProductSkuId", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("provisionalProductSkuId", args.productSkuId),
      )
      .take(3)
  ).filter(
    (row) =>
      row.status === "pending_review" ||
      row.status === "flagged" ||
      row.status === "linked_to_catalog",
  );

  if (rows.length === 0) {
    return { activeRowCount: 0, state: "none" as const };
  }

  if (rows.length > 1) {
    return { activeRowCount: rows.length, state: "ambiguous" as const };
  }

  const row = rows[0];
  if (!row.provisionalProductSkuId || !row.provisionalProductId) {
    return { activeRowCount: 0, state: "none" as const };
  }

  const [product, productSku, linkedProduct, linkedSku] = await Promise.all([
    ctx.db.get("product", row.provisionalProductId),
    ctx.db.get("productSku", row.provisionalProductSkuId),
    row.approvedProductId ? ctx.db.get("product", row.approvedProductId) : null,
    row.approvedProductSkuId
      ? ctx.db.get("productSku", row.approvedProductSkuId)
      : null,
  ]);

  if (
    !product ||
    product.storeId !== args.storeId ||
    product.availability !== "draft" ||
    productSku?._id !== args.productSkuId ||
    productSku.storeId !== args.storeId ||
    productSku.productId !== product._id
  ) {
    return { activeRowCount: 0, state: "none" as const };
  }

  return {
    activeRowCount: 1,
    row: {
      _id: row._id,
      importKey: "pending-checkout",
      importedQuantity: row.evidence.totalQuantitySold,
      lastPosTransactionId: row.evidence.lastPosTransactionId,
      lastRegisterSessionId: row.evidence.lastRegisterSessionId,
      lastSoldAt: row.evidence.lastSeenAt,
      ...(row.status === "linked_to_catalog" &&
      linkedProduct &&
      linkedSku &&
      linkedProduct.storeId === args.storeId &&
      linkedSku.storeId === args.storeId &&
      linkedSku.productId === linkedProduct._id
        ? {
            linkedTarget: {
              ...(typeof linkedSku.price === "number"
                ? { price: linkedSku.price }
                : {}),
              productId: linkedProduct._id,
              productName: linkedProduct.name,
              ...(typeof linkedSku.quantityAvailable === "number"
                ? { quantityAvailable: linkedSku.quantityAvailable }
                : {}),
              ...(linkedSku.sku ? { sku: linkedSku.sku } : {}),
              skuId: linkedSku._id,
            },
          }
        : {}),
      provisionalSoldQuantity: row.evidence.totalQuantitySold,
      rowNumber: 1,
      saleCount: row.evidence.transactionCount,
      status: row.status,
      updatedAt: row.updatedAt,
    },
    saleEvidenceFingerprint: buildPendingCheckoutSaleEvidenceFingerprint(row),
    state: "unique" as const,
    trustedSkuFingerprint: buildTrustedSkuFingerprint(productSku),
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
  handler: async (ctx, args) => {
    await requireRegisterCatalogStoreAccess(ctx, args);

    return listRegisterCatalog(ctx, args);
  },
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
      failureMessage: "You cannot add pending checkout items for this store.",
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
      .slice(0, 100)
      .map(toPendingCheckoutReviewItem);
  },
});

export const listPendingCheckoutProductPageBinding = query({
  args: {
    productSkuId: v.id("productSku"),
    refreshNonce: v.optional(v.number()),
    storeId: v.id("store"),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requirePendingCheckoutReviewAccess(ctx, args);
    return listPendingCheckoutProductPageBindingWithCtx(ctx, args);
  },
});

export const finalizePendingCheckoutTrustedInventoryFromProductPage = mutation({
  args: {
    conversionRequestId: v.string(),
    productId: v.id("product"),
    productSkuId: v.id("productSku"),
    provisionalSkuId: v.id("posPendingCheckoutItem"),
    reviewedInventoryCount: v.number(),
    reviewedIsVisible: v.boolean(),
    reviewedNetPrice: v.optional(v.number()),
    reviewedPrice: v.number(),
    reviewedQuantityAvailable: v.number(),
    reviewedUnitCost: v.optional(v.number()),
    saleEvidenceFingerprint: v.string(),
    sourceSurface: v.literal("product_edit"),
    storeId: v.id("store"),
    trustedSkuFingerprint: v.string(),
  },
  returns: commandResultValidator(v.any()),
  handler: async (ctx, args) => {
    const normalizedArgs = {
      ...args,
      conversionRequestId: args.conversionRequestId.trim(),
    };
    const access = await requirePendingCheckoutReviewAccess(
      ctx,
      normalizedArgs,
    );
    const validationError =
      validateReviewedTrustedInventoryFields(normalizedArgs);
    if (validationError) return validationError;

    if (!normalizedArgs.conversionRequestId) {
      return userError({
        code: "validation_failed",
        message: "Finalization request id is required.",
      });
    }

    const [item, product, productSku] = await Promise.all([
      ctx.db.get("posPendingCheckoutItem", normalizedArgs.provisionalSkuId),
      ctx.db.get("product", normalizedArgs.productId),
      ctx.db.get("productSku", normalizedArgs.productSkuId),
    ]);

    if (!item || item.storeId !== normalizedArgs.storeId) {
      return userError({
        code: "not_found",
        message: "Pending checkout item was not found.",
      });
    }

    if (item.status !== "pending_review" && item.status !== "flagged") {
      return userError({
        code: "conflict",
        message: "This pending checkout item has already been reviewed.",
      });
    }

    if (
      !product ||
      product.storeId !== normalizedArgs.storeId ||
      product.availability !== "draft" ||
      product._id !== item.provisionalProductId
    ) {
      return userError({
        code: "precondition_failed",
        message:
          "Open the draft pending checkout product before finalizing trusted inventory.",
      });
    }

    if (
      !productSku ||
      productSku.storeId !== normalizedArgs.storeId ||
      productSku.productId !== product._id ||
      productSku._id !== item.provisionalProductSkuId
    ) {
      return userError({
        code: "precondition_failed",
        message:
          "Open the pending checkout SKU before finalizing trusted inventory.",
      });
    }

    const currentSaleEvidenceFingerprint =
      buildPendingCheckoutSaleEvidenceFingerprint(item);
    if (
      normalizedArgs.saleEvidenceFingerprint !== currentSaleEvidenceFingerprint
    ) {
      return userError({
        code: "conflict",
        message:
          "Pending checkout sales changed while you were reviewing. Refresh before finalizing.",
      });
    }

    const currentTrustedSkuFingerprint = buildTrustedSkuFingerprint(productSku);
    if (normalizedArgs.trustedSkuFingerprint !== currentTrustedSkuFingerprint) {
      return userError({
        code: "conflict",
        message:
          "SKU stock or price changed while you were reviewing. Refresh before finalizing.",
      });
    }

    const now = Date.now();
    const payloadHash =
      buildPendingCheckoutFinalizationPayloadHash(normalizedArgs);
    const productSkuPatch = omitUndefined({
      inventoryCount: normalizedArgs.reviewedInventoryCount,
      isVisible: normalizedArgs.reviewedIsVisible,
      netPrice: normalizedArgs.reviewedNetPrice,
      price: normalizedArgs.reviewedPrice,
      quantityAvailable: normalizedArgs.reviewedQuantityAvailable,
      unitCost: normalizedArgs.reviewedUnitCost,
    });
    const productPatch = {
      availability: "live" as const,
      inventoryCount: normalizedArgs.reviewedInventoryCount,
      isVisible: true,
      quantityAvailable: normalizedArgs.reviewedQuantityAvailable,
    };

    await ctx.db.patch(
      "productSku",
      normalizedArgs.productSkuId,
      productSkuPatch,
    );
    await ctx.db.patch("product", normalizedArgs.productId, productPatch);
    await upsertProductSkuSearchProjection(ctx, normalizedArgs.productSkuId);

    let inventoryMovementId: Id<"inventoryMovement"> | undefined;
    const stockDelta =
      normalizedArgs.reviewedInventoryCount - productSku.inventoryCount;
    if (stockDelta !== 0) {
      const movement = await recordInventoryMovementWithCtx(ctx, {
        actorUserId: access.athenaUser._id,
        movementType: "pending_checkout_trusted_finalization",
        notes: "Trusted inventory finalized from pending checkout review.",
        organizationId: access.store.organizationId,
        productId: normalizedArgs.productId,
        productSkuId: normalizedArgs.productSkuId,
        quantityDelta: stockDelta,
        reasonCode: "trusted_inventory_conversion",
        sourceId: String(item._id),
        sourceType: "pos_pending_checkout_item",
        storeId: normalizedArgs.storeId,
      });
      inventoryMovementId = movement?._id;
    }

    await ctx.db.patch("posPendingCheckoutItem", item._id, {
      approvedProductId: normalizedArgs.productId,
      approvedProductSkuId: normalizedArgs.productSkuId,
      reviewedAt: now,
      reviewedByUserId: access.athenaUser._id,
      reviewNote: "Trusted inventory finalized from product edit.",
      status: "approved",
      updatedAt: now,
    });

    if (item.operationalWorkItemId) {
      const workItemPatch =
        mapPendingCheckoutReviewStatusToWorkItemPatch("approved");
      await updateOperationalWorkItemStatusWithCtx(ctx, {
        approvalState: workItemPatch.approvalState,
        status: workItemPatch.status,
        workItemId: item.operationalWorkItemId,
      });
    }

    await refreshCatalogSummaryWithCtx(ctx, normalizedArgs.storeId);

    await recordOperationalEventWithCtx(ctx, {
      actorUserId: access.athenaUser._id,
      eventType: "pos_pending_checkout_item_trusted_finalized",
      message: `Pending checkout item ${item.name} was finalized as trusted inventory.`,
      metadata: {
        conversionRequestId: normalizedArgs.conversionRequestId,
        finalTrustedQuantity: normalizedArgs.reviewedInventoryCount,
        inventoryMovementId,
        pendingCheckoutItemId: item._id,
        previousStatus: item.status,
        quantityAvailable: normalizedArgs.reviewedQuantityAvailable,
        saleEvidenceFingerprint: normalizedArgs.saleEvidenceFingerprint,
        stockQuantityDelta: stockDelta,
        trustedSkuFingerprint: normalizedArgs.trustedSkuFingerprint,
        trustedInventoryPayloadHash: payloadHash,
      },
      organizationId: access.store.organizationId,
      storeId: normalizedArgs.storeId,
      subjectId: String(item._id),
      subjectLabel: item.name,
      subjectType: "pos_pending_checkout_item",
    });

    return ok({
      finalTrustedQuantity: normalizedArgs.reviewedInventoryCount,
      product: productPatch,
      productId: normalizedArgs.productId,
      productSkuId: normalizedArgs.productSkuId,
      provisionalSkuId: item._id,
      provisionalSoldQuantity: item.evidence.totalQuantitySold,
      quantityAvailable: normalizedArgs.reviewedQuantityAvailable,
      ...(inventoryMovementId ? { inventoryMovementId } : {}),
    });
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
    if (
      item.status === "linked_to_catalog" &&
      (await hasPendingCheckoutTransactionAttribution(ctx, item._id)) &&
      (args.status !== "linked_to_catalog" ||
        args.approvedProductId !== item.approvedProductId ||
        args.approvedProductSkuId !== item.approvedProductSkuId)
    ) {
      throw new Error(
        "This pending checkout item is already linked to a trusted SKU. Create a correction to change linked sale history.",
      );
    }

    const approvedProduct = args.approvedProductId
      ? await ctx.db.get("product", args.approvedProductId)
      : null;
    const approvedSku = args.approvedProductSkuId
      ? await ctx.db.get("productSku", args.approvedProductSkuId)
      : null;
    const approvedProductCategory = approvedProduct?.categoryId
      ? await ctx.db.get("category", approvedProduct.categoryId)
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
          category: approvedProductCategory,
          product: approvedProduct,
          sku: approvedSku,
        })
      ) {
        throw new Error(
          "Choose a valid catalog product and SKU from this store.",
        );
      }
    }

    const reviewedAt = Date.now();
    const shouldRetirePriorLinkedLookup =
      item.status === "linked_to_catalog" &&
      (args.status !== "linked_to_catalog" ||
        args.approvedProductId !== item.approvedProductId ||
        args.approvedProductSkuId !== item.approvedProductSkuId);
    let retiredLookupAliasId: Id<"posPendingCheckoutLookupAlias"> | null = null;
    if (shouldRetirePriorLinkedLookup) {
      retiredLookupAliasId = await retirePendingCheckoutLookupAliasForItem(ctx, {
        lookupCode: item.lookupCode,
        now: reviewedAt,
        pendingCheckoutItemId: item._id,
        storeId: args.storeId,
      });

      if (item.lookupCode && item.approvedProductSkuId) {
        const priorApprovedSku = await ctx.db.get(
          "productSku",
          item.approvedProductSkuId,
        );
        if (priorApprovedSku?.barcode?.trim() === item.lookupCode.trim()) {
          await ctx.db.patch("productSku", priorApprovedSku._id, {
            barcode: undefined,
          });
          await upsertProductSkuSearchProjection(ctx, priorApprovedSku._id);
        }
      }
    }
    let attachedLookupCode: string | undefined;
    let lookupAliasId: Id<"posPendingCheckoutLookupAlias"> | null = null;
    if (args.status === "linked_to_catalog" && approvedSku && item.lookupCode) {
      const existingBarcodeSku = await findStoreSkuByBarcode(ctx, {
        barcode: item.lookupCode,
        storeId: args.storeId,
      });
      if (existingBarcodeSku && existingBarcodeSku._id !== approvedSku._id) {
        throw new Error(
          "This lookup code already belongs to another catalog SKU.",
        );
      }

      if (!approvedSku.barcode?.trim()) {
        await ctx.db.patch("productSku", approvedSku._id, {
          barcode: item.lookupCode,
          barcodeAutoGenerated: false,
        });
        await upsertProductSkuSearchProjection(ctx, approvedSku._id);
        attachedLookupCode = item.lookupCode;
      } else {
        lookupAliasId = await upsertPendingCheckoutLookupAlias(ctx, {
          lookupCode: item.lookupCode,
          now: reviewedAt,
          organizationId: store.organizationId,
          pendingCheckoutItemId: item._id,
          productId: approvedProduct!._id,
          productSkuId: approvedSku._id,
          storeId: args.storeId,
        });
      }
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
      const workItemPatch = mapPendingCheckoutReviewStatusToWorkItemPatch(
        args.status,
      );
      await updateOperationalWorkItemStatusWithCtx(ctx, {
        approvalState: workItemPatch.approvalState,
        status: workItemPatch.status,
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
        attachedLookupCode,
        lookupAliasId: lookupAliasId ?? undefined,
        retiredLookupAliasId: retiredLookupAliasId ?? undefined,
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

    return toPendingCheckoutReviewItem(reviewedItem);
  },
});
