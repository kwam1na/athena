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

export const dailyCloseSchema = v.object({
  storeId: v.id("store"),
  organizationId: v.id("organization"),
  operatingDate: v.string(),
  status: v.union(v.literal("open"), v.literal("completed")),
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
  carryForwardWorkItemIds: v.array(v.id("operationalWorkItem")),
  reviewedItemKeys: v.optional(v.array(v.string())),
  notes: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
  completedAt: v.optional(v.number()),
  completedByUserId: v.optional(v.id("athenaUser")),
  completedByStaffProfileId: v.optional(v.id("staffProfile")),
});
