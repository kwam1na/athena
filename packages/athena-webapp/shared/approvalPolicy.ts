export const APPROVAL_REQUIRED_ROLES = [
  "manager",
  "front_desk",
  "stylist",
  "technician",
  "cashier",
] as const;

export type ApprovalRequiredRole = (typeof APPROVAL_REQUIRED_ROLES)[number];

export type ApprovalActionIdentity = {
  key: string;
  label?: string;
};

export type ApprovalSubjectIdentity = {
  type: string;
  id: string;
  label?: string;
};

export type ApprovalOperatorCopy = {
  title: string;
  message: string;
  primaryActionLabel?: string;
  secondaryActionLabel?: string;
};

export type InlineManagerProofResolutionMode = {
  kind: "inline_manager_proof";
  proofTtlMs?: number;
};

export type AsyncApprovalRequestResolutionMode = {
  kind: "async_request";
  requestType: string;
  approvalRequestId?: string;
};

export type ApprovalResolutionMode =
  | InlineManagerProofResolutionMode
  | AsyncApprovalRequestResolutionMode;

export type ApprovalRequirement = {
  action: ApprovalActionIdentity;
  subject: ApprovalSubjectIdentity;
  requiredRole: ApprovalRequiredRole;
  reason: string;
  copy: ApprovalOperatorCopy;
  resolutionModes: ApprovalResolutionMode[];
  selfApproval?: "allowed" | "disallowed";
  metadata?: Record<string, unknown>;
};

export type ApprovalDecision =
  | {
      kind: "allow";
    }
  | {
      kind: "deny" | "unsupported" | "requires_fresh_auth";
      reason: string;
      copy: ApprovalOperatorCopy;
    }
  | {
      kind: "requires_manager_approval" | "requires_async_approval";
      approval: ApprovalRequirement;
    };
