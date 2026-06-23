import { v } from "convex/values";

export const automationPolicyModeValidator = v.union(
  v.literal("disabled"),
  v.literal("dry_run"),
  v.literal("enabled"),
);

export const openingAutoStartBlockerHandlingValidator = v.union(
  v.literal("skip"),
  v.literal("manager_review"),
);

export const automationRunOutcomeValidator = v.union(
  v.literal("disabled"),
  v.literal("dry_run"),
  v.literal("skipped"),
  v.literal("prepared"),
  v.literal("eligible"),
  v.literal("applied"),
  v.literal("failed"),
);

export const automationSourceSubjectValidator = v.object({
  type: v.string(),
  id: v.string(),
  label: v.optional(v.string()),
});

const automationDecisionEvidenceValueValidator = v.union(
  v.string(),
  v.number(),
  v.boolean(),
  v.array(v.string()),
  v.null(),
);

export const automationDecisionEvidenceValidator = v.object({
  kind: v.string(),
  classification: v.optional(v.string()),
  eligible: v.optional(v.boolean()),
  observed: v.optional(
    v.record(v.string(), automationDecisionEvidenceValueValidator),
  ),
  policy: v.optional(
    v.record(v.string(), automationDecisionEvidenceValueValidator),
  ),
  gates: v.optional(
    v.array(
      v.object({
        key: v.string(),
        passed: v.boolean(),
        reason: v.optional(v.string()),
      }),
    ),
  ),
});

export const automationPolicySchema = v.object({
  storeId: v.id("store"),
  organizationId: v.optional(v.id("organization")),
  domain: v.string(),
  action: v.string(),
  mode: automationPolicyModeValidator,
  operatingTimezoneOffsetMinutes: v.optional(v.number()),
  openingLocalStartMinutes: v.optional(v.number()),
  openingBlockerHandling: v.optional(openingAutoStartBlockerHandlingValidator),
  eodCleanDayAutoCompleteEnabled: v.optional(v.boolean()),
  eodLocalCompletionWindowMinutes: v.optional(v.number()),
  eodMaxAbsoluteCashVariance: v.optional(v.number()),
  eodMaxVoidedSaleCount: v.optional(v.number()),
  eodMaxVoidedSaleTotal: v.optional(v.number()),
  paused: v.optional(v.boolean()),
  policyVersion: v.string(),
  rolloutNotes: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
  updatedByUserId: v.optional(v.id("athenaUser")),
});

export const automationRunSchema = v.object({
  storeId: v.id("store"),
  organizationId: v.optional(v.id("organization")),
  operatingDate: v.string(),
  domain: v.string(),
  action: v.string(),
  triggerType: v.string(),
  idempotencyKey: v.string(),
  outcome: automationRunOutcomeValidator,
  policyMode: automationPolicyModeValidator,
  policyVersion: v.string(),
  mutationBoundary: v.string(),
  sourceSubjects: v.array(automationSourceSubjectValidator),
  snapshotCounts: v.record(v.string(), v.number()),
  decisionReason: v.optional(v.string()),
  decisionEvidence: v.optional(automationDecisionEvidenceValidator),
  eventIds: v.array(v.id("operationalEvent")),
  error: v.optional(
    v.object({
      code: v.string(),
      message: v.string(),
    }),
  ),
  createdAt: v.number(),
  updatedAt: v.number(),
  appliedAt: v.optional(v.number()),
});

export const scheduledRunLedgerOutcomeValidator = v.union(
  v.literal("applied"),
  v.literal("no_candidates"),
  v.literal("partial_failure"),
  v.literal("failed"),
  v.literal("support_only"),
);

export const scheduledRunLedgerSchema = v.object({
  runKey: v.string(),
  cronFamily: v.string(),
  scheduledWindowStartAt: v.number(),
  scheduledWindowEndAt: v.number(),
  scope: v.union(v.literal("store"), v.literal("system")),
  visibility: v.union(v.literal("store"), v.literal("support")),
  storeId: v.optional(v.id("store")),
  organizationId: v.optional(v.id("organization")),
  actorType: v.literal("system"),
  outcome: scheduledRunLedgerOutcomeValidator,
  candidateCount: v.number(),
  processedCount: v.number(),
  succeededCount: v.number(),
  failedCount: v.number(),
  skippedCount: v.number(),
  sourceSubjectType: v.string(),
  sampleSubjectIds: v.array(v.string()),
  snapshotCounts: v.record(v.string(), v.number()),
  notes: v.optional(v.string()),
  error: v.optional(
    v.object({
      code: v.string(),
      message: v.string(),
    }),
  ),
  createdAt: v.number(),
  updatedAt: v.number(),
  completedAt: v.number(),
});
