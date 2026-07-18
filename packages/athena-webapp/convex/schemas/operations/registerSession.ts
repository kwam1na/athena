import { v } from "convex/values";

export const registerSessionSchema = v.object({
  storeId: v.id("store"),
  organizationId: v.optional(v.id("organization")),
  terminalId: v.optional(v.id("posTerminal")),
  registerNumber: v.optional(v.string()),
  workflowTraceId: v.optional(v.string()),
  lifecycleAuthorityRevision: v.optional(v.number()),
  recordedTransactionKeys: v.optional(v.array(v.string())),
  status: v.union(
    v.literal("open"),
    v.literal("active"),
    v.literal("closing"),
    v.literal("closeout_rejected"),
    v.literal("closed")
  ),
  openedByUserId: v.optional(v.id("athenaUser")),
  openedByStaffProfileId: v.optional(v.id("staffProfile")),
  openedAt: v.number(),
  openedOperatingDate: v.optional(v.string()),
  openedOperatingDateStartAt: v.optional(v.number()),
  openedOperatingDateEndAt: v.optional(v.number()),
  openedOperatingDateScheduleVersionId: v.optional(v.id("storeSchedule")),
  openedOperatingDateDerivationStatus: v.optional(
    v.union(v.literal("resolved"), v.literal("missing_schedule"))
  ),
  closeoutOwnedAt: v.optional(v.number()),
  closeoutOwnershipSource: v.optional(
    v.union(
      v.literal("closed_record"),
      v.literal("approval_request"),
      v.literal("closeout_submission"),
      v.literal("closed_at")
    )
  ),
  closeoutOperatingDate: v.optional(v.string()),
  closeoutOperatingDateStartAt: v.optional(v.number()),
  closeoutOperatingDateEndAt: v.optional(v.number()),
  closeoutOperatingDateScheduleVersionId: v.optional(v.id("storeSchedule")),
  closeoutOperatingDateDerivationStatus: v.optional(
    v.union(v.literal("resolved"), v.literal("missing_schedule"))
  ),
  openingFloat: v.number(),
  expectedCash: v.number(),
  countedCash: v.optional(v.number()),
  variance: v.optional(v.number()),
  closeoutRecords: v.optional(
    v.array(
      v.object({
        actorStaffProfileId: v.optional(v.id("staffProfile")),
        actorUserId: v.optional(v.id("athenaUser")),
        countedCash: v.optional(v.number()),
        expectedCash: v.number(),
        notes: v.optional(v.string()),
        occurredAt: v.number(),
        previousClosedAt: v.optional(v.number()),
        previousClosedByStaffProfileId: v.optional(v.id("staffProfile")),
        previousClosedByUserId: v.optional(v.id("athenaUser")),
        reason: v.optional(v.string()),
        type: v.union(v.literal("closed"), v.literal("reopened")),
        variance: v.optional(v.number()),
      })
    )
  ),
  closedByUserId: v.optional(v.id("athenaUser")),
  closedByStaffProfileId: v.optional(v.id("staffProfile")),
  closedAt: v.optional(v.number()),
  closeoutNotificationLocalEventId: v.optional(v.string()),
  closeoutNotificationScheduledAt: v.optional(v.number()),
  managerApprovalRequestId: v.optional(v.id("approvalRequest")),
  notes: v.optional(v.string()),
  // U10: deterministic idempotency marker for the cedis→pesewas migration of the
  // cash-drawer money fields (openingFloat/expectedCash/countedCash/variance +
  // closeoutRecords[]).
  pesewasMigratedAt: v.optional(v.number()),
});
