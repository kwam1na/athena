import { render } from "@react-email/components";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { env, internalAction, internalMutation, internalQuery } from "../_generated/server";
import WalkthroughRequestNotification from "../emails/WalkthroughRequestNotification";
import { consumeWalkthroughBudget } from "./walkthroughBudgets";
import { walkthroughHourlyNotificationLimit } from "./walkthroughConfig";

const MAX_ATTEMPTS = 4;
const LEASE_MS = 5 * 60_000;

export function nextBackoffMs(attempt: number) { return Math.min(86_400_000, 60_000 * 2 ** Math.max(0, Math.min(10, attempt - 1))); }
export function classifyDeliveryResult(result: { kind: "timeout" } | { kind: "http"; status: number }) {
  if (result.kind === "timeout") return { state: "outcome_unknown" as const, retry: false, code: "provider_timeout" };
  if (result.status >= 200 && result.status < 300) return { state: "sent" as const, retry: false, code: "sent" };
  if (result.status === 408 || result.status === 429 || result.status >= 500) return { state: "retryable_failure" as const, retry: true, code: `provider_${result.status}` };
  return { state: "terminal_failure" as const, retry: false, code: `provider_${result.status}` };
}

export function isDeliberateRetryEligible(state: string, attemptCount: number) {
  return (
    ["retryable_failure", "terminal_failure", "outcome_unknown"].includes(state) &&
    attemptCount < MAX_ATTEMPTS
  );
}

function boundedAuditValue(value: string, label: string, maximum: number) {
  const normalized = value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length < 3 || normalized.length > maximum) {
    throw new Error(`Invalid ${label}`);
  }
  return normalized;
}

export const lease = internalMutation({
  args: { attemptId: v.id("walkthroughNotificationAttempt"), now: v.number() },
  handler: async (ctx, args) => {
    const attempt = await ctx.db.get("walkthroughNotificationAttempt", args.attemptId);
    if (
      !attempt ||
      attempt.attemptCount >= MAX_ATTEMPTS ||
      env.WALKTHROUGH_NOTIFICATIONS_DISABLED === "true"
    ) return null;
    const eligible = attempt.state === "pending" || attempt.state === "retryable_failure";
    if (!eligible || (attempt.nextAttemptAt ?? 0) > args.now) return null;
    const request = await ctx.db.get("walkthroughRequest", attempt.requestId);
    if (!request?.name || !request.normalizedEmail || !request.businessName || !request.businessNeed) return null;
    const hour = 3_600_000;
    const windowStart = Math.floor(args.now / hour) * hour;
    const withinBudget = await consumeWalkthroughBudget(
      ctx,
      "notifications",
      windowStart,
      walkthroughHourlyNotificationLimit(),
    );
    if (!withinBudget) return null;
    const leaseToken = crypto.randomUUID();
    await ctx.db.patch("walkthroughNotificationAttempt", attempt._id, { state: "in_flight", attemptCount: attempt.attemptCount + 1, lastAttemptAt: args.now, leaseExpiresAt: args.now + LEASE_MS, leaseToken, errorCode: undefined });
    return { attemptCount: attempt.attemptCount + 1, leaseToken, request: { requestId: String(request._id), name: request.name, workEmail: request.normalizedEmail, businessName: request.businessName, phone: request.phone, businessNeed: request.businessNeed } };
  },
});

export const complete = internalMutation({
  args: { attemptId: v.id("walkthroughNotificationAttempt"), leaseToken: v.string(), now: v.number(), state: v.union(v.literal("sent"), v.literal("retryable_failure"), v.literal("terminal_failure"), v.literal("outcome_unknown")), errorCode: v.string(), providerId: v.optional(v.string()), nextAttemptAt: v.optional(v.number()) },
  handler: async (ctx, args) => { const attempt = await ctx.db.get("walkthroughNotificationAttempt", args.attemptId); if (!attempt || attempt.state !== "in_flight" || attempt.leaseToken !== args.leaseToken) return null; await ctx.db.patch("walkthroughNotificationAttempt", attempt._id, { state: args.state, errorCode: args.errorCode.slice(0, 64), providerId: args.providerId?.slice(0, 160), nextAttemptAt: args.nextAttemptAt, leaseExpiresAt: undefined, leaseToken: undefined, terminalAt: args.state === "sent" || args.state === "terminal_failure" || args.state === "outcome_unknown" ? args.now : undefined }); return null; },
});

export const deliver = internalAction({
  args: { attemptId: v.id("walkthroughNotificationAttempt") },
  handler: async (ctx, args) => {
    const now = Date.now();
    const leased: { attemptCount: number; leaseToken: string; request: { requestId: string; name: string; workEmail: string; businessName: string; phone?: string; businessNeed: string } } | null = await ctx.runMutation(internal.marketing.walkthroughRequestNotifications.lease, { attemptId: args.attemptId, now });
    if (!leased) return null;
    const recipient = env.WALKTHROUGH_NOTIFICATION_RECIPIENT;
    const apiKey = env.MAILERSEND_API_KEY;
    if (!recipient || !apiKey) { await ctx.runMutation(internal.marketing.walkthroughRequestNotifications.complete, { attemptId: args.attemptId, leaseToken: leased.leaseToken, now, state: "terminal_failure", errorCode: "missing_configuration" }); return null; }
    let classification: ReturnType<typeof classifyDeliveryResult>;
    let providerId: string | undefined;
    try {
      const html = await render(WalkthroughRequestNotification(leased.request));
      const response = await fetch("https://api.mailersend.com/v1/email", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`, "Idempotency-Key": String(args.attemptId) }, body: JSON.stringify({ from: { email: "noreply@wigclub.store", name: "Athena" }, to: [{ email: recipient, name: "Athena walkthrough owner" }], subject: "New Athena walkthrough request", html }), signal: AbortSignal.timeout(15_000) });
      providerId = response.headers.get("x-message-id") ?? undefined;
      classification = classifyDeliveryResult({ kind: "http", status: response.status });
    } catch { classification = classifyDeliveryResult({ kind: "timeout" }); }
    const nextAttemptAt = classification.retry && leased.attemptCount < MAX_ATTEMPTS ? now + nextBackoffMs(leased.attemptCount) : undefined;
    const state = classification.retry && !nextAttemptAt ? "terminal_failure" : classification.state;
    await ctx.runMutation(internal.marketing.walkthroughRequestNotifications.complete, { attemptId: args.attemptId, leaseToken: leased.leaseToken, now, state, errorCode: classification.code, providerId, nextAttemptAt });
    if (nextAttemptAt) await ctx.scheduler.runAfter(nextAttemptAt - now, internal.marketing.walkthroughRequestNotifications.deliver, { attemptId: args.attemptId });
    return null;
  },
});

export const inspectAttempts = internalQuery({ args: { requestId: v.id("walkthroughRequest") }, handler: (ctx, args) => ctx.db.query("walkthroughNotificationAttempt").withIndex("by_requestId", (q) => q.eq("requestId", args.requestId)).take(20) });

export const scheduleEligibleBatch = internalMutation({
  args: { now: v.optional(v.number()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const limit = Math.min(25, Math.max(1, args.limit ?? 25));
    const stale = await ctx.db
      .query("walkthroughNotificationAttempt")
      .withIndex("by_state_and_leaseExpiresAt", (q) =>
        q.eq("state", "in_flight").lte("leaseExpiresAt", now),
      )
      .take(limit);
    for (const attempt of stale) {
      await ctx.db.patch("walkthroughNotificationAttempt", attempt._id, {
        state: "outcome_unknown",
        errorCode: "stale_delivery_lease",
        leaseExpiresAt: undefined,
        leaseToken: undefined,
        nextAttemptAt: undefined,
        terminalAt: now,
      });
    }

    const schedulableLimit = limit - stale.length;
    const pending = schedulableLimit > 0
      ? await ctx.db
          .query("walkthroughNotificationAttempt")
          .withIndex("by_state_and_nextAttemptAt", (q) =>
            q.eq("state", "pending").lte("nextAttemptAt", now),
          )
          .take(schedulableLimit)
      : [];
    const retryable = pending.length < schedulableLimit
      ? await ctx.db
          .query("walkthroughNotificationAttempt")
          .withIndex("by_state_and_nextAttemptAt", (q) =>
            q.eq("state", "retryable_failure").lte("nextAttemptAt", now),
          )
          .take(schedulableLimit - pending.length)
      : [];
    for (const attempt of [...pending, ...retryable]) {
      await ctx.scheduler.runAfter(
        0,
        internal.marketing.walkthroughRequestNotifications.deliver,
        { attemptId: attempt._id },
      );
    }
    return {
      scheduled: pending.length + retryable.length,
      markedOutcomeUnknown: stale.length,
    };
  },
});

export const deliberateRetry = internalMutation({ args: { attemptId: v.id("walkthroughNotificationAttempt"), operatorReference: v.string(), reasonCode: v.string(), now: v.number() }, handler: async (ctx, args) => { const attempt = await ctx.db.get("walkthroughNotificationAttempt", args.attemptId); if (!attempt || !isDeliberateRetryEligible(attempt.state, attempt.attemptCount)) throw new Error("Attempt is not eligible within the delivery cap"); const operatorReference = boundedAuditValue(args.operatorReference, "operator reference", 100); const reasonCode = boundedAuditValue(args.reasonCode, "reason code", 80); await ctx.db.patch("walkthroughNotificationAttempt", attempt._id, { state: "pending", nextAttemptAt: args.now, terminalAt: undefined, errorCode: undefined, leaseToken: undefined }); await ctx.db.insert("walkthroughOperationsAudit", { requestId: attempt.requestId, operatorReference, action: "deliberate_retry", priorState: attempt.state, resultingState: "pending", reasonCode, occurredAt: args.now }); await ctx.scheduler.runAfter(0, internal.marketing.walkthroughRequestNotifications.deliver, { attemptId: attempt._id }); return null; } });

export const resolveUnknown = internalMutation({ args: { attemptId: v.id("walkthroughNotificationAttempt"), outcome: v.union(v.literal("sent"), v.literal("retryable_failure")), operatorReference: v.string(), reasonCode: v.string(), now: v.number() }, handler: async (ctx, args) => { const attempt = await ctx.db.get("walkthroughNotificationAttempt", args.attemptId); if (!attempt || attempt.state !== "outcome_unknown") throw new Error("Attempt is not outcome unknown"); if (args.outcome === "retryable_failure" && attempt.attemptCount >= MAX_ATTEMPTS) throw new Error("Attempt has reached the delivery cap"); const operatorReference = boundedAuditValue(args.operatorReference, "operator reference", 100); const reasonCode = boundedAuditValue(args.reasonCode, "reason code", 80); await ctx.db.patch("walkthroughNotificationAttempt", attempt._id, { state: args.outcome, nextAttemptAt: args.outcome === "retryable_failure" ? args.now : undefined, terminalAt: args.outcome === "sent" ? args.now : undefined, leaseToken: undefined }); await ctx.db.insert("walkthroughOperationsAudit", { requestId: attempt.requestId, operatorReference, action: "resolve_unknown", priorState: "outcome_unknown", resultingState: args.outcome, reasonCode, occurredAt: args.now }); return null; } });
