import {
  internalMutation,
  mutation,
  type MutationCtx,
} from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { resolveStockAdjustmentApprovalDecisionWithCtx } from "../stockOps/adjustments";
import { resolvePaymentMethodCorrectionApprovalDecisionWithCtx } from "../pos/application/commands/correctTransaction";
import { resolveTransactionItemAdjustmentApprovalDecisionWithCtx } from "../pos/application/commands/adjustTransactionItems";
import { resolveTransactionVoidApprovalDecisionWithCtx } from "../pos/application/commands/completeTransaction";
import {
  requireOrganizationMemberRoleWithCtx,
  requireAuthenticatedAthenaUserWithCtx,
} from "../lib/athenaUserAuth";
import { buildApprovalRequest } from "./approvalRequestHelpers";
import {
  approvalRequired,
  ok,
  userError,
  type ApprovalCommandResult,
  type CommandResult,
} from "../../shared/commandResult";
import { commandResultValidator } from "../lib/commandResultValidators";
import { consumeApprovalProofWithCtx } from "./approvalProofs";

const APPROVAL_DECISION_ACTION_KEY = "operations.approval_request.decide";
const ITEM_ADJUSTMENT_REQUEST_TYPE = "pos_item_adjustment";
const ITEM_ADJUSTMENT_SUBJECT_TYPE = "pos_transaction_item_adjustment";
const SERVICE_DEPOSIT_REVIEW_REQUEST_TYPE = "service_deposit_review";
const APPROVAL_APPLY_UNSUPPORTED_REQUEST_TYPES = new Set([
  SERVICE_DEPOSIT_REVIEW_REQUEST_TYPE,
  "online_order_return_review",
  "pos_item_adjustment_review",
]);
const TERMINAL_WORK_ITEM_STATUSES = new Set(["completed", "cancelled"]);
const ITEM_ADJUSTMENT_RETIRED_PRECONDITION_MESSAGES = new Set([
  "Register session expected cash cannot be negative.",
]);

type DecideApprovalRequestArgs = {
  approvalProofId?: Id<"approvalProof">;
  approvalRequestId: Id<"approvalRequest">;
  decision: "approved" | "rejected" | "cancelled";
  decisionApprovedByStaffProfileId?: Id<"staffProfile">;
  decisionApprovalProofId?: Id<"approvalProof">;
  reviewedByUserId?: Id<"athenaUser">;
  reviewedByStaffProfileId?: Id<"staffProfile">;
  decisionNotes?: string;
};

type PublicDecideApprovalRequestArgs = {
  approvalRequestId: Id<"approvalRequest">;
  approvalProofId?: Id<"approvalProof">;
  decision: "approved" | "rejected" | "cancelled";
  decisionNotes?: string;
};

function omitUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as Partial<T>;
}

function buildApprovalDecisionSubject(approvalRequest: {
  _id: Id<"approvalRequest">;
  requestType: string;
  workItemTitle?: string | null;
}) {
  return {
    type: "approval_request",
    id: String(approvalRequest._id),
    label: approvalRequest.workItemTitle ?? approvalRequest.requestType,
  };
}

function buildApprovalDecisionRequirement(approvalRequest: {
  _id: Id<"approvalRequest">;
  requestType: string;
  workItemTitle?: string | null;
}) {
  return {
    action: {
      key: APPROVAL_DECISION_ACTION_KEY,
      label: "Resolve approval request",
    },
    subject: buildApprovalDecisionSubject(approvalRequest),
    requiredRole: "manager" as const,
    reason: "Resolve pending approval request.",
    copy: {
      title: "Unlock approval decisions",
      message:
        "Use manager credentials before approving or rejecting requests.",
      primaryActionLabel: "Unlock approvals",
      secondaryActionLabel: "Cancel",
    },
    resolutionModes: [{ kind: "inline_manager_proof" as const }],
  };
}

async function consumeApprovalDecisionProofWithCtx(
  ctx: MutationCtx,
  args: {
    approvalProofId: Id<"approvalProof">;
    approvalRequest: {
      _id: Id<"approvalRequest">;
      requestType: string;
      storeId: Id<"store">;
      workItemTitle?: string | null;
    };
  },
) {
  const result = await consumeApprovalProofWithCtx(ctx, {
    actionKey: APPROVAL_DECISION_ACTION_KEY,
    approvalProofId: args.approvalProofId,
    requiredRole: "manager",
    storeId: args.approvalRequest.storeId,
    subject: buildApprovalDecisionSubject(args.approvalRequest),
  });

  if (result.kind !== "ok") {
    throw new Error(result.error.message);
  }

  return result.data;
}

function shouldRetireItemAdjustmentApprovalAfterApplyFailure(error: unknown) {
  const message = error instanceof Error ? error.message : "";

  return ITEM_ADJUSTMENT_RETIRED_PRECONDITION_MESSAGES.has(message);
}

function unsupportedApprovalDecisionMessage(requestType: string) {
  if (requestType === SERVICE_DEPOSIT_REVIEW_REQUEST_TYPE) {
    return "Service deposit approval reviews can only be retired.";
  }

  if (requestType === "online_order_return_review") {
    return "Online return approval reviews are not supported yet.";
  }

  if (requestType === "pos_item_adjustment_review") {
    return "Legacy item adjustment approval reviews can only be retired.";
  }

  return null;
}

function assertApprovalDecisionCanApply(args: {
  decision: DecideApprovalRequestArgs["decision"];
  requestType: string;
}) {
  if (
    args.decision === "approved" &&
    APPROVAL_APPLY_UNSUPPORTED_REQUEST_TYPES.has(args.requestType)
  ) {
    throw new Error(
      unsupportedApprovalDecisionMessage(args.requestType) ??
        "Approval reviews of this type are not supported yet.",
    );
  }
}

async function retireLinkedUnsupportedApprovalWorkItemWithCtx(
  ctx: MutationCtx,
  args: {
    approvalRequest: {
      _id: Id<"approvalRequest">;
      organizationId?: Id<"organization">;
      requestType: string;
      storeId: Id<"store">;
      workItemId?: Id<"operationalWorkItem">;
    };
    decision: Exclude<DecideApprovalRequestArgs["decision"], "approved">;
  },
) {
  if (!APPROVAL_APPLY_UNSUPPORTED_REQUEST_TYPES.has(args.approvalRequest.requestType)) {
    return;
  }

  if (!args.approvalRequest.workItemId) {
    return;
  }

  const workItem = await ctx.db.get(
    "operationalWorkItem",
    args.approvalRequest.workItemId,
  );
  if (!workItem) {
    return;
  }

  if (
    workItem.storeId !== args.approvalRequest.storeId ||
    workItem.organizationId !== args.approvalRequest.organizationId ||
    workItem.approvalRequestId !== args.approvalRequest._id ||
    TERMINAL_WORK_ITEM_STATUSES.has(workItem.status)
  ) {
    return;
  }

  await ctx.db.patch("operationalWorkItem", workItem._id, {
    approvalState: args.decision,
    ...(workItem.type === SERVICE_DEPOSIT_REVIEW_REQUEST_TYPE
      ? { status: "cancelled" }
      : {}),
  });
}

async function retireItemAdjustmentApprovalAfterApplyFailure(
  ctx: MutationCtx,
  args: {
    approvalRequestId: Id<"approvalRequest">;
    error: unknown;
    decisionApprovedByStaffProfileId?: Id<"staffProfile">;
    decisionApprovalProofId?: Id<"approvalProof">;
    reviewedByStaffProfileId?: Id<"staffProfile">;
    reviewedByUserId?: Id<"athenaUser">;
  },
) {
  const approvalRequest = await ctx.db.get(
    "approvalRequest",
    args.approvalRequestId,
  );

  if (
    !approvalRequest ||
    approvalRequest.status !== "pending" ||
    approvalRequest.requestType !== ITEM_ADJUSTMENT_REQUEST_TYPE ||
    approvalRequest.subjectType !== ITEM_ADJUSTMENT_SUBJECT_TYPE
  ) {
    return;
  }

  const message = args.error instanceof Error ? args.error.message : "";
  const failedAt = Date.now();

  await ctx.db.patch("approvalRequest", args.approvalRequestId, {
    decidedAt: failedAt,
    decisionNotes: message,
    decisionApprovedByStaffProfileId: args.decisionApprovedByStaffProfileId,
    decisionApprovalProofId: args.decisionApprovalProofId,
    failedAt,
    failureCode: "decision_apply_failed",
    failureMessage: message,
    freshApprovalRequired: true,
    metadata: {
      ...(approvalRequest.metadata ?? {}),
      applyFailureMessage: message,
    },
    reviewedByStaffProfileId: args.reviewedByStaffProfileId,
    reviewedByUserId: args.reviewedByUserId,
    status: "cancelled",
  });
}

export async function decideApprovalRequestWithCtx(
  ctx: MutationCtx,
  args: DecideApprovalRequestArgs,
) {
  const approvalRequest = await ctx.db.get(
    "approvalRequest",
    args.approvalRequestId,
  );

  if (!approvalRequest) {
    throw new Error("Approval request not found.");
  }

  if (approvalRequest.status !== "pending") {
    throw new Error("Approval request has already been decided.");
  }

  if (!approvalRequest.organizationId || !args.reviewedByUserId) {
    throw new Error(
      "A full-admin reviewer is required to resolve approval requests.",
    );
  }

  const reviewerMembership = await ctx.db
    .query("organizationMember")
    .filter((q) =>
      q.and(
        q.eq(q.field("organizationId"), approvalRequest.organizationId),
        q.eq(q.field("userId"), args.reviewedByUserId),
      ),
    )
    .first();

  if (reviewerMembership?.role !== "full_admin") {
    throw new Error("Only full admins can resolve approval requests.");
  }

  assertApprovalDecisionCanApply({
    decision: args.decision,
    requestType: approvalRequest.requestType,
  });

  if (
    approvalRequest.requestType === "inventory_adjustment_review" &&
    approvalRequest.subjectType === "stock_adjustment_batch"
  ) {
    await resolveStockAdjustmentApprovalDecisionWithCtx(ctx, args);
  }

  if (
    approvalRequest.requestType === "payment_method_correction" &&
    approvalRequest.subjectType === "pos_transaction"
  ) {
    await resolvePaymentMethodCorrectionApprovalDecisionWithCtx(ctx, args);
  }

  if (
    approvalRequest.requestType === ITEM_ADJUSTMENT_REQUEST_TYPE &&
    approvalRequest.subjectType === ITEM_ADJUSTMENT_SUBJECT_TYPE
  ) {
    try {
      await resolveTransactionItemAdjustmentApprovalDecisionWithCtx(ctx, args);
    } catch (error) {
      if (
        args.decision === "approved" &&
        shouldRetireItemAdjustmentApprovalAfterApplyFailure(error)
      ) {
        await retireItemAdjustmentApprovalAfterApplyFailure(ctx, {
          approvalRequestId: args.approvalRequestId,
          decisionApprovedByStaffProfileId:
            args.decisionApprovedByStaffProfileId,
          decisionApprovalProofId: args.decisionApprovalProofId,
          error,
          reviewedByStaffProfileId: args.reviewedByStaffProfileId,
          reviewedByUserId: args.reviewedByUserId,
        });
      }

      throw error;
    }
  }

  if (
    approvalRequest.requestType === "pos_transaction_void" &&
    approvalRequest.subjectType === "pos_transaction"
  ) {
    await resolveTransactionVoidApprovalDecisionWithCtx(ctx, args);
  }

  const decisionNotes =
    args.decisionNotes ??
    (approvalRequest.requestType === "pos_transaction_void"
      ? approvalRequest.notes ?? approvalRequest.reason
      : undefined);

  if (args.decision !== "approved") {
    await retireLinkedUnsupportedApprovalWorkItemWithCtx(ctx, {
      approvalRequest,
      decision: args.decision,
    });
  }

  await ctx.db.patch("approvalRequest", args.approvalRequestId, {
    status: args.decision,
    decisionApprovedByStaffProfileId: args.decisionApprovedByStaffProfileId,
    decisionApprovalProofId: args.decisionApprovalProofId,
    reviewedByUserId: args.reviewedByUserId,
    reviewedByStaffProfileId: args.reviewedByStaffProfileId,
    ...omitUndefined({
      decisionNotes,
    }),
    decidedAt: Date.now(),
  });

  return ctx.db.get("approvalRequest", args.approvalRequestId);
}

export async function decideApprovalRequestAsAuthenticatedUserWithCtx(
  ctx: MutationCtx,
  args: PublicDecideApprovalRequestArgs,
) {
  const approvalRequest = await ctx.db.get(
    "approvalRequest",
    args.approvalRequestId,
  );

  if (!approvalRequest) {
    throw new Error("Approval request not found.");
  }

  if (!approvalRequest.organizationId) {
    throw new Error(
      "A full-admin reviewer is required to resolve approval requests.",
    );
  }

  if (approvalRequest.status !== "pending") {
    throw new Error("Approval request has already been decided.");
  }

  const reviewer = await requireAuthenticatedAthenaUserWithCtx(ctx);

  await requireOrganizationMemberRoleWithCtx(ctx, {
    allowedRoles: ["full_admin"],
    failureMessage: "Only full admins can resolve approval requests.",
    organizationId: approvalRequest.organizationId,
    userId: reviewer._id,
  });

  assertApprovalDecisionCanApply({
    decision: args.decision,
    requestType: approvalRequest.requestType,
  });

  if (!args.approvalProofId) {
    throw new Error(
      "Manager approval is required to resolve approval requests.",
    );
  }

  const approvalProof = await consumeApprovalDecisionProofWithCtx(ctx, {
    approvalProofId: args.approvalProofId,
    approvalRequest,
  });

  return decideApprovalRequestWithCtx(ctx, {
    ...args,
    approvalProofId: args.approvalProofId,
    decisionApprovedByStaffProfileId: approvalProof.approvedByStaffProfileId,
    decisionApprovalProofId: args.approvalProofId,
    reviewedByStaffProfileId: approvalProof.approvedByStaffProfileId,
    reviewedByUserId: reviewer._id,
  });
}

function mapDecideApprovalRequestError(
  error: unknown,
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
    message ===
      "A full-admin reviewer is required to resolve approval requests."
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
    message === "Stock adjustment batch not found for this approval request." ||
    message === "Payment method approval request not found." ||
    message === "Item adjustment approval request not found." ||
    message === "Void approval request not found." ||
    message === "Transaction not found."
  ) {
    return userError({
      code: "not_found",
      message,
    });
  }

  if (
    message === "Approval request has already been decided." ||
    message === "Service deposit approval reviews can only be retired." ||
    message === "Online return approval reviews are not supported yet." ||
    message === "Legacy item adjustment approval reviews can only be retired." ||
    message === "Approval proof was not found." ||
    message === "Approval proof does not match this command." ||
    message === "Approval proof has already been used." ||
    message === "Approval proof requester does not match this command." ||
    message === "Approval proof has expired." ||
    message === "Stock adjustment batch has already been resolved." ||
    message ===
      "Payment method approval request is missing correction details." ||
    message === "Payment method approval request does not match this store." ||
    message === "Item adjustment approval request is missing adjustment details." ||
    message === "Item adjustment approval request does not match this store." ||
    message === "Item adjustment approval request does not match this payload." ||
    message === "Item adjustment payload is stale for this transaction." ||
    message === "Item adjustment cannot reduce inventory below zero." ||
    message === "Void approval request has already been decided." ||
    message === "Void approval request does not match this sale." ||
    message === "Void approval request is missing transaction details." ||
    message === "Manager approval is required to void a completed sale." ||
    message === "Reason is required to void a completed sale." ||
    message === "Sale is already voided." ||
    message === "Sale is already refunded." ||
    message === "Only completed sales can be voided." ||
    message ===
      "This sale has item adjustments. Resolve the adjustment before voiding it." ||
    message ===
      "EOD Review is completed for this sale. Reopen EOD Review before voiding it." ||
    message === "Register sale is missing drawer context." ||
    message === "Drawer closed. Open the drawer before voiding this sale." ||
    message ===
      "Sale item inventory record not found. Review inventory before voiding this sale." ||
    message ===
      "This transaction already has an item adjustment waiting for approval." ||
    message === "Register session expected cash cannot be negative." ||
    message === "Only single-payment transactions can be corrected." ||
    message === "Only same-amount payment method corrections are supported." ||
    message === "Payment allocation must be a same-amount single payment."
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
  args: PublicDecideApprovalRequestArgs,
): Promise<ApprovalCommandResult<any>> {
  try {
    return ok(await decideApprovalRequestAsAuthenticatedUserWithCtx(ctx, args));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";

    if (
      message === "Manager approval is required to resolve approval requests."
    ) {
      const approvalRequest = await ctx.db.get(
        "approvalRequest",
        args.approvalRequestId,
      );

      if (approvalRequest) {
        return approvalRequired(
          buildApprovalDecisionRequirement(approvalRequest),
        );
      }
    }

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
    const requestId = await ctx.db.insert(
      "approvalRequest",
      buildApprovalRequest(args),
    );
    return ctx.db.get("approvalRequest", requestId);
  },
});

const decideApprovalRequestArgs = {
  approvalRequestId: v.id("approvalRequest"),
  approvalProofId: v.optional(v.id("approvalProof")),
  decision: v.union(
    v.literal("approved"),
    v.literal("rejected"),
    v.literal("cancelled"),
  ),
  decisionNotes: v.optional(v.string()),
};

const decideApprovalRequestInternalArgs = {
  ...decideApprovalRequestArgs,
  decisionApprovedByStaffProfileId: v.optional(v.id("staffProfile")),
  decisionApprovalProofId: v.optional(v.id("approvalProof")),
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
