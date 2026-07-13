import { v } from "convex/values";

export const storeTimezoneSourceSchema = v.union(
  v.literal("admin_authorized"),
  v.literal("schedule_evidence"),
  v.literal("import"),
);

/**
 * Immutable, effective-dated calendar authority. Opening-hours schedules may
 * reference this row, but reporting never requires a schedule to use it.
 */
export const storeTimezoneVersionSchema = v.object({
  organizationId: v.id("organization"),
  storeId: v.id("store"),
  timezone: v.string(),
  effectiveFrom: v.number(),
  effectiveTo: v.optional(v.number()),
  contentHash: v.string(),
  evidenceHash: v.optional(v.string()),
  source: storeTimezoneSourceSchema,
  authorizedByUserId: v.id("athenaUser"),
  authorizedAt: v.number(),
  createdAt: v.number(),
});
