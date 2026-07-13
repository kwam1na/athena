import { v } from "convex/values";

export const sharedDemoRestoreStateSchema = v.object({
  baselineVersion: v.number(),
  completedAt: v.optional(v.number()),
  epoch: v.number(),
  failureCode: v.optional(v.string()),
  idempotencyKey: v.optional(v.string()),
  startedAt: v.optional(v.number()),
  status: v.union(v.literal("ready"), v.literal("restoring"), v.literal("failed")),
  storeId: v.id("store"),
});

export const sharedDemoBaselineRowSchema = v.object({
  baselineVersion: v.number(),
  domain: v.string(),
  expectedCount: v.number(),
  storeId: v.id("store"),
});

export const sharedDemoRestoreAuditSchema = v.object({
  baselineVersion: v.number(),
  epoch: v.number(),
  occurredAt: v.number(),
  outcome: v.union(v.literal("ready"), v.literal("failed")),
  source: v.union(v.literal("hourly"), v.literal("manual")),
  storeId: v.id("store"),
});

export const sharedDemoBaselineDocumentSchema = v.object({
  baselineVersion: v.number(),
  document: v.any(),
  documentId: v.string(),
  storeId: v.id("store"),
  tableName: v.union(
    v.literal("posTransaction"),
    v.literal("posTransactionItem"),
    v.literal("posTerminal"),
    v.literal("posLocalSyncConflict"),
    v.literal("posLocalSyncCursor"),
    v.literal("posLocalSyncMapping"),
    v.literal("posLocalSyncEvent"),
    v.literal("posLifecycleJournal"),
    v.literal("posLifecycleJournalCursor"),
    v.literal("posRegisterMappingAuthority"),
    v.literal("posRegisterAuthorityReplicationStatus"),
    v.literal("posSession"),
    v.literal("posSessionItem"),
    v.literal("inventoryMovement"),
    v.literal("product"),
    v.literal("productSku"),
    v.literal("productSkuSearch"),
    v.literal("reportingInventoryPosition"),
    v.literal("posRegisterSessionActivity"),
    v.literal("registerSession"),
    v.literal("onlineOrder"),
    v.literal("onlineOrderItem"),
    v.literal("operationalEvent"),
    v.literal("dailyOpening"),
    v.literal("staffProfile"),
    v.literal("staffMessage"),
  ),
});
