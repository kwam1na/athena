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
import { getActiveManagerElevationWithCtx } from "../operations/managerElevations";
import { recordOperationalEventWithCtx } from "../operations/operationalEvents";
import { toSlug } from "../utils";
import { ok, userError, type CommandResult } from "../../shared/commandResult";

const DEFAULT_CATEGORY_NAME = "Legacy import";
const DEFAULT_SUBCATEGORY_NAME = "Imported inventory";
const IMPORT_EVENT_TYPE = "inventory_import_applied";
const REVIEW_VERSION_EVENT_TYPE = "inventory_import_review_version_saved";

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
  rowCount: v.number(),
  sourceFormat: importSourceFormatValidator,
  versionNumber: v.number(),
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

export async function importInventoryRowsWithCtx(
  ctx: MutationCtx,
  args: {
    importKey: string;
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

  for (const row of importRows) {
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
      await ctx.db.patch("productSku", existingSku._id, buildSkuPatch(row, product._id));
      summary.skusUpdated += 1;
    } else {
      await ctx.db.insert("productSku", buildSkuInsert(row, product._id, args.storeId));
      summary.skusCreated += 1;
    }

    touchedProductIds.add(product._id);
    summary.rowsImported += 1;
  }

  for (const productId of touchedProductIds) {
    const didUpdate = await recomputeProductInventory(ctx, productId);
    if (didUpdate) summary.productsUpdated += 1;
  }

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
    notes?: string;
    rawContent: string;
    rowCount: number;
    sourceFormat: "csv" | "json";
    storeId: Id<"store">;
    terminalId?: Id<"posTerminal">;
  },
  resolvedAccess?: ImportAccess,
): Promise<InventoryImportReviewVersionSummary> {
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
  const versionId = await ctx.db.insert("inventoryImportReviewVersion", {
    createdAt,
    createdByUserId: access.athenaUser._id,
    fileName,
    importKey: args.importKey,
    issueCount: args.issueCount,
    notes,
    organizationId: access.store.organizationId,
    rawContent,
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
    rowCount: v.number(),
    sourceFormat: importSourceFormatValidator,
    storeId: v.id("store"),
    terminalId: v.optional(v.id("posTerminal")),
  },
  returns: commandResultValidator(v.any()),
  handler: saveInventoryImportReviewVersionCommandWithCtx,
});

export const getLatestInventoryImportReviewVersion = query({
  args: {
    storeId: v.id("store"),
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
      rowCount: version.rowCount,
      sourceFormat: version.sourceFormat,
      versionNumber: version.versionNumber,
    };
  },
});

async function requireInventoryImportAccess(
  ctx: InventoryImportAccessCtx,
  args: {
    storeId: Id<"store">;
    terminalId?: Id<"posTerminal">;
  },
): Promise<ImportAccess> {
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
) {
  return {
    attributes: {
      importedRowNumber: row.rowNumber,
      ...(row.color ? { legacyColor: row.color } : null),
    },
    barcode: normalizeOptional(row.barcode),
    barcodeAutoGenerated: false,
    images: [],
    inventoryCount: row.quantity,
    isVisible: row.status !== "archived",
    length: row.length,
    netPrice: row.price,
    price: row.price,
    productId,
    productName: row.productName.trim(),
    quantityAvailable: row.quantity,
    size: normalizeOptional(row.size),
    sku: normalizeOptional(row.sku) ?? normalizeOptional(row.barcode),
    storeId,
    unitCost: row.unitCost,
    weight: normalizeOptional(row.weight),
  };
}

function buildSkuPatch(row: CatalogImportRow, productId: Id<"product">) {
  return {
    attributes: {
      importedRowNumber: row.rowNumber,
      ...(row.color ? { legacyColor: row.color } : null),
    },
    barcode: normalizeOptional(row.barcode),
    inventoryCount: row.quantity,
    isVisible: row.status !== "archived",
    length: row.length,
    netPrice: row.price,
    price: row.price,
    productId,
    productName: row.productName.trim(),
    quantityAvailable: row.quantity,
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

function isNonNegativeInteger(value: number) {
  return Number.isInteger(value) && value >= 0;
}

function getActorLabel(user: Doc<"athenaUser">) {
  const fullName = [user.firstName, user.lastName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");

  return fullName || user.email;
}
