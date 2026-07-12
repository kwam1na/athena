import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import {
  createWalkthroughDedupeHmac,
  getActiveWalkthroughHmacKey,
} from "./walkthroughHmac";

const DAY = 86_400_000;
const PII_RETENTION_MS = 180 * DAY;
const TOMBSTONE_RETENTION_MS = 365 * DAY;
const ATTEMPT_DIAGNOSTIC_MS = 30 * DAY;
const PRIVACY_CHALLENGE_MS = DAY;

export function retentionDecision(input: { status: "open" | "resolved" | "abandoned"; lastActivityAt: number; terminalAt?: number; now: number }) {
  if (input.status === "open" && input.lastActivityAt <= input.now - PII_RETENTION_MS) return "abandon_and_redact" as const;
  if (input.status !== "open" && (input.terminalAt ?? input.lastActivityAt) <= input.now - PII_RETENTION_MS) return "redact" as const;
  return "retain" as const;
}

export const cleanupBatch = internalMutation({
  args: { now: v.optional(v.number()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const limit = Math.min(100, Math.max(1, args.limit ?? 50));
    const { version: keyVersion, secret } = getActiveWalkthroughHmacKey();
    const open = await ctx.db.query("walkthroughRequest").withIndex("by_status_and_redactedAt_and_lastActivityAt", (q) => q.eq("status", "open").eq("redactedAt", undefined).lte("lastActivityAt", now - PII_RETENTION_MS)).take(limit);
    const remaining = limit - open.length;
    const terminal = remaining > 0 ? [
      ...(await ctx.db.query("walkthroughRequest").withIndex("by_status_and_redactedAt_and_terminalAt", (q) => q.eq("status", "resolved").eq("redactedAt", undefined).lte("terminalAt", now - PII_RETENTION_MS)).take(remaining)),
      ...(await ctx.db.query("walkthroughRequest").withIndex("by_status_and_redactedAt_and_terminalAt", (q) => q.eq("status", "abandoned").eq("redactedAt", undefined).lte("terminalAt", now - PII_RETENTION_MS)).take(remaining)),
    ].slice(0, remaining) : [];
    for (const row of [...open, ...terminal]) {
      if (row.submissionKey && row.normalizedEmail && row.payloadDigest) {
        const dedupeHmac = await createWalkthroughDedupeHmac(
          row.normalizedEmail,
          row.payloadDigest,
          secret,
        );
        const existing = await ctx.db.query("walkthroughRequestTombstone").withIndex("by_submissionKey", (q) => q.eq("submissionKey", row.submissionKey!)).unique();
        if (!existing) await ctx.db.insert("walkthroughRequestTombstone", { submissionKey: row.submissionKey, dedupeHmac, keyVersion, createdAt: now, expiresAt: now + TOMBSTONE_RETENTION_MS });
      }
      await ctx.db.patch("walkthroughRequest", row._id, { name: undefined, normalizedEmail: undefined, businessName: undefined, phone: undefined, businessNeed: undefined, payloadDigest: undefined, status: row.status === "open" ? "abandoned" : row.status, terminalAt: row.terminalAt ?? now, redactedAt: now });
    }
    const attempts = [
      ...(await ctx.db.query("walkthroughNotificationAttempt").withIndex("by_state_and_terminalAt", (q) => q.eq("state", "sent").lte("terminalAt", now - ATTEMPT_DIAGNOSTIC_MS)).take(limit)),
      ...(await ctx.db.query("walkthroughNotificationAttempt").withIndex("by_state_and_terminalAt", (q) => q.eq("state", "terminal_failure").lte("terminalAt", now - ATTEMPT_DIAGNOSTIC_MS)).take(limit)),
      ...(await ctx.db.query("walkthroughNotificationAttempt").withIndex("by_state_and_terminalAt", (q) => q.eq("state", "outcome_unknown").lte("terminalAt", now - ATTEMPT_DIAGNOSTIC_MS)).take(limit)),
    ].slice(0, limit);
    for (const attempt of attempts) await ctx.db.delete("walkthroughNotificationAttempt", attempt._id);
    const tombstones = await ctx.db.query("walkthroughRequestTombstone").withIndex("by_expiresAt", (q) => q.lte("expiresAt", now)).take(limit);
    for (const tombstone of tombstones) {
      const request = await ctx.db.query("walkthroughRequest").withIndex("by_submissionKey", (q) => q.eq("submissionKey", tombstone.submissionKey)).unique();
      if (request?.redactedAt) {
        await ctx.db.patch("walkthroughRequest", request._id, { submissionKey: undefined });
      }
      await ctx.db.delete("walkthroughRequestTombstone", tombstone._id);
    }
    const expiredChallenges = await ctx.db.query("walkthroughPrivacyChallenge").withIndex("by_expiresAt", (q) => q.lte("expiresAt", now)).take(limit);
    for (const challenge of expiredChallenges) await ctx.db.delete("walkthroughPrivacyChallenge", challenge._id);
    const counters = await ctx.db.query("walkthroughBudgetCounter").withIndex("by_windowStart", (q) => q.lte("windowStart", now - 2 * DAY)).take(limit);
    for (const counter of counters) await ctx.db.delete("walkthroughBudgetCounter", counter._id);
    const hasMore = open.length + terminal.length === limit || attempts.length === limit || tombstones.length === limit || counters.length === limit || expiredChallenges.length === limit;
    if (hasMore) await ctx.scheduler.runAfter(0, internal.marketing.walkthroughRequestRetention.cleanupBatch, { now, limit });
    return { processedRequests: open.length + terminal.length, deletedAttempts: attempts.length, deletedTombstones: tombstones.length, deletedCounters: counters.length, deletedChallenges: expiredChallenges.length, hasMore };
  },
});

function boundedAuditValue(value: string, label: string) {
  const normalized = value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  if (normalized.length < 3 || normalized.length > 100) throw new Error(`Invalid ${label}`);
  return normalized;
}

async function consumePrivacyChallenge(
  ctx: MutationCtx,
  challengeId: Id<"walkthroughPrivacyChallenge">,
  replyDigest: string,
  requestedAction: "export" | "redaction",
  now: number,
) {
  if (!/^sha256:[a-f0-9]{64}$/.test(replyDigest)) throw new Error("Invalid privacy challenge reply");
  const challenge = await ctx.db.get("walkthroughPrivacyChallenge", challengeId);
  if (
    !challenge ||
    challenge.requestedAction !== requestedAction ||
    challenge.consumedAt ||
    challenge.expiresAt < now ||
    challenge.challengeDigest !== replyDigest
  ) {
    throw new Error("Privacy challenge is not valid");
  }
  await ctx.db.patch("walkthroughPrivacyChallenge", challenge._id, { consumedAt: now });
  return challenge;
}

export const beginPrivacyChallenge = internalMutation({
  args: {
    requestId: v.id("walkthroughRequest"),
    challengeDigest: v.string(),
    requestedAction: v.union(v.literal("export"), v.literal("redaction")),
    operatorReference: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    if (!/^sha256:[a-f0-9]{64}$/.test(args.challengeDigest)) throw new Error("Invalid privacy challenge digest");
    const request = await ctx.db.get("walkthroughRequest", args.requestId);
    if (!request?.normalizedEmail || request.redactedAt) throw new Error("Request has no verifiable stored email");
    const challengeId = await ctx.db.insert("walkthroughPrivacyChallenge", {
      requestId: request._id,
      challengeDigest: args.challengeDigest,
      requestedAction: args.requestedAction,
      createdAt: args.now,
      expiresAt: args.now + PRIVACY_CHALLENGE_MS,
    });
    await ctx.db.insert("walkthroughOperationsAudit", {
      requestId: request._id,
      operatorReference: boundedAuditValue(args.operatorReference, "operator reference"),
      action: "privacy_challenge_issued",
      priorState: request.status,
      resultingState: request.status,
      reasonCode: args.requestedAction,
      occurredAt: args.now,
    });
    return { challengeId, storedEmail: request.normalizedEmail, expiresAt: args.now + PRIVACY_CHALLENGE_MS };
  },
});

export const exportVerifiedSubject = internalMutation({
  args: {
    challengeId: v.id("walkthroughPrivacyChallenge"),
    replyDigest: v.string(),
    operatorReference: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const challenge = await consumePrivacyChallenge(ctx, args.challengeId, args.replyDigest, "export", args.now);
    const request = await ctx.db.get("walkthroughRequest", challenge.requestId);
    if (!request?.normalizedEmail || request.redactedAt) throw new Error("Verified request is unavailable");
    await ctx.db.insert("walkthroughOperationsAudit", {
      requestId: request._id,
      operatorReference: boundedAuditValue(args.operatorReference, "operator reference"),
      action: "verified_export",
      priorState: request.status,
      resultingState: request.status,
      reasonCode: "stored_email_reply",
      occurredAt: args.now,
    });
    return {
      requestId: request._id,
      name: request.name,
      workEmail: request.normalizedEmail,
      businessName: request.businessName,
      phone: request.phone,
      businessNeed: request.businessNeed,
      submittedAt: request.submittedAt,
      status: request.status,
      qualification: request.qualification,
    };
  },
});

export const redactVerifiedSubject = internalMutation({
  args: {
    challengeId: v.id("walkthroughPrivacyChallenge"),
    replyDigest: v.string(),
    operatorReference: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const challenge = await consumePrivacyChallenge(ctx, args.challengeId, args.replyDigest, "redaction", args.now);
    const row = await ctx.db.get("walkthroughRequest", challenge.requestId);
    if (!row?.normalizedEmail || !row.submissionKey || !row.payloadDigest || row.redactedAt) throw new Error("Verified request is unavailable");
    const { version: keyVersion, secret } = getActiveWalkthroughHmacKey();
    const existing = await ctx.db.query("walkthroughRequestTombstone").withIndex("by_submissionKey", (q) => q.eq("submissionKey", row.submissionKey!)).unique();
    if (!existing) await ctx.db.insert("walkthroughRequestTombstone", { submissionKey: row.submissionKey, dedupeHmac: await createWalkthroughDedupeHmac(row.normalizedEmail, row.payloadDigest, secret), keyVersion, createdAt: args.now, expiresAt: args.now + TOMBSTONE_RETENTION_MS });
    await ctx.db.patch("walkthroughRequest", row._id, { name: undefined, normalizedEmail: undefined, businessName: undefined, phone: undefined, businessNeed: undefined, payloadDigest: undefined, status: "abandoned", terminalAt: args.now, lastActivityAt: args.now, redactedAt: args.now });
    const attempts = await ctx.db.query("walkthroughNotificationAttempt").withIndex("by_requestId", (q) => q.eq("requestId", row._id)).take(20);
    for (const attempt of attempts) {
      if (!["sent", "terminal_failure", "outcome_unknown"].includes(attempt.state)) {
        await ctx.db.patch("walkthroughNotificationAttempt", attempt._id, { state: "terminal_failure", errorCode: "subject_redacted", leaseExpiresAt: undefined, leaseToken: undefined, nextAttemptAt: undefined, terminalAt: args.now });
      }
    }
    await ctx.db.insert("walkthroughOperationsAudit", { requestId: row._id, operatorReference: boundedAuditValue(args.operatorReference, "operator reference"), action: "verified_redaction", priorState: row.status, resultingState: "abandoned", reasonCode: "stored_email_reply", occurredAt: args.now });
    return null;
  },
});
