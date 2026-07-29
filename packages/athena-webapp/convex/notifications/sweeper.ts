import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { recordOperationalEventWithCtx } from "../operations/operationalEvents";
import {
  INTENT_ABANDON_AFTER_MS,
  MAX_DELIVERY_ATTEMPTS,
  SWEEPER_INTENT_PICKUP_DELAY_MS,
  nextBackoffMs,
} from "./deliveryPolicy";

// Each phase gets its own budget rather than sharing one. A shared budget lets
// a backlog in an earlier phase (say, mass lease expiry after an outage)
// starve the later phases to zero work on every tick, which disables the only
// safety net the rail has.
const DEFAULT_SWEEP_LIMIT = 25;



// The safety net that makes delivery eventual. Immediate dispatch via
// runAfter(0) is the fast path; this sweep recovers everything that path can
// drop: expired in_flight leases (crashed dispatch actions), retryable
// failures whose backoff has elapsed, and intents whose scheduled dispatch
// never landed. Work left behind by a crashed sweep is simply picked up on
// the next tick.
export const sweep = internalMutation({
  args: {
    now: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const limit = Math.min(
      DEFAULT_SWEEP_LIMIT,
      Math.max(1, args.limit ?? DEFAULT_SWEEP_LIMIT),
    );

    const staleLeases = await ctx.db
      .query("notificationDelivery")
      .withIndex("by_status_and_leaseExpiresAt", (q) =>
        q.eq("status", "in_flight").lte("leaseExpiresAt", now),
      )
      .take(limit);
    let terminaled = 0;
    for (const delivery of staleLeases) {
      if (delivery.attemptCount >= MAX_DELIVERY_ATTEMPTS) {
        await ctx.db.patch("notificationDelivery", delivery._id, {
          status: "terminal_failure",
          errorCode: "stale_delivery_lease",
          leaseToken: undefined,
          leaseExpiresAt: undefined,
          nextAttemptAt: undefined,
          terminalAt: now,
          updatedAt: now,
        });
        const intent = await ctx.db.get(
          "notificationIntent",
          delivery.intentId,
        );
        await recordOperationalEventWithCtx(ctx, {
          storeId: delivery.storeId,
          organizationId: delivery.organizationId,
          eventType: "notification_delivery_failed",
          subjectType: intent?.subjectType ?? "notificationIntent",
          subjectId: intent?.subjectId ?? String(delivery.intentId),
          actorType: "automation",
          message: `Notification ${delivery.kind} could not be delivered after ${delivery.attemptCount} attempts.`,
          metadata: {
            notificationKind: delivery.kind,
            deliveryId: String(delivery._id),
            errorCode: "stale_delivery_lease",
          },
          metadataDedupeKeys: ["deliveryId"],
        });
        terminaled += 1;
      } else {
        await ctx.db.patch("notificationDelivery", delivery._id, {
          status: "retryable_failure",
          errorCode: "stale_delivery_lease",
          leaseToken: undefined,
          leaseExpiresAt: undefined,
          nextAttemptAt: now + nextBackoffMs(delivery.attemptCount),
          updatedAt: now,
        });
      }
    }

    const intentIdsToDispatch = new Set<Id<"notificationIntent">>();

    const dueRetries = await ctx.db
      .query("notificationDelivery")
      .withIndex("by_status_and_nextAttemptAt", (q) =>
        q.eq("status", "retryable_failure").lte("nextAttemptAt", now),
      )
      .take(limit);
    for (const delivery of dueRetries) {
      intentIdsToDispatch.add(delivery.intentId);
    }

    const staleIntents = await ctx.db
      .query("notificationIntent")
      .withIndex("by_status_and_emittedAt", (q) =>
        q
          .eq("status", "pending")
          .lte("emittedAt", now - SWEEPER_INTENT_PICKUP_DELAY_MS),
      )
      .take(limit);
    let intentsAbandoned = 0;
    for (const intent of staleIntents) {
      const sweepAttempts = (intent.sweepAttempts ?? 0) + 1;
      // Written in the sweeper's own transaction, so it survives a reserve
      // that throws and rolls back its own writes. Diagnostic only —
      // abandonment is decided by age so the threshold does not shift with
      // the environment's sweep cadence.
      await ctx.db.patch("notificationIntent", intent._id, { sweepAttempts });
      if (now - intent.emittedAt > INTENT_ABANDON_AFTER_MS) {
        await ctx.db.patch("notificationIntent", intent._id, {
          status: "suppressed",
          suppressedReason: "dispatch_unrecoverable",
        });
        await recordOperationalEventWithCtx(ctx, {
          storeId: intent.storeId,
          organizationId: intent.organizationId,
          eventType: "notification_delivery_failed",
          subjectType: intent.subjectType,
          subjectId: intent.subjectId,
          actorType: "automation",
          message: `Notification ${intent.kind} could not be dispatched within ${Math.round(INTENT_ABANDON_AFTER_MS / 3_600_000)}h (${sweepAttempts} attempts); intent abandoned. Requeue with notifications.sweeper.requeueAbandonedIntent once the cause is fixed.`,
          metadata: {
            notificationKind: intent.kind,
            notificationSubjectKey: String(intent._id),
            errorCode: "dispatch_unrecoverable",
          },
          metadataDedupeKeys: ["notificationSubjectKey"],
        });
        intentsAbandoned += 1;
        continue;
      }
      intentIdsToDispatch.add(intent._id);
    }

    for (const intentId of intentIdsToDispatch) {
      await ctx.scheduler.runAfter(
        0,
        internal.notifications.dispatch.dispatchIntent,
        { intentId },
      );
    }

    return {
      staleLeasesRecovered: staleLeases.length - terminaled,
      terminaled,
      dispatchesScheduled: intentIdsToDispatch.size,
      intentsAbandoned,
      // Surfaced so a saturated phase is visible in cron output rather than
      // silently truncated.
      staleLeaseBacklog: staleLeases.length >= limit,
      retryBacklog: dueRetries.length >= limit,
      pendingIntentBacklog: staleIntents.length >= limit,
    };
  },
});

// Recovery path for abandoned intents. Abandonment occupies the intent's
// dedupeKey forever, so emit() will not re-create the same domain moment;
// without this an operator would have to hand-edit rows. Run once the cause
// (bad deploy, unregistered kind) is fixed.
export const requeueAbandonedIntent = internalMutation({
  args: { intentId: v.id("notificationIntent") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const intent = await ctx.db.get("notificationIntent", args.intentId);
    if (
      !intent ||
      intent.status !== "suppressed" ||
      intent.suppressedReason !== "dispatch_unrecoverable"
    ) {
      return false;
    }
    await ctx.db.patch("notificationIntent", intent._id, {
      status: "pending",
      suppressedReason: undefined,
      sweepAttempts: 0,
      emittedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(
      0,
      internal.notifications.dispatch.dispatchIntent,
      { intentId: intent._id },
    );
    return true;
  },
});
