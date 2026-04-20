import { v } from "convex/values";

export const approvalRequestSchema = v.object({
  storeId: v.id("store"),
  organizationId: v.optional(v.id("organization")),
  requestType: v.string(),
  subjectType: v.string(),
  subjectId: v.string(),
  status: v.union(
    v.literal("pending"),
    v.literal("approved"),
    v.literal("rejected"),
    v.literal("cancelled")
  ),
  requestedByUserId: v.optional(v.id("athenaUser")),
  requestedByStaffProfileId: v.optional(v.id("staffProfile")),
  reviewedByUserId: v.optional(v.id("athenaUser")),
  reviewedByStaffProfileId: v.optional(v.id("staffProfile")),
  workItemId: v.optional(v.id("operationalWorkItem")),
  registerSessionId: v.optional(v.id("registerSession")),
  reason: v.optional(v.string()),
  notes: v.optional(v.string()),
  decisionNotes: v.optional(v.string()),
  createdAt: v.number(),
  decidedAt: v.optional(v.number()),
  metadata: v.optional(v.record(v.string(), v.any())),
});
