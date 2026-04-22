import { v } from "convex/values";

export const workflowTraceEventSchema = v.object({
  storeId: v.id("store"),
  traceId: v.string(),
  workflowType: v.string(),
  sequence: v.number(),
  kind: v.union(
    v.literal("milestone"),
    v.literal("system_action"),
    v.literal("gap")
  ),
  step: v.string(),
  status: v.union(
    v.literal("started"),
    v.literal("succeeded"),
    v.literal("failed"),
    v.literal("blocked"),
    v.literal("info")
  ),
  message: v.string(),
  occurredAt: v.number(),
  details: v.optional(v.record(v.string(), v.any())),
  source: v.string(),
  subjectRefs: v.optional(v.record(v.string(), v.string())),
  actorRefs: v.optional(v.record(v.string(), v.string())),
});
