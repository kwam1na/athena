import { v } from "convex/values";

export const posLocalSyncCursorSchema = v.object({
  storeId: v.id("store"),
  terminalId: v.id("posTerminal"),
  localRegisterSessionId: v.string(),
  acceptedThroughSequence: v.number(),
  updatedAt: v.number(),
});
