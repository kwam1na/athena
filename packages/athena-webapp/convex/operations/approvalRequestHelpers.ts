import { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { emitNotificationWithCtx } from "../notifications/emit";

export type ApprovalRequestInput = {
  storeId: Id<"store">;
  organizationId?: Id<"organization">;
  requestType: string;
  subjectType: string;
  subjectId: string;
  requestedByUserId?: Id<"athenaUser">;
  requestedByStaffProfileId?: Id<"staffProfile">;
  workItemId?: Id<"operationalWorkItem">;
  registerSessionId?: Id<"registerSession">;
  posTransactionId?: Id<"posTransaction">;
  reason?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
};

export function buildApprovalRequest(args: ApprovalRequestInput) {
  return {
    ...args,
    status: "pending" as const,
    createdAt: Date.now(),
  };
}

// Request types whose "a request was created" communication is owned by a
// different notification lane. variance_review belongs to
// register.closeout_variance (the POS sync closeout lane, PR #710) — emitting
// approvals.request_created for it here would double-notify admins.
const REQUEST_TYPES_WITHOUT_CREATED_NOTIFICATION = new Set(["variance_review"]);

// The one choke point for creating approval requests. Inserts the pending
// request and — inside the same transaction — emits the idempotent
// approvals.request_created intent, unless the request type is carved out
// above. Do not call ctx.db.insert("approvalRequest", ...) anywhere else.
export async function insertApprovalRequestWithCtx(
  ctx: MutationCtx,
  args: ApprovalRequestInput,
): Promise<Id<"approvalRequest">> {
  const approvalRequestId = await ctx.db.insert(
    "approvalRequest",
    buildApprovalRequest(args),
  );

  if (!REQUEST_TYPES_WITHOUT_CREATED_NOTIFICATION.has(args.requestType)) {
    await emitNotificationWithCtx(ctx, {
      kind: "approvals.request_created",
      storeId: args.storeId,
      organizationId: args.organizationId,
      subjectType: "approvalRequest",
      subjectId: String(approvalRequestId),
      // Refs only — never rendered content.
      payload: {
        approvalRequestId,
        storeId: args.storeId,
        requestType: args.requestType,
      },
    });
  }

  return approvalRequestId;
}
