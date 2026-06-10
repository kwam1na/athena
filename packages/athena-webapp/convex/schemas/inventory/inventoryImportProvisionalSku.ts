import { v } from "convex/values";

export const inventoryImportProvisionalSkuStatusValidator = v.union(
  v.literal("active"),
  v.literal("finalized"),
  v.literal("rejected"),
  v.literal("closed"),
);

export const inventoryImportProvisionalSkuExposureStatusValidator = v.union(
  v.literal("available"),
  v.literal("hidden"),
);

export const inventoryImportProvisionalSkuSchema = v.object({
  storeId: v.id("store"),
  organizationId: v.id("organization"),
  importKey: v.string(),
  reviewVersionId: v.id("inventoryImportReviewVersion"),
  reviewVersionNumber: v.number(),
  sourceFormat: v.union(v.literal("csv"), v.literal("json")),
  rowKey: v.string(),
  rowNumber: v.number(),

  productId: v.optional(v.id("product")),
  productSkuId: v.optional(v.id("productSku")),

  importedProductName: v.string(),
  normalizedImportedProductName: v.string(),
  importedSku: v.optional(v.string()),
  normalizedImportedSku: v.optional(v.string()),
  importedBarcode: v.optional(v.string()),
  normalizedImportedBarcode: v.optional(v.string()),
  importedCategory: v.optional(v.string()),
  importedSubcategory: v.optional(v.string()),
  importedPrice: v.number(),
  importedUnitCost: v.optional(v.number()),
  importedQuantity: v.number(),
  importedSize: v.optional(v.string()),
  importedColor: v.optional(v.string()),
  importedLength: v.optional(v.number()),
  importedWeight: v.optional(v.string()),

  rowDecision: v.optional(
    v.object({
      action: v.optional(v.union(v.literal("create_item"), v.literal("skip_row"))),
      nameSource: v.optional(v.union(v.literal("import"), v.literal("athena"))),
      priceSource: v.optional(v.union(v.literal("import"), v.literal("athena"))),
      quantitySource: v.optional(v.union(v.literal("import"), v.literal("athena"))),
    }),
  ),

  status: inventoryImportProvisionalSkuStatusValidator,
  posExposureStatus: inventoryImportProvisionalSkuExposureStatusValidator,
  exposedAt: v.optional(v.number()),
  hiddenAt: v.optional(v.number()),

  saleEvidence: v.object({
    saleCount: v.number(),
    totalQuantitySold: v.number(),
    lastSoldAt: v.optional(v.number()),
    lastPosTransactionId: v.optional(v.id("posTransaction")),
    lastRegisterSessionId: v.optional(v.id("registerSession")),
  }),

  finalizedAt: v.optional(v.number()),
  finalizedByUserId: v.optional(v.id("athenaUser")),
  finalTrustedQuantity: v.optional(v.number()),
  provisionalSoldQuantityAtFinalization: v.optional(v.number()),
  rejectedAt: v.optional(v.number()),
  rejectedByUserId: v.optional(v.id("athenaUser")),
  closedAt: v.optional(v.number()),
  closedByUserId: v.optional(v.id("athenaUser")),

  createdByUserId: v.id("athenaUser"),
  createdAt: v.number(),
  updatedAt: v.number(),
});
