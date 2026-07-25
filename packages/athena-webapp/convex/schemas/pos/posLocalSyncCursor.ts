import { v } from "convex/values";

export const posLocalSyncCursorSchema = v.object({
  storeId: v.id("store"),
  terminalId: v.id("posTerminal"),
  syncScope: v.optional(v.union(v.literal("pos"), v.literal("expense"))),
  localSyncCursorId: v.optional(v.string()),
  localRegisterSessionId: v.string(),
  localExpenseSessionId: v.optional(v.string()),
  acceptedThroughSequence: v.number(),
  updatedAt: v.number(),
  // Durable tracking for an upload-sequence hole that is blocking held
  // successors. Written by ingest when a gap is observed, cleared as soon as
  // the cursor reaches the sequence it was waiting on, and read by gap
  // reconciliation to drive the probe-then-bounded-skip ladder. Absent on the
  // overwhelming majority of cursors, which never gap.
  gap: v.optional(
    v.object({
      missingFromSequence: v.number(),
      firstObservedAt: v.number(),
      lastObservedAt: v.number(),
      observationCount: v.number(),
      probeIssuedAt: v.optional(v.number()),
      probeCommandId: v.optional(v.id("posTerminalRecoveryCommand")),
    }),
  ),
});
