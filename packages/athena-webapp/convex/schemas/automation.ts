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

export const automationPolicySchema = v.object({
  storeId: v.id("store"),
  organizationId: v.optional(v.id("organization")),
  domain: v.string(),
  action: v.string(),
  mode: automationPolicyModeValidator,
  operatingTimezoneOffsetMinutes: v.optional(v.number()),
  openingLocalStartMinutes: v.optional(v.number()),
  openingBlockerHandling: v.optional(openingAutoStartBlockerHandlingValidator),
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
