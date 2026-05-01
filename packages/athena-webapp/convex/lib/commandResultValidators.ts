import { v } from "convex/values";

export const userErrorValidator = v.object({
  code: v.union(
    v.literal("validation_failed"),
    v.literal("authentication_failed"),
    v.literal("authorization_failed"),
    v.literal("not_found"),
    v.literal("conflict"),
    v.literal("precondition_failed"),
    v.literal("rate_limited"),
    v.literal("unavailable"),
  ),
  title: v.optional(v.string()),
  message: v.string(),
  fields: v.optional(v.record(v.string(), v.array(v.string()))),
  retryable: v.optional(v.boolean()),
  traceId: v.optional(v.string()),
  metadata: v.optional(v.record(v.string(), v.any())),
});

export const approvalRoleValidator = v.union(
  v.literal("manager"),
  v.literal("front_desk"),
  v.literal("stylist"),
  v.literal("technician"),
  v.literal("cashier"),
);

export const approvalActionIdentityValidator = v.object({
  key: v.string(),
  label: v.optional(v.string()),
});

export const approvalSubjectIdentityValidator = v.object({
  type: v.string(),
  id: v.string(),
  label: v.optional(v.string()),
});

export const approvalOperatorCopyValidator = v.object({
  title: v.string(),
  message: v.string(),
  primaryActionLabel: v.optional(v.string()),
  secondaryActionLabel: v.optional(v.string()),
});

export const approvalResolutionModeValidator = v.union(
  v.object({
    kind: v.literal("inline_manager_proof"),
    proofTtlMs: v.optional(v.number()),
  }),
  v.object({
    kind: v.literal("async_request"),
    requestType: v.string(),
    approvalRequestId: v.optional(v.string()),
  }),
);

export const approvalRequirementValidator = v.object({
  action: approvalActionIdentityValidator,
  subject: approvalSubjectIdentityValidator,
  requiredRole: approvalRoleValidator,
  reason: v.string(),
  copy: approvalOperatorCopyValidator,
  resolutionModes: v.array(approvalResolutionModeValidator),
  selfApproval: v.optional(
    v.union(v.literal("allowed"), v.literal("disallowed")),
  ),
  metadata: v.optional(v.record(v.string(), v.any())),
});

export function commandResultValidator(dataValidator: any) {
  return v.union(
    v.object({
      kind: v.literal("ok"),
      data: dataValidator,
    }),
    v.object({
      kind: v.literal("user_error"),
      error: userErrorValidator,
    }),
    v.object({
      kind: v.literal("approval_required"),
      approval: approvalRequirementValidator,
    }),
  );
}
