import {
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
import { toSlug } from "../utils";
import { ok, userError, type CommandResult } from "../../shared/commandResult";

const DEFAULT_CATEGORY_NAME = "Legacy import";
const DEFAULT_SUBCATEGORY_NAME = "Imported inventory";
const IMPORT_EVENT_TYPE = "inventory_import_applied";
const REVIEW_VERSION_EVENT_TYPE = "inventory_import_review_version_saved";
const PROVISIONAL_STAGE_EVENT_TYPE = "inventory_import_provisional_pos_staged";
const PROVISIONAL_IMPORT_FINALIZATION_LIMIT = 5000;

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

const importSourceFormatValidator = v.union(v.literal("csv"), v.literal("json"));

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
        nameSource: v.optional(v.union(v.literal("import"), v.literal("athena"))),
        priceSource: v.optional(v.union(v.literal("import"), v.literal("athena"))),
        productName: v.string(),
        quantitySource: v.optional(v.union(v.literal("import"), v.literal("athena"))),
        rowKey: v.string(),
        rowNumber: v.number(),
      }),
    ),
  ),
  rowCount: v.number(),
  sourceFormat: importSourceFormatValidator,
  versionNumber: v.number(),
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

type ImportAccess = {
  athenaUser: Doc<"athenaUser">;
  store: Doc<"store">;
};

type InventoryImportAccessCtx =
  | Pick<QueryCtx, "auth" | "db">
  | Pick<MutationCtx, "auth" | "db">;

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
        .eq("subjectId", args.importKey)
    )
    .first();

  if (existingImportEvent?.metadata) {
    return {
      alreadyApplied: true,
      categoriesCreated: Number(existingImportEvent.metadata.categoriesCreated ?? 0),
      productsCreated: Number(existingImportEvent.metadata.productsCreated ?? 0),
      productsUpdated: Number(existingImportEvent.metadata.productsUpdated ?? 0),
      rowsImported: Number(existingImportEvent.metadata.rowsImported ?? 0),
      skusCreated: Number(existingImportEvent.metadata.skusCreated ?? 0),
      skusUpdated: Number(existingImportEvent.metadata.skusUpdated ?? 0),
      subcategoriesCreated: Number(existingImportEvent.metadata.subcategoriesCreated ?? 0),
    };
  }

  const activeProvisionalRows = await listActiveProvisionalImportRowsForFinalization(
    ctx,
    {
      importKey: args.importKey,
      storeId: args.storeId,
    },
  );

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
      await ctx.db.patch(
        "productSku",
        existingSku._id,
        buildSkuPatch(row, product._id, finalTrustedQuantity),
      );
      summary.skusUpdated += 1;
    } else {
      await ctx.db.insert(
        "productSku",
        buildSkuInsert(row, product._id, args.storeId, finalTrustedQuantity),
      );
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
    const message = error instanceof Error ? error.message : "Inventory import failed.";

    if (message === "Authentication required." || message === "Sign in again to continue.") {
      return userError({ code: "authentication_failed", message });
    }

    if (
      message === "Manager elevation is required before importing inventory." ||
      message === "Terminal context is required before using manager elevation." ||
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
  const access = resolvedAccess ?? await requireInventoryImportAccess(ctx, args);
  const rawContent = args.rawContent.trim();

  if (!rawContent) {
    throw new Error("Import content is required before saving a review version.");
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
    const message = error instanceof Error ? error.message : "Review version could not be saved.";

    if (message === "Authentication required." || message === "Sign in again to continue.") {
      return userError({ code: "authentication_failed", message });
    }

    if (
      message === "Manager elevation is required before importing inventory." ||
      message === "Terminal context is required before using manager elevation." ||
      message === "You do not have permission to import inventory." ||
      message === "Athena user not found."
    ) {
      return userError({ code: "authorization_failed", message });
    }

    if (message === "Store not found.") {
      return userError({ code: "not_found", message });
    }

    if (message === "Import content is required before saving a review version.") {
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
          nameSource: v.optional(v.union(v.literal("import"), v.literal("athena"))),
          priceSource: v.optional(v.union(v.literal("import"), v.literal("athena"))),
          productName: v.string(),
          quantitySource: v.optional(v.union(v.literal("import"), v.literal("athena"))),
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
  const access = resolvedAccess ?? await requireInventoryImportAccess(ctx, args);
  const reviewVersion = await ctx.db.get("inventoryImportReviewVersion", args.reviewVersionId);

  if (!reviewVersion || reviewVersion.storeId !== args.storeId) {
    throw new Error("Inventory import review version not found.");
  }

  if (reviewVersion.importKey !== args.importKey) {
    throw new Error("Import key does not match the saved review version.");
  }

  const rows = normalizeProvisionalStageRows(args.rows);
  if (rows.length === 0) {
    throw new Error("At least one import review row is required before staging POS availability.");
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

  for (const row of rows) {
    const existing = await ctx.db
      .query("inventoryImportProvisionalSku")
      .withIndex("by_storeId_importKey_rowKey", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("importKey", args.importKey)
          .eq("rowKey", row.rowKey)
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
        ? {
            productId: existing.productId,
            productSkuId: existing.productSkuId,
          }
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
      stagedIds.push(id);
    }

    summary.rowsStaged += 1;
  }

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
      error instanceof Error ? error.message : "Inventory import rows could not be staged.";

    if (message === "Authentication required." || message === "Sign in again to continue.") {
      return userError({ code: "authentication_failed", message });
    }

    if (
      message === "Manager elevation is required before importing inventory." ||
      message === "Terminal context is required before using manager elevation." ||
      message === "You do not have permission to import inventory." ||
      message === "Athena user not found."
    ) {
      return userError({ code: "authorization_failed", message });
    }

    if (message === "Store not found." || message === "Inventory import review version not found.") {
      return userError({ code: "not_found", message });
    }

    if (
      message === "Import key does not match the saved review version." ||
      message === "At least one import review row is required before staging POS availability."
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

  const productIds = Array.from(new Set(productSkus.map((productSku) => productSku.productId)));
  const products = await Promise.all(productIds.map((productId) => ctx.db.get("product", productId)));
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
        productName: product?.name ?? productSku.productName ?? productSku.sku ?? "Unnamed SKU",
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
    throw new Error("Manager elevation is required before importing inventory.");
  }

  const activeElevation = await getActiveManagerElevationWithCtx(ctx, {
    accountId: athenaUser._id,
    storeId: args.storeId,
    terminalId: args.terminalId,
  });

  if (!activeElevation) {
    throw new Error("Manager elevation is required before importing inventory.");
  }

  return { athenaUser, store };
}

function requireTerminalContextForManagerElevation(args: {
  managerElevationId?: Id<"managerElevation">;
  terminalId?: Id<"posTerminal">;
}) {
  if (args.managerElevationId && !args.terminalId) {
    throw new Error("Terminal context is required before using manager elevation.");
  }
}

function validateImportRows(rows: CatalogImportRow[]) {
  const errors: string[] = [];

  if (rows.length === 0) {
    errors.push("Row 0: import file must include at least one inventory row.");
  }

  rows.forEach((row) => {
    if (!Number.isInteger(row.quantity) || row.quantity < 0) {
      errors.push(`Row ${row.rowNumber}: quantity must be a non-negative whole number.`);
    }
    if (!Number.isInteger(row.price) || row.price < 0) {
      errors.push(`Row ${row.rowNumber}: price must be a non-negative stored amount.`);
    }
    if (row.unitCost !== undefined && (!Number.isInteger(row.unitCost) || row.unitCost < 0)) {
      errors.push(`Row ${row.rowNumber}: unit cost must be a non-negative stored amount.`);
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
    (normalizeOptional(row.barcode) ? undefined : `legacy-row-${row.rowNumber}`);
  const price = isNonNegativeInteger(row.price) ? row.price : 0;
  const quantity = isNonNegativeInteger(row.quantity) ? row.quantity : 0;
  const unitCost =
    row.unitCost === undefined || !isNonNegativeInteger(row.unitCost) ? undefined : row.unitCost;

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
    .withIndex("by_storeId_slug", (q) => q.eq("storeId", args.storeId).eq("slug", slug))
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
      q.eq("categoryId", args.categoryId).eq("slug", slug)
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
        q.eq("storeId", storeId).eq("barcode", barcode)
      )
      .first();
    if (byBarcode) return byBarcode;
  }

  const sku = row.sku?.trim();
  if (sku) {
    return ctx.db
      .query("productSku")
      .withIndex("by_storeId_sku", (q) => q.eq("storeId", storeId).eq("sku", sku))
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
        .eq("status", "active")
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
): Promise<{
  productId: Id<"product">;
  productSkuId: Id<"productSku">;
} | null> {
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
): Promise<{
  productId?: Id<"product">;
  productSkuId?: Id<"productSku">;
}> {
  const created = await findOrCreateProvisionalCatalogIdentity(ctx, {
    access: args.access,
    row: args.row,
    storeId: args.storeId,
  });
  args.summary.catalogIdentitiesCreated += 1;

  return {
    productId: created.product._id,
    productSkuId: created.productSku._id,
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
    ...buildSkuInsert({ ...args.row, quantity: 0, status: "draft" }, product._id, args.storeId),
    attributes: {
      importedRowNumber: args.row.rowNumber,
      provisionalImportIdentity: true,
      provisionalImportRowKey: args.row.rowKey,
      ...(args.row.color ? { legacyColor: args.row.color } : null),
    },
    inventoryCount: 0,
    isVisible: false,
    quantityAvailable: 0,
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
    inventoryCount: finalTrustedQuantity,
    isVisible: row.status !== "archived",
    length: row.length,
    netPrice: row.price,
    price: row.price,
    productId,
    productName: row.productName.trim(),
    quantityAvailable: finalTrustedQuantity,
    size: normalizeOptional(row.size),
    sku: normalizeOptional(row.sku) ?? normalizeOptional(row.barcode),
    storeId,
    unitCost: row.unitCost,
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
    inventoryCount: finalTrustedQuantity,
    isVisible: row.status !== "archived",
    length: row.length,
    netPrice: row.price,
    price: row.price,
    productId,
    productName: row.productName.trim(),
    quantityAvailable: finalTrustedQuantity,
    size: normalizeOptional(row.size),
    sku: normalizeOptional(row.sku),
    unitCost: row.unitCost,
    weight: normalizeOptional(row.weight),
  };
}

async function recomputeProductInventory(ctx: MutationCtx, productId: Id<"product">) {
  const product = await ctx.db.get("product", productId);
  if (!product) return false;

  const skus = await ctx.db
    .query("productSku")
    .withIndex("by_productId", (q) => q.eq("productId", productId))
    .take(1000);

  const inventoryCount = skus.reduce((sum, sku) => sum + sku.inventoryCount, 0);
  const quantityAvailable = skus.reduce((sum, sku) => sum + sku.quantityAvailable, 0);

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
  identity: {
    productId?: Id<"product">;
    productSkuId?: Id<"productSku">;
  };
  reviewVersion: Doc<"inventoryImportReviewVersion">;
  row: ProvisionalInventoryImportStageRow;
  sourceFormat: "csv" | "json";
  storeId: Id<"store">;
}) {
  const now = Date.now();
  const importedSku = normalizeOptional(args.row.sku);
  const importedBarcode = normalizeOptional(args.row.barcode);

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
