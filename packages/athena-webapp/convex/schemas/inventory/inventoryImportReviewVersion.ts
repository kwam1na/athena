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
  createdAt: v.number(),
});
