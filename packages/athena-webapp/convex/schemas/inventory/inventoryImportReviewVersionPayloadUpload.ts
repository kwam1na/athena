import { v } from "convex/values";

export const inventoryImportReviewVersionPayloadUploadSchema = v.object({
  storeId: v.id("store"),
  uploadKey: v.string(),
  createdByUserId: v.id("athenaUser"),
  expectedChunkCount: v.number(),
  expectedByteLength: v.number(),
  status: v.union(
    v.literal("active"),
    v.literal("finalized"),
    v.literal("expired"),
  ),
  expiresAt: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
});
