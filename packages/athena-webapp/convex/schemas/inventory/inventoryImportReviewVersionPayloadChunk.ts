import { v } from "convex/values";

const rowDecisionValidator = v.object({
  action: v.optional(
    v.union(v.literal("create_item"), v.literal("skip_row")),
  ),
  nameSource: v.optional(v.union(v.literal("import"), v.literal("athena"))),
  priceSource: v.optional(v.union(v.literal("import"), v.literal("athena"))),
  productName: v.string(),
  quantitySource: v.optional(v.union(v.literal("import"), v.literal("athena"))),
  rowKey: v.string(),
  rowNumber: v.number(),
});

export const inventoryImportReviewVersionPayloadChunkSchema = v.union(
  v.object({
    chunkIndex: v.number(),
    createdByUserId: v.optional(v.id("athenaUser")),
    kind: v.literal("raw_content"),
    rawContent: v.string(),
    reviewVersionId: v.optional(v.id("inventoryImportReviewVersion")),
    storeId: v.optional(v.id("store")),
    uploadKey: v.optional(v.string()),
  }),
  v.object({
    chunkIndex: v.number(),
    createdByUserId: v.optional(v.id("athenaUser")),
    kind: v.literal("row_decisions"),
    reviewVersionId: v.optional(v.id("inventoryImportReviewVersion")),
    rowDecisions: v.array(rowDecisionValidator),
    storeId: v.optional(v.id("store")),
    uploadKey: v.optional(v.string()),
  }),
);
