import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type {
  ApprovalRequesterBinding,
  ApprovalSubjectIdentity,
} from "../../shared/approvalPolicy";
import { ok, userError, type CommandResult } from "../../shared/commandResult";
import { operationalRoleValidator, type OperationalRole } from "./staffRoles";

export const APPROVAL_REQUESTER_CHALLENGE_TTL_MS = 5 * 60 * 1000;

type ApprovalRequesterChallengeId = Id<"approvalRequesterChallenge">;

type CreateApprovalRequesterChallengeArgs = {
  actionKey: string;
  organizationId?: Id<"organization">;
  requestedByStaffProfileId: Id<"staffProfile">;
  requiredRole: OperationalRole;
  storeId: Id<"store">;
  subject: ApprovalSubjectIdentity;
  ttlMs?: number;
};

type ConsumeApprovalRequesterChallengeArgs = {
  actionKey: string;
  binding: {
    challengeId: ApprovalRequesterChallengeId;
    kind: "operational_staff_challenge";
    requestedByStaffProfileId: Id<"staffProfile">;
  };
  requiredRole: OperationalRole;
  storeId: Id<"store">;
  subject: ApprovalSubjectIdentity;
};

function invalidApprovalRequesterChallengeResult(message: string) {
  return userError({
    code: "precondition_failed",
    message,
  });
}

function toRequesterBinding(
  challengeId: ApprovalRequesterChallengeId,
  requestedByStaffProfileId: Id<"staffProfile">,
): ApprovalRequesterBinding {
  return {
    kind: "operational_staff_challenge",
    challengeId: String(challengeId),
    requestedByStaffProfileId: String(requestedByStaffProfileId),
  };
}

export async function createApprovalRequesterChallengeWithCtx(
  ctx: MutationCtx,
  args: CreateApprovalRequesterChallengeArgs,
): Promise<CommandResult<{ requesterBinding: ApprovalRequesterBinding }>> {
  const staffProfile = await ctx.db.get(
    "staffProfile",
    args.requestedByStaffProfileId,
  );

  if (
    !staffProfile ||
    staffProfile.storeId !== args.storeId ||
    staffProfile.status !== "active"
  ) {
    return userError({
      code: "authorization_failed",
      message: "Requested staff profile is not valid for this approval.",
    });
  }

  const now = Date.now();
  const challengeId = await ctx.db.insert("approvalRequesterChallenge", {
    storeId: args.storeId,
    organizationId: args.organizationId,
    actionKey: args.actionKey,
    subjectType: args.subject.type,
    subjectId: args.subject.id,
    subjectLabel: args.subject.label,
    requiredRole: args.requiredRole,
    requestedByStaffProfileId: args.requestedByStaffProfileId,
    createdAt: now,
    expiresAt: now + (args.ttlMs ?? APPROVAL_REQUESTER_CHALLENGE_TTL_MS),
  });

  return ok({
    requesterBinding: toRequesterBinding(
      challengeId,
      args.requestedByStaffProfileId,
    ),
  });
}

export async function consumeApprovalRequesterChallengeWithCtx(
  ctx: MutationCtx,
  args: ConsumeApprovalRequesterChallengeArgs,
): Promise<CommandResult<{ requestedByStaffProfileId: Id<"staffProfile"> }>> {
  const challenge = await ctx.db.get(
    "approvalRequesterChallenge",
    args.binding.challengeId,
  );

  if (!challenge) {
    return invalidApprovalRequesterChallengeResult(
      "Approval requester challenge was not found.",
    );
  }

  if (
    challenge.storeId !== args.storeId ||
    challenge.actionKey !== args.actionKey ||
    challenge.subjectType !== args.subject.type ||
    challenge.subjectId !== args.subject.id ||
    challenge.requiredRole !== args.requiredRole ||
    challenge.requestedByStaffProfileId !== args.binding.requestedByStaffProfileId
  ) {
    return invalidApprovalRequesterChallengeResult(
      "Approval requester challenge does not match this approval.",
    );
  }

  if (challenge.consumedAt !== undefined) {
    return invalidApprovalRequesterChallengeResult(
      "Approval requester challenge has already been used.",
    );
  }

  const now = Date.now();

  if (challenge.expiresAt <= now) {
    return invalidApprovalRequesterChallengeResult(
      "Approval requester challenge has expired.",
    );
  }

  const staffProfile = await ctx.db.get(
    "staffProfile",
    challenge.requestedByStaffProfileId,
  );
  if (
    !staffProfile ||
    staffProfile.storeId !== args.storeId ||
    staffProfile.status !== "active"
  ) {
    return userError({
      code: "authorization_failed",
      message: "Requested staff profile is not valid for this approval.",
    });
  }

  await ctx.db.patch("approvalRequesterChallenge", challenge._id, {
    consumedAt: now,
  });

  return ok({
    requestedByStaffProfileId: challenge.requestedByStaffProfileId,
  });
}

export const approvalRequesterBindingArgValidator = v.object({
  kind: v.literal("operational_staff_challenge"),
  challengeId: v.id("approvalRequesterChallenge"),
  requestedByStaffProfileId: v.id("staffProfile"),
});

export const approvalRequesterChallengeArgsValidator = {
  actionKey: v.string(),
  requestedByStaffProfileId: v.id("staffProfile"),
  requiredRole: operationalRoleValidator,
  storeId: v.id("store"),
  subject: v.object({
    type: v.string(),
    id: v.string(),
    label: v.optional(v.string()),
  }),
};
