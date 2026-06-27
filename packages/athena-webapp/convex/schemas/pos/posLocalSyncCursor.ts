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
});
