import { v } from "convex/values";

export const operationalWorkItemSchema = v.object({
  storeId: v.id("store"),
  organizationId: v.id("organization"),
  type: v.string(),
  status: v.string(),
  priority: v.string(),
  approvalState: v.string(),
  title: v.string(),
  notes: v.optional(v.string()),
  metadata: v.optional(v.record(v.string(), v.any())),
  createdAt: v.number(),
  dueAt: v.optional(v.number()),
  startedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
  createdByUserId: v.optional(v.id("athenaUser")),
  createdByStaffProfileId: v.optional(v.id("staffProfile")),
  assignedToStaffProfileId: v.optional(v.id("staffProfile")),
  customerProfileId: v.optional(v.id("customerProfile")),
  approvalRequestId: v.optional(v.id("approvalRequest")),
});
