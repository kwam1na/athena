import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { recordOperationalEventWithCtx } from "../operations/operationalEvents";
import {
  MAX_DELIVERY_ATTEMPTS,
  SWEEPER_INTENT_PICKUP_DELAY_MS,
  nextBackoffMs,
} from "./deliveryPolicy";

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

    const retryBudget = limit - staleLeases.length;
    const dueRetries =
      retryBudget > 0
        ? await ctx.db
            .query("notificationDelivery")
            .withIndex("by_status_and_nextAttemptAt", (q) =>
              q.eq("status", "retryable_failure").lte("nextAttemptAt", now),
            )
            .take(retryBudget)
        : [];
    for (const delivery of dueRetries) {
      intentIdsToDispatch.add(delivery.intentId);
    }

    const intentBudget = retryBudget - dueRetries.length;
    const staleIntents =
      intentBudget > 0
        ? await ctx.db
            .query("notificationIntent")
            .withIndex("by_status_and_emittedAt", (q) =>
              q
                .eq("status", "pending")
                .lte("emittedAt", now - SWEEPER_INTENT_PICKUP_DELAY_MS),
            )
            .take(intentBudget)
        : [];
    for (const intent of staleIntents) {
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
    };
  },
});
