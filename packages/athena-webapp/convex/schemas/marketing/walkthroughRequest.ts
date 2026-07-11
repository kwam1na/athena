import { v } from "convex/values";

export const walkthroughRequestSchema = v.object({
  submissionKey: v.optional(v.string()),
  payloadDigest: v.optional(v.string()),
  name: v.optional(v.string()),
  normalizedEmail: v.optional(v.string()),
  businessName: v.optional(v.string()),
  phone: v.optional(v.string()),
  businessNeed: v.optional(v.string()),
  status: v.union(v.literal("open"), v.literal("resolved"), v.literal("abandoned")),
  qualification: v.optional(v.union(v.literal("qualified"), v.literal("not_qualified"), v.literal("unknown"))),
  parentRequestId: v.optional(v.id("walkthroughRequest")),
  submittedAt: v.number(),
  lastActivityAt: v.number(),
  terminalAt: v.optional(v.number()),
  redactedAt: v.optional(v.number()),
});

export const walkthroughNotificationAttemptSchema = v.object({
  requestId: v.id("walkthroughRequest"),
  state: v.union(v.literal("pending"), v.literal("in_flight"), v.literal("sent"), v.literal("retryable_failure"), v.literal("terminal_failure"), v.literal("outcome_unknown")),
  attemptCount: v.number(),
  createdAt: v.number(),
  leaseExpiresAt: v.optional(v.number()),
  leaseToken: v.optional(v.string()),
  lastAttemptAt: v.optional(v.number()),
  nextAttemptAt: v.optional(v.number()),
  providerId: v.optional(v.string()),
  errorCode: v.optional(v.string()),
  terminalAt: v.optional(v.number()),
});

export const walkthroughRequestTombstoneSchema = v.object({
  submissionKey: v.string(),
  dedupeHmac: v.string(),
  keyVersion: v.string(),
  createdAt: v.number(),
  expiresAt: v.number(),
});

export const walkthroughOperationsAuditSchema = v.object({
  requestId: v.id("walkthroughRequest"),
  operatorReference: v.string(),
  action: v.string(),
  priorState: v.optional(v.string()),
  resultingState: v.string(),
  reasonCode: v.string(),
  occurredAt: v.number(),
});

export const walkthroughBudgetCounterSchema = v.object({
  partition: v.string(),
  windowStart: v.number(),
  count: v.number(),
});

export const walkthroughPrivacyChallengeSchema = v.object({
  requestId: v.id("walkthroughRequest"),
  challengeDigest: v.string(),
  requestedAction: v.union(v.literal("export"), v.literal("redaction")),
  createdAt: v.number(),
  expiresAt: v.number(),
  consumedAt: v.optional(v.number()),
});
