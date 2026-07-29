import { v } from "convex/values";

export const inventoryImportCostOverlayBulkDecisionRequestSchema = v.object({
  runId: v.id("inventoryImportCostOverlayRun"),
  requestKey: v.string(),
  requestFingerprint: v.string(),
  generation: v.optional(v.number()),
  status: v.union(v.literal("processing"), v.literal("completed")),
  updatedCount: v.number(),
  completedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
});
