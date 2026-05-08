import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type {
  ApprovalActionIdentity,
  ApprovalRequiredRole,
  ApprovalSubjectIdentity,
} from "../../shared/approvalPolicy";
import { consumeApprovalProofWithCtx } from "./approvalProofs";

export const APPROVAL_ACTIONS = {
  registerSessionVarianceReview: {
    key: "cash_controls.register_session.review_variance",
    label: "Review register closeout variance",
  },
  registerSessionOpeningFloatCorrection: {
    key: "cash_controls.register_session.correct_opening_float",
    label: "Correct opening float",
  },
  dailyCloseCompletion: {
    key: "operations.daily_close.complete",
    label: "Complete End-of-Day Review",
  },
  transactionPaymentMethodCorrection: {
    key: "pos.transaction.correct_payment_method",
    label: "Correct payment method",
  },
} as const satisfies Record<string, ApprovalActionIdentity>;

export type ConsumeCommandApprovalProofArgs = {
  action: ApprovalActionIdentity;
  approvalProofId: Id<"approvalProof">;
  requestedByStaffProfileId?: Id<"staffProfile">;
  requiredRole: ApprovalRequiredRole;
  storeId: Id<"store">;
  subject: ApprovalSubjectIdentity;
};

export async function consumeCommandApprovalProofWithCtx(
  ctx: MutationCtx,
  args: ConsumeCommandApprovalProofArgs,
) {
  return consumeApprovalProofWithCtx(ctx, {
    actionKey: args.action.key,
    approvalProofId: args.approvalProofId,
    requestedByStaffProfileId: args.requestedByStaffProfileId,
    requiredRole: args.requiredRole,
    storeId: args.storeId,
    subject: args.subject,
  });
}
