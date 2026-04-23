import { internalMutation, mutation, type MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { resolveStockAdjustmentApprovalDecisionWithCtx } from "../stockOps/adjustments";
import {
  requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx,
} from "../lib/athenaUserAuth";
import { buildApprovalRequest } from "./approvalRequestHelpers";
import { ok, userError, type CommandResult } from "../../shared/commandResult";
import { commandResultValidator } from "../lib/commandResultValidators";

type DecideApprovalRequestArgs = {
  approvalRequestId: Id<"approvalRequest">;
  decision: "approved" | "rejected" | "cancelled";
  reviewedByUserId?: Id<"athenaUser">;
  reviewedByStaffProfileId?: Id<"staffProfile">;
  decisionNotes?: string;
};

type PublicDecideApprovalRequestArgs = {
  approvalRequestId: Id<"approvalRequest">;
  decision: "approved" | "rejected" | "cancelled";
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

export async function decideApprovalRequestAsAuthenticatedUserWithCtx(
  ctx: MutationCtx,
  args: PublicDecideApprovalRequestArgs
) {
  const approvalRequest = await ctx.db.get("approvalRequest", args.approvalRequestId);

  if (!approvalRequest) {
    throw new Error("Approval request not found.");
  }

  if (!approvalRequest.organizationId) {
    throw new Error("A full-admin reviewer is required to resolve approval requests.");
  }

  const reviewer = await requireAuthenticatedAthenaUserWithCtx(ctx);

  await requireOrganizationMemberRoleWithCtx(ctx, {
    allowedRoles: ["full_admin"],
    failureMessage: "Only full admins can resolve approval requests.",
    organizationId: approvalRequest.organizationId,
    userId: reviewer._id,
  });

  return decideApprovalRequestWithCtx(ctx, {
    ...args,
    reviewedByUserId: reviewer._id,
  });
}

function mapDecideApprovalRequestError(
  error: unknown
): CommandResult<never> | null {
  const message = error instanceof Error ? error.message : "";

  if (message === "Sign in again to continue.") {
    return userError({
      code: "authentication_failed",
      message,
    });
  }

  if (
    message === "Only full admins can resolve approval requests." ||
    message === "A full-admin reviewer is required to resolve approval requests."
  ) {
    return userError({
      code: "authorization_failed",
      message,
    });
  }

  if (message === "Approval request not found.") {
    return userError({
      code: "not_found",
      message,
    });
  }

  if (
    message === "Inventory adjustment approval request not found." ||
    message === "Stock adjustment batch not found for this approval request."
  ) {
    return userError({
      code: "not_found",
      message,
    });
  }

  if (
    message === "Approval request has already been decided." ||
    message === "Stock adjustment batch has already been resolved."
  ) {
    return userError({
      code: "precondition_failed",
      message,
    });
  }

  return null;
}

export async function decideApprovalRequestAsCommandWithCtx(
  ctx: MutationCtx,
  args: PublicDecideApprovalRequestArgs
): Promise<CommandResult<any>> {
  try {
    return ok(await decideApprovalRequestAsAuthenticatedUserWithCtx(ctx, args));
  } catch (error) {
    const result = mapDecideApprovalRequestError(error);

    if (result) {
      return result;
    }

    throw error;
  }
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
  decisionNotes: v.optional(v.string()),
};

const decideApprovalRequestInternalArgs = {
  ...decideApprovalRequestArgs,
  reviewedByUserId: v.optional(v.id("athenaUser")),
  reviewedByStaffProfileId: v.optional(v.id("staffProfile")),
};

export const decideApprovalRequest = mutation({
  args: decideApprovalRequestArgs,
  returns: commandResultValidator(v.any()),
  handler: (ctx, args) => decideApprovalRequestAsCommandWithCtx(ctx, args),
});

export const decideApprovalRequestInternal = internalMutation({
  args: {
    ...decideApprovalRequestInternalArgs,
  },
  handler: (ctx, args) => decideApprovalRequestWithCtx(ctx, args),
});
