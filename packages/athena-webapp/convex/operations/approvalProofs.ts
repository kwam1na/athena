import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { ApprovalSubjectIdentity } from "../../shared/approvalPolicy";
import { ok, userError, type CommandResult } from "../../shared/commandResult";
import { operationalRoleValidator, type OperationalRole } from "./staffRoles";
import {
  recordApprovalProofConsumedAuditEventWithCtx,
  recordManagerApprovalGrantedAuditEventWithCtx,
} from "./approvalAuditEvents";

export const APPROVAL_PROOF_TTL_MS = 5 * 60 * 1000;

type ApprovalProofId = Id<"approvalProof">;

type ApprovalProofResult = {
  approvalProofId: ApprovalProofId;
  approvedByStaffProfileId: Id<"staffProfile">;
  expiresAt: number;
  requestedByStaffProfileId?: Id<"staffProfile">;
};

type ConsumedApprovalProofResult = ApprovalProofResult & {
  consumedAt: number;
};

type CreateApprovalProofArgs = {
  actionKey: string;
  approvedByCredentialId: Id<"staffCredential">;
  approvedByStaffProfileId: Id<"staffProfile">;
  organizationId?: Id<"organization">;
  reason?: string;
  requiredRole: OperationalRole;
  requestedByStaffProfileId?: Id<"staffProfile">;
  storeId: Id<"store">;
  subject: ApprovalSubjectIdentity;
  ttlMs?: number;
};

type ConsumeApprovalProofArgs = {
  actionKey: string;
  approvalProofId: ApprovalProofId;
  requiredRole: OperationalRole;
  requestedByStaffProfileId?: Id<"staffProfile">;
  storeId: Id<"store">;
  subject: ApprovalSubjectIdentity;
};

function invalidApprovalProofResult(message: string) {
  return userError({
    code: "precondition_failed",
    message,
  });
}

export async function createApprovalProofWithCtx(
  ctx: MutationCtx,
  args: CreateApprovalProofArgs,
): Promise<CommandResult<ApprovalProofResult>> {
  const now = Date.now();
  const expiresAt = now + (args.ttlMs ?? APPROVAL_PROOF_TTL_MS);
  const approvalProofId = await ctx.db.insert("approvalProof", {
    storeId: args.storeId,
    organizationId: args.organizationId,
    actionKey: args.actionKey,
    subjectType: args.subject.type,
    subjectId: args.subject.id,
    subjectLabel: args.subject.label,
    requiredRole: args.requiredRole,
    requestedByStaffProfileId: args.requestedByStaffProfileId,
    approvedByStaffProfileId: args.approvedByStaffProfileId,
    approvedByCredentialId: args.approvedByCredentialId,
    reason: args.reason,
    createdAt: now,
    expiresAt,
  });

  await recordManagerApprovalGrantedAuditEventWithCtx(ctx, {
    actionKey: args.actionKey,
    approvalProofId: String(approvalProofId),
    approvedByStaffProfileId: args.approvedByStaffProfileId,
    organizationId: args.organizationId,
    reason: args.reason,
    requestedByStaffProfileId: args.requestedByStaffProfileId,
    requiredRole: args.requiredRole,
    storeId: args.storeId,
    subject: args.subject,
  });

  return ok({
    approvalProofId,
    approvedByStaffProfileId: args.approvedByStaffProfileId,
    expiresAt,
    requestedByStaffProfileId: args.requestedByStaffProfileId,
  });
}

export async function consumeApprovalProofWithCtx(
  ctx: MutationCtx,
  args: ConsumeApprovalProofArgs,
): Promise<CommandResult<ConsumedApprovalProofResult>> {
  const proof = await ctx.db.get("approvalProof", args.approvalProofId);

  if (!proof) {
    return invalidApprovalProofResult("Approval proof was not found.");
  }

  if (
    proof.storeId !== args.storeId ||
    proof.actionKey !== args.actionKey ||
    proof.subjectType !== args.subject.type ||
    proof.subjectId !== args.subject.id ||
    proof.requiredRole !== args.requiredRole
  ) {
    return invalidApprovalProofResult(
      "Approval proof does not match this command.",
    );
  }

  if (proof.consumedAt !== undefined) {
    return invalidApprovalProofResult("Approval proof has already been used.");
  }

  if (proof.requestedByStaffProfileId !== args.requestedByStaffProfileId) {
    return invalidApprovalProofResult(
      "Approval proof requester does not match this command.",
    );
  }

  const now = Date.now();

  if (proof.expiresAt <= now) {
    return invalidApprovalProofResult("Approval proof has expired.");
  }

  await ctx.db.patch("approvalProof", args.approvalProofId, {
    consumedAt: now,
  });

  await recordApprovalProofConsumedAuditEventWithCtx(ctx, {
    actionKey: args.actionKey,
    approvalProofId: String(args.approvalProofId),
    approvedByStaffProfileId: proof.approvedByStaffProfileId,
    organizationId: proof.organizationId,
    reason: proof.reason,
    requestedByStaffProfileId: proof.requestedByStaffProfileId,
    requiredRole: args.requiredRole,
    storeId: args.storeId,
    subject: args.subject,
  });

  return ok({
    approvalProofId: args.approvalProofId,
    approvedByStaffProfileId: proof.approvedByStaffProfileId,
    consumedAt: now,
    expiresAt: proof.expiresAt,
    requestedByStaffProfileId: proof.requestedByStaffProfileId,
  });
}

export const approvalProofSubjectArgValidator = v.object({
  type: v.string(),
  id: v.string(),
  label: v.optional(v.string()),
});

export const consumeApprovalProofArgsValidator = {
  actionKey: v.string(),
  approvalProofId: v.id("approvalProof"),
  requiredRole: operationalRoleValidator,
  requestedByStaffProfileId: v.optional(v.id("staffProfile")),
  storeId: v.id("store"),
  subject: approvalProofSubjectArgValidator,
};
