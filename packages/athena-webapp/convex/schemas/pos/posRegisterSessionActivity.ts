import { v } from "convex/values";

export const POS_REGISTER_SESSION_ACTIVITY_CATEGORIES = [
  "register",
  "session",
  "cart",
  "payment",
  "service",
  "cash",
  "expense",
  "sale",
  "closeout",
  "reopen",
  "sync",
  "review",
] as const;

export const POS_REGISTER_SESSION_ACTIVITY_STATUSES = [
  "terminal_reported",
  "mapping_pending",
  "accepted",
  "projected",
  "held",
  "conflicted",
  "manager_applied",
  "manager_rejected",
  "rejected",
  "repaired",
  "activity_patch_failed",
] as const;

export const POS_REGISTER_SESSION_ACTIVITY_SKIP_CODES = [
  "disallowed_metadata",
  "invalid_metadata",
  "invalid_scope",
] as const;

const ACTIVITY_CATEGORY_COUNT: (typeof POS_REGISTER_SESSION_ACTIVITY_CATEGORIES)["length"] = 12;
const ACTIVITY_STATUS_COUNT: (typeof POS_REGISTER_SESSION_ACTIVITY_STATUSES)["length"] = 11;
void ACTIVITY_CATEGORY_COUNT;
void ACTIVITY_STATUS_COUNT;

export const posRegisterSessionActivityCategoryValidator = v.union(
  v.literal(POS_REGISTER_SESSION_ACTIVITY_CATEGORIES[0]),
  v.literal(POS_REGISTER_SESSION_ACTIVITY_CATEGORIES[1]),
  v.literal(POS_REGISTER_SESSION_ACTIVITY_CATEGORIES[2]),
  v.literal(POS_REGISTER_SESSION_ACTIVITY_CATEGORIES[3]),
  v.literal(POS_REGISTER_SESSION_ACTIVITY_CATEGORIES[4]),
  v.literal(POS_REGISTER_SESSION_ACTIVITY_CATEGORIES[5]),
  v.literal(POS_REGISTER_SESSION_ACTIVITY_CATEGORIES[6]),
  v.literal(POS_REGISTER_SESSION_ACTIVITY_CATEGORIES[7]),
  v.literal(POS_REGISTER_SESSION_ACTIVITY_CATEGORIES[8]),
  v.literal(POS_REGISTER_SESSION_ACTIVITY_CATEGORIES[9]),
  v.literal(POS_REGISTER_SESSION_ACTIVITY_CATEGORIES[10]),
  v.literal(POS_REGISTER_SESSION_ACTIVITY_CATEGORIES[11]),
);

export const posRegisterSessionActivityStatusValidator = v.union(
  v.literal(POS_REGISTER_SESSION_ACTIVITY_STATUSES[0]),
  v.literal(POS_REGISTER_SESSION_ACTIVITY_STATUSES[1]),
  v.literal(POS_REGISTER_SESSION_ACTIVITY_STATUSES[2]),
  v.literal(POS_REGISTER_SESSION_ACTIVITY_STATUSES[3]),
  v.literal(POS_REGISTER_SESSION_ACTIVITY_STATUSES[4]),
  v.literal(POS_REGISTER_SESSION_ACTIVITY_STATUSES[5]),
  v.literal(POS_REGISTER_SESSION_ACTIVITY_STATUSES[6]),
  v.literal(POS_REGISTER_SESSION_ACTIVITY_STATUSES[7]),
  v.literal(POS_REGISTER_SESSION_ACTIVITY_STATUSES[8]),
  v.literal(POS_REGISTER_SESSION_ACTIVITY_STATUSES[9]),
  v.literal(POS_REGISTER_SESSION_ACTIVITY_STATUSES[10]),
);

export const posRegisterSessionActivitySkipCodeValidator = v.union(
  v.literal(POS_REGISTER_SESSION_ACTIVITY_SKIP_CODES[0]),
  v.literal(POS_REGISTER_SESSION_ACTIVITY_SKIP_CODES[1]),
  v.literal(POS_REGISTER_SESSION_ACTIVITY_SKIP_CODES[2]),
);

export const posRegisterSessionActivityMetadataValueValidator = v.union(
  v.string(),
  v.number(),
  v.boolean(),
);

export const posRegisterSessionActivitySchema = v.object({
  storeId: v.id("store"),
  terminalId: v.id("posTerminal"),
  registerSessionId: v.optional(v.id("registerSession")),
  localRegisterSessionId: v.string(),
  localExpenseSessionId: v.optional(v.string()),
  registerNumber: v.optional(v.string()),
  activityKey: v.string(),
  localEventId: v.string(),
  localSequence: v.number(),
  uploadSequence: v.optional(v.number()),
  occurredAt: v.number(),
  reportedAt: v.number(),
  receivedAt: v.number(),
  acceptedAt: v.optional(v.number()),
  projectedAt: v.optional(v.number()),
  reviewedAt: v.optional(v.number()),
  staffProfileId: v.optional(v.id("staffProfile")),
  category: posRegisterSessionActivityCategoryValidator,
  eventType: v.string(),
  status: posRegisterSessionActivityStatusValidator,
  relatedSyncEventId: v.optional(v.id("posLocalSyncEvent")),
  relatedConflictId: v.optional(v.id("posLocalSyncConflict")),
  relatedTransactionId: v.optional(v.id("posTransaction")),
  relatedPosSessionId: v.optional(v.id("posSession")),
  relatedCloseoutRecordId: v.optional(v.string()),
  relatedWorkflowTraceId: v.optional(v.string()),
  metadata: v.record(
    v.string(),
    posRegisterSessionActivityMetadataValueValidator,
  ),
  sanitizedReasonCode: v.optional(posRegisterSessionActivitySkipCodeValidator),
  updatedAt: v.number(),
});
