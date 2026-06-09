import { v } from "convex/values";

export const inventoryImportReviewVersionSchema = v.object({
  storeId: v.id("store"),
  organizationId: v.id("organization"),
  createdByUserId: v.id("athenaUser"),
  importKey: v.string(),
  versionNumber: v.number(),
  sourceFormat: v.union(v.literal("csv"), v.literal("json")),
  fileName: v.optional(v.string()),
  rawContent: v.string(),
  rowCount: v.number(),
  issueCount: v.number(),
  notes: v.optional(v.string()),
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
  createdAt: v.number(),
});
