import { internalMutation, mutation, type MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { resolveStockAdjustmentApprovalDecisionWithCtx } from "../stockOps/adjustments";
import { buildApprovalRequest } from "./approvalRequestHelpers";

type DecideApprovalRequestArgs = {
  approvalRequestId: Id<"approvalRequest">;
  decision: "approved" | "rejected" | "cancelled";
  reviewedByUserId?: Id<"athenaUser">;
  reviewedByStaffProfileId?: Id<"staffProfile">;
  decisionNotes?: string;
};

export async function decideApprovalRequestWithCtx(
  ctx: MutationCtx,
  args: DecideApprovalRequestArgs
) {
  const approvalRequest = await ctx.db.get("approvalRequest", args.approvalRequestId);

  if (!approvalRequest) {
    throw new Error("Approval request not found.");
  }

  if (approvalRequest.status !== "pending") {
    throw new Error("Approval request has already been decided.");
  }

  if (!approvalRequest.organizationId || !args.reviewedByUserId) {
    throw new Error("A full-admin reviewer is required to resolve approval requests.");
  }

  const reviewerMembership = await ctx.db
    .query("organizationMember")
    .filter((q) =>
      q.and(
        q.eq(q.field("organizationId"), approvalRequest.organizationId),
        q.eq(q.field("userId"), args.reviewedByUserId)
      )
    )
    .first();

  if (reviewerMembership?.role !== "full_admin") {
    throw new Error("Only full admins can resolve approval requests.");
  }

  if (
    approvalRequest.requestType === "inventory_adjustment_review" &&
    approvalRequest.subjectType === "stock_adjustment_batch"
  ) {
    await resolveStockAdjustmentApprovalDecisionWithCtx(ctx, args);
  }

  await ctx.db.patch("approvalRequest", args.approvalRequestId, {
    status: args.decision,
    reviewedByUserId: args.reviewedByUserId,
    reviewedByStaffProfileId: args.reviewedByStaffProfileId,
    decisionNotes: args.decisionNotes,
    decidedAt: Date.now(),
  });

  return ctx.db.get("approvalRequest", args.approvalRequestId);
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

const decideApprovalRequestArgs = {
  approvalRequestId: v.id("approvalRequest"),
  decision: v.union(v.literal("approved"), v.literal("rejected"), v.literal("cancelled")),
  reviewedByUserId: v.optional(v.id("athenaUser")),
  reviewedByStaffProfileId: v.optional(v.id("staffProfile")),
  decisionNotes: v.optional(v.string()),
};

export const decideApprovalRequest = mutation({
  args: decideApprovalRequestArgs,
  handler: (ctx, args) => decideApprovalRequestWithCtx(ctx, args),
});

export const decideApprovalRequestInternal = internalMutation({
  args: {
    ...decideApprovalRequestArgs,
  },
  handler: (ctx, args) => decideApprovalRequestWithCtx(ctx, args),
});
