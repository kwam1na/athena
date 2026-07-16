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
  requireAuthenticatedAthenaUserIndexedWithCtx,
  requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx,
} from "../../lib/athenaUserAuth";
import { upsertProductSkuSearchProjection } from "../../inventory/skuSearch";
import { advanceRegisterCatalogRevision } from "../application/sync/registerCatalogRevision";
import { refreshCatalogSummaryWithCtx } from "../../inventory/catalogSummary";
import { quickAddCatalogItem } from "../application/commands/quickAddCatalogItem";
import { createOrReusePendingCheckoutItem } from "../application/commands/createOrReusePendingCheckoutItem";
import { applyInventoryEffectWithCtx } from "../../reporting/inventory/effects";
import { recordPendingCheckoutSkuAttributionWithCtx } from "../../reporting/evidence";
import {
  knownUnitCostBasis,
  uncostedBasis,
} from "../../reporting/inventory/valuation";
import { recordOperationalEventWithCtx } from "../../operations/operationalEvents";
import { updateOperationalWorkItemStatusWithCtx } from "../../operations/operationalWorkItems";
import { requireSharedDemoStoreCapabilityIfApplicable } from "../../sharedDemo/actor";
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
  listRegisterCatalogWithRevision,
  listRegisterCatalogAvailability as readRegisterCatalogAvailability,
  listRegisterCatalogAvailabilitySnapshot as readRegisterCatalogAvailabilitySnapshot,
} from "../application/queries/listRegisterCatalog";
import { readRegisterCatalogRevision } from "../application/sync/registerCatalogRevision";
import { isPosUsableRegisterSessionStatus } from "../../../shared/registerSessionStatus";
import { ok, userError } from "../../../shared/commandResult";
import { getServicePrincipalActorWithCtx } from "../../servicePrincipals/actor";
import { requirePosApplicationAuthorityWithCtx } from "../application/posApplicationAuthority";

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
  catalogRowKey: v.optional(v.string()),
  productSkuId: v.id("productSku"),
  skuId: v.id("productSku"),
  productId: v.id("product"),
  inventoryImportProvisionalSkuId: v.optional(
    v.id("inventoryImportProvisionalSku"),
  ),
  pendingCheckoutItemId: v.optional(v.id("posPendingCheckoutItem")),
  pendingCheckoutAliasState: v.optional(v.literal("linked_to_catalog")),
  pendingCheckoutAliasLookupCode: v.optional(v.string()),
  pendingCheckoutAliasName: v.optional(v.string()),
  pendingCheckoutAliasPrice: v.optional(v.number()),
  pendingCheckoutAliasTrustedName: v.optional(v.string()),
  pendingCheckoutAliasTrustedSku: v.optional(v.string()),
  pendingCheckoutAliasTrustedCategory: v.optional(v.string()),
  pendingCheckoutAliasTrustedDescription: v.optional(v.string()),
  linkedPendingCheckoutItemIds: v.optional(
    v.array(v.id("posPendingCheckoutItem")),
  ),
  linkedPendingCheckoutLocalEventIds: v.optional(v.array(v.string())),
  suppressedPendingCheckoutItemIds: v.optional(
    v.array(v.id("posPendingCheckoutItem")),
  ),
  suppressedPendingCheckoutLocalEventIds: v.optional(v.array(v.string())),
  suppressFromRegisterSearch: v.optional(v.literal(true)),
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

const linkedPendingCheckoutAliasSummaryValidator = v.object({
  aliases: v.array(
    v.object({
      lookupCode: v.optional(v.string()),
      name: v.string(),
      pendingCheckoutItemId: v.id("posPendingCheckoutItem"),
      provisionalProductId: v.optional(v.id("product")),
      provisionalSku: v.optional(v.string()),
      provisionalProductSkuId: v.optional(v.id("productSku")),
      quantitySold: v.number(),
    }),
  ),
  count: v.number(),
  productSkuId: v.id("productSku"),
});

const linkedPendingCheckoutProvisionalBindingValidator = v.object({
  linkedTarget: v.object({
    isArchived: v.boolean(),
    price: v.optional(v.number()),
    productId: v.id("product"),
    productName: v.string(),
    quantityAvailable: v.optional(v.number()),
    sku: v.optional(v.string()),
    skuId: v.id("productSku"),
  }),
  pendingCheckoutItemId: v.id("posPendingCheckoutItem"),
  productSkuId: v.id("productSku"),
});

async function isLinkedPendingCheckoutAliasVisible(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  args: {
    item: Pick<
      Doc<"posPendingCheckoutItem">,
      "provisionalProductId" | "provisionalProductSkuId"
    >;
    storeId: Id<"store">;
  },
) {
  let productId = args.item.provisionalProductId;

  if (args.item.provisionalProductSkuId) {
    const sku = await ctx.db.get(
      "productSku",
      args.item.provisionalProductSkuId,
    );
    if (!sku || sku.storeId !== args.storeId) {
      return false;
    }
    productId = sku.productId;
  }

  if (!productId) {
    return true;
  }

  const product = await ctx.db.get("product", productId);
  return (
    product !== null &&
    product.storeId === args.storeId &&
    product.availability !== "archived"
  );
}

type PendingCheckoutReviewStatus =
  "approved" | "linked_to_catalog" | "rejected" | "flagged";

type PendingCheckoutTrustedInventoryFinalizationArgs = {
  conversionRequestId: string;
  productId: Id<"product">;
  productSkuId: Id<"productSku">;
  provisionalSkuId: Id<"posPendingCheckoutItem">;
  reviewedInventoryCount: number;
  reviewedIsVisible: boolean;
  reviewedPosVisible?: boolean;
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
    posVisible: productSku.posVisible,
    netPrice: productSku.netPrice,
    price: productSku.price,
    quantityAvailable: productSku.quantityAvailable,
    unitCost: productSku.unitCost,
  });
}

function pendingCheckoutLinkPricesMatch(args: {
  pendingStoredPrice: number;
  trustedSkuStoredPrice: number;
}) {
  return args.pendingStoredPrice === args.trustedSkuStoredPrice;
}

function reviewedPosVisibleFor(
  args: Pick<
    PendingCheckoutTrustedInventoryFinalizationArgs,
    "reviewedIsVisible" | "reviewedPosVisible"
  >,
) {
  return args.reviewedPosVisible ?? args.reviewedIsVisible;
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

  if (!reviewedPosVisibleFor(args)) {
    return userError({
      code: "precondition_failed",
      message:
        "Make this SKU available in POS before finalizing trusted inventory.",
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
    reviewedPosVisible: reviewedPosVisibleFor(args),
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
  options?: {
    indexedIdentityOnly?: boolean;
  },
) {
  await requireSharedDemoStoreCapabilityIfApplicable(
    ctx,
    "pos.sale.complete",
    args.storeId,
  );
  const store = await ctx.db.get("store", args.storeId);
  if (!store) {
    throw new Error("Store not found.");
  }

  const serviceActor = await getServicePrincipalActorWithCtx(ctx);
  if (serviceActor) {
    return requirePosApplicationAuthorityWithCtx(ctx, {
      storeId: args.storeId,
    });
  }

  const athenaUser = options?.indexedIdentityOnly
    ? await requireAuthenticatedAthenaUserIndexedWithCtx(ctx, {
        sharedDemoCapability: "pos.sale.complete",
      })
    : await requireAuthenticatedAthenaUserWithCtx(ctx, {
        sharedDemoCapability: "pos.sale.complete",
      });
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
    createdByUserId: staffProfile.linkedUserId,
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
    product.availability === "archived" ||
    (row.status !== "linked_to_catalog" && product.availability !== "draft") ||
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
              isArchived: linkedProduct.availability === "archived",
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
  handler: async (ctx, args) => {
    await requireRegisterCatalogStoreAccess(ctx, args);
    return searchProducts(ctx, args);
  },
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

export const getRegisterCatalogRevision = query({
  args: {
    storeId: v.id("store"),
  },
  returns: v.union(
    v.object({ status: v.literal("authorization-paused") }),
    v.object({ revision: v.number(), status: v.literal("ready") }),
  ),
  handler: async (ctx, args) => {
    try {
      await requireRegisterCatalogStoreAccess(ctx, args, {
        indexedIdentityOnly: true,
      });
    } catch {
      return { status: "authorization-paused" as const };
    }

    return {
      revision: await readRegisterCatalogRevision(ctx, args.storeId),
      status: "ready" as const,
    };
  },
});

export const listRegisterCatalogSnapshotWithRevision = query({
  args: {
    storeId: v.id("store"),
  },
  returns: v.object({
    revision: v.number(),
    rows: v.array(registerCatalogRowValidator),
  }),
  handler: async (ctx, args) => {
    await requireRegisterCatalogStoreAccess(ctx, args);

    return listRegisterCatalogWithRevision(ctx, args);
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
  handler: async (ctx, args) => {
    await requireRegisterCatalogStoreAccess(ctx, args);
    return lookupByBarcode(ctx, args);
  },
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
    await requireSharedDemoStoreCapabilityIfApplicable(
      ctx,
      "catalog.quick_add",
      args.storeId,
    );
    const store = await ctx.db.get("store", args.storeId);
    if (!store) {
      throw new Error("Store not found.");
    }

    const serviceActor = await getServicePrincipalActorWithCtx(ctx);
    if (serviceActor) {
      const authority = await requirePosApplicationAuthorityWithCtx(ctx, {
        storeId: args.storeId,
      });
      if (args.terminalId !== authority.terminalId) {
        throw new Error("The POS application session is no longer authorized.");
      }
      const registerContext = await requirePendingCheckoutSaleContext(
        ctx,
        args,
      );
      if (!registerContext.createdByUserId) {
        throw new Error("Active staff context is required to add this item.");
      }
      return quickAddCatalogItem(ctx, {
        ...args,
        ...registerContext,
        createdByUserId: registerContext.createdByUserId,
      });
    }

    const athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx, {
      sharedDemoCapability: "catalog.quick_add",
    });
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

    const serviceActor = await getServicePrincipalActorWithCtx(ctx);
    let createdByUserId: Id<"athenaUser"> | undefined;
    let serviceTerminalId: Id<"posTerminal"> | undefined;
    if (serviceActor) {
      const authority = await requirePosApplicationAuthorityWithCtx(ctx, {
        storeId: args.storeId,
      });
      serviceTerminalId = authority.terminalId;
    } else {
      const athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
      await requireOrganizationMemberRoleWithCtx(ctx, {
        allowedRoles: ["full_admin", "pos_only"],
        failureMessage: "You cannot add pending checkout items for this store.",
        organizationId: store.organizationId,
        userId: athenaUser._id,
      });
      createdByUserId = athenaUser._id;
    }
    const registerContext = await requirePendingCheckoutSaleContext(ctx, args);
    if (serviceTerminalId) {
      if (serviceTerminalId !== registerContext.terminalId) {
        throw new Error("The POS application session is no longer authorized.");
      }
      createdByUserId = registerContext.createdByUserId;
    }

    return createOrReusePendingCheckoutItem(ctx, {
      storeId: args.storeId,
      name: args.name,
      lookupCode: args.lookupCode,
      price: args.price,
      quantitySold: args.quantitySold,
      ...registerContext,
      createdByUserId,
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

export const listLinkedPendingCheckoutAliasesBySku = query({
  args: {
    productSkuIds: v.array(v.id("productSku")),
    storeId: v.id("store"),
  },
  returns: v.array(linkedPendingCheckoutAliasSummaryValidator),
  handler: async (ctx, args) => {
    await requirePendingCheckoutReviewAccess(ctx, args);

    const summaries = await Promise.all(
      Array.from(new Set(args.productSkuIds)).map(async (productSkuId) => {
        const aliases = await ctx.db
          .query("posPendingCheckoutItem")
          .withIndex("by_storeId_status_approvedProductSkuId", (q) =>
            q
              .eq("storeId", args.storeId)
              .eq("status", "linked_to_catalog")
              .eq("approvedProductSkuId", productSkuId),
          )
          .take(20);

        const visibleAliases = [];
        for (const alias of aliases) {
          if (
            await isLinkedPendingCheckoutAliasVisible(ctx, {
              item: alias,
              storeId: args.storeId,
            })
          ) {
            visibleAliases.push(alias);
          }
        }

        const aliasSummaries = await Promise.all(
          visibleAliases.map(async (alias) => {
            const provisionalSku = alias.provisionalProductSkuId
              ? await ctx.db.get("productSku", alias.provisionalProductSkuId)
              : null;

            return {
              ...(alias.lookupCode ? { lookupCode: alias.lookupCode } : {}),
              name: alias.name,
              pendingCheckoutItemId: alias._id,
              ...(alias.provisionalProductId
                ? { provisionalProductId: alias.provisionalProductId }
                : {}),
              ...(provisionalSku?.sku
                ? { provisionalSku: provisionalSku.sku }
                : {}),
              ...(alias.provisionalProductSkuId
                ? { provisionalProductSkuId: alias.provisionalProductSkuId }
                : {}),
              quantitySold: alias.evidence.totalQuantitySold,
            };
          }),
        );

        return {
          aliases: aliasSummaries,
          count: aliasSummaries.length,
          productSkuId,
        };
      }),
    );

    return summaries.filter((summary) => summary.count > 0);
  },
});

export const listLinkedPendingCheckoutProvisionalBindingsBySku = query({
  args: {
    productSkuIds: v.array(v.id("productSku")),
    storeId: v.id("store"),
  },
  returns: v.array(linkedPendingCheckoutProvisionalBindingValidator),
  handler: async (ctx, args) => {
    await requirePendingCheckoutReviewAccess(ctx, args);

    const bindings = await Promise.all(
      Array.from(new Set(args.productSkuIds)).map(async (productSkuId) => {
        const binding = await listPendingCheckoutProductPageBindingWithCtx(
          ctx,
          {
            productSkuId,
            storeId: args.storeId,
          },
        );

        if (
          binding.state !== "unique" ||
          binding.row.status !== "linked_to_catalog" ||
          !binding.row.linkedTarget
        ) {
          return null;
        }

        return {
          linkedTarget: binding.row.linkedTarget,
          pendingCheckoutItemId: binding.row._id,
          productSkuId,
        };
      }),
    );

    return bindings.filter(
      (binding): binding is NonNullable<(typeof bindings)[number]> =>
        binding !== null,
    );
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
    reviewedPosVisible: v.optional(v.boolean()),
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
      reviewedPosVisible: args.reviewedPosVisible ?? args.reviewedIsVisible,
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
      isVisible: normalizedArgs.reviewedIsVisible,
      posVisible: normalizedArgs.reviewedPosVisible,
      netPrice: normalizedArgs.reviewedNetPrice,
      price: normalizedArgs.reviewedPrice,
    });
    const productPatch = {
      availability: "live" as const,
      inventoryCount: normalizedArgs.reviewedInventoryCount,
      posVisible: true,
      quantityAvailable: normalizedArgs.reviewedQuantityAvailable,
    };

    const stockDelta =
      normalizedArgs.reviewedInventoryCount - productSku.inventoryCount;
    const availabilityDelta =
      normalizedArgs.reviewedQuantityAvailable - productSku.quantityAvailable;
    const valuation =
      stockDelta > 0
        ? {
            costBasis:
              normalizedArgs.reviewedUnitCost === undefined
                ? uncostedBasis()
                : knownUnitCostBasis({
                    currency: product.currency ?? item.currency,
                    quantity: stockDelta,
                    unitCost: normalizedArgs.reviewedUnitCost,
                  }),
            deficitLots: [],
            kind: "inbound" as const,
            quantity: stockDelta,
          }
        : stockDelta < 0
          ? {
              disposition: "stock_correction" as const,
              kind: "outbound" as const,
              quantity: Math.abs(stockDelta),
            }
          : { kind: "availability_only" as const };
    const inventoryEffect = await applyInventoryEffectWithCtx(ctx, {
      actorUserId: access.athenaUser._id,
      activityType: "pending_checkout_trusted_finalization",
      businessEventKey: `pending_checkout:${item._id}:trusted:${normalizedArgs.conversionRequestId}`,
      compatibilityBalance: {
        onHandQuantity: normalizedArgs.reviewedInventoryCount,
        sellableQuantity: normalizedArgs.reviewedQuantityAvailable,
      },
      completeness: "partial",
      contentFingerprint: payloadHash,
      effectType: "baseline",
      movementType: "pending_checkout_trusted_finalization",
      notes: "Trusted inventory finalized from pending checkout review.",
      occurrenceAt: now,
      organizationId: access.store.organizationId,
      physicalQuantityDelta: stockDelta,
      productId: normalizedArgs.productId,
      productSkuId: normalizedArgs.productSkuId,
      reasonCode: "trusted_inventory_conversion",
      sellableQuantityDelta: availabilityDelta,
      sourceDomain: "inventory",
      sourceId: String(item._id),
      sourceType: "pos_pending_checkout_item",
      storeId: normalizedArgs.storeId,
      valuation,
    });
    await ctx.db.patch("productSku", normalizedArgs.productSkuId, {
      ...(productSkuPatch.isVisible !== undefined
        ? { isVisible: productSkuPatch.isVisible }
        : {}),
      ...(productSkuPatch.posVisible !== undefined
        ? { posVisible: productSkuPatch.posVisible }
        : {}),
      ...(productSkuPatch.netPrice !== undefined
        ? { netPrice: productSkuPatch.netPrice }
        : {}),
      ...(productSkuPatch.price !== undefined
        ? { price: productSkuPatch.price }
        : {}),
    });
    await ctx.db.patch("product", normalizedArgs.productId, productPatch);
    await upsertProductSkuSearchProjection(ctx, normalizedArgs.productSkuId, {
      advanceRevision: false,
    });

    const inventoryMovementId = inventoryEffect.movement?._id;

    await ctx.db.patch("posPendingCheckoutItem", item._id, {
      approvedProductId: normalizedArgs.productId,
      approvedProductSkuId: normalizedArgs.productSkuId,
      reviewedAt: now,
      reviewedByUserId: access.athenaUser._id,
      reviewNote: "Trusted inventory finalized from product edit.",
      status: "approved",
      updatedAt: now,
    });
    await advanceRegisterCatalogRevision(ctx, {
      didChange: true,
      storeId: normalizedArgs.storeId,
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
  returns: commandResultValidator(pendingCheckoutReviewItemValidator),
  handler: async (ctx, args) => {
    const store = await ctx.db.get("store", args.storeId);
    if (!store) {
      return userError({
        code: "not_found",
        message: "Store not found.",
      });
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
      return userError({
        code: "not_found",
        message: "Pending checkout item not found.",
      });
    }
    if (
      item.status === "linked_to_catalog" &&
      (await hasPendingCheckoutTransactionAttribution(ctx, item._id)) &&
      (args.status !== "linked_to_catalog" ||
        args.approvedProductId !== item.approvedProductId ||
        args.approvedProductSkuId !== item.approvedProductSkuId)
    ) {
      return userError({
        code: "conflict",
        message:
          "This pending checkout item is already linked to a trusted SKU. Create a correction to change linked sale history.",
      });
    }

    const approvedProduct = args.approvedProductId
      ? await ctx.db.get("product", args.approvedProductId)
      : null;
    const approvedSku = args.approvedProductSkuId
      ? await ctx.db.get("productSku", args.approvedProductSkuId)
      : null;
    const provisionalSku = item.provisionalProductSkuId
      ? await ctx.db.get("productSku", item.provisionalProductSkuId)
      : null;
    const approvedProductCategory = approvedProduct?.categoryId
      ? await ctx.db.get("category", approvedProduct.categoryId)
      : null;
    const pendingStoredPrice =
      provisionalSku &&
      provisionalSku.storeId === args.storeId &&
      provisionalSku._id === item.provisionalProductSkuId
        ? provisionalSku.price
        : item.provisionalPrice;
    const trustedSkuLinkPrice = approvedSku?.netPrice ?? approvedSku?.price;
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
        return userError({
          code: "validation_failed",
          message: "Choose a valid catalog product and SKU from this store.",
        });
      }

      if (
        args.status === "linked_to_catalog" &&
        (typeof pendingStoredPrice !== "number" ||
          typeof trustedSkuLinkPrice !== "number" ||
          !pendingCheckoutLinkPricesMatch({
            pendingStoredPrice,
            trustedSkuStoredPrice: trustedSkuLinkPrice,
          }))
      ) {
        return userError({
          code: "validation_failed",
          message:
            "Link to a SKU with the same price as the pending checkout item.",
        });
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
      retiredLookupAliasId = await retirePendingCheckoutLookupAliasForItem(
        ctx,
        {
          lookupCode: item.lookupCode,
          now: reviewedAt,
          pendingCheckoutItemId: item._id,
          storeId: args.storeId,
        },
      );

      if (item.lookupCode && item.approvedProductSkuId) {
        const priorApprovedSku = await ctx.db.get(
          "productSku",
          item.approvedProductSkuId,
        );
        if (priorApprovedSku?.barcode?.trim() === item.lookupCode.trim()) {
          await ctx.db.patch("productSku", priorApprovedSku._id, {
            barcode: undefined,
          });
          await upsertProductSkuSearchProjection(ctx, priorApprovedSku._id, {
            advanceRevision: false,
          });
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
        return userError({
          code: "conflict",
          message: "This lookup code already belongs to another catalog SKU.",
        });
      }

      if (!approvedSku.barcode?.trim()) {
        await ctx.db.patch("productSku", approvedSku._id, {
          barcode: item.lookupCode,
          barcodeAutoGenerated: false,
        });
        await upsertProductSkuSearchProjection(ctx, approvedSku._id, {
          advanceRevision: false,
        });
        attachedLookupCode = item.lookupCode;
      } else {
        try {
          lookupAliasId = await upsertPendingCheckoutLookupAlias(ctx, {
            lookupCode: item.lookupCode,
            now: reviewedAt,
            organizationId: store.organizationId,
            pendingCheckoutItemId: item._id,
            productId: approvedProduct!._id,
            productSkuId: approvedSku._id,
            storeId: args.storeId,
          });
        } catch (error) {
          if (
            error instanceof Error &&
            error.message ===
              "This lookup code is already linked to another SKU."
          ) {
            return userError({
              code: "conflict",
              message: error.message,
            });
          }
          throw error;
        }
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
    await advanceRegisterCatalogRevision(ctx, {
      didChange:
        item.status !== args.status ||
        item.approvedProductId !== args.approvedProductId ||
        item.approvedProductSkuId !== args.approvedProductSkuId ||
        attachedLookupCode !== undefined ||
        lookupAliasId !== null ||
        retiredLookupAliasId !== null,
      storeId: args.storeId,
    });
    if (
      (args.status === "approved" || args.status === "linked_to_catalog") &&
      args.approvedProductSkuId &&
      item.provisionalProductSkuId
    ) {
      await recordPendingCheckoutSkuAttributionWithCtx(ctx, {
        canonicalProductId: args.approvedProductId,
        canonicalProductSkuId: args.approvedProductSkuId,
        organizationId: store.organizationId,
        originalProductId: item.provisionalProductId,
        originalProductSkuId: item.provisionalProductSkuId,
        pendingCheckoutItemId: item._id,
        storeId: args.storeId,
      });
    }

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

    return ok(toPendingCheckoutReviewItem(reviewedItem));
  },
});
