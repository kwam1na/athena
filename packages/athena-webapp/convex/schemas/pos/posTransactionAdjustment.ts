import { v } from "convex/values";

export const posTransactionAdjustmentStatusValidator = v.union(
  v.literal("pending_approval"),
  v.literal("applied"),
  v.literal("rejected"),
  v.literal("cancelled"),
  v.literal("stale"),
);

export const posTransactionAdjustmentSettlementDirectionValidator = v.union(
  v.literal("collect"),
  v.literal("refund"),
  v.literal("none"),
);

export const posTransactionAdjustmentSchema = v.object({
  storeId: v.id("store"),
  transactionId: v.id("posTransaction"),
  registerSessionId: v.optional(v.id("registerSession")),
  requestedByUserId: v.optional(v.id("athenaUser")),
  requestedByStaffProfileId: v.optional(v.id("staffProfile")),
  approvalRequestId: v.optional(v.id("approvalRequest")),
  approvalProofId: v.optional(v.id("approvalProof")),
  decisionApprovalProofId: v.optional(v.id("approvalProof")),
  decisionApprovedByStaffProfileId: v.optional(v.id("staffProfile")),
  paymentAllocationId: v.optional(v.id("paymentAllocation")),
  operationalEventId: v.optional(v.id("operationalEvent")),
  status: posTransactionAdjustmentStatusValidator,
  originalSubtotal: v.number(),
  originalTax: v.number(),
  originalTotal: v.number(),
  correctedSubtotal: v.number(),
  correctedTax: v.number(),
  correctedTotal: v.number(),
  deltaTotal: v.number(),
  settlementDirection: posTransactionAdjustmentSettlementDirectionValidator,
  settlementAmount: v.number(),
  settlementMethod: v.optional(v.string()),
  payloadFingerprint: v.string(),
  payloadSubject: v.string(),
  reason: v.optional(v.string()),
  currency: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
  appliedAt: v.optional(v.number()),
  decidedAt: v.optional(v.number()),
});
