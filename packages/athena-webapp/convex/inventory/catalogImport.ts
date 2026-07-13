import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { v } from "convex/values";

import { commandResultValidator } from "../lib/commandResultValidators";
import {
  requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx,
} from "../lib/athenaUserAuth";
import {
  getActiveManagerElevationByIdWithCtx,
  getActiveManagerElevationWithCtx,
} from "../operations/managerElevations";
import { recordOperationalEventWithCtx } from "../operations/operationalEvents";
import { createOperationalWorkItemWithCtx } from "../operations/operationalWorkItems";
import { recordSkuActivityEventWithCtx } from "../operations/skuActivity";
import { applyInventoryEffectWithCtx } from "../reporting/inventory/effects";
import {
  knownUnitCostBasis,
  uncostedBasis,
} from "../reporting/inventory/valuation";
import { toSlug } from "../utils";
import { ok, userError, type CommandResult } from "../../shared/commandResult";
import { isPosCatalogVisible } from "../../shared/posCatalogVisibility";
import { refreshCatalogSummaryWithCtx } from "./catalogSummary";
import {
  upsertProductSkuSearchProjection,
  upsertProductSkuSearchProjections,
} from "./skuSearch";
import { advanceRegisterCatalogRevision } from "../pos/application/sync/registerCatalogRevision";

const DEFAULT_CATEGORY_NAME = "Legacy import";
const DEFAULT_SUBCATEGORY_NAME = "Imported inventory";
const IMPORT_EVENT_TYPE = "inventory_import_applied";
const REVIEW_VERSION_EVENT_TYPE = "inventory_import_review_version_saved";
const PROVISIONAL_STAGE_EVENT_TYPE = "inventory_import_provisional_pos_staged";
const PROVISIONAL_TRUST_FINALIZATION_EVENT_TYPE =
  "inventory_import_provisional_trusted_finalized";
export const CATALOG_TAXONOMY_SETUP_WORK_ITEM_TYPE = "catalog_taxonomy_setup";
const CATALOG_TAXONOMY_SETUP_WORK_ITEM_STATUSES = [
  "open",
  "in_progress",
] as const;
const PROVISIONAL_IMPORT_FINALIZATION_LIMIT = 5000;
const CATALOG_TAXONOMY_FINALIZATION_ROW_LIMIT = 25;
const TRUSTED_FINALIZATION_ACTIVE_CHECKOUT_SESSION_LIMIT = 200;
const DEFAULT_CATEGORY_SLUG = toSlug(DEFAULT_CATEGORY_NAME);
const TRUSTED_FINALIZATION_CHECKOUT_SESSION_ITEM_LIMIT = 200;
const LEGACY_IMPORT_TRUSTED_VISIBILITY_REPAIR_LIMIT = 200;

type ProvisionalImportIdentity = {
  productId: Id<"product">;
  productSkuId: Id<"productSku">;
  sku?: string;
  barcode?: string;
};

type LegacyImportTrustedVisibilityRepairSku = {
  productId: Id<"product">;
  productName: string;
  productSkuId: Id<"productSku">;
  sku?: string;
};

type LegacyImportTrustedVisibilityRepairCursor = {
  finalizedAt: number;
  scannedRowIds: Array<Id<"inventoryImportProvisionalSku">>;
  status: "active" | "finalized";
};

type LegacyImportTrustedVisibilityRepairResult = {
  dryRun: boolean;
  limit: number;
  nextCursor?: LegacyImportTrustedVisibilityRepairCursor;
  promotedToLive: number;
  refreshedSearchProjections: number;
  repairedProducts: number;
  repairedSkus: LegacyImportTrustedVisibilityRepairSku[];
  scannedRows: number;
  skippedArchivedProducts: number;
  skippedLegacyTaxonomy: number;
  taxonomyWorkItemsEnsured: number;
  taxonomyWorkItemSkus: LegacyImportTrustedVisibilityRepairSku[];
  truncated: boolean;
  visibleProducts: number;
};

const importStatusValidator = v.union(
  v.literal("active"),
  v.literal("draft"),
  v.literal("archived"),
);

const importRowValidator = v.object({
  rowNumber: v.number(),
  productName: v.string(),
  category: v.optional(v.string()),
  subcategory: v.optional(v.string()),
  sku: v.optional(v.string()),
  barcode: v.optional(v.string()),
  price: v.number(),
  unitCost: v.optional(v.number()),
  quantity: v.number(),
  size: v.optional(v.string()),
  color: v.optional(v.string()),
  length: v.optional(v.number()),
  weight: v.optional(v.string()),
  status: v.optional(importStatusValidator),
});

const importSourceFormatValidator = v.union(
  v.literal("csv"),
  v.literal("json"),
);

const inventoryImportReviewVersionValidator = v.object({
  _id: v.id("inventoryImportReviewVersion"),
  createdAt: v.number(),
  fileName: v.optional(v.string()),
  importKey: v.string(),
  issueCount: v.number(),
  notes: v.optional(v.string()),
  rawContent: v.string(),
  rowDecisions: v.optional(
    v.array(
      v.object({
        action: v.optional(
          v.union(v.literal("create_item"), v.literal("skip_row")),
        ),
        nameSource: v.optional(
          v.union(v.literal("import"), v.literal("athena")),
        ),
        priceSource: v.optional(
          v.union(v.literal("import"), v.literal("athena")),
        ),
        productName: v.string(),
        quantitySource: v.optional(
          v.union(v.literal("import"), v.literal("athena")),
        ),
        rowKey: v.string(),
        rowNumber: v.number(),
      }),
    ),
  ),
  rowCount: v.number(),
  sourceFormat: importSourceFormatValidator,
  versionNumber: v.number(),
});

const legacyImportTrustedVisibilityRepairSkuValidator = v.object({
  productId: v.id("product"),
  productName: v.string(),
  productSkuId: v.id("productSku"),
  sku: v.optional(v.string()),
});

const legacyImportTrustedVisibilityRepairCursorValidator = v.object({
  finalizedAt: v.number(),
  scannedRowIds: v.array(v.id("inventoryImportProvisionalSku")),
  status: v.union(v.literal("active"), v.literal("finalized")),
});

const legacyImportTrustedVisibilityRepairResultValidator = v.object({
  dryRun: v.boolean(),
  limit: v.number(),
  nextCursor: v.optional(legacyImportTrustedVisibilityRepairCursorValidator),
  promotedToLive: v.number(),
  refreshedSearchProjections: v.number(),
  repairedProducts: v.number(),
  repairedSkus: v.array(legacyImportTrustedVisibilityRepairSkuValidator),
  scannedRows: v.number(),
  skippedArchivedProducts: v.number(),
  skippedLegacyTaxonomy: v.number(),
  taxonomyWorkItemsEnsured: v.number(),
  taxonomyWorkItemSkus: v.array(
    legacyImportTrustedVisibilityRepairSkuValidator,
  ),
  truncated: v.boolean(),
  visibleProducts: v.number(),
});

const provisionalImportStageRowValidator = v.object({
  action: v.optional(v.union(v.literal("create_item"), v.literal("skip_row"))),
  barcode: v.optional(v.string()),
  category: v.optional(v.string()),
  color: v.optional(v.string()),
  length: v.optional(v.number()),
  nameSource: v.optional(v.union(v.literal("import"), v.literal("athena"))),
  price: v.number(),
  priceSource: v.optional(v.union(v.literal("import"), v.literal("athena"))),
  productId: v.optional(v.id("product")),
  productName: v.string(),
  productSkuId: v.optional(v.id("productSku")),
  quantity: v.number(),
  quantitySource: v.optional(v.union(v.literal("import"), v.literal("athena"))),
  rowKey: v.string(),
  rowNumber: v.number(),
  size: v.optional(v.string()),
  sku: v.optional(v.string()),
  subcategory: v.optional(v.string()),
  unitCost: v.optional(v.number()),
  weight: v.optional(v.string()),
});

export type CatalogImportRow = {
  rowNumber: number;
  productName: string;
  category?: string;
  subcategory?: string;
  sku?: string;
  barcode?: string;
  price: number;
  unitCost?: number;
  quantity: number;
  size?: string;
  color?: string;
  length?: number;
  weight?: string;
  status?: "active" | "draft" | "archived";
};

export type ProvisionalInventoryImportStageRow = CatalogImportRow & {
  action?: "create_item" | "skip_row";
  nameSource?: "import" | "athena";
  priceSource?: "import" | "athena";
  productId?: Id<"product">;
  productSkuId?: Id<"productSku">;
  quantitySource?: "import" | "athena";
  rowKey: string;
};

export type CatalogImportSummary = {
  alreadyApplied?: boolean;
  categoriesCreated: number;
  productsCreated: number;
  productsUpdated: number;
  rowsImported: number;
  skusCreated: number;
  skusUpdated: number;
  subcategoriesCreated: number;
};

export type ProvisionalInventoryImportStageSummary = {
  alreadyStaged: boolean;
  catalogIdentitiesCreated: number;
  provisionalRowsCreated: number;
  provisionalRowsUpdated: number;
  rowsSkipped: number;
  rowsStaged: number;
  trustedStockRowsUpdated: 0;
};

export type ProductPageProvisionalSkuBinding =
  | {
      activeRowCount: 0;
      state: "none";
    }
  | {
      activeRowCount: number;
      state: "ambiguous";
    }
  | {
      activeRowCount: 0;
      message: string;
      state: "unauthorized";
    }
  | {
      activeRowCount: 1;
      row: {
        _id: Id<"inventoryImportProvisionalSku">;
        finalizedAt?: number;
        importKey: string;
        importedQuantity: number;
        lastPosTransactionId?: Id<"posTransaction">;
        lastRegisterSessionId?: Id<"registerSession">;
        lastSoldAt?: number;
        posExposureStatus: "available" | "hidden";
        provisionalSoldQuantity: number;
        reviewVersionId: Id<"inventoryImportReviewVersion">;
        reviewVersionNumber: number;
        rowKey: string;
        rowNumber: number;
        saleCount: number;
        updatedAt: number;
      };
      saleEvidenceFingerprint: string;
      state: "unique";
      trustedSkuFingerprint: string;
    };

export type ProductPageTrustedInventoryFinalizationArgs = {
  conversionRequestId: string;
  productId: Id<"product">;
  productSkuId: Id<"productSku">;
  provisionalSkuId: Id<"inventoryImportProvisionalSku">;
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

export type ProductPageTrustedInventoryFinalizationResult = {
  finalTrustedQuantity: number;
  inventoryMovementId?: Id<"inventoryMovement">;
  product?: {
    availability?: Doc<"product">["availability"];
    posVisible?: boolean;
  };
  productId: Id<"product">;
  productSkuId: Id<"productSku">;
  provisionalSkuId: Id<"inventoryImportProvisionalSku">;
  provisionalSoldQuantity: number;
  quantityAvailable: number;
};

type ImportAccess = {
  athenaUser: Doc<"athenaUser">;
  store: Doc<"store">;
};

type InventoryImportAccessCtx =
  Pick<QueryCtx, "auth" | "db"> | Pick<MutationCtx, "auth" | "db">;

type MutableSummary = Omit<CatalogImportSummary, "alreadyApplied">;

export type InventoryImportReviewVersionSummary = {
  _id: Id<"inventoryImportReviewVersion">;
  createdAt: number;
  fileName?: string;
  importKey: string;
  issueCount: number;
  rowCount: number;
  sourceFormat: "csv" | "json";
  versionNumber: number;
};

export type InventoryImportReviewRowDecision = {
  action?: "create_item" | "skip_row";
  nameSource?: "import" | "athena";
  priceSource?: "import" | "athena";
  productName: string;
  quantitySource?: "import" | "athena";
  rowKey: string;
  rowNumber: number;
};

export async function importInventoryRowsWithCtx(
  ctx: MutationCtx,
  args: {
    importKey: string;
    managerElevationId?: Id<"managerElevation">;
    notes?: string;
    rows: CatalogImportRow[];
    sourceFormat: "csv" | "json";
    storeId: Id<"store">;
  },
  access: ImportAccess,
): Promise<CatalogImportSummary> {
  const importRows = args.rows.map(normalizeImportRow);
  const validationErrors = validateImportRows(importRows);
  if (validationErrors.length > 0) {
    throw new Error(validationErrors.join("\n"));
  }

  const existingImportEvent = await ctx.db
    .query("operationalEvent")
    .withIndex("by_storeId_subject", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("subjectType", "inventory_import")
        .eq("subjectId", args.importKey),
    )
    .first();

  if (existingImportEvent?.metadata) {
    return {
      alreadyApplied: true,
      categoriesCreated: Number(
        existingImportEvent.metadata.categoriesCreated ?? 0,
      ),
      productsCreated: Number(
        existingImportEvent.metadata.productsCreated ?? 0,
      ),
      productsUpdated: Number(
        existingImportEvent.metadata.productsUpdated ?? 0,
      ),
      rowsImported: Number(existingImportEvent.metadata.rowsImported ?? 0),
      skusCreated: Number(existingImportEvent.metadata.skusCreated ?? 0),
      skusUpdated: Number(existingImportEvent.metadata.skusUpdated ?? 0),
      subcategoriesCreated: Number(
        existingImportEvent.metadata.subcategoriesCreated ?? 0,
      ),
    };
  }

  const activeProvisionalRows =
    await listActiveProvisionalImportRowsForFinalization(ctx, {
      importKey: args.importKey,
      storeId: args.storeId,
    });

  const summary: MutableSummary = {
    categoriesCreated: 0,
    productsCreated: 0,
    productsUpdated: 0,
    rowsImported: 0,
    skusCreated: 0,
    skusUpdated: 0,
    subcategoriesCreated: 0,
  };
  const touchedProductIds = new Set<Id<"product">>();
  const touchedProductSkuIds = new Set<Id<"productSku">>();
  const finalTrustedQuantitiesByRowNumber =
    buildFinalTrustedQuantitiesByRowNumber(importRows, activeProvisionalRows);

  for (const row of importRows) {
    const finalTrustedQuantity =
      finalTrustedQuantitiesByRowNumber.get(row.rowNumber) ?? row.quantity;
    const category = await findOrCreateCategory(ctx, {
      name: row.category,
      storeId: args.storeId,
      summary,
    });
    const subcategory = await findOrCreateSubcategory(ctx, {
      categoryId: category._id,
      name: row.subcategory,
      storeId: args.storeId,
      summary,
    });
    const existingSku = await findExistingSku(ctx, args.storeId, row);
    const product =
      existingSku && (await ctx.db.get("product", existingSku.productId))
        ? await ctx.db.get("product", existingSku.productId)
        : await findOrCreateProduct(ctx, {
            access,
            categoryId: category._id,
            row,
            storeId: args.storeId,
            subcategoryId: subcategory._id,
            summary,
          });

    if (!product) {
      throw new Error(`Row ${row.rowNumber}: product could not be loaded.`);
    }

    if (existingSku) {
      const skuMetadata = buildSkuPatch(row, product._id, finalTrustedQuantity);
      await ctx.db.patch("productSku", existingSku._id, {
        attributes: skuMetadata.attributes,
        barcode: skuMetadata.barcode,
        isVisible: skuMetadata.isVisible,
        length: skuMetadata.length,
        netPrice: skuMetadata.netPrice,
        price: skuMetadata.price,
        productId: skuMetadata.productId,
        productName: skuMetadata.productName,
        size: skuMetadata.size,
        sku: skuMetadata.sku,
        weight: skuMetadata.weight,
      });
      await applyImportedSkuInventoryWithCtx(ctx, {
        access,
        currentSku: existingSku,
        importKey: args.importKey,
        product,
        row,
        storeId: args.storeId,
        targetQuantity: finalTrustedQuantity,
      });
      touchedProductSkuIds.add(existingSku._id);
      summary.skusUpdated += 1;
    } else {
      const productSkuId = await ctx.db.insert(
        "productSku",
        buildSkuInsert(row, product._id, args.storeId, finalTrustedQuantity),
      );
      const createdSku = await ctx.db.get("productSku", productSkuId);
      if (!createdSku) {
        throw new Error(`Row ${row.rowNumber}: SKU could not be loaded.`);
      }
      await applyImportedSkuInventoryWithCtx(ctx, {
        access,
        currentSku: createdSku,
        importKey: args.importKey,
        product,
        row,
        storeId: args.storeId,
        targetQuantity: finalTrustedQuantity,
      });
      touchedProductSkuIds.add(productSkuId);
      summary.skusCreated += 1;
    }

    touchedProductIds.add(product._id);
    summary.rowsImported += 1;
  }

  for (const productId of touchedProductIds) {
    const didUpdate = await recomputeProductInventory(ctx, productId);
    if (didUpdate) summary.productsUpdated += 1;
  }

  await finalizeProvisionalImportRowsForAppliedImport(ctx, {
    actorUserId: access.athenaUser._id,
    importKey: args.importKey,
    finalTrustedQuantitiesByRowNumber,
    stagedRows: activeProvisionalRows,
    rows: importRows,
    storeId: args.storeId,
  });
  await upsertProductSkuSearchProjections(
    ctx,
    Array.from(touchedProductSkuIds),
    args.storeId,
    { additionalEffectiveChange: activeProvisionalRows.length > 0 },
  );

  await recordOperationalEventWithCtx(ctx, {
    actorUserId: access.athenaUser._id,
    eventType: IMPORT_EVENT_TYPE,
    message: `${getActorLabel(access.athenaUser)} imported ${summary.rowsImported} inventory row${summary.rowsImported === 1 ? "" : "s"} into Athena.`,
    metadata: {
      ...summary,
      importKey: args.importKey,
      sourceFormat: args.sourceFormat,
    },
    organizationId: access.store.organizationId,
    reason: args.notes,
    storeId: args.storeId,
    subjectId: args.importKey,
    subjectLabel: "Inventory import",
    subjectType: "inventory_import",
  });

  await refreshCatalogSummaryWithCtx(ctx, args.storeId);

  return summary;
}

export async function importInventoryCommandWithCtx(
  ctx: MutationCtx,
  args: {
    importKey: string;
    notes?: string;
    rows: CatalogImportRow[];
    sourceFormat: "csv" | "json";
    storeId: Id<"store">;
    terminalId?: Id<"posTerminal">;
  },
): Promise<CommandResult<CatalogImportSummary>> {
  try {
    const access = await requireInventoryImportAccess(ctx, args);
    return ok(await importInventoryRowsWithCtx(ctx, args, access));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Inventory import failed.";

    if (
      message === "Authentication required." ||
      message === "Sign in again to continue."
    ) {
      return userError({ code: "authentication_failed", message });
    }

    if (
      message === "Manager elevation is required before importing inventory." ||
      message ===
        "Terminal context is required before using manager elevation." ||
      message === "You do not have permission to import inventory." ||
      message === "Athena user not found."
    ) {
      return userError({ code: "authorization_failed", message });
    }

    if (message === "Store not found.") {
      return userError({ code: "not_found", message });
    }

    if (message.startsWith("Row ") || message.includes("\nRow ")) {
      return userError({ code: "validation_failed", message });
    }

    throw error;
  }
}

export const importInventory = mutation({
  args: {
    importKey: v.string(),
    managerElevationId: v.optional(v.id("managerElevation")),
    notes: v.optional(v.string()),
    rows: v.array(importRowValidator),
    sourceFormat: v.union(v.literal("csv"), v.literal("json")),
    storeId: v.id("store"),
    terminalId: v.optional(v.id("posTerminal")),
  },
  returns: commandResultValidator(v.any()),
  handler: importInventoryCommandWithCtx,
});

export async function saveInventoryImportReviewVersionWithCtx(
  ctx: MutationCtx,
  args: {
    fileName?: string;
    importKey: string;
    issueCount: number;
    managerElevationId?: Id<"managerElevation">;
    notes?: string;
    rawContent: string;
    rowDecisions?: InventoryImportReviewRowDecision[];
    rowCount: number;
    sourceFormat: "csv" | "json";
    storeId: Id<"store">;
    terminalId?: Id<"posTerminal">;
  },
  resolvedAccess?: ImportAccess,
): Promise<InventoryImportReviewVersionSummary> {
  requireTerminalContextForManagerElevation(args);
  const access =
    resolvedAccess ?? (await requireInventoryImportAccess(ctx, args));
  const rawContent = args.rawContent.trim();

  if (!rawContent) {
    throw new Error(
      "Import content is required before saving a review version.",
    );
  }

  const latestVersion = await ctx.db
    .query("inventoryImportReviewVersion")
    .withIndex("by_storeId_createdAt", (q) => q.eq("storeId", args.storeId))
    .order("desc")
    .first();
  const versionNumber = (latestVersion?.versionNumber ?? 0) + 1;
  const createdAt = Date.now();
  const fileName = normalizeOptional(args.fileName);
  const notes = normalizeOptional(args.notes);
  const rowDecisions = normalizeReviewRowDecisions(args.rowDecisions);
  const versionId = await ctx.db.insert("inventoryImportReviewVersion", {
    createdAt,
    createdByUserId: access.athenaUser._id,
    fileName,
    importKey: args.importKey,
    issueCount: args.issueCount,
    notes,
    organizationId: access.store.organizationId,
    rawContent,
    rowDecisions,
    rowCount: args.rowCount,
    sourceFormat: args.sourceFormat,
    storeId: args.storeId,
    versionNumber,
  });

  await recordOperationalEventWithCtx(ctx, {
    actorUserId: access.athenaUser._id,
    eventType: REVIEW_VERSION_EVENT_TYPE,
    message: `${getActorLabel(access.athenaUser)} saved inventory import review version ${versionNumber}.`,
    metadata: {
      fileName,
      importKey: args.importKey,
      issueCount: args.issueCount,
      rowCount: args.rowCount,
      rowDecisionCount: rowDecisions.length,
      sourceFormat: args.sourceFormat,
      versionId,
      versionNumber,
    },
    organizationId: access.store.organizationId,
    reason: notes,
    storeId: args.storeId,
    subjectId: String(versionId),
    subjectLabel: `Inventory import review v${versionNumber}`,
    subjectType: "inventory_import_review_version",
  });

  return {
    _id: versionId,
    createdAt,
    fileName,
    importKey: args.importKey,
    issueCount: args.issueCount,
    rowCount: args.rowCount,
    sourceFormat: args.sourceFormat,
    versionNumber,
  };
}

export async function saveInventoryImportReviewVersionCommandWithCtx(
  ctx: MutationCtx,
  args: Parameters<typeof saveInventoryImportReviewVersionWithCtx>[1],
): Promise<CommandResult<InventoryImportReviewVersionSummary>> {
  try {
    return ok(await saveInventoryImportReviewVersionWithCtx(ctx, args));
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Review version could not be saved.";

    if (
      message === "Authentication required." ||
      message === "Sign in again to continue."
    ) {
      return userError({ code: "authentication_failed", message });
    }

    if (
      message === "Manager elevation is required before importing inventory." ||
      message ===
        "Terminal context is required before using manager elevation." ||
      message === "You do not have permission to import inventory." ||
      message === "Athena user not found."
    ) {
      return userError({ code: "authorization_failed", message });
    }

    if (message === "Store not found.") {
      return userError({ code: "not_found", message });
    }

    if (
      message === "Import content is required before saving a review version."
    ) {
      return userError({ code: "validation_failed", message });
    }

    throw error;
  }
}

export const saveInventoryImportReviewVersion = mutation({
  args: {
    fileName: v.optional(v.string()),
    importKey: v.string(),
    issueCount: v.number(),
    notes: v.optional(v.string()),
    rawContent: v.string(),
    rowDecisions: v.optional(
      v.array(
        v.object({
          action: v.optional(
            v.union(v.literal("create_item"), v.literal("skip_row")),
          ),
          nameSource: v.optional(
            v.union(v.literal("import"), v.literal("athena")),
          ),
          priceSource: v.optional(
            v.union(v.literal("import"), v.literal("athena")),
          ),
          productName: v.string(),
          quantitySource: v.optional(
            v.union(v.literal("import"), v.literal("athena")),
          ),
          rowKey: v.string(),
          rowNumber: v.number(),
        }),
      ),
    ),
    rowCount: v.number(),
    sourceFormat: importSourceFormatValidator,
    storeId: v.id("store"),
    managerElevationId: v.optional(v.id("managerElevation")),
    terminalId: v.optional(v.id("posTerminal")),
  },
  returns: commandResultValidator(v.any()),
  handler: saveInventoryImportReviewVersionCommandWithCtx,
});

export async function stageInventoryImportReviewRowsForPosWithCtx(
  ctx: MutationCtx,
  args: {
    importKey: string;
    managerElevationId?: Id<"managerElevation">;
    notes?: string;
    reviewVersionId: Id<"inventoryImportReviewVersion">;
    rows: ProvisionalInventoryImportStageRow[];
    sourceFormat: "csv" | "json";
    storeId: Id<"store">;
    terminalId?: Id<"posTerminal">;
  },
  resolvedAccess?: ImportAccess,
): Promise<ProvisionalInventoryImportStageSummary> {
  requireTerminalContextForManagerElevation(args);
  const access =
    resolvedAccess ?? (await requireInventoryImportAccess(ctx, args));
  const reviewVersion = await ctx.db.get(
    "inventoryImportReviewVersion",
    args.reviewVersionId,
  );

  if (!reviewVersion || reviewVersion.storeId !== args.storeId) {
    throw new Error("Inventory import review version not found.");
  }

  if (reviewVersion.importKey !== args.importKey) {
    throw new Error("Import key does not match the saved review version.");
  }

  const rows = normalizeProvisionalStageRows(args.rows);
  if (rows.length === 0) {
    throw new Error(
      "At least one import review row is required before staging POS availability.",
    );
  }

  const summary: ProvisionalInventoryImportStageSummary = {
    alreadyStaged: false,
    catalogIdentitiesCreated: 0,
    provisionalRowsCreated: 0,
    provisionalRowsUpdated: 0,
    rowsSkipped: 0,
    rowsStaged: 0,
    trustedStockRowsUpdated: 0,
  };
  const stagedIds: Array<Id<"inventoryImportProvisionalSku">> = [];
  let registerCatalogChanged = false;

  for (const row of rows) {
    const existing = await ctx.db
      .query("inventoryImportProvisionalSku")
      .withIndex("by_storeId_importKey_rowKey", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("importKey", args.importKey)
          .eq("rowKey", row.rowKey),
      )
      .first();

    if (row.action === "skip_row") {
      summary.rowsSkipped += 1;
      if (existing?.status === "active") {
        const now = Date.now();
        summary.alreadyStaged = true;
        summary.provisionalRowsUpdated += 1;
        await ctx.db.patch("inventoryImportProvisionalSku", existing._id, {
          status: "closed",
          posExposureStatus: "hidden",
          hiddenAt: now,
          closedAt: now,
          closedByUserId: access.athenaUser._id,
          updatedAt: now,
        });
        registerCatalogChanged = true;
      }
      continue;
    }

    if (existing && existing.status !== "active") {
      summary.alreadyStaged = true;
      summary.rowsSkipped += 1;
      continue;
    }

    const submittedIdentity = await resolveSubmittedProvisionalImportIdentity(
      ctx,
      {
        row,
        storeId: args.storeId,
      },
    );
    const identity =
      submittedIdentity ??
      (existing?.productId && existing.productSkuId
        ? await resolveExistingProvisionalImportIdentity(ctx, {
            productId: existing.productId,
            productSkuId: existing.productSkuId,
            row,
            storeId: args.storeId,
          })
        : await resolveProvisionalImportIdentity(ctx, {
            access,
            row,
            storeId: args.storeId,
            summary,
          }));
    const patch = buildProvisionalSkuPatch({
      access,
      identity,
      reviewVersion,
      row,
      sourceFormat: args.sourceFormat,
      storeId: args.storeId,
    });

    if (existing) {
      summary.alreadyStaged = true;
      summary.provisionalRowsUpdated += 1;
      await ctx.db.patch("inventoryImportProvisionalSku", existing._id, patch);
      registerCatalogChanged =
        registerCatalogChanged ||
        existing.status !== patch.status ||
        existing.posExposureStatus !== patch.posExposureStatus ||
        existing.productId !== patch.productId ||
        existing.productSkuId !== patch.productSkuId ||
        existing.importedProductName !== patch.importedProductName ||
        existing.importedSku !== patch.importedSku ||
        existing.importedBarcode !== patch.importedBarcode ||
        existing.importedCategory !== patch.importedCategory ||
        existing.importedColor !== patch.importedColor ||
        existing.importedLength !== patch.importedLength ||
        existing.importedPrice !== patch.importedPrice ||
        existing.importedSize !== patch.importedSize;
      stagedIds.push(existing._id);
    } else {
      const id = await ctx.db.insert("inventoryImportProvisionalSku", {
        ...patch,
        createdAt: patch.updatedAt,
        createdByUserId: access.athenaUser._id,
        saleEvidence: {
          saleCount: 0,
          totalQuantitySold: 0,
        },
      });
      summary.provisionalRowsCreated += 1;
      registerCatalogChanged = true;
      stagedIds.push(id);
    }

    summary.rowsStaged += 1;
  }

  await advanceRegisterCatalogRevision(ctx, {
    didChange: registerCatalogChanged,
    storeId: args.storeId,
  });

  await recordOperationalEventWithCtx(ctx, {
    actorUserId: access.athenaUser._id,
    eventType: PROVISIONAL_STAGE_EVENT_TYPE,
    message: `${getActorLabel(access.athenaUser)} staged ${summary.rowsStaged} inventory import row${summary.rowsStaged === 1 ? "" : "s"} for POS availability.`,
    metadata: {
      alreadyStaged: summary.alreadyStaged,
      catalogIdentitiesCreated: summary.catalogIdentitiesCreated,
      importKey: args.importKey,
      provisionalRowsCreated: summary.provisionalRowsCreated,
      provisionalRowsUpdated: summary.provisionalRowsUpdated,
      reviewVersionId: args.reviewVersionId,
      reviewVersionNumber: reviewVersion.versionNumber,
      rowsSkipped: summary.rowsSkipped,
      rowsStaged: summary.rowsStaged,
      sourceFormat: args.sourceFormat,
      stagedIds,
      trustedStockRowsUpdated: summary.trustedStockRowsUpdated,
    },
    organizationId: access.store.organizationId,
    reason: normalizeOptional(args.notes),
    storeId: args.storeId,
    subjectId: String(args.reviewVersionId),
    subjectLabel: `Inventory import review v${reviewVersion.versionNumber}`,
    subjectType: "inventory_import_review_version",
  });

  return summary;
}

export async function stageInventoryImportReviewRowsForPosCommandWithCtx(
  ctx: MutationCtx,
  args: Parameters<typeof stageInventoryImportReviewRowsForPosWithCtx>[1],
): Promise<CommandResult<ProvisionalInventoryImportStageSummary>> {
  try {
    return ok(await stageInventoryImportReviewRowsForPosWithCtx(ctx, args));
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Inventory import rows could not be staged.";

    if (
      message === "Authentication required." ||
      message === "Sign in again to continue."
    ) {
      return userError({ code: "authentication_failed", message });
    }

    if (
      message === "Manager elevation is required before importing inventory." ||
      message ===
        "Terminal context is required before using manager elevation." ||
      message === "You do not have permission to import inventory." ||
      message === "Athena user not found."
    ) {
      return userError({ code: "authorization_failed", message });
    }

    if (
      message === "Store not found." ||
      message === "Inventory import review version not found."
    ) {
      return userError({ code: "not_found", message });
    }

    if (
      message === "Import key does not match the saved review version." ||
      message ===
        "At least one import review row is required before staging POS availability."
    ) {
      return userError({ code: "validation_failed", message });
    }

    throw error;
  }
}

export const stageInventoryImportReviewRowsForPos = mutation({
  args: {
    importKey: v.string(),
    managerElevationId: v.optional(v.id("managerElevation")),
    notes: v.optional(v.string()),
    reviewVersionId: v.id("inventoryImportReviewVersion"),
    rows: v.array(provisionalImportStageRowValidator),
    sourceFormat: importSourceFormatValidator,
    storeId: v.id("store"),
    terminalId: v.optional(v.id("posTerminal")),
  },
  returns: commandResultValidator(v.any()),
  handler: stageInventoryImportReviewRowsForPosCommandWithCtx,
});

export const getLatestInventoryImportReviewVersion = query({
  args: {
    storeId: v.id("store"),
    managerElevationId: v.optional(v.id("managerElevation")),
    terminalId: v.optional(v.id("posTerminal")),
  },
  returns: v.union(inventoryImportReviewVersionValidator, v.null()),
  async handler(ctx, args) {
    await requireInventoryImportAccess(ctx, args);
    const version = await ctx.db
      .query("inventoryImportReviewVersion")
      .withIndex("by_storeId_createdAt", (q) => q.eq("storeId", args.storeId))
      .order("desc")
      .first();

    if (!version) return null;

    return {
      _id: version._id,
      createdAt: version.createdAt,
      fileName: version.fileName,
      importKey: version.importKey,
      issueCount: version.issueCount,
      notes: version.notes,
      rawContent: version.rawContent,
      rowDecisions: version.rowDecisions,
      rowCount: version.rowCount,
      sourceFormat: version.sourceFormat,
      versionNumber: version.versionNumber,
    };
  },
});

export async function listInventoryImportReviewSkuContextWithCtx(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
    managerElevationId?: Id<"managerElevation">;
    terminalId?: Id<"posTerminal">;
  },
  resolvedAccess?: ImportAccess,
) {
  requireTerminalContextForManagerElevation(args);
  if (!resolvedAccess) {
    await requireInventoryImportAccess(ctx, args);
  }

  const productSkus = [];
  for await (const productSku of ctx.db
    .query("productSku")
    .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))) {
    productSkus.push(productSku);
  }

  const productIds = Array.from(
    new Set(productSkus.map((productSku) => productSku.productId)),
  );
  const products = await Promise.all(
    productIds.map((productId) => ctx.db.get("product", productId)),
  );
  const productById = new Map<Id<"product">, Doc<"product">>();
  products.forEach((product) => {
    if (product) {
      productById.set(product._id, product);
    }
  });

  return productSkus
    .map((productSku) => {
      const product = productById.get(productSku.productId);
      return {
        barcode: normalizeOptional(productSku.barcode),
        inventoryCount: productSku.inventoryCount,
        price: productSku.netPrice ?? productSku.price,
        productAvailability: product?.availability,
        productId: productSku.productId,
        productName:
          product?.name ??
          productSku.productName ??
          productSku.sku ??
          "Unnamed SKU",
        productSkuId: productSku._id,
        quantityAvailable: productSku.quantityAvailable,
        sku: normalizeOptional(productSku.sku),
      };
    })
    .sort((left, right) => left.productName.localeCompare(right.productName));
}

export const listInventoryImportReviewSkuContext = query({
  args: {
    storeId: v.id("store"),
    managerElevationId: v.optional(v.id("managerElevation")),
    terminalId: v.optional(v.id("posTerminal")),
  },
  returns: v.array(
    v.object({
      barcode: v.optional(v.string()),
      inventoryCount: v.number(),
      price: v.number(),
      productAvailability: v.optional(v.string()),
      productId: v.id("product"),
      productName: v.string(),
      productSkuId: v.id("productSku"),
      quantityAvailable: v.number(),
      sku: v.optional(v.string()),
    }),
  ),
  async handler(ctx, args) {
    return listInventoryImportReviewSkuContextWithCtx(ctx, args);
  },
});

export const listProductPageProvisionalSkuBinding = query({
  args: {
    managerElevationId: v.optional(v.id("managerElevation")),
    productSkuId: v.id("productSku"),
    refreshNonce: v.optional(v.number()),
    storeId: v.id("store"),
    terminalId: v.optional(v.id("posTerminal")),
  },
  returns: v.any(),
  async handler(ctx, args) {
    try {
      const access = await requireInventoryImportAccess(ctx, args);
      return listProductPageProvisionalSkuBindingWithCtx(ctx, args, access);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Inventory import permission is required to finalize trusted inventory.";

      if (isInventoryImportAccessError(message)) {
        return {
          activeRowCount: 0,
          message:
            "Inventory import permission is required to finalize trusted inventory.",
          state: "unauthorized" as const,
        };
      }

      throw error;
    }
  },
});

export const finalizeTrustedInventoryFromProductPage = mutation({
  args: {
    conversionRequestId: v.string(),
    managerElevationId: v.optional(v.id("managerElevation")),
    productId: v.id("product"),
    productSkuId: v.id("productSku"),
    provisionalSkuId: v.id("inventoryImportProvisionalSku"),
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
    terminalId: v.optional(v.id("posTerminal")),
    trustedSkuFingerprint: v.string(),
  },
  returns: commandResultValidator(v.any()),
  async handler(ctx, args) {
    try {
      const access = await requireInventoryImportAccess(ctx, args);
      return finalizeTrustedInventoryFromProductPageWithCtx(ctx, args, access);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Trusted inventory was not finalized.";

      if (isInventoryImportAccessError(message)) {
        return userError({ code: "authorization_failed", message });
      }

      throw error;
    }
  },
});

export const repairOnboardedLegacyImportTrustedSkuVisibility = internalMutation(
  {
    args: {
      cursor: v.optional(legacyImportTrustedVisibilityRepairCursorValidator),
      dryRun: v.optional(v.boolean()),
      limit: v.optional(v.number()),
      storeId: v.id("store"),
    },
    returns: legacyImportTrustedVisibilityRepairResultValidator,
    async handler(ctx, args) {
      return repairOnboardedLegacyImportTrustedSkuVisibilityWithCtx(ctx, {
        cursor: args.cursor,
        dryRun: args.dryRun ?? true,
        limit: args.limit,
        storeId: args.storeId,
      });
    },
  },
);

export async function repairOnboardedLegacyImportTrustedSkuVisibilityWithCtx(
  ctx: MutationCtx,
  args: {
    cursor?: LegacyImportTrustedVisibilityRepairCursor;
    dryRun?: boolean;
    limit?: number;
    storeId: Id<"store">;
  },
): Promise<LegacyImportTrustedVisibilityRepairResult> {
  const dryRun = args.dryRun ?? true;
  const limit = normalizeLegacyImportTrustedVisibilityRepairLimit(args.limit);
  const candidateRows = await listLegacyImportTrustedVisibilityRepairRows(ctx, {
    cursor: args.cursor,
    limit: limit + 1,
    storeId: args.storeId,
  });
  const rows = candidateRows.slice(0, limit);
  const lastScannedRow = rows.at(-1);
  const nextCursor =
    candidateRows.length > limit && lastScannedRow?.finalizedAt !== undefined
      ? {
          finalizedAt: lastScannedRow.finalizedAt,
          scannedRowIds: [
            ...(args.cursor?.status === lastScannedRow.status &&
            args.cursor.finalizedAt === lastScannedRow.finalizedAt
              ? args.cursor.scannedRowIds
              : []),
            ...rows
              .filter(
                (row) =>
                  row.status === lastScannedRow.status &&
                  row.finalizedAt === lastScannedRow.finalizedAt,
              )
              .map((row) => row._id),
          ],
          status: lastScannedRow.status as "active" | "finalized",
        }
      : undefined;
  const repairedSkus: LegacyImportTrustedVisibilityRepairSku[] = [];
  const taxonomyWorkItemSkus: LegacyImportTrustedVisibilityRepairSku[] = [];
  const repairedProductIds = new Set<Id<"product">>();
  const repairedProductSkuIds: Array<Id<"productSku">> = [];
  let promotedToLive = 0;
  let refreshedSearchProjections = 0;
  let skippedArchivedProducts = 0;
  let skippedLegacyTaxonomy = 0;
  let taxonomyWorkItemsEnsured = 0;
  let visibleProducts = 0;

  for (const row of rows) {
    if (!row.productId || !row.productSkuId || row.finalizedAt === undefined) {
      continue;
    }

    const [product, productSku, taxonomyState] = await Promise.all([
      ctx.db.get("product", row.productId),
      ctx.db.get("productSku", row.productSkuId),
      readProductTaxonomyStateWithCtx(ctx, {
        productId: row.productId,
        storeId: args.storeId,
      }),
    ]);

    if (
      !product ||
      product.storeId !== args.storeId ||
      !productSku ||
      productSku.storeId !== args.storeId ||
      productSku.productId !== product._id
    ) {
      continue;
    }

    if (product.availability === "archived") {
      skippedArchivedProducts += 1;
      continue;
    }

    if (!taxonomyState?.hasAthenaTaxonomy) {
      skippedLegacyTaxonomy += 1;
      taxonomyWorkItemSkus.push({
        productId: product._id,
        productName: product.name,
        productSkuId: productSku._id,
        ...(productSku.sku ? { sku: productSku.sku } : {}),
      });
      if (!dryRun) {
        await ensureCatalogTaxonomySetupWorkForProductWithCtx(ctx, {
          productId: product._id,
          productSkuId: productSku._id,
          provisionalSkuId: row._id,
          storeId: args.storeId,
        });
        taxonomyWorkItemsEnsured += 1;
      }
      continue;
    }

    const shouldPromoteToLive = product.availability === "draft";
    const shouldMakeVisible = !isPosCatalogVisible(product);
    const productAlreadyRepaired = repairedProductIds.has(product._id);
    if (!shouldPromoteToLive && !shouldMakeVisible && !productAlreadyRepaired) {
      continue;
    }

    repairedSkus.push({
      productId: product._id,
      productName: product.name,
      productSkuId: productSku._id,
      ...(productSku.sku ? { sku: productSku.sku } : {}),
    });
    if (shouldPromoteToLive) promotedToLive += 1;
    if (shouldMakeVisible) visibleProducts += 1;

    if (dryRun) {
      continue;
    }

    if (!productAlreadyRepaired) {
      await ctx.db.patch("product", product._id, {
        ...(shouldPromoteToLive ? { availability: "live" as const } : {}),
        ...(shouldMakeVisible ? { posVisible: true } : {}),
      });
      repairedProductIds.add(product._id);
    }

    repairedProductSkuIds.push(productSku._id);
    refreshedSearchProjections += 1;
  }

  if (!dryRun && repairedProductSkuIds.length > 0) {
    await upsertProductSkuSearchProjections(
      ctx,
      repairedProductSkuIds,
      args.storeId,
    );
  }

  return {
    dryRun,
    limit,
    ...(nextCursor ? { nextCursor } : {}),
    promotedToLive,
    refreshedSearchProjections,
    repairedProducts: new Set(repairedSkus.map((sku) => sku.productId)).size,
    repairedSkus,
    scannedRows: rows.length,
    skippedArchivedProducts,
    skippedLegacyTaxonomy,
    taxonomyWorkItemsEnsured: dryRun
      ? taxonomyWorkItemSkus.length
      : taxonomyWorkItemsEnsured,
    taxonomyWorkItemSkus,
    truncated: Boolean(nextCursor),
    visibleProducts,
  };
}

function normalizeLegacyImportTrustedVisibilityRepairLimit(limit?: number) {
  if (!Number.isFinite(limit) || limit === undefined) {
    return LEGACY_IMPORT_TRUSTED_VISIBILITY_REPAIR_LIMIT;
  }

  return Math.max(
    1,
    Math.min(LEGACY_IMPORT_TRUSTED_VISIBILITY_REPAIR_LIMIT, Math.trunc(limit)),
  );
}

async function listLegacyImportTrustedVisibilityRepairRows(
  ctx: Pick<MutationCtx, "db">,
  args: {
    cursor?: LegacyImportTrustedVisibilityRepairCursor;
    limit: number;
    storeId: Id<"store">;
  },
) {
  const rows: Array<Doc<"inventoryImportProvisionalSku">> = [];
  const statuses = ["active", "finalized"] as const;
  const startStatusIndex = args.cursor
    ? Math.max(0, statuses.indexOf(args.cursor.status))
    : 0;

  for (const status of statuses.slice(startStatusIndex)) {
    if (rows.length >= args.limit) break;
    const finalizedAtFloor =
      args.cursor?.status === status ? args.cursor.finalizedAt - 1 : -1;
    const scannedRowIds =
      args.cursor?.status === status
        ? new Set(args.cursor.scannedRowIds)
        : null;

    const statusRows = await ctx.db
      .query("inventoryImportProvisionalSku")
      .withIndex("by_storeId_status_finalizedAt", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("status", status)
          .gt("finalizedAt", finalizedAtFloor),
      )
      .take(args.limit - rows.length + (scannedRowIds?.size ?? 0));

    rows.push(
      ...statusRows
        .filter((row) => {
          if (!args.cursor || args.cursor.status !== status) return true;
          if (row.finalizedAt === undefined) return false;
          if (row.finalizedAt < args.cursor.finalizedAt) return false;
          return !(
            row.finalizedAt === args.cursor.finalizedAt &&
            scannedRowIds?.has(row._id)
          );
        })
        .slice(0, args.limit - rows.length),
    );
  }

  return rows;
}

export async function listProductPageProvisionalSkuBindingWithCtx(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  args: {
    productSkuId: Id<"productSku">;
    storeId: Id<"store">;
  },
  _access: ImportAccess,
): Promise<ProductPageProvisionalSkuBinding> {
  const rows = await ctx.db
    .query("inventoryImportProvisionalSku")
    .withIndex("by_storeId_productSkuId_status", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("productSkuId", args.productSkuId)
        .eq("status", "active"),
    )
    .take(2);

  if (rows.length === 0) {
    return { activeRowCount: 0, state: "none" };
  }

  if (rows.length > 1) {
    return { activeRowCount: rows.length, state: "ambiguous" };
  }

  const row = rows[0];
  const productSku = row.productSkuId
    ? await ctx.db.get("productSku", row.productSkuId)
    : null;

  if (!productSku || productSku.storeId !== args.storeId) {
    return { activeRowCount: 0, state: "none" };
  }

  return {
    activeRowCount: 1,
    row: {
      _id: row._id,
      importKey: row.importKey,
      importedQuantity: row.importedQuantity,
      lastPosTransactionId: row.saleEvidence.lastPosTransactionId,
      lastRegisterSessionId: row.saleEvidence.lastRegisterSessionId,
      lastSoldAt: row.saleEvidence.lastSoldAt,
      posExposureStatus: row.posExposureStatus,
      provisionalSoldQuantity: row.saleEvidence.totalQuantitySold,
      reviewVersionId: row.reviewVersionId,
      reviewVersionNumber: row.reviewVersionNumber,
      finalizedAt: row.finalizedAt,
      rowKey: row.rowKey,
      rowNumber: row.rowNumber,
      saleCount: row.saleEvidence.saleCount,
      updatedAt: row.updatedAt,
    },
    saleEvidenceFingerprint: buildSaleEvidenceFingerprint(row),
    state: "unique",
    trustedSkuFingerprint: buildTrustedSkuFingerprint(productSku),
  };
}

export async function finalizeTrustedInventoryFromProductPageWithCtx(
  ctx: MutationCtx,
  args: ProductPageTrustedInventoryFinalizationArgs,
  access: ImportAccess,
): Promise<CommandResult<ProductPageTrustedInventoryFinalizationResult>> {
  const normalizedArgs = {
    ...args,
    conversionRequestId: args.conversionRequestId.trim(),
  };
  const payloadHash = buildProductPageFinalizationPayloadHash(normalizedArgs);

  if (!normalizedArgs.conversionRequestId) {
    return userError({
      code: "validation_failed",
      message: "Finalization request id is required.",
    });
  }

  const existingFinalization = await findProvisionalRowByConversionRequestId(
    ctx,
    {
      conversionRequestId: normalizedArgs.conversionRequestId,
      storeId: normalizedArgs.storeId,
    },
  );

  if (existingFinalization) {
    if (existingFinalization.finalizationRequestPayloadHash !== payloadHash) {
      return userError({
        code: "conflict",
        message:
          "This trusted inventory finalization request was already used with different reviewed values.",
      });
    }

    const storedResult = existingFinalization.finalizationResult as
      ProductPageTrustedInventoryFinalizationResult | undefined;
    if (storedResult) return ok(storedResult);
  }

  const validation = await validateProductPageTrustedInventoryFinalization(
    ctx,
    normalizedArgs,
    access,
  );

  if (validation.kind === "user_error") return validation;

  const {
    activeRow,
    finalizationResultBase,
    metadata,
    now,
    previousInventoryCount,
  } = validation.data;
  const stockDelta =
    normalizedArgs.reviewedInventoryCount - previousInventoryCount;
  const currentSku = await ctx.db.get(
    "productSku",
    normalizedArgs.productSkuId,
  );
  if (!currentSku) {
    return userError({
      code: "not_found",
      message: "Trusted SKU could not be loaded.",
    });
  }
  const availabilityDelta =
    normalizedArgs.reviewedQuantityAvailable - currentSku.quantityAvailable;
  const valuation =
    stockDelta > 0
      ? {
          costBasis:
            normalizedArgs.reviewedUnitCost === undefined
              ? uncostedBasis()
              : knownUnitCostBasis({
                  currency: access.store.currency ?? "GHS",
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
    activityType: "provisional_import_finalization",
    businessEventKey: `inventory_import:${activeRow._id}:trusted:${normalizedArgs.conversionRequestId}`,
    compatibilityBalance: {
      onHandQuantity: normalizedArgs.reviewedInventoryCount,
      sellableQuantity: normalizedArgs.reviewedQuantityAvailable,
    },
    completeness: "partial",
    contentFingerprint: payloadHash,
    effectType: "baseline",
    movementType: "provisional_import_finalization",
    notes: "Trusted inventory finalized from product edit.",
    occurrenceAt: now,
    organizationId: access.store.organizationId,
    physicalQuantityDelta: stockDelta,
    productId: normalizedArgs.productId,
    productSkuId: normalizedArgs.productSkuId,
    reasonCode: "trusted_inventory_conversion",
    sellableQuantityDelta: availabilityDelta,
    sourceDomain: "inventory",
    sourceId: String(activeRow._id),
    sourceType: "inventory_import_provisional_sku",
    storeId: normalizedArgs.storeId,
    valuation,
  });
  await ctx.db.patch("productSku", normalizedArgs.productSkuId, {
    isVisible: normalizedArgs.reviewedIsVisible,
    ...(normalizedArgs.reviewedPosVisible !== undefined
      ? { posVisible: normalizedArgs.reviewedPosVisible }
      : {}),
    ...(normalizedArgs.reviewedNetPrice !== undefined
      ? { netPrice: normalizedArgs.reviewedNetPrice }
      : {}),
    price: normalizedArgs.reviewedPrice,
  });
  await ctx.db.patch("product", normalizedArgs.productId, {
    availability: "live",
    posVisible: true,
  });
  await ensureCatalogTaxonomySetupWorkForProductWithCtx(ctx, {
    actorUserId: access.athenaUser._id,
    productId: normalizedArgs.productId,
    productSkuId: normalizedArgs.productSkuId,
    provisionalSkuId: activeRow._id,
    storeId: normalizedArgs.storeId,
  });
  await upsertProductSkuSearchProjection(ctx, normalizedArgs.productSkuId, {
    advanceRevision: false,
  });

  const inventoryMovementId = inventoryEffect.movement?._id;

  const finalizationResult = {
    ...finalizationResultBase,
    ...(inventoryMovementId ? { inventoryMovementId } : null),
  };

  await ctx.db.patch("inventoryImportProvisionalSku", activeRow._id, {
    finalQuantityAvailable: normalizedArgs.reviewedQuantityAvailable,
    finalTrustedQuantity: normalizedArgs.reviewedInventoryCount,
    finalizationConversionRequestId: normalizedArgs.conversionRequestId,
    finalizationRequestPayloadHash: payloadHash,
    finalizationResult,
    finalizationSaleEvidenceFingerprint: normalizedArgs.saleEvidenceFingerprint,
    finalizationSourceSurface: normalizedArgs.sourceSurface,
    finalizationTrustedSkuFingerprint: normalizedArgs.trustedSkuFingerprint,
    finalizedAt: now,
    finalizedByUserId: access.athenaUser._id,
    hiddenAt: now,
    posExposureStatus: "hidden",
    provisionalSoldQuantityAtFinalization:
      activeRow.saleEvidence.totalQuantitySold,
    updatedAt: now,
  });
  await advanceRegisterCatalogRevision(ctx, {
    didChange: true,
    storeId: normalizedArgs.storeId,
  });
  await refreshCatalogSummaryWithCtx(ctx, normalizedArgs.storeId);

  await recomputeProductInventory(ctx, normalizedArgs.productId);

  await recordSkuActivityEventWithCtx(ctx, {
    actorUserId: access.athenaUser._id,
    activityType: "provisional_import_trusted_finalization",
    idempotencyKey: `inventoryImportProvisionalSku:${activeRow._id}:${normalizedArgs.conversionRequestId}`,
    metadata,
    occurredAt: now,
    organizationId: access.store.organizationId,
    productId: normalizedArgs.productId,
    productSkuId: normalizedArgs.productSkuId,
    sourceId: String(activeRow._id),
    sourceLabel: "Product edit trusted inventory finalization",
    sourceType: "inventory_import_provisional_sku",
    status: "committed",
    stockQuantityDelta: stockDelta,
    storeId: normalizedArgs.storeId,
  });

  await recordOperationalEventWithCtx(ctx, {
    actorUserId: access.athenaUser._id,
    eventType: PROVISIONAL_TRUST_FINALIZATION_EVENT_TYPE,
    message: `${getActorLabel(access.athenaUser)} finalized trusted inventory for one legacy import SKU.`,
    metadata,
    organizationId: access.store.organizationId,
    storeId: normalizedArgs.storeId,
    subjectId: String(activeRow._id),
    subjectLabel: "Legacy import SKU",
    subjectType: "inventory_import_provisional_sku",
  });

  return ok(finalizationResult);
}

async function readProductTaxonomyStateWithCtx(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  args: {
    productId: Id<"product">;
    storeId: Id<"store">;
  },
) {
  const product = await ctx.db.get("product", args.productId);
  if (!product || product.storeId !== args.storeId) return null;

  const [category, subcategory] = await Promise.all([
    ctx.db.get("category", product.categoryId),
    ctx.db.get("subcategory", product.subcategoryId),
  ]);

  const hasAthenaTaxonomy = Boolean(
    category &&
    subcategory &&
    category.storeId === args.storeId &&
    subcategory.storeId === args.storeId &&
    subcategory.categoryId === category._id &&
    category.slug !== DEFAULT_CATEGORY_SLUG,
  );

  return {
    category,
    hasAthenaTaxonomy,
    product,
    subcategory,
  };
}

async function findCurrentCatalogTaxonomySetupWorkItemsWithCtx(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  args: {
    productId: Id<"product">;
    storeId: Id<"store">;
  },
) {
  const lanes = await Promise.all(
    CATALOG_TAXONOMY_SETUP_WORK_ITEM_STATUSES.map((status) =>
      ctx.db
        .query("operationalWorkItem")
        .withIndex("by_storeId_type_status_productId", (q) =>
          q
            .eq("storeId", args.storeId)
            .eq("type", CATALOG_TAXONOMY_SETUP_WORK_ITEM_TYPE)
            .eq("status", status)
            .eq("productId", args.productId),
        )
        .take(CATALOG_TAXONOMY_SETUP_WORK_ITEM_STATUSES.length + 1),
    ),
  );

  return lanes.flat();
}

export async function ensureCatalogTaxonomySetupWorkForProductWithCtx(
  ctx: MutationCtx,
  args: {
    actorUserId?: Id<"athenaUser">;
    productId: Id<"product">;
    productSkuId?: Id<"productSku">;
    provisionalSkuId?: Id<"inventoryImportProvisionalSku">;
    storeId: Id<"store">;
  },
) {
  const taxonomyState = await readProductTaxonomyStateWithCtx(ctx, args);
  if (!taxonomyState || taxonomyState.hasAthenaTaxonomy) return null;

  const { category, product, subcategory } = taxonomyState;
  const productSku = args.productSkuId
    ? await ctx.db.get("productSku", args.productSkuId)
    : null;
  const now = Date.now();
  const title = `Assign catalog category: ${product.name}`;
  const metadata = {
    categorySlug: category?.slug,
    productId: product._id,
    productName: product.name,
    productSkuId: args.productSkuId,
    provisionalSkuId: args.provisionalSkuId,
    sku: productSku?.sku,
    sourceId: args.provisionalSkuId,
    sourceType: "inventoryImportProvisionalSku",
    subcategorySlug: subcategory?.slug,
  };

  const existingWorkItems =
    await findCurrentCatalogTaxonomySetupWorkItemsWithCtx(ctx, args);
  const existingWorkItem = existingWorkItems[0];
  if (existingWorkItem) {
    await ctx.db.patch("operationalWorkItem", existingWorkItem._id, {
      metadata: {
        ...(existingWorkItem.metadata ?? {}),
        ...metadata,
        refreshedAt: now,
      },
      priority: "medium",
      title,
    });

    return ctx.db.get("operationalWorkItem", existingWorkItem._id);
  }

  const workItem = await createOperationalWorkItemWithCtx(ctx, {
    createdByUserId: args.actorUserId,
    metadata,
    notes:
      "Assign an Athena category and subcategory before saving this product.",
    organizationId: product.organizationId,
    priority: "medium",
    productId: product._id,
    productSkuId: args.productSkuId,
    status: "open",
    storeId: args.storeId,
    title,
    type: CATALOG_TAXONOMY_SETUP_WORK_ITEM_TYPE,
  });

  if (workItem) {
    await recordOperationalEventWithCtx(ctx, {
      actorUserId: args.actorUserId,
      eventType: "catalog_taxonomy_setup_work_created",
      message: "Catalog setup work opened.",
      metadata: {
        productId: product._id,
        productSkuId: args.productSkuId,
        provisionalSkuId: args.provisionalSkuId,
      },
      organizationId: product.organizationId,
      storeId: args.storeId,
      subjectId: product._id,
      subjectLabel: product.name,
      subjectType: "product",
      workItemId: workItem._id,
    });
  }

  return workItem;
}

export async function completeCatalogTaxonomySetupWorkForProductWithCtx(
  ctx: MutationCtx,
  args: {
    productId: Id<"product">;
    storeId: Id<"store">;
  },
) {
  const taxonomyState = await readProductTaxonomyStateWithCtx(ctx, args);
  if (!taxonomyState || !taxonomyState.hasAthenaTaxonomy) return 0;

  const workItems = await findCurrentCatalogTaxonomySetupWorkItemsWithCtx(
    ctx,
    args,
  );
  const now = Date.now();

  for (const workItem of workItems) {
    await ctx.db.patch("operationalWorkItem", workItem._id, {
      completedAt: now,
      metadata: {
        ...(workItem.metadata ?? {}),
        completedReason: "athena_taxonomy_applied",
      },
      status: "completed",
    });

    await recordOperationalEventWithCtx(ctx, {
      actorType: "automation",
      eventType: "catalog_taxonomy_setup_work_completed",
      message: "Catalog setup work completed.",
      metadata: {
        productId: taxonomyState.product._id,
        workItemId: workItem._id,
      },
      organizationId: taxonomyState.product.organizationId,
      storeId: args.storeId,
      subjectId: taxonomyState.product._id,
      subjectLabel: taxonomyState.product.name,
      subjectType: "product",
      workItemId: workItem._id,
    });
  }

  return workItems.length;
}

export async function completeFinalizedLegacyImportRowsForProductTaxonomyWithCtx(
  ctx: MutationCtx,
  args: {
    productId: Id<"product">;
    storeId: Id<"store">;
  },
) {
  const taxonomyState = await readProductTaxonomyStateWithCtx(ctx, args);
  if (!taxonomyState || !taxonomyState.hasAthenaTaxonomy) return 0;

  const rows = await ctx.db
    .query("inventoryImportProvisionalSku")
    .withIndex("by_storeId_productId_status", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("productId", args.productId)
        .eq("status", "active"),
    )
    .take(CATALOG_TAXONOMY_FINALIZATION_ROW_LIMIT + 1);

  if (rows.length > CATALOG_TAXONOMY_FINALIZATION_ROW_LIMIT) {
    throw new Error(
      "Cannot complete catalog setup because this product has too many active legacy import rows to finalize safely.",
    );
  }

  const now = Date.now();
  let completedCount = 0;

  for (const row of rows) {
    if (row.finalizedAt === undefined) continue;

    await ctx.db.patch("inventoryImportProvisionalSku", row._id, {
      status: "finalized",
      updatedAt: now,
    });
    completedCount += 1;
  }

  await advanceRegisterCatalogRevision(ctx, {
    didChange: completedCount > 0,
    storeId: args.storeId,
  });

  return completedCount;
}

async function validateProductPageTrustedInventoryFinalization(
  ctx: MutationCtx,
  args: ProductPageTrustedInventoryFinalizationArgs,
  access: ImportAccess,
): Promise<
  CommandResult<{
    activeRow: Doc<"inventoryImportProvisionalSku">;
    finalizationResultBase: ProductPageTrustedInventoryFinalizationResult;
    metadata: Record<string, unknown>;
    now: number;
    previousInventoryCount: number;
    productSkuPatch: Partial<Doc<"productSku">>;
  }>
> {
  if (args.storeId !== access.store._id) {
    return userError({
      code: "authorization_failed",
      message: "Store access is required to finalize trusted inventory.",
    });
  }

  const fieldError = validateReviewedTrustedInventoryFields(args);
  if (fieldError) return fieldError;

  const [product, productSku, submittedRow] = await Promise.all([
    ctx.db.get("product", args.productId),
    ctx.db.get("productSku", args.productSkuId),
    ctx.db.get("inventoryImportProvisionalSku", args.provisionalSkuId),
  ]);

  if (!product || product.storeId !== args.storeId) {
    return userError({
      code: "not_found",
      message: "Product could not be found for this store.",
    });
  }

  if (
    !productSku ||
    productSku.storeId !== args.storeId ||
    productSku.productId !== product._id
  ) {
    return userError({
      code: "not_found",
      message: "SKU could not be found for this product and store.",
    });
  }

  if (
    !submittedRow ||
    submittedRow.storeId !== args.storeId ||
    submittedRow.productId !== args.productId ||
    submittedRow.productSkuId !== args.productSkuId ||
    submittedRow.status !== "active"
  ) {
    return userError({
      code: "precondition_failed",
      message: "No active provisional import row is linked to this SKU.",
    });
  }

  const binding = await listProductPageProvisionalSkuBindingWithCtx(
    ctx,
    {
      productSkuId: args.productSkuId,
      storeId: args.storeId,
    },
    access,
  );

  if (binding.state === "none") {
    return userError({
      code: "precondition_failed",
      message: "No active provisional import row is linked to this SKU.",
    });
  }

  if (binding.state === "ambiguous") {
    return userError({
      code: "precondition_failed",
      message:
        "Multiple active provisional import rows are linked to this SKU. Resolve the import rows before finalizing.",
    });
  }

  if (binding.state === "unauthorized") {
    return userError({
      code: "authorization_failed",
      message: binding.message,
    });
  }

  if (binding.row._id !== args.provisionalSkuId) {
    return userError({
      code: "precondition_failed",
      message: "The provisional import row no longer matches this SKU.",
    });
  }

  if (binding.saleEvidenceFingerprint !== args.saleEvidenceFingerprint) {
    return userError({
      code: "conflict",
      message:
        "Provisional sales changed. Refresh and review the counts again.",
    });
  }

  const trustedFingerprintMatches =
    binding.trustedSkuFingerprint === args.trustedSkuFingerprint;
  const submittedValuesAlreadyPersisted = trustedSkuMatchesReviewedPayload(
    productSku,
    args,
  );

  if (!trustedFingerprintMatches && !submittedValuesAlreadyPersisted) {
    return userError({
      code: "conflict",
      message: "Trusted SKU fields changed. Refresh and review the SKU again.",
    });
  }

  const reservationBlock = await readFinalizationReservationBlock(ctx, args);
  if (reservationBlock) return reservationBlock;

  const now = Date.now();
  const metadata = buildProductPageFinalizationMetadata({
    access,
    args,
    product,
    productSku,
    provisionalSku: submittedRow,
  });
  const finalizationResultBase = {
    finalTrustedQuantity: args.reviewedInventoryCount,
    product: {
      availability: "live" as const,
      posVisible: true,
    },
    productId: args.productId,
    productSkuId: args.productSkuId,
    provisionalSkuId: args.provisionalSkuId,
    provisionalSoldQuantity: submittedRow.saleEvidence.totalQuantitySold,
    quantityAvailable: args.reviewedQuantityAvailable,
  };

  return ok({
    activeRow: submittedRow,
    finalizationResultBase,
    metadata,
    now,
    previousInventoryCount: productSku.inventoryCount,
    productSkuPatch: omitUndefined({
      inventoryCount: args.reviewedInventoryCount,
      isVisible: args.reviewedIsVisible,
      posVisible: reviewedPosVisibleFor(args),
      netPrice: args.reviewedNetPrice,
      price: args.reviewedPrice,
      quantityAvailable: args.reviewedQuantityAvailable,
      unitCost: args.reviewedUnitCost,
    }),
  });
}

function validateReviewedTrustedInventoryFields(
  args: ProductPageTrustedInventoryFinalizationArgs,
): CommandResult<never> | null {
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

async function findProvisionalRowByConversionRequestId(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  args: {
    conversionRequestId: string;
    storeId: Id<"store">;
  },
) {
  return ctx.db
    .query("inventoryImportProvisionalSku")
    .withIndex("by_storeId_finalizationConversionRequestId", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("finalizationConversionRequestId", args.conversionRequestId),
    )
    .first();
}

async function readFinalizationReservationBlock(
  ctx: MutationCtx,
  args: Pick<
    ProductPageTrustedInventoryFinalizationArgs,
    "productSkuId" | "storeId"
  >,
): Promise<CommandResult<never> | null> {
  const now = Date.now();
  const activePosHold = await ctx.db
    .query("inventoryHold")
    .withIndex("by_storeId_productSkuId_status_expiresAt", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("productSkuId", args.productSkuId)
        .eq("status", "active")
        .gt("expiresAt", now),
    )
    .first();

  if (activePosHold) {
    return userError({
      code: "precondition_failed",
      message: "Clear active POS holds before finalizing this SKU.",
    });
  }

  const activeSessionCandidates = await ctx.db
    .query("checkoutSession")
    .withIndex("by_storeId_hasCompletedCheckoutSession_expiresAt", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("hasCompletedCheckoutSession", false)
        .gt("expiresAt", now),
    )
    .take(TRUSTED_FINALIZATION_ACTIVE_CHECKOUT_SESSION_LIMIT + 1);

  if (
    activeSessionCandidates.length >
    TRUSTED_FINALIZATION_ACTIVE_CHECKOUT_SESSION_LIMIT
  ) {
    return userError({
      code: "precondition_failed",
      message: "Clear active checkout reservations before finalizing this SKU.",
    });
  }

  for (const session of activeSessionCandidates) {
    const items = await ctx.db
      .query("checkoutSessionItem")
      .withIndex("by_sessionId", (q) => q.eq("sesionId", session._id))
      .take(TRUSTED_FINALIZATION_CHECKOUT_SESSION_ITEM_LIMIT + 1);

    if (items.length > TRUSTED_FINALIZATION_CHECKOUT_SESSION_ITEM_LIMIT) {
      return userError({
        code: "precondition_failed",
        message:
          "Clear active checkout reservations before finalizing this SKU.",
      });
    }

    if (items.some((item) => item.productSkuId === args.productSkuId)) {
      return userError({
        code: "precondition_failed",
        message:
          "Clear active checkout reservations before finalizing this SKU.",
      });
    }
  }

  return null;
}

function trustedSkuMatchesReviewedPayload(
  productSku: Doc<"productSku">,
  args: ProductPageTrustedInventoryFinalizationArgs,
) {
  return (
    productSku.inventoryCount === args.reviewedInventoryCount &&
    productSku.quantityAvailable === args.reviewedQuantityAvailable &&
    productSku.price === args.reviewedPrice &&
    productSku.netPrice === args.reviewedNetPrice &&
    productSku.unitCost === args.reviewedUnitCost &&
    productSku.isVisible === args.reviewedIsVisible &&
    productSku.posVisible === reviewedPosVisibleFor(args)
  );
}

function reviewedPosVisibleFor(
  args: Pick<
    ProductPageTrustedInventoryFinalizationArgs,
    "reviewedIsVisible" | "reviewedPosVisible"
  >,
) {
  return args.reviewedPosVisible ?? args.reviewedIsVisible;
}

function buildSaleEvidenceFingerprint(
  row: Doc<"inventoryImportProvisionalSku">,
) {
  return stableStringify({
    lastPosTransactionId: row.saleEvidence.lastPosTransactionId,
    lastRegisterSessionId: row.saleEvidence.lastRegisterSessionId,
    lastSoldAt: row.saleEvidence.lastSoldAt,
    saleCount: row.saleEvidence.saleCount,
    totalQuantitySold: row.saleEvidence.totalQuantitySold,
    updatedAt: row.updatedAt,
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
    updatedAt: (productSku as { updatedAt?: number }).updatedAt,
  });
}

function buildProductPageFinalizationPayloadHash(
  args: ProductPageTrustedInventoryFinalizationArgs,
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

function buildProductPageFinalizationMetadata(args: {
  access: ImportAccess;
  args: ProductPageTrustedInventoryFinalizationArgs;
  product: Doc<"product">;
  productSku: Doc<"productSku">;
  provisionalSku: Doc<"inventoryImportProvisionalSku">;
}) {
  return {
    actorUserId: String(args.access.athenaUser._id),
    conversionRequestId: args.args.conversionRequestId,
    finalTrustedQuantity: args.args.reviewedInventoryCount,
    importKey: args.provisionalSku.importKey,
    lastPosTransactionId: args.provisionalSku.saleEvidence.lastPosTransactionId,
    lastRegisterSessionId:
      args.provisionalSku.saleEvidence.lastRegisterSessionId,
    lastSoldAt: args.provisionalSku.saleEvidence.lastSoldAt,
    productId: args.product._id,
    productSkuId: args.productSku._id,
    provisionalSkuId: args.provisionalSku._id,
    provisionalSoldQuantity: args.provisionalSku.saleEvidence.totalQuantitySold,
    quantityAvailable: args.args.reviewedQuantityAvailable,
    reviewVersionId: args.provisionalSku.reviewVersionId,
    reviewVersionNumber: args.provisionalSku.reviewVersionNumber,
    saleCount: args.provisionalSku.saleEvidence.saleCount,
    saleEvidenceFingerprint: args.args.saleEvidenceFingerprint,
    sourceSurface: args.args.sourceSurface,
    trustedSkuFingerprint: args.args.trustedSkuFingerprint,
  };
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

async function requireInventoryImportAccess(
  ctx: InventoryImportAccessCtx,
  args: {
    storeId: Id<"store">;
    managerElevationId?: Id<"managerElevation">;
    terminalId?: Id<"posTerminal">;
  },
): Promise<ImportAccess> {
  requireTerminalContextForManagerElevation(args);

  const store = await ctx.db.get("store", args.storeId);

  if (!store) {
    throw new Error("Store not found.");
  }

  const athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);

  try {
    await requireOrganizationMemberRoleWithCtx(ctx, {
      allowedRoles: ["full_admin"],
      failureMessage: "You do not have permission to import inventory.",
      organizationId: store.organizationId,
      userId: athenaUser._id,
    });

    return { athenaUser, store };
  } catch (error) {
    if (
      !(error instanceof Error) ||
      error.message !== "You do not have permission to import inventory."
    ) {
      throw error;
    }
  }

  if (args.managerElevationId) {
    const activeElevation = await getActiveManagerElevationByIdWithCtx(ctx, {
      accountId: athenaUser._id,
      elevationId: args.managerElevationId,
      storeId: args.storeId,
      terminalId: args.terminalId,
    });

    if (activeElevation) {
      return { athenaUser, store };
    }
  }

  if (!args.terminalId) {
    throw new Error(
      "Manager elevation is required before importing inventory.",
    );
  }

  const activeElevation = await getActiveManagerElevationWithCtx(ctx, {
    accountId: athenaUser._id,
    storeId: args.storeId,
    terminalId: args.terminalId,
  });

  if (!activeElevation) {
    throw new Error(
      "Manager elevation is required before importing inventory.",
    );
  }

  return { athenaUser, store };
}

function isInventoryImportAccessError(message: string) {
  return (
    message === "Authentication required." ||
    message === "Sign in again to continue." ||
    message === "Manager elevation is required before importing inventory." ||
    message ===
      "Terminal context is required before using manager elevation." ||
    message === "You do not have permission to import inventory." ||
    message === "Athena user not found." ||
    message === "Store not found."
  );
}

function requireTerminalContextForManagerElevation(args: {
  managerElevationId?: Id<"managerElevation">;
  terminalId?: Id<"posTerminal">;
}) {
  if (args.managerElevationId && !args.terminalId) {
    throw new Error(
      "Terminal context is required before using manager elevation.",
    );
  }
}

function validateImportRows(rows: CatalogImportRow[]) {
  const errors: string[] = [];

  if (rows.length === 0) {
    errors.push("Row 0: import file must include at least one inventory row.");
  }

  rows.forEach((row) => {
    if (!Number.isInteger(row.quantity) || row.quantity < 0) {
      errors.push(
        `Row ${row.rowNumber}: quantity must be a non-negative whole number.`,
      );
    }
    if (!Number.isInteger(row.price) || row.price < 0) {
      errors.push(
        `Row ${row.rowNumber}: price must be a non-negative stored amount.`,
      );
    }
    if (
      row.unitCost !== undefined &&
      (!Number.isInteger(row.unitCost) || row.unitCost < 0)
    ) {
      errors.push(
        `Row ${row.rowNumber}: unit cost must be a non-negative stored amount.`,
      );
    }
  });

  return errors;
}

function normalizeImportRow(row: CatalogImportRow): CatalogImportRow {
  const productName =
    normalizeLabel(row.productName) ||
    normalizeLabel(row.sku) ||
    normalizeLabel(row.barcode) ||
    `Imported row ${row.rowNumber}`;
  const sku =
    normalizeOptional(row.sku) ||
    (normalizeOptional(row.barcode)
      ? undefined
      : `legacy-row-${row.rowNumber}`);
  const price = isNonNegativeInteger(row.price) ? row.price : 0;
  const quantity = isNonNegativeInteger(row.quantity) ? row.quantity : 0;
  const unitCost =
    row.unitCost === undefined || !isNonNegativeInteger(row.unitCost)
      ? undefined
      : row.unitCost;

  return {
    ...row,
    productName,
    sku,
    price,
    quantity,
    unitCost,
  };
}

async function findOrCreateCategory(
  ctx: MutationCtx,
  args: {
    name?: string;
    storeId: Id<"store">;
    summary: MutableSummary;
  },
) {
  const name = normalizeLabel(args.name) || DEFAULT_CATEGORY_NAME;
  const slug = toSlug(name) || toSlug(DEFAULT_CATEGORY_NAME);
  const existing = await ctx.db
    .query("category")
    .withIndex("by_storeId_slug", (q) =>
      q.eq("storeId", args.storeId).eq("slug", slug),
    )
    .first();

  if (existing) return existing;

  const id = await ctx.db.insert("category", {
    name,
    slug,
    storeId: args.storeId,
  });
  args.summary.categoriesCreated += 1;
  return (await ctx.db.get("category", id))!;
}

async function findOrCreateSubcategory(
  ctx: MutationCtx,
  args: {
    categoryId: Id<"category">;
    name?: string;
    storeId: Id<"store">;
    summary: MutableSummary;
  },
) {
  const name = normalizeLabel(args.name) || DEFAULT_SUBCATEGORY_NAME;
  const slug = toSlug(name) || toSlug(DEFAULT_SUBCATEGORY_NAME);
  const existing = await ctx.db
    .query("subcategory")
    .withIndex("by_categoryId_slug", (q) =>
      q.eq("categoryId", args.categoryId).eq("slug", slug),
    )
    .first();

  if (existing && existing.storeId === args.storeId) return existing;

  const id = await ctx.db.insert("subcategory", {
    categoryId: args.categoryId,
    name,
    slug,
    storeId: args.storeId,
  });
  args.summary.subcategoriesCreated += 1;
  return (await ctx.db.get("subcategory", id))!;
}

async function findExistingSku(
  ctx: MutationCtx,
  storeId: Id<"store">,
  row: CatalogImportRow,
) {
  const barcode = row.barcode?.trim();
  if (barcode) {
    const byBarcode = await ctx.db
      .query("productSku")
      .withIndex("by_storeId_barcode", (q) =>
        q.eq("storeId", storeId).eq("barcode", barcode),
      )
      .first();
    if (byBarcode) return byBarcode;
  }

  const sku = row.sku?.trim();
  if (sku) {
    return ctx.db
      .query("productSku")
      .withIndex("by_storeId_sku", (q) =>
        q.eq("storeId", storeId).eq("sku", sku),
      )
      .first();
  }

  return null;
}

async function listActiveProvisionalImportRowsForFinalization(
  ctx: MutationCtx,
  args: {
    importKey: string;
    storeId: Id<"store">;
  },
) {
  const stagedRows = await ctx.db
    .query("inventoryImportProvisionalSku")
    .withIndex("by_storeId_importKey_status", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("importKey", args.importKey)
        .eq("status", "active"),
    )
    .take(PROVISIONAL_IMPORT_FINALIZATION_LIMIT + 1);

  if (stagedRows.length > PROVISIONAL_IMPORT_FINALIZATION_LIMIT) {
    throw new Error(
      `Inventory import has more than ${PROVISIONAL_IMPORT_FINALIZATION_LIMIT} active provisional POS rows. Finalize provisional POS availability in smaller batches before applying trusted counts.`,
    );
  }

  return stagedRows;
}

function buildFinalTrustedQuantitiesByRowNumber(
  rows: CatalogImportRow[],
  stagedRows: Awaited<
    ReturnType<typeof listActiveProvisionalImportRowsForFinalization>
  >,
) {
  const soldByRowNumber = new Map<number, number>();
  for (const row of stagedRows) {
    soldByRowNumber.set(
      row.rowNumber,
      (soldByRowNumber.get(row.rowNumber) ?? 0) +
        row.saleEvidence.totalQuantitySold,
    );
  }

  return new Map(
    rows.map((row) => [
      row.rowNumber,
      Math.max(0, row.quantity - (soldByRowNumber.get(row.rowNumber) ?? 0)),
    ]),
  );
}

async function finalizeProvisionalImportRowsForAppliedImport(
  ctx: MutationCtx,
  args: {
    actorUserId: Id<"athenaUser">;
    finalTrustedQuantitiesByRowNumber: Map<number, number>;
    importKey: string;
    rows: CatalogImportRow[];
    stagedRows: Awaited<
      ReturnType<typeof listActiveProvisionalImportRowsForFinalization>
    >;
    storeId: Id<"store">;
  },
) {
  if (args.stagedRows.length === 0) return;

  const now = Date.now();

  for (const row of args.stagedRows) {
    const finalTrustedQuantity =
      args.finalTrustedQuantitiesByRowNumber.get(row.rowNumber) ??
      row.importedQuantity;
    await ctx.db.patch("inventoryImportProvisionalSku", row._id, {
      status: "finalized",
      posExposureStatus: "hidden",
      hiddenAt: now,
      finalizedAt: now,
      finalizedByUserId: args.actorUserId,
      finalTrustedQuantity,
      provisionalSoldQuantityAtFinalization: row.saleEvidence.totalQuantitySold,
      updatedAt: now,
    });
  }
}

async function resolveSubmittedProvisionalImportIdentity(
  ctx: MutationCtx,
  args: {
    row: ProvisionalInventoryImportStageRow;
    storeId: Id<"store">;
  },
): Promise<ProvisionalImportIdentity | null> {
  if (!args.row.productId && !args.row.productSkuId) return null;
  if (!args.row.productId || !args.row.productSkuId) {
    throw new Error(
      `Row ${args.row.rowNumber}: matched Athena product and SKU are required together.`,
    );
  }

  const [product, productSku] = await Promise.all([
    ctx.db.get("product", args.row.productId),
    ctx.db.get("productSku", args.row.productSkuId),
  ]);

  if (
    !product ||
    product.storeId !== args.storeId ||
    !productSku ||
    productSku.storeId !== args.storeId ||
    productSku.productId !== product._id
  ) {
    throw new Error(
      `Row ${args.row.rowNumber}: matched Athena product and SKU could not be verified for this store.`,
    );
  }

  return {
    productId: product._id,
    productSkuId: productSku._id,
    sku: productSku.sku,
    barcode: productSku.barcode,
  };
}

async function resolveExistingProvisionalImportIdentity(
  ctx: MutationCtx,
  args: {
    productId: Id<"product">;
    productSkuId: Id<"productSku">;
    row: ProvisionalInventoryImportStageRow;
    storeId: Id<"store">;
  },
): Promise<ProvisionalImportIdentity> {
  const [product, productSku] = await Promise.all([
    ctx.db.get("product", args.productId),
    ctx.db.get("productSku", args.productSkuId),
  ]);

  if (
    !product ||
    product.storeId !== args.storeId ||
    !productSku ||
    productSku.storeId !== args.storeId ||
    productSku.productId !== product._id
  ) {
    throw new Error(
      `Row ${args.row.rowNumber}: staged Athena product and SKU could not be verified for this store.`,
    );
  }

  return {
    productId: product._id,
    productSkuId: productSku._id,
    sku: productSku.sku,
    barcode: productSku.barcode,
  };
}

async function resolveProvisionalImportIdentity(
  ctx: MutationCtx,
  args: {
    access: ImportAccess;
    row: ProvisionalInventoryImportStageRow;
    storeId: Id<"store">;
    summary: ProvisionalInventoryImportStageSummary;
  },
): Promise<ProvisionalImportIdentity> {
  const created = await findOrCreateProvisionalCatalogIdentity(ctx, {
    access: args.access,
    row: args.row,
    storeId: args.storeId,
  });
  args.summary.catalogIdentitiesCreated += 1;

  return {
    productId: created.product._id,
    productSkuId: created.productSku._id,
    sku: created.productSku.sku,
    barcode: created.productSku.barcode,
  };
}

async function findOrCreateProvisionalCatalogIdentity(
  ctx: MutationCtx,
  args: {
    access: ImportAccess;
    row: ProvisionalInventoryImportStageRow;
    storeId: Id<"store">;
  },
): Promise<{ product: Doc<"product">; productSku: Doc<"productSku"> }> {
  const summary: MutableSummary = {
    categoriesCreated: 0,
    productsCreated: 0,
    productsUpdated: 0,
    rowsImported: 0,
    skusCreated: 0,
    skusUpdated: 0,
    subcategoriesCreated: 0,
  };
  const category = await findOrCreateCategory(ctx, {
    name: args.row.category,
    storeId: args.storeId,
    summary,
  });
  const subcategory = await findOrCreateSubcategory(ctx, {
    categoryId: category._id,
    name: args.row.subcategory,
    storeId: args.storeId,
    summary,
  });
  const productId = await ctx.db.insert("product", {
    availability: "draft",
    categoryId: category._id,
    createdByUserId: args.access.athenaUser._id,
    currency: "GHS",
    inventoryCount: 0,
    isVisible: false,
    name: args.row.productName.trim(),
    organizationId: args.access.store.organizationId,
    quantityAvailable: 0,
    slug:
      toSlug(`${args.row.productName}-${args.row.rowKey}`) ||
      `legacy-provisional-import-${Date.now()}`,
    storeId: args.storeId,
    subcategoryId: subcategory._id,
  });
  summary.productsCreated += 1;
  const product = await ctx.db.get("product", productId);

  if (!product) {
    throw new Error(`Row ${args.row.rowNumber}: product could not be loaded.`);
  }

  const productSkuId = await ctx.db.insert("productSku", {
    ...buildSkuInsert(
      {
        ...args.row,
        barcode: args.row.barcode,
        quantity: 0,
        sku: undefined,
        status: "draft",
      },
      product._id,
      args.storeId,
    ),
    attributes: {
      importedRowNumber: args.row.rowNumber,
      provisionalImportIdentity: true,
      provisionalImportRowKey: args.row.rowKey,
      ...(args.row.color ? { legacyColor: args.row.color } : null),
    },
    inventoryCount: 0,
    isVisible: false,
    quantityAvailable: 0,
    sku: "TEMP_SKU",
  });
  await ctx.db.patch("productSku", productSkuId, {
    sku: generateSKU({
      productId: product._id,
      skuId: productSkuId,
      storeId: args.storeId,
    }),
  });
  await upsertProductSkuSearchProjection(ctx, productSkuId, {
    advanceRevision: false,
  });
  const productSku = await ctx.db.get("productSku", productSkuId);
  if (!productSku) {
    throw new Error(`Row ${args.row.rowNumber}: SKU could not be loaded.`);
  }

  return { product, productSku };
}

async function findOrCreateProduct(
  ctx: MutationCtx,
  args: {
    access: ImportAccess;
    categoryId: Id<"category">;
    row: CatalogImportRow;
    storeId: Id<"store">;
    subcategoryId: Id<"subcategory">;
    summary: MutableSummary;
  },
) {
  const productNameKey = args.row.productName.trim().toLowerCase();
  const products = await ctx.db
    .query("product")
    .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
    .take(1000);
  const existing = products.find(
    (product) =>
      product.name.trim().toLowerCase() === productNameKey &&
      product.categoryId === args.categoryId &&
      product.subcategoryId === args.subcategoryId,
  );

  if (existing) return existing;

  const productId = await ctx.db.insert("product", {
    availability: mapProductAvailability(args.row.status),
    categoryId: args.categoryId,
    createdByUserId: args.access.athenaUser._id,
    currency: "GHS",
    inventoryCount: 0,
    isVisible: args.row.status !== "archived",
    name: args.row.productName.trim(),
    organizationId: args.access.store.organizationId,
    quantityAvailable: 0,
    slug: toSlug(args.row.productName) || `legacy-import-${Date.now()}`,
    storeId: args.storeId,
    subcategoryId: args.subcategoryId,
  });
  args.summary.productsCreated += 1;

  return ctx.db.get("product", productId);
}

function buildSkuInsert(
  row: CatalogImportRow,
  productId: Id<"product">,
  storeId: Id<"store">,
  finalTrustedQuantity = row.quantity,
) {
  return {
    attributes: {
      importedRowNumber: row.rowNumber,
      ...(row.color ? { legacyColor: row.color } : null),
    },
    barcode: normalizeOptional(row.barcode),
    barcodeAutoGenerated: false,
    images: [],
    inventoryCount: 0,
    isVisible: row.status !== "archived",
    length: row.length,
    netPrice: row.price,
    price: row.price,
    productId,
    productName: row.productName.trim(),
    quantityAvailable: 0,
    size: normalizeOptional(row.size),
    sku: normalizeOptional(row.sku) ?? normalizeOptional(row.barcode),
    storeId,
    weight: normalizeOptional(row.weight),
  };
}

function buildSkuPatch(
  row: CatalogImportRow,
  productId: Id<"product">,
  finalTrustedQuantity = row.quantity,
) {
  return {
    attributes: {
      importedRowNumber: row.rowNumber,
      ...(row.color ? { legacyColor: row.color } : null),
    },
    barcode: normalizeOptional(row.barcode),
    isVisible: row.status !== "archived",
    length: row.length,
    netPrice: row.price,
    price: row.price,
    productId,
    productName: row.productName.trim(),
    size: normalizeOptional(row.size),
    sku: normalizeOptional(row.sku),
    weight: normalizeOptional(row.weight),
  };
}

async function applyImportedSkuInventoryWithCtx(
  ctx: MutationCtx,
  args: {
    access: ImportAccess;
    currentSku: Doc<"productSku">;
    importKey: string;
    product: Doc<"product">;
    row: CatalogImportRow;
    storeId: Id<"store">;
    targetQuantity: number;
  },
) {
  const physicalQuantityDelta =
    args.targetQuantity - args.currentSku.inventoryCount;
  const sellableQuantityDelta =
    args.targetQuantity - args.currentSku.quantityAvailable;
  if (physicalQuantityDelta === 0 && sellableQuantityDelta === 0) return;

  const valuation =
    physicalQuantityDelta > 0
      ? {
          costBasis:
            args.row.unitCost === undefined
              ? uncostedBasis()
              : knownUnitCostBasis({
                  currency: args.product.currency,
                  quantity: physicalQuantityDelta,
                  unitCost: args.row.unitCost,
                }),
          deficitLots: [],
          kind: "inbound" as const,
          quantity: physicalQuantityDelta,
        }
      : physicalQuantityDelta < 0
        ? {
            disposition: "stock_correction" as const,
            kind: "outbound" as const,
            quantity: Math.abs(physicalQuantityDelta),
          }
        : { kind: "availability_only" as const };

  await applyInventoryEffectWithCtx(ctx, {
    actorUserId: args.access.athenaUser._id,
    activityType: "inventory_import_applied",
    businessEventKey: `inventory_import:${args.importKey}:row:${args.row.rowNumber}:sku:${args.currentSku._id}`,
    compatibilityBalance: {
      onHandQuantity: args.targetQuantity,
      sellableQuantity: args.targetQuantity,
    },
    completeness: "partial",
    contentFingerprint: `quantity:${args.targetQuantity}:cost:${args.row.unitCost ?? "unknown"}`,
    effectType:
      args.currentSku.inventoryCount === 0 ? "baseline" : "adjustment",
    movementType: "inventory_import",
    notes: "Inventory applied from a reviewed catalog import.",
    occurrenceAt: Date.now(),
    organizationId: args.access.store.organizationId,
    physicalQuantityDelta,
    productId: args.product._id,
    productSkuId: args.currentSku._id,
    reasonCode: "inventory_import",
    sellableQuantityDelta,
    sourceDomain: "inventory",
    sourceId: args.importKey,
    sourceLineId: String(args.row.rowNumber),
    sourceType: "inventory_import",
    storeId: args.storeId,
    valuation,
  });
}

async function recomputeProductInventory(
  ctx: MutationCtx,
  productId: Id<"product">,
) {
  const product = await ctx.db.get("product", productId);
  if (!product) return false;

  const skus = await ctx.db
    .query("productSku")
    .withIndex("by_productId", (q) => q.eq("productId", productId))
    .take(1000);

  const inventoryCount = skus.reduce((sum, sku) => sum + sku.inventoryCount, 0);
  const quantityAvailable = skus.reduce(
    (sum, sku) => sum + sku.quantityAvailable,
    0,
  );

  await ctx.db.patch("product", productId, {
    inventoryCount,
    quantityAvailable,
  });

  return true;
}

function mapProductAvailability(status: CatalogImportRow["status"]) {
  if (status === "archived") return "archived" as const;
  if (status === "draft") return "draft" as const;
  return "live" as const;
}

function normalizeLabel(value?: string) {
  return value?.trim().replace(/\s+/g, " ");
}

function normalizeOptional(value?: string) {
  const normalized = normalizeLabel(value);
  return normalized || undefined;
}

function generateSKU({
  storeId,
  productId,
  skuId,
}: {
  storeId: string;
  productId: string;
  skuId: string;
}) {
  const encodeBase36 = (id: string, length: number) => {
    const subset = id.substring(id.length - length);
    return parseInt(subset, 36).toString(36).toUpperCase();
  };

  const storeCode = encodeBase36(storeId, 4);
  const productCode = encodeBase36(productId, 3);
  const skuCode = encodeBase36(skuId, 3);

  return `${storeCode}-${productCode}-${skuCode}`;
}

function normalizeReviewRowDecisions(
  decisions?: InventoryImportReviewRowDecision[],
): InventoryImportReviewRowDecision[] {
  if (!decisions) return [];

  return decisions
    .map((decision) => ({
      action: decision.action,
      nameSource: decision.nameSource,
      priceSource: decision.priceSource,
      productName: normalizeLabel(decision.productName) ?? "",
      quantitySource: decision.quantitySource,
      rowKey: normalizeLabel(decision.rowKey) ?? "",
      rowNumber: decision.rowNumber,
    }))
    .filter((decision) => decision.rowKey && decision.productName);
}

function normalizeProvisionalStageRows(
  rows: ProvisionalInventoryImportStageRow[],
): ProvisionalInventoryImportStageRow[] {
  return rows
    .map((row) => ({
      ...normalizeImportRow(row),
      action: row.action,
      nameSource: row.nameSource,
      priceSource: row.priceSource,
      productId: row.productId,
      productSkuId: row.productSkuId,
      quantitySource: row.quantitySource,
      rowKey: normalizeLabel(row.rowKey) ?? "",
    }))
    .filter((row) => row.rowKey);
}

function buildProvisionalSkuPatch(args: {
  access: ImportAccess;
  identity: ProvisionalImportIdentity;
  reviewVersion: Doc<"inventoryImportReviewVersion">;
  row: ProvisionalInventoryImportStageRow;
  sourceFormat: "csv" | "json";
  storeId: Id<"store">;
}) {
  const now = Date.now();
  const importedSku = normalizeOptional(args.identity.sku);
  const importedBarcode =
    normalizeOptional(args.identity.barcode) ??
    normalizeOptional(args.row.barcode);

  return {
    storeId: args.storeId,
    organizationId: args.access.store.organizationId,
    importKey: args.reviewVersion.importKey,
    reviewVersionId: args.reviewVersion._id,
    reviewVersionNumber: args.reviewVersion.versionNumber,
    sourceFormat: args.sourceFormat,
    rowKey: args.row.rowKey,
    rowNumber: args.row.rowNumber,
    productId: args.identity.productId,
    productSkuId: args.identity.productSkuId,
    importedProductName: args.row.productName.trim(),
    normalizedImportedProductName:
      normalizeSearchValue(args.row.productName) ?? "",
    importedSku,
    normalizedImportedSku: normalizeSearchValue(importedSku),
    importedBarcode,
    normalizedImportedBarcode: normalizeSearchValue(importedBarcode),
    importedCategory: normalizeOptional(args.row.category),
    importedSubcategory: normalizeOptional(args.row.subcategory),
    importedPrice: args.row.price,
    importedUnitCost: args.row.unitCost,
    importedQuantity: args.row.quantity,
    importedSize: normalizeOptional(args.row.size),
    importedColor: normalizeOptional(args.row.color),
    importedLength: args.row.length,
    importedWeight: normalizeOptional(args.row.weight),
    rowDecision:
      args.row.action ||
      args.row.nameSource ||
      args.row.priceSource ||
      args.row.quantitySource
        ? {
            action: args.row.action,
            nameSource: args.row.nameSource,
            priceSource: args.row.priceSource,
            quantitySource: args.row.quantitySource,
          }
        : undefined,
    status: "active" as const,
    posExposureStatus: "available" as const,
    exposedAt: now,
    updatedAt: now,
  };
}

function isNonNegativeInteger(value: number) {
  return Number.isInteger(value) && value >= 0;
}

function normalizeSearchValue(value?: string) {
  return normalizeOptional(value)?.toLowerCase();
}

function getActorLabel(user: Doc<"athenaUser">) {
  const fullName = [user.firstName, user.lastName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");

  return fullName || user.email;
}
