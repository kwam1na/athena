import { v } from "convex/values";

export const workflowTraceSchema = v.object({
  storeId: v.id("store"),
  organizationId: v.optional(v.id("organization")),
  traceId: v.string(),
  workflowType: v.string(),
  title: v.string(),
  status: v.union(
    v.literal("started"),
    v.literal("succeeded"),
    v.literal("failed"),
    v.literal("blocked"),
    v.literal("info")
  ),
  health: v.union(
    v.literal("healthy"),
    v.literal("partial"),
    v.literal("degraded")
  ),
  startedAt: v.number(),
  completedAt: v.optional(v.number()),
  primaryLookupType: v.string(),
  primaryLookupValue: v.string(),
  primarySubjectType: v.optional(v.string()),
  primarySubjectId: v.optional(v.string()),
  summary: v.optional(v.string()),
  details: v.optional(v.record(v.string(), v.any())),
});
