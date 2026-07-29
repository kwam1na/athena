import { v } from "convex/values";
import { internal } from "../_generated/api";
import {
  internalAction,
  internalMutation,
} from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { ADMIN_EMAILS } from "../constants/email";
import { recordOperationalEventWithCtx } from "../operations/operationalEvents";
import {
  DELIVERY_LEASE_MS,
  MAX_DELIVERY_ATTEMPTS,
  deliveryDedupeKey,
  nextBackoffMs,
  normalizeRecipientEmail,
} from "./deliveryPolicy";
import {
  getNotificationKind,
  type PreparedNotificationEmail,
} from "./registry";
import { sendNotificationEmail } from "./transport";

const SUBSCRIPTION_RESOLUTION_CAP = 200;

type LeasedDelivery = {
  deliveryId: Id<"notificationDelivery">;
  leaseToken: string;
  attemptCount: number;
  recipientEmail: string;
  recipientName?: string;
};

type ReservedIntentBatch = {
  intent: {
    intentId: Id<"notificationIntent">;
    kind: string;
    payload: Record<string, unknown>;
  };
  leased: LeasedDelivery[];
};

function resolveRecipients(
  subscriptions: Doc<"notificationSubscription">[],
  storeId: Id<"store">,
): Array<{ email: string; name?: string }> {
  const matching = subscriptions.filter(
    (subscription) =>
      subscription.enabled &&
      subscription.channel === "email" &&
      (!subscription.storeId || subscription.storeId === storeId),
  );
  const source =
    matching.length > 0
      ? matching.map((subscription) => ({
          email: subscription.recipientEmail,
          name: subscription.recipientName,
        }))
      : // Pre-seed fallback: identical behavior to the legacy admin loops, so
        // the rail has no deploy-ordering dependency on the subscription seed.
        ADMIN_EMAILS.map((recipient) => ({
          email: recipient.email,
          name: recipient.name as string | undefined,
        }));

  const byEmail = new Map<string, { email: string; name?: string }>();
  for (const recipient of source) {
    const normalized = normalizeRecipientEmail(recipient.email);
    if (!byEmail.has(normalized)) {
      byEmail.set(normalized, { email: normalized, name: recipient.name });
    }
  }
  return [...byEmail.values()];
}

// Reserving IS leasing: eligible deliveries leave this mutation in_flight
// with a fresh lease token, and only that token can complete them. Rows that
// are already sent, suppressed, terminal, under a live lease, waiting on a
// future retry, or at the attempt cap are skipped.
export const reserveIntentDeliveries = internalMutation({
  args: { intentId: v.id("notificationIntent") },
  handler: async (ctx, args): Promise<ReservedIntentBatch | null> => {
    const intent = await ctx.db.get("notificationIntent", args.intentId);
    if (!intent || intent.status === "suppressed") return null;

    const definition = getNotificationKind(intent.kind);
    const now = Date.now();

    if (!definition.channels.includes("email")) {
      // In-app is schema-supported but stubbed; a kind with no email channel
      // has nothing to deliver yet.
      await ctx.db.patch("notificationIntent", intent._id, {
        status: "dispatched",
        dispatchedAt: intent.dispatchedAt ?? now,
      });
      return null;
    }

    const subscriptions = intent.organizationId
      ? await ctx.db
          .query("notificationSubscription")
          .withIndex("by_organizationId_and_category", (q) =>
            q
              .eq("organizationId", intent.organizationId!)
              .eq("category", intent.category),
          )
          .take(SUBSCRIPTION_RESOLUTION_CAP)
      : [];
    const recipients = resolveRecipients(subscriptions, intent.storeId);

    const leased: LeasedDelivery[] = [];
    for (const recipient of recipients) {
      const dedupeKey = deliveryDedupeKey({
        intentDedupeKey: intent.dedupeKey,
        channel: "email",
        recipientEmail: recipient.email,
      });
      const existing = await ctx.db
        .query("notificationDelivery")
        .withIndex("by_dedupeKey", (q) => q.eq("dedupeKey", dedupeKey))
        .unique();

      if (existing) {
        const liveLease =
          existing.status === "in_flight" &&
          (existing.leaseExpiresAt ?? 0) > now;
        const futureRetry =
          existing.status === "retryable_failure" &&
          (existing.nextAttemptAt ?? 0) > now;
        const terminal =
          existing.status === "sent" ||
          existing.status === "terminal_failure" ||
          existing.status === "outcome_unknown" ||
          existing.status === "suppressed";
        if (
          terminal ||
          liveLease ||
          futureRetry ||
          existing.attemptCount >= MAX_DELIVERY_ATTEMPTS
        ) {
          continue;
        }
        const leaseToken = crypto.randomUUID();
        await ctx.db.patch("notificationDelivery", existing._id, {
          status: "in_flight",
          attemptCount: existing.attemptCount + 1,
          leaseToken,
          leaseExpiresAt: now + DELIVERY_LEASE_MS,
          nextAttemptAt: undefined,
          errorCode: undefined,
          updatedAt: now,
        });
        leased.push({
          deliveryId: existing._id,
          leaseToken,
          attemptCount: existing.attemptCount + 1,
          recipientEmail: recipient.email,
          recipientName: recipient.name,
        });
        continue;
      }

      const leaseToken = crypto.randomUUID();
      const deliveryId = await ctx.db.insert("notificationDelivery", {
        intentId: intent._id,
        kind: intent.kind,
        category: intent.category,
        channel: "email",
        storeId: intent.storeId,
        organizationId: intent.organizationId,
        recipientEmail: recipient.email,
        recipientName: recipient.name,
        dedupeKey,
        status: "in_flight",
        attemptCount: 1,
        leaseToken,
        leaseExpiresAt: now + DELIVERY_LEASE_MS,
        createdAt: now,
        updatedAt: now,
      });
      leased.push({
        deliveryId,
        leaseToken,
        attemptCount: 1,
        recipientEmail: recipient.email,
        recipientName: recipient.name,
      });
    }

    await ctx.db.patch("notificationIntent", intent._id, {
      status: "dispatched",
      dispatchedAt: intent.dispatchedAt ?? now,
    });

    return {
      intent: {
        intentId: intent._id,
        kind: intent.kind,
        payload: intent.payload,
      },
      leased,
    };
  },
});

export const completeDelivery = internalMutation({
  args: {
    deliveryId: v.id("notificationDelivery"),
    leaseToken: v.string(),
    state: v.union(
      v.literal("sent"),
      v.literal("retryable_failure"),
      v.literal("terminal_failure"),
      v.literal("suppressed"),
    ),
    errorCode: v.string(),
    providerMessageId: v.optional(v.string()),
    nextAttemptAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const delivery = await ctx.db.get("notificationDelivery", args.deliveryId);
    if (
      !delivery ||
      delivery.status !== "in_flight" ||
      delivery.leaseToken !== args.leaseToken
    ) {
      return null;
    }

    const now = Date.now();
    await ctx.db.patch("notificationDelivery", delivery._id, {
      status: args.state,
      errorCode: args.errorCode.slice(0, 64),
      providerMessageId: args.providerMessageId?.slice(0, 160),
      nextAttemptAt: args.nextAttemptAt,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      sentAt: args.state === "sent" ? now : undefined,
      terminalAt:
        args.state === "terminal_failure" || args.state === "suppressed"
          ? now
          : undefined,
      updatedAt: now,
    });

    if (args.state === "terminal_failure") {
      await recordTerminalDeliveryFailureEvent(ctx, delivery, args.errorCode);
    }
    return null;
  },
});

// An admin alert that permanently failed to send is itself an operational
// event — it must surface somewhere reviewable, not vanish into a table.
async function recordTerminalDeliveryFailureEvent(
  ctx: Parameters<typeof recordOperationalEventWithCtx>[0],
  delivery: Doc<"notificationDelivery">,
  errorCode: string,
) {
  const intent = await ctx.db.get("notificationIntent", delivery.intentId);
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
      errorCode,
    },
    metadataDedupeKeys: ["deliveryId"],
  });
}

export const markIntentSuppressed = internalMutation({
  args: {
    intentId: v.id("notificationIntent"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const intent = await ctx.db.get("notificationIntent", args.intentId);
    if (!intent) return null;
    await ctx.db.patch("notificationIntent", intent._id, {
      status: "suppressed",
      suppressedReason: args.reason.slice(0, 64),
    });
    return null;
  },
});

// Reserve -> render fresh -> send -> complete. Rendering happens once per
// dispatch (recipients share content); a null or throwing prepareEmail means
// the subject is no longer sendable and the whole batch suppresses.
export const dispatchIntent = internalAction({
  args: { intentId: v.id("notificationIntent") },
  handler: async (ctx, args) => {
    const reserved: ReservedIntentBatch | null = await ctx.runMutation(
      internal.notifications.dispatch.reserveIntentDeliveries,
      { intentId: args.intentId },
    );
    if (!reserved || reserved.leased.length === 0) return null;

    const definition = getNotificationKind(reserved.intent.kind);
    let prepared: PreparedNotificationEmail | null = null;
    let prepareFailed = false;
    try {
      prepared = await definition.prepareEmail(ctx, reserved.intent.payload);
    } catch {
      prepareFailed = true;
    }

    if (!prepared) {
      const reason = prepareFailed ? "payload_error" : "payload_unavailable";
      for (const lease of reserved.leased) {
        await ctx.runMutation(internal.notifications.dispatch.completeDelivery, {
          deliveryId: lease.deliveryId,
          leaseToken: lease.leaseToken,
          state: "suppressed",
          errorCode: reason,
        });
      }
      await ctx.runMutation(
        internal.notifications.dispatch.markIntentSuppressed,
        { intentId: args.intentId, reason },
      );
      return null;
    }

    let earliestRetryAt: number | null = null;
    for (const lease of reserved.leased) {
      const result = await sendNotificationEmail({
        deliveryId: String(lease.deliveryId),
        recipientEmail: lease.recipientEmail,
        recipientName: lease.recipientName,
        subject: prepared.subject,
        html: prepared.html,
      });
      const now = Date.now();
      const canRetry =
        result.state === "retryable_failure" &&
        lease.attemptCount < MAX_DELIVERY_ATTEMPTS;
      const state =
        result.state === "retryable_failure" && !canRetry
          ? "terminal_failure"
          : result.state;
      const nextAttemptAt = canRetry
        ? now + nextBackoffMs(lease.attemptCount)
        : undefined;
      await ctx.runMutation(internal.notifications.dispatch.completeDelivery, {
        deliveryId: lease.deliveryId,
        leaseToken: lease.leaseToken,
        state,
        errorCode: result.code,
        providerMessageId: result.providerMessageId,
        nextAttemptAt,
      });
      if (nextAttemptAt) {
        earliestRetryAt =
          earliestRetryAt === null
            ? nextAttemptAt
            : Math.min(earliestRetryAt, nextAttemptAt);
      }
    }

    if (earliestRetryAt !== null) {
      await ctx.scheduler.runAfter(
        Math.max(0, earliestRetryAt - Date.now()),
        internal.notifications.dispatch.dispatchIntent,
        { intentId: args.intentId },
      );
    }
    return null;
  },
});
