import { v } from "convex/values";

export const serviceAppointmentSchema = v.object({
  storeId: v.id("store"),
  organizationId: v.optional(v.id("organization")),
  serviceCatalogId: v.id("serviceCatalog"),
  serviceCaseId: v.optional(v.id("serviceCase")),
  customerProfileId: v.id("customerProfile"),
  assignedStaffProfileId: v.id("staffProfile"),
  status: v.union(
    v.literal("scheduled"),
    v.literal("rescheduled"),
    v.literal("checked_in"),
    v.literal("cancelled"),
    v.literal("converted_to_walk_in"),
    v.literal("completed")
  ),
  startAt: v.number(),
  endAt: v.number(),
  notes: v.optional(v.string()),
  createdByUserId: v.optional(v.id("athenaUser")),
  createdAt: v.number(),
  updatedAt: v.number(),
  cancelledAt: v.optional(v.number()),
  convertedAt: v.optional(v.number()),
});
