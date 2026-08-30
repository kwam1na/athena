import { v } from "convex/values";

export const reportWeeklyRecoverySchema = v.object({
  storeId: v.id("store"),
  closeCursor: v.optional(v.string()),
  acceptedCursor: v.optional(v.string()),
  lane: v.union(v.literal("close"), v.literal("accepted")),
  nextRunAt: v.number(),
  nextCurrentAt: v.number(),
});
