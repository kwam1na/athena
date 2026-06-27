import { v } from "convex/values";

export const storeScheduleWindowSchema = v.object({
  dayOfWeek: v.number(),
  startMinute: v.number(),
  endMinute: v.number(),
  label: v.optional(v.string()),
});

export const storeScheduleExceptionWindowSchema = v.object({
  startMinute: v.number(),
  endMinute: v.number(),
  label: v.optional(v.string()),
});

export const storeScheduleDateExceptionSchema = v.object({
  localDate: v.string(),
  closed: v.boolean(),
  windows: v.array(storeScheduleExceptionWindowSchema),
  note: v.optional(v.string()),
});

export const storeScheduleStatusSchema = v.union(
  v.literal("active"),
  v.literal("superseded"),
  v.literal("candidate"),
);

export const storeScheduleSourceSchema = v.union(
  v.literal("admin"),
  v.literal("seed"),
  v.literal("import"),
  v.literal("system"),
);

export const storeScheduleSchema = v.object({
  organizationId: v.id("organization"),
  storeId: v.id("store"),
  timezone: v.string(),
  weeklyWindows: v.array(storeScheduleWindowSchema),
  weeklyClosedDays: v.array(v.number()),
  dateExceptions: v.array(storeScheduleDateExceptionSchema),
  effectiveFrom: v.number(),
  effectiveTo: v.optional(v.number()),
  status: storeScheduleStatusSchema,
  source: storeScheduleSourceSchema,
  createdAt: v.number(),
  updatedAt: v.number(),
  createdByUserId: v.optional(v.id("athenaUser")),
  updatedByUserId: v.optional(v.id("athenaUser")),
  supersededAt: v.optional(v.number()),
  supersededByScheduleId: v.optional(v.id("storeSchedule")),
});
