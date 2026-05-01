import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { ApprovalSubjectIdentity } from "../../shared/approvalPolicy";
import { recordOperationalEventWithCtx } from "./operationalEvents";

export type ApprovalAuditEventType =
  | "approval.required"
  | "approval.manager_granted"
  | "approval.proof_consumed"
  | "approval.async_request_created"
  | "approval.decision_recorded"
  | "approval.approved_command_applied";

type ApprovalAuditEventArgs = {
  actionKey: string;
  approvalProofId?: string;
  approvalRequestId?: Id<"approvalRequest">;
  approvedByStaffProfileId?: Id<"staffProfile">;
  eventType: ApprovalAuditEventType;
  message?: string;
  metadata?: Record<string, unknown>;
  organizationId?: Id<"organization">;
  reason?: string;
  requestedByStaffProfileId?: Id<"staffProfile">;
  requiredRole?: string;
  storeId: Id<"store">;
  subject: ApprovalSubjectIdentity;
};

export async function recordApprovalAuditEventWithCtx(
  ctx: MutationCtx,
  args: ApprovalAuditEventArgs,
) {
  try {
    return await recordOperationalEventWithCtx(ctx, {
      storeId: args.storeId,
      organizationId: args.organizationId,
      eventType: args.eventType,
      subjectType: args.subject.type,
      subjectId: args.subject.id,
      subjectLabel: args.subject.label,
      message: args.message,
      reason: args.reason,
      actorStaffProfileId:
        args.approvedByStaffProfileId ?? args.requestedByStaffProfileId,
      approvalRequestId: args.approvalRequestId,
      metadata: {
        ...(args.metadata ?? {}),
        actionKey: args.actionKey,
        ...(args.approvalProofId
          ? { approvalProofId: args.approvalProofId }
          : {}),
        ...(args.approvedByStaffProfileId
          ? { approvedByStaffProfileId: String(args.approvedByStaffProfileId) }
          : {}),
        ...(args.requestedByStaffProfileId
          ? { requestedByStaffProfileId: String(args.requestedByStaffProfileId) }
          : {}),
        ...(args.requiredRole ? { requiredRole: args.requiredRole } : {}),
      },
    });
  } catch {
    return null;
  }
}

export function recordApprovalRequiredAuditEventWithCtx(
  ctx: MutationCtx,
  args: Omit<ApprovalAuditEventArgs, "eventType">,
) {
  return recordApprovalAuditEventWithCtx(ctx, {
    ...args,
    eventType: "approval.required",
  });
}

export function recordManagerApprovalGrantedAuditEventWithCtx(
  ctx: MutationCtx,
  args: Omit<ApprovalAuditEventArgs, "eventType">,
) {
  return recordApprovalAuditEventWithCtx(ctx, {
    ...args,
    eventType: "approval.manager_granted",
  });
}

export function recordApprovalProofConsumedAuditEventWithCtx(
  ctx: MutationCtx,
  args: Omit<ApprovalAuditEventArgs, "eventType">,
) {
  return recordApprovalAuditEventWithCtx(ctx, {
    ...args,
    eventType: "approval.proof_consumed",
  });
}

export function recordAsyncApprovalRequestCreatedAuditEventWithCtx(
  ctx: MutationCtx,
  args: Omit<ApprovalAuditEventArgs, "eventType">,
) {
  return recordApprovalAuditEventWithCtx(ctx, {
    ...args,
    eventType: "approval.async_request_created",
  });
}

export function recordApprovalDecisionRecordedAuditEventWithCtx(
  ctx: MutationCtx,
  args: Omit<ApprovalAuditEventArgs, "eventType">,
) {
  return recordApprovalAuditEventWithCtx(ctx, {
    ...args,
    eventType: "approval.decision_recorded",
  });
}

export function recordApprovedCommandAppliedAuditEventWithCtx(
  ctx: MutationCtx,
  args: Omit<ApprovalAuditEventArgs, "eventType">,
) {
  return recordApprovalAuditEventWithCtx(ctx, {
    ...args,
    eventType: "approval.approved_command_applied",
  });
}
