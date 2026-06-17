import { v } from "convex/values";

export const posLocalSyncMappingKindValidator = v.union(
  v.literal("registerSession"),
  v.literal("posSession"),
  v.literal("pendingCheckoutItem"),
  v.literal("transaction"),
  v.literal("transactionItem"),
  v.literal("payment"),
  v.literal("receipt"),
  v.literal("serviceCase"),
  v.literal("serviceLine"),
  v.literal("closeout"),
  v.literal("expenseSession"),
  v.literal("expenseTransaction"),
);

export const posLocalSyncMappingSchema = v.object({
  storeId: v.id("store"),
  terminalId: v.id("posTerminal"),
  syncScope: v.optional(v.union(v.literal("pos"), v.literal("expense"))),
  localRegisterSessionId: v.string(),
  localExpenseSessionId: v.optional(v.string()),
  localEventId: v.string(),
  localIdKind: posLocalSyncMappingKindValidator,
  localId: v.string(),
  cloudTable: v.string(),
  cloudId: v.string(),
  createdAt: v.number(),
});
