import { v } from "convex/values";

const dailyOpeningReadinessStatusValidator = v.union(
  v.literal("blocked"),
  v.literal("needs_attention"),
  v.literal("ready"),
);

const dailyOpeningSourceSubjectValidator = v.object({
  type: v.string(),
  id: v.string(),
  label: v.optional(v.string()),
});

const dailyOpeningReviewEvidenceValidator = v.object({
  key: v.string(),
  severity: v.union(
    v.literal("blocker"),
    v.literal("review"),
    v.literal("carry_forward"),
  ),
  category: v.string(),
  title: v.string(),
  message: v.string(),
  subject: dailyOpeningSourceSubjectValidator,
  link: v.optional(
    v.object({
      href: v.optional(v.string()),
      label: v.optional(v.string()),
      params: v.optional(v.record(v.string(), v.string())),
      search: v.optional(v.record(v.string(), v.string())),
      to: v.optional(v.string()),
    }),
  ),
  metadata: v.optional(v.any()),
});

export const dailyOpeningSchema = v.object({
  storeId: v.id("store"),
  organizationId: v.id("organization"),
  operatingDate: v.string(),
  startAt: v.optional(v.number()),
  endAt: v.optional(v.number()),
  status: v.literal("started"),
  priorDailyCloseId: v.optional(v.id("dailyClose")),
  readiness: v.object({
    status: dailyOpeningReadinessStatusValidator,
    blockerCount: v.number(),
    reviewCount: v.number(),
    carryForwardCount: v.number(),
    readyCount: v.number(),
  }),
  sourceSubjects: v.array(dailyOpeningSourceSubjectValidator),
  carryForwardWorkItemIds: v.array(v.id("operationalWorkItem")),
  acknowledgedItemKeys: v.array(v.string()),
  notes: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
  startedAt: v.number(),
  actorUserId: v.optional(v.id("athenaUser")),
  actorStaffProfileId: v.optional(v.id("staffProfile")),
  actorType: v.optional(
    v.union(v.literal("human"), v.literal("automation")),
  ),
  automationRunId: v.optional(v.id("automationRun")),
  automationPolicyVersion: v.optional(v.string()),
  automationDecisionReason: v.optional(v.string()),
  managerReviewEvidence: v.optional(v.array(dailyOpeningReviewEvidenceValidator)),
});
