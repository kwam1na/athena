import { v } from "convex/values";

const dailyCloseReadinessStatusValidator = v.union(
  v.literal("blocked"),
  v.literal("needs_review"),
  v.literal("ready"),
);

const dailyCloseSourceSubjectValidator = v.object({
  type: v.string(),
  id: v.string(),
  label: v.optional(v.string()),
});

const dailyCloseSourceCompletenessValidator = v.object({
  complete: v.boolean(),
  entries: v.array(
    v.object({
      source: v.string(),
      complete: v.boolean(),
      readMode: v.string(),
      recordCount: v.number(),
      limit: v.optional(v.number()),
      range: v.optional(
        v.object({
          startAt: v.number(),
          endAt: v.number(),
        }),
      ),
      statuses: v.optional(v.array(v.string())),
      reason: v.optional(v.string()),
    }),
  ),
});

const dailyCloseReportItemValidator = v.object({
  key: v.string(),
  severity: v.union(
    v.literal("blocker"),
    v.literal("review"),
    v.literal("carry_forward"),
    v.literal("ready"),
  ),
  category: v.string(),
  title: v.string(),
  message: v.string(),
  subject: dailyCloseSourceSubjectValidator,
  link: v.optional(
    v.object({
      href: v.optional(v.string()),
      label: v.optional(v.string()),
      params: v.optional(v.record(v.string(), v.string())),
      search: v.optional(v.record(v.string(), v.string())),
      to: v.optional(v.string()),
    }),
  ),
  metadata: v.optional(v.record(v.string(), v.any())),
});

const dailyCloseReportSnapshotValidator = v.object({
  closeMetadata: v.object({
    operatingDate: v.string(),
    storeId: v.id("store"),
    organizationId: v.id("organization"),
    startAt: v.number(),
    endAt: v.number(),
    completedAt: v.number(),
    completedByUserId: v.optional(v.id("athenaUser")),
    completedByStaffProfileId: v.optional(v.id("staffProfile")),
    completionApprovalProofId: v.optional(v.id("approvalProof")),
    completionApprovedByStaffProfileId: v.optional(v.id("staffProfile")),
    completionRequestedByStaffProfileId: v.optional(v.id("staffProfile")),
    completionRequestedByUserId: v.optional(v.id("athenaUser")),
    actorType: v.optional(
      v.union(v.literal("human"), v.literal("automation")),
    ),
    automationRunId: v.optional(v.id("automationRun")),
    automationPolicyVersion: v.optional(v.string()),
    automationDecisionReason: v.optional(v.string()),
    currentnessMode: v.optional(
      v.union(v.literal("mark_current"), v.literal("historical_record")),
    ),
    policyReviewedItemKeys: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
    reviewedItemKeys: v.optional(v.array(v.string())),
    carryForwardWorkItemIds: v.array(v.id("operationalWorkItem")),
  }),
  readiness: v.object({
    status: dailyCloseReadinessStatusValidator,
    blockerCount: v.number(),
    reviewCount: v.number(),
    carryForwardCount: v.number(),
    readyCount: v.number(),
  }),
  summary: v.record(v.string(), v.any()),
  reviewedItems: v.array(dailyCloseReportItemValidator),
  carryForwardItems: v.array(dailyCloseReportItemValidator),
  readyItems: v.array(dailyCloseReportItemValidator),
  sourceCompleteness: v.optional(dailyCloseSourceCompletenessValidator),
  sourceSubjects: v.array(dailyCloseSourceSubjectValidator),
});

export const dailyCloseSchema = v.object({
  storeId: v.id("store"),
  organizationId: v.id("organization"),
  operatingDate: v.string(),
  status: v.union(v.literal("open"), v.literal("completed")),
  lifecycleStatus: v.optional(
    v.union(
      v.literal("active"),
      v.literal("reopened"),
      v.literal("superseded"),
    ),
  ),
  isCurrent: v.boolean(),
  readiness: v.object({
    status: dailyCloseReadinessStatusValidator,
    blockerCount: v.number(),
    reviewCount: v.number(),
    carryForwardCount: v.number(),
    readyCount: v.number(),
  }),
  summary: v.record(v.string(), v.any()),
  sourceCompleteness: v.optional(dailyCloseSourceCompletenessValidator),
  sourceSubjects: v.array(dailyCloseSourceSubjectValidator),
  reportSnapshot: v.optional(dailyCloseReportSnapshotValidator),
  carryForwardWorkItemIds: v.array(v.id("operationalWorkItem")),
  reviewedItemKeys: v.optional(v.array(v.string())),
  notes: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
  completedAt: v.optional(v.number()),
  completedByUserId: v.optional(v.id("athenaUser")),
  completedByStaffProfileId: v.optional(v.id("staffProfile")),
  completionApprovalProofId: v.optional(v.id("approvalProof")),
  completionApprovedByStaffProfileId: v.optional(v.id("staffProfile")),
  completionRequestedByStaffProfileId: v.optional(v.id("staffProfile")),
  completionRequestedByUserId: v.optional(v.id("athenaUser")),
  actorType: v.optional(
    v.union(v.literal("human"), v.literal("automation")),
  ),
  automationRunId: v.optional(v.id("automationRun")),
  automationPolicyVersion: v.optional(v.string()),
  automationDecisionReason: v.optional(v.string()),
  policyReviewedItemKeys: v.optional(v.array(v.string())),
  reopenedAt: v.optional(v.number()),
  reopenedByUserId: v.optional(v.id("athenaUser")),
  reopenedByStaffProfileId: v.optional(v.id("staffProfile")),
  reopenApprovalProofId: v.optional(v.id("approvalProof")),
  reopenApprovedByStaffProfileId: v.optional(v.id("staffProfile")),
  reopenRequestedByStaffProfileId: v.optional(v.id("staffProfile")),
  reopenRequestedByUserId: v.optional(v.id("athenaUser")),
  reopenReason: v.optional(v.string()),
  reopenedFromDailyCloseId: v.optional(v.id("dailyClose")),
  supersededByDailyCloseId: v.optional(v.id("dailyClose")),
  supersedesDailyCloseId: v.optional(v.id("dailyClose")),
});
