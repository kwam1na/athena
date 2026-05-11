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
  reopenedAt: v.optional(v.number()),
  reopenedByUserId: v.optional(v.id("athenaUser")),
  reopenedByStaffProfileId: v.optional(v.id("staffProfile")),
  reopenReason: v.optional(v.string()),
  reopenedFromDailyCloseId: v.optional(v.id("dailyClose")),
  supersededByDailyCloseId: v.optional(v.id("dailyClose")),
  supersedesDailyCloseId: v.optional(v.id("dailyClose")),
});
