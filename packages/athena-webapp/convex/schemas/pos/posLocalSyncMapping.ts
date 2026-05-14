import { v } from "convex/values";

export const posLocalSyncMappingKindValidator = v.union(
  v.literal("registerSession"),
  v.literal("posSession"),
  v.literal("transaction"),
  v.literal("transactionItem"),
  v.literal("payment"),
  v.literal("receipt"),
  v.literal("closeout"),
);

export const posLocalSyncMappingSchema = v.object({
  storeId: v.id("store"),
  terminalId: v.id("posTerminal"),
  localRegisterSessionId: v.string(),
  localEventId: v.string(),
  localIdKind: posLocalSyncMappingKindValidator,
  localId: v.string(),
  cloudTable: v.string(),
  cloudId: v.string(),
  createdAt: v.number(),
});
