import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation, type MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

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



// A delivery whose intent has been suppressed (abandoned mid-chain, or
// suppressed for any other reason after its rows existed) must be terminalized
// rather than left non-terminal: reserveIntentDeliveries returns early for a
// suppressed intent without touching rows, so the row would otherwise be
// re-selected by this sweep on every tick forever. Because nextAttemptAt never
// advances for such a row and the retry index is ascending, a handful of them
// would sort to the front and permanently consume the whole retry budget,
// killing the retry backstop for every other notification.
async function terminalizeOrphanedDelivery(
  ctx: MutationCtx,
  deliveryId: Id<"notificationDelivery">,
  now: number,
) {
  await ctx.db.patch("notificationDelivery", deliveryId, {
    status: "suppressed",
    errorCode: "intent_suppressed",
    leaseToken: undefined,
    leaseExpiresAt: undefined,
    nextAttemptAt: undefined,
    terminalAt: now,
    updatedAt: now,
  });
}

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
    // Tracked separately so staleLeasesRecovered stays honest: an orphan under
    // a suppressed intent was terminalized, not recovered for another attempt.
    let leaseOrphans = 0;
    let retryOrphans = 0;
    for (const delivery of staleLeases) {
      const leaseIntent = await ctx.db.get(
        "notificationIntent",
        delivery.intentId,
      );
      if (leaseIntent?.status === "suppressed") {
        await terminalizeOrphanedDelivery(ctx, delivery._id, now);
        leaseOrphans += 1;
        continue;
      }
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
        // Same subject key shape as completeDelivery's terminal path, so a
        // delivery that fails once does not produce two differently-keyed
        // events depending on which path noticed. Scheduled rather than
        // inline: see recordNotificationFailureEvent.
        // Guarded on the intent only because the scheduled recorder needs it
        // to resolve the subject; nothing deletes intents today, so this is
        // unreachable rather than a deliberate skip.
        if (intent) {
          await ctx.scheduler.runAfter(
            0,
            internal.notifications.dispatch.recordNotificationFailureEvent,
            {
              intentId: intent._id,
              errorCode: "stale_delivery_lease",
              message: `Notification ${delivery.kind} could not be delivered after ${delivery.attemptCount} attempts.`,
              subjectKey: String(delivery._id),
            },
          );
        }
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
      const retryIntent = await ctx.db.get(
        "notificationIntent",
        delivery.intentId,
      );
      if (retryIntent?.status === "suppressed") {
        await terminalizeOrphanedDelivery(ctx, delivery._id, now);
        retryOrphans += 1;
        continue;
      }
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
      const eligibleFrom = Math.max(
        intent.emittedAt,
        intent.requeuedAt ?? 0,
      );
      if (now - eligibleFrom > INTENT_ABANDON_AFTER_MS) {
        await ctx.db.patch("notificationIntent", intent._id, {
          status: "suppressed",
          suppressedReason: "dispatch_unrecoverable",
        });
        await ctx.scheduler.runAfter(
          0,
          internal.notifications.dispatch.recordNotificationFailureEvent,
          {
            intentId: intent._id,
            errorCode: "dispatch_unrecoverable",
            message: `Notification ${intent.kind} could not be dispatched within ${Math.round(INTENT_ABANDON_AFTER_MS / 3_600_000)}h (${sweepAttempts} attempts); intent abandoned. Requeue with notifications.sweeper.requeueAbandonedIntent once the cause is fixed.`,
            // Keyed on the attempt generation, not just the intent: a requeue
            // starts a new generation, so a second abandonment after a failed
            // recovery records its own event instead of being deduped away.
            subjectKey: `${intent._id}:abandoned:${eligibleFrom}`,
          },
        );
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

    if (
      staleLeases.length >= limit ||
      dueRetries.length >= limit ||
      staleIntents.length >= limit
    ) {
      // The cron discards this mutation's return value, so a saturated phase
      // is otherwise invisible until someone reads function logs on purpose.
      console.warn(
        `[notifications] sweep saturated a phase (staleLeases=${staleLeases.length}, dueRetries=${dueRetries.length}, pendingIntents=${staleIntents.length}, limit=${limit})`,
      );
    }

    return {
      staleLeasesRecovered: staleLeases.length - terminaled - leaseOrphans,
      terminaled,
      dispatchesScheduled: intentIdsToDispatch.size,
      intentsAbandoned,
      orphansTerminalized: leaseOrphans + retryOrphans,
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
      // emittedAt is preserved: it is the audit record of when the domain
      // moment happened. requeuedAt restarts the abandonment clock without
      // rewriting that history.
      requeuedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(
      0,
      internal.notifications.dispatch.dispatchIntent,
      { intentId: intent._id },
    );
    return true;
  },
});
