import { v } from "convex/values";

export const posLocalSyncConflictTypeValidator = v.union(
  v.literal("duplicate_local_id"),
  v.literal("inventory"),
  v.literal("offline_authority"),
  v.literal("payment"),
  v.literal("permission"),
  v.literal("server_rejected"),
);

export const posLocalSyncConflictStatusValidator = v.union(
  v.literal("needs_review"),
  v.literal("resolved"),
);

export const posLocalSyncConflictSchema = v.object({
  storeId: v.id("store"),
  terminalId: v.id("posTerminal"),
  localRegisterSessionId: v.string(),
  localEventId: v.string(),
  sequence: v.number(),
  conflictType: posLocalSyncConflictTypeValidator,
  status: posLocalSyncConflictStatusValidator,
  summary: v.string(),
  details: v.record(v.string(), v.any()),
  createdAt: v.number(),
  resolvedAt: v.optional(v.number()),
  resolvedByStaffProfileId: v.optional(v.id("staffProfile")),
  resolvedByUserId: v.optional(v.id("athenaUser")),
});
