import { internalMutation } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { v } from "convex/values";

export function buildApprovalRequest(args: {
  storeId: Id<"store">;
  organizationId?: Id<"organization">;
  requestType: string;
  subjectType: string;
  subjectId: string;
  requestedByUserId?: Id<"athenaUser">;
  requestedByStaffProfileId?: Id<"staffProfile">;
  workItemId?: Id<"operationalWorkItem">;
  registerSessionId?: Id<"registerSession">;
  reason?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
}) {
  return {
    ...args,
    status: "pending" as const,
    createdAt: Date.now(),
  };
}

export const createApprovalRequest = internalMutation({
  args: {
    storeId: v.id("store"),
    organizationId: v.optional(v.id("organization")),
    requestType: v.string(),
    subjectType: v.string(),
    subjectId: v.string(),
    requestedByUserId: v.optional(v.id("athenaUser")),
    requestedByStaffProfileId: v.optional(v.id("staffProfile")),
    workItemId: v.optional(v.id("operationalWorkItem")),
    registerSessionId: v.optional(v.id("registerSession")),
    reason: v.optional(v.string()),
    notes: v.optional(v.string()),
    metadata: v.optional(v.record(v.string(), v.any())),
  },
  handler: async (ctx, args) => {
    const requestId = await ctx.db.insert("approvalRequest", buildApprovalRequest(args));
    return ctx.db.get("approvalRequest", requestId);
  },
});

export const decideApprovalRequest = internalMutation({
  args: {
    approvalRequestId: v.id("approvalRequest"),
    decision: v.union(v.literal("approved"), v.literal("rejected"), v.literal("cancelled")),
    reviewedByUserId: v.optional(v.id("athenaUser")),
    reviewedByStaffProfileId: v.optional(v.id("staffProfile")),
    decisionNotes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch("approvalRequest", args.approvalRequestId, {
      status: args.decision,
      reviewedByUserId: args.reviewedByUserId,
      reviewedByStaffProfileId: args.reviewedByStaffProfileId,
      decisionNotes: args.decisionNotes,
      decidedAt: Date.now(),
    });

    return ctx.db.get("approvalRequest", args.approvalRequestId);
  },
});
