import { v } from "convex/values";

import { posRegisterSessionActivitySkipCodeValidator } from "./posRegisterSessionActivity";

export const posRegisterSessionActivityCheckpointSchema = v.object({
  storeId: v.id("store"),
  terminalId: v.id("posTerminal"),
  registerSessionId: v.optional(v.id("registerSession")),
  localRegisterSessionId: v.string(),
  registerNumber: v.optional(v.string()),
  reportedThroughSequence: v.number(),
  reportedThroughOccurredAt: v.optional(v.number()),
  lastActivityReportedAt: v.optional(v.number()),
  lastAcceptedBatchAt: v.number(),
  skippedCounts: v.record(v.string(), v.number()),
  skippedLocalEventIds: v.optional(v.array(v.string())),
  lastSkipCode: v.optional(posRegisterSessionActivitySkipCodeValidator),
  updatedAt: v.number(),
});
