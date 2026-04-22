import { v } from "convex/values";

export const registerSessionSchema = v.object({
  storeId: v.id("store"),
  organizationId: v.optional(v.id("organization")),
  terminalId: v.optional(v.id("posTerminal")),
  registerNumber: v.optional(v.string()),
  workflowTraceId: v.optional(v.string()),
  status: v.union(
    v.literal("open"),
    v.literal("active"),
    v.literal("closing"),
    v.literal("closed")
  ),
  openedByUserId: v.optional(v.id("athenaUser")),
  openedByStaffProfileId: v.optional(v.id("staffProfile")),
  openedAt: v.number(),
  openingFloat: v.number(),
  expectedCash: v.number(),
  countedCash: v.optional(v.number()),
  variance: v.optional(v.number()),
  closedByUserId: v.optional(v.id("athenaUser")),
  closedByStaffProfileId: v.optional(v.id("staffProfile")),
  closedAt: v.optional(v.number()),
  managerApprovalRequestId: v.optional(v.id("approvalRequest")),
  notes: v.optional(v.string()),
});
