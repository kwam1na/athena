import { v } from "convex/values";

export const operationalEventSchema = v.object({
  storeId: v.id("store"),
  organizationId: v.optional(v.id("organization")),
  eventType: v.string(),
  subjectType: v.string(),
  subjectId: v.string(),
  message: v.string(),
  reason: v.optional(v.string()),
  metadata: v.optional(v.record(v.string(), v.any())),
  createdAt: v.number(),
  actorUserId: v.optional(v.id("athenaUser")),
  actorStaffProfileId: v.optional(v.id("staffProfile")),
  customerProfileId: v.optional(v.id("customerProfile")),
  workItemId: v.optional(v.id("operationalWorkItem")),
  registerSessionId: v.optional(v.id("registerSession")),
  approvalRequestId: v.optional(v.id("approvalRequest")),
  inventoryMovementId: v.optional(v.id("inventoryMovement")),
  paymentAllocationId: v.optional(v.id("paymentAllocation")),
  onlineOrderId: v.optional(v.id("onlineOrder")),
  posTransactionId: v.optional(v.id("posTransaction")),
});
