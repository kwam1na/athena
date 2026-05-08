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
});
