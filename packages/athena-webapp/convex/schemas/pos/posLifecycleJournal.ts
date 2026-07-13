import { v } from "convex/values";

export const posLifecycleJournalEventKindValidator = v.union(
  v.literal("completed"),
  v.literal("voided"),
  v.literal("refunded"),
  v.literal("adjustment_applied"),
  v.literal("payment_method_corrected"),
);

export const posLifecycleJournalOriginValidator = v.union(
  v.literal("cloud"),
  v.literal("local_sync"),
);

/**
 * Immutable, sanitized evidence that an authoritative POS lifecycle mutation
 * committed. The journal deliberately excludes customer, payment, reason,
 * approval, and free-form payloads; canonical reporting re-reads its owned
 * POS source rows by these stable references.
 */
export const posLifecycleJournalSchema = v.object({
  organizationId: v.id("organization"),
  storeId: v.id("store"),
  transactionId: v.id("posTransaction"),
  adjustmentId: v.optional(v.id("posTransactionAdjustment")),
  localSyncEventId: v.optional(v.id("posLocalSyncEvent")),
  eventKind: posLifecycleJournalEventKindValidator,
  eventKey: v.string(),
  contentFingerprint: v.string(),
  occurredAt: v.number(),
  sequence: v.number(),
  recordedAt: v.number(),
  origin: posLifecycleJournalOriginValidator,
});

export const posLifecycleJournalCursorSchema = v.object({
  storeId: v.id("store"),
  nextSequence: v.number(),
  updatedAt: v.number(),
});
