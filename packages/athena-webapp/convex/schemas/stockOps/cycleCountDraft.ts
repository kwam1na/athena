import { v } from "convex/values";

export const cycleCountDraftSchema = v.object({
  storeId: v.id("store"),
  organizationId: v.optional(v.id("organization")),
  scopeKey: v.string(),
  status: v.union(
    v.literal("open"),
    v.literal("submitted"),
    v.literal("discarded"),
  ),
  ownerUserId: v.id("athenaUser"),
  submissionKey: v.string(),
  changedLineCount: v.number(),
  staleLineCount: v.number(),
  notes: v.optional(v.string()),
  submittedStockAdjustmentBatchId: v.optional(v.id("stockAdjustmentBatch")),
  createdAt: v.number(),
  updatedAt: v.number(),
  lastSavedAt: v.optional(v.number()),
  submittedAt: v.optional(v.number()),
  discardedAt: v.optional(v.number()),
});

export const cycleCountDraftLineSchema = v.object({
  draftId: v.id("cycleCountDraft"),
  storeId: v.id("store"),
  organizationId: v.optional(v.id("organization")),
  productSkuId: v.id("productSku"),
  baselineInventoryCount: v.number(),
  baselineAvailableCount: v.number(),
  countedQuantity: v.number(),
  isDirty: v.boolean(),
  staleStatus: v.optional(
    v.union(v.literal("current"), v.literal("stale")),
  ),
  currentInventoryCount: v.optional(v.number()),
  currentAvailableCount: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
});
