import { v } from "convex/values";

export const inventoryImportReviewVersionSchema = v.object({
  storeId: v.id("store"),
  organizationId: v.id("organization"),
  createdByUserId: v.id("athenaUser"),
  importKey: v.string(),
  versionNumber: v.number(),
  sourceFormat: v.union(v.literal("csv"), v.literal("json")),
  fileName: v.optional(v.string()),
  rawContent: v.optional(v.string()),
  rowCount: v.number(),
  issueCount: v.number(),
  notes: v.optional(v.string()),
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
  payloadChunkCount: v.optional(v.number()),
  payloadUploadKey: v.optional(v.string()),
  rawContentChunkCount: v.optional(v.number()),
  rowDecisionChunkCount: v.optional(v.number()),
  sourceProjectionVersion: v.optional(v.number()),
  sourceColumns: v.optional(
    v.array(
      v.object({
        id: v.string(),
        label: v.string(),
        normalizedKey: v.string(),
        ordinal: v.number(),
        sourcePath: v.string(),
        costValidity: v.optional(
          v.object({
            valid: v.number(),
            invalid: v.number(),
          }),
        ),
        sampleValues: v.array(
          v.union(v.string(), v.number(), v.boolean(), v.null()),
        ),
      }),
    ),
  ),
  createdAt: v.number(),
});
