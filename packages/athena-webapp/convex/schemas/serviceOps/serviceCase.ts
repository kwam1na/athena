import { v } from "convex/values";

export const serviceCaseSchema = v.object({
  storeId: v.id("store"),
  organizationId: v.optional(v.id("organization")),
  operationalWorkItemId: v.id("operationalWorkItem"),
  serviceCatalogId: v.optional(v.id("serviceCatalog")),
  appointmentId: v.optional(v.id("serviceAppointment")),
  customerProfileId: v.id("customerProfile"),
  assignedStaffProfileId: v.optional(v.id("staffProfile")),
  serviceMode: v.union(
    v.literal("same_day"),
    v.literal("consultation"),
    v.literal("repair"),
    v.literal("revamp")
  ),
  status: v.union(
    v.literal("intake"),
    v.literal("scheduled"),
    v.literal("in_progress"),
    v.literal("awaiting_approval"),
    v.literal("awaiting_pickup"),
    v.literal("completed"),
    v.literal("cancelled")
  ),
  paymentStatus: v.union(
    v.literal("unpaid"),
    v.literal("deposit_paid"),
    v.literal("partially_paid"),
    v.literal("paid"),
    v.literal("refunded")
  ),
  quotedAmount: v.optional(v.number()),
  totalAmount: v.number(),
  balanceDueAmount: v.number(),
  notes: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
  lastStatusChangedAt: v.number(),
  completedAt: v.optional(v.number()),
  cancelledAt: v.optional(v.number()),
  cancellationReason: v.optional(v.string()),
});
