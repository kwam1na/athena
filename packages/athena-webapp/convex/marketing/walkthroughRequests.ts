import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { env, internalMutation, internalQuery, type MutationCtx } from "../_generated/server";
import { appendFunnelAggregateWithCtx, appendFunnelEventWithCtx } from "./landingFunnelEvents";
import {
  createWalkthroughDedupeHmac,
  getActiveWalkthroughHmacKey,
  getWalkthroughHmacVerificationKeys,
  matchesWalkthroughTombstone,
} from "./walkthroughHmac";
import { consumeWalkthroughBudget } from "./walkthroughBudgets";
import { normalizeWalkthroughEmail, normalizeWalkthroughText } from "./walkthroughNormalization";
import {
  walkthroughDailyPerEmailLimit,
  walkthroughHourlyGlobalLimit,
} from "./walkthroughConfig";

const DAY = 86_400_000;
const qualificationValidator = v.union(v.literal("qualified"), v.literal("not_qualified"), v.literal("unknown"));

function boundedText(value: string, min: number, max: number, label: string) {
  const normalized = normalizeWalkthroughText(value);
  if (normalized.length < min || normalized.length > max) throw new Error(`Invalid ${label}`);
  return normalized;
}

async function keyedFingerprint(value: string) {
  const { secret } = getActiveWalkthroughHmacKey();
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const acceptArgs = {
  submissionKey: v.string(), payloadDigest: v.string(), name: v.string(), workEmail: v.string(), businessName: v.string(), phone: v.optional(v.string()), businessNeed: v.string(), submittedAt: v.number(),
};

export const accept = internalMutation({
  args: acceptArgs,
  handler: async (ctx, args) => {
    if (env.WALKTHROUGH_INGRESS_DISABLED === "true") return { accepted: false as const, inserted: false as const, reason: "unavailable" as const };
    if (!/^[A-Za-z0-9_-]{24,96}$/.test(args.submissionKey) || !/^sha256:[a-f0-9]{64}$/.test(args.payloadDigest)) throw new Error("Invalid request envelope");
    const existingKey = await ctx.db.query("walkthroughRequest").withIndex("by_submissionKey", (q) => q.eq("submissionKey", args.submissionKey)).unique();
    if (existingKey && !existingKey.redactedAt) return existingKey.payloadDigest === args.payloadDigest
      ? { accepted: true as const, inserted: false as const, followUp: Boolean(existingKey.parentRequestId) }
      : { accepted: false as const, inserted: false as const, reason: "retry" as const };

    const name = boundedText(args.name, 2, 100, "name");
    const normalizedEmail = normalizeWalkthroughEmail(args.workEmail);
    if (normalizedEmail.length < 5 || normalizedEmail.length > 254) throw new Error("Invalid email");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new Error("Invalid email");
    const businessName = boundedText(args.businessName, 2, 160, "business name");
    const businessNeed = boundedText(args.businessNeed, 10, 1_500, "business need");
    const phone = args.phone ? boundedText(args.phone, 7, 40, "phone") : undefined;
    const tombstone = await ctx.db.query("walkthroughRequestTombstone").withIndex("by_submissionKey", (q) => q.eq("submissionKey", args.submissionKey)).unique();
    if (tombstone && tombstone.expiresAt > args.submittedAt) {
      const matches = await matchesWalkthroughTombstone(
        tombstone,
        normalizedEmail,
        args.payloadDigest,
      );
      return matches
        ? { accepted: true as const, inserted: false as const, followUp: false }
        : { accepted: false as const, inserted: false as const, reason: "retry" as const };
    }
    if (tombstone) {
      await ctx.db.delete("walkthroughRequestTombstone", tombstone._id);
    }
    if (existingKey?.redactedAt) {
      await ctx.db.patch("walkthroughRequest", existingKey._id, {
        submissionKey: undefined,
      });
    }

    // Every newly observed key consumes the same bounded admission budget,
    // including equivalent aliases, so replay memory cannot grow without limit.
    const emailWindow = Math.floor(args.submittedAt / DAY) * DAY;
    const perEmailOk = await consumeWalkthroughBudget(
      ctx,
      `email:${await keyedFingerprint(normalizedEmail)}`,
      emailWindow,
      walkthroughDailyPerEmailLimit(),
    );
    if (!perEmailOk) return { accepted: false as const, inserted: false as const, reason: "unavailable" as const };
    const hour = 3_600_000;
    const globalWindow = Math.floor(args.submittedAt / hour) * hour;
    const globalOk = await consumeWalkthroughBudget(
      ctx,
      "global",
      globalWindow,
      walkthroughHourlyGlobalLimit(),
    );
    if (!globalOk) return { accepted: false as const, inserted: false as const, reason: "unavailable" as const };

    for (const key of getWalkthroughHmacVerificationKeys()) {
      const dedupeHmac = await createWalkthroughDedupeHmac(
        normalizedEmail,
        args.payloadDigest,
        key.secret,
      );
      const equivalentTombstone = await ctx.db
        .query("walkthroughRequestTombstone")
        .withIndex("by_keyVersion_and_dedupeHmac_and_expiresAt", (q) =>
          q
            .eq("keyVersion", key.version)
            .eq("dedupeHmac", dedupeHmac)
            .gt("expiresAt", args.submittedAt),
        )
        .first();
      if (equivalentTombstone) {
        const active = getActiveWalkthroughHmacKey();
        await ctx.db.insert("walkthroughRequestTombstone", {
          submissionKey: args.submissionKey,
          dedupeHmac: await createWalkthroughDedupeHmac(normalizedEmail, args.payloadDigest, active.secret),
          keyVersion: active.version,
          createdAt: args.submittedAt,
          expiresAt: Math.min(equivalentTombstone.expiresAt, args.submittedAt + 365 * DAY),
        });
        return { accepted: true as const, inserted: false as const, followUp: false };
      }
    }
    const recent = await ctx.db.query("walkthroughRequest")
      .withIndex("by_normalizedEmail_and_submittedAt", (q) => q.eq("normalizedEmail", normalizedEmail).gte("submittedAt", args.submittedAt - DAY))
      .order("desc").take(10);
    const equivalent = recent.find((row) => row.payloadDigest === args.payloadDigest);
    if (equivalent) {
      const active = getActiveWalkthroughHmacKey();
      await ctx.db.insert("walkthroughRequestTombstone", {
        submissionKey: args.submissionKey,
        dedupeHmac: await createWalkthroughDedupeHmac(normalizedEmail, args.payloadDigest, active.secret),
        keyVersion: active.version,
        createdAt: args.submittedAt,
        expiresAt: args.submittedAt + 365 * DAY,
      });
      return { accepted: true as const, inserted: false as const, followUp: Boolean(equivalent.parentRequestId) };
    }

    const parent = await ctx.db
      .query("walkthroughRequest")
      .withIndex("by_normalizedEmail_and_submittedAt", (q) =>
        q.eq("normalizedEmail", normalizedEmail),
      )
      .order("desc")
      .first();
    const requestId = await ctx.db.insert("walkthroughRequest", {
      submissionKey: args.submissionKey, payloadDigest: args.payloadDigest, name, normalizedEmail, businessName, phone, businessNeed,
      status: "open", parentRequestId: parent?._id, submittedAt: args.submittedAt, lastActivityAt: args.submittedAt,
    });
    const attemptId = await ctx.db.insert("walkthroughNotificationAttempt", { requestId, state: "pending", attemptCount: 0, createdAt: args.submittedAt, nextAttemptAt: args.submittedAt });
    await appendFunnelEventWithCtx(ctx, { event: "durable_acceptance", occurredAt: args.submittedAt });
    if (env.WALKTHROUGH_NOTIFICATIONS_DISABLED !== "true") {
      await ctx.scheduler.runAfter(
        0,
        internal.marketing.walkthroughRequestNotifications.deliver,
        { attemptId },
      );
    }
    return { accepted: true as const, inserted: true as const, followUp: Boolean(parent), requestId };
  },
});

export const listOpen = internalQuery({ args: { limit: v.optional(v.number()) }, handler: (ctx, args) => ctx.db.query("walkthroughRequest").withIndex("by_status_and_lastActivityAt", (q) => q.eq("status", "open")).order("asc").take(Math.min(100, Math.max(1, args.limit ?? 50))) });

async function audit(ctx: MutationCtx, requestId: Id<"walkthroughRequest">, operatorReference: string, action: string, priorState: string | undefined, resultingState: string, reasonCode: string, occurredAt: number) {
  await ctx.db.insert("walkthroughOperationsAudit", { requestId, operatorReference: boundedText(operatorReference, 3, 100, "operator reference"), action, priorState, resultingState, reasonCode: boundedText(reasonCode, 2, 80, "reason code"), occurredAt });
}

export const resolve = internalMutation({ args: { requestId: v.id("walkthroughRequest"), qualification: qualificationValidator, operatorReference: v.string(), reasonCode: v.string(), occurredAt: v.number() }, handler: async (ctx, args) => { const row = await ctx.db.get("walkthroughRequest", args.requestId); if (!row) throw new Error("Request not found"); if (row.status !== "open" || row.redactedAt) throw new Error("Only an open request can be resolved"); await ctx.db.patch("walkthroughRequest", row._id, { status: "resolved", qualification: args.qualification, terminalAt: args.occurredAt, lastActivityAt: args.occurredAt }); await appendFunnelAggregateWithCtx(ctx, { event: args.qualification, occurredAt: args.occurredAt }); await audit(ctx, row._id, args.operatorReference, "resolve", row.status, "resolved", args.reasonCode, args.occurredAt); return null; } });
export const abandon = internalMutation({ args: { requestId: v.id("walkthroughRequest"), operatorReference: v.string(), reasonCode: v.string(), occurredAt: v.number() }, handler: async (ctx, args) => { const row = await ctx.db.get("walkthroughRequest", args.requestId); if (!row) throw new Error("Request not found"); if (row.status !== "open" || row.redactedAt) throw new Error("Only an open request can be abandoned"); await ctx.db.patch("walkthroughRequest", row._id, { status: "abandoned", terminalAt: args.occurredAt, lastActivityAt: args.occurredAt }); await audit(ctx, row._id, args.operatorReference, "abandon", row.status, "abandoned", args.reasonCode, args.occurredAt); return null; } });
