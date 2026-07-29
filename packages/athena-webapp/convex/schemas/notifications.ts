import { v } from "convex/values";

export const notificationCategoryValidator = v.union(
  v.literal("cash_controls"),
  v.literal("eod"),
  v.literal("system_health"),
);

export const notificationChannelValidator = v.union(
  v.literal("email"),
  v.literal("in_app"),
);

export const notificationIntentStatusValidator = v.union(
  v.literal("pending"),
  v.literal("dispatched"),
  v.literal("suppressed"),
);

// One row per notification-worthy domain moment. Append-only; identity is the
// kind-specific dedupeKey, so replays from idempotent domain mutations are
// no-ops. Payload carries only the references the registry's prepare step
// needs to rebuild fresh content at send time — never rendered content.
export const notificationIntentSchema = v.object({
  kind: v.string(),
  category: notificationCategoryValidator,
  storeId: v.id("store"),
  organizationId: v.optional(v.id("organization")),
  subjectType: v.string(),
  subjectId: v.string(),
  dedupeKey: v.string(),
  payload: v.record(v.string(), v.any()),
  status: notificationIntentStatusValidator,
  emittedAt: v.number(),
  dispatchedAt: v.optional(v.number()),
  suppressedReason: v.optional(v.string()),
});

// Who receives which category over which channel. A row with no storeId
// covers every store in the organization. Resolution happens in dispatch, so
// audience changes are data changes, not deploys.
export const notificationSubscriptionSchema = v.object({
  organizationId: v.id("organization"),
  storeId: v.optional(v.id("store")),
  category: notificationCategoryValidator,
  channel: notificationChannelValidator,
  recipientEmail: v.string(),
  recipientName: v.optional(v.string()),
  recipientUserId: v.optional(v.id("athenaUser")),
  enabled: v.boolean(),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const notificationDeliveryStatusValidator = v.union(
  v.literal("in_flight"),
  v.literal("sent"),
  v.literal("retryable_failure"),
  v.literal("terminal_failure"),
  v.literal("outcome_unknown"),
  v.literal("suppressed"),
);

// One row per intent x recipient x channel. Reserving a delivery IS taking a
// lease: rows are born in_flight with a leaseToken, and only the holder of the
// token may complete them. The provider idempotency key is the delivery id, so
// a retry after an ambiguous outcome cannot double-send.
export const notificationDeliverySchema = v.object({
  intentId: v.id("notificationIntent"),
  kind: v.string(),
  category: notificationCategoryValidator,
  channel: notificationChannelValidator,
  storeId: v.id("store"),
  organizationId: v.optional(v.id("organization")),
  recipientEmail: v.string(),
  recipientName: v.optional(v.string()),
  dedupeKey: v.string(),
  status: notificationDeliveryStatusValidator,
  attemptCount: v.number(),
  nextAttemptAt: v.optional(v.number()),
  leaseToken: v.optional(v.string()),
  leaseExpiresAt: v.optional(v.number()),
  errorCode: v.optional(v.string()),
  providerMessageId: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
  sentAt: v.optional(v.number()),
  terminalAt: v.optional(v.number()),
  readAt: v.optional(v.number()),
});
