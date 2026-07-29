import { v } from "convex/values";
import { internal } from "../_generated/api";
import {
  internalAction,
  internalMutation,
  type MutationCtx,
} from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { ADMIN_EMAILS } from "../constants/email";
import { recordOperationalEventWithCtx } from "../operations/operationalEvents";
import {
  MAX_DELIVERIES_PER_DISPATCH,
  MAX_DELIVERY_ATTEMPTS,
  computeDeliveryLeaseMs,
  nextDispatchDelayMs,
  deliveryDedupeKey,
  nextBackoffMs,
  normalizeRecipientEmail,
} from "./deliveryPolicy";
import {
  findNotificationKind,
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
  // True when the audience was larger than one dispatch's batch, so a
  // follow-on dispatch is needed to reach the remaining recipients.
  hasMore: boolean;
};

// The fallback is a PRE-SEED bridge, so it keys off "this org has no
// subscription rows for this category at all" — never off "no row matched".
// Keying off the filtered result would invert the feature: disabling every
// subscription in a category, or scoping subscriptions to one store, would
// silently re-broadcast to the hardcoded admin list instead of narrowing the
// audience.
function resolveRecipients(
  subscriptions: Doc<"notificationSubscription">[],
  storeId: Id<"store">,
): Array<{ email: string; name?: string }> {
  const source =
    subscriptions.length === 0
      ? ADMIN_EMAILS.map((recipient) => ({
          email: recipient.email,
          name: recipient.name as string | undefined,
        }))
      : subscriptions
          .filter(
            (subscription) =>
              subscription.enabled &&
              subscription.channel === "email" &&
              (!subscription.storeId || subscription.storeId === storeId),
          )
          .map((subscription) => ({
            email: subscription.recipientEmail,
            name: subscription.recipientName,
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

async function suppressIntentWithCtx(
  ctx: MutationCtx,
  intent: Doc<"notificationIntent">,
  reason: string,
) {
  const now = Date.now();
  await ctx.db.patch("notificationIntent", intent._id, {
    status: "suppressed",
    suppressedReason: reason.slice(0, 64),
  });
  // Suppression must cover every non-terminal delivery for the intent, not
  // just the batch a caller happened to hold leases for. A sibling left in
  // retryable_failure would otherwise be re-selected by the sweeper forever
  // while its intent refuses to reserve.
  const deliveries = await ctx.db
    .query("notificationDelivery")
    .withIndex("by_intentId", (q) => q.eq("intentId", intent._id))
    .take(SUBSCRIPTION_RESOLUTION_CAP);
  for (const delivery of deliveries) {
    if (
      delivery.status === "sent" ||
      delivery.status === "terminal_failure" ||
      delivery.status === "suppressed"
    ) {
      continue;
    }
    await ctx.db.patch("notificationDelivery", delivery._id, {
      status: "suppressed",
      errorCode: reason.slice(0, 64),
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      nextAttemptAt: undefined,
      terminalAt: now,
      updatedAt: now,
    });
  }
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

    const definition = findNotificationKind(intent.kind);
    if (!definition) {
      // A kind removed or renamed by a later deploy would otherwise throw here
      // on every dispatch and every sweep, leaving the intent pending forever
      // at the head of the sweeper's queue. Terminalize it loudly instead.
      await suppressIntentWithCtx(ctx, intent, "unknown_kind");
      await recordNotificationFailureEventWithCtx(ctx, {
        intent,
        errorCode: "unknown_kind",
        message: `Notification kind ${intent.kind} is not registered; intent suppressed.`,
        subjectKey: String(intent._id),
      });
      return null;
    }
    const now = Date.now();

    if (!definition.channels.includes("email")) {
      // In-app is schema-supported but stubbed; a kind with no email channel
      // has nothing to deliver yet. Suppress rather than mark dispatched so a
      // registry edit that drops the email channel cannot strand existing
      // non-terminal deliveries in the sweeper's budget forever.
      await suppressIntentWithCtx(ctx, intent, "no_deliverable_channel");
      await recordNotificationFailureEventWithCtx(ctx, {
        intent,
        errorCode: "no_deliverable_channel",
        message: `Notification ${intent.kind} has no deliverable channel and was not sent.`,
        subjectKey: `${intent._id}:no_deliverable_channel`,
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
          .take(SUBSCRIPTION_RESOLUTION_CAP + 1)
      : [];
    // Silent truncation would drop the most recently added subscribers with
    // no delivery row and no trace. Surface it instead of hiding it.
    if (subscriptions.length > SUBSCRIPTION_RESOLUTION_CAP) {
      await recordNotificationFailureEventWithCtx(ctx, {
        intent,
        errorCode: "subscription_cap_exceeded",
        message: `Notification audience for ${intent.category} exceeds ${SUBSCRIPTION_RESOLUTION_CAP} subscriptions; some recipients were not resolved.`,
        subjectKey: `${intent._id}:subscription_cap`,
      });
      subscriptions.length = SUBSCRIPTION_RESOLUTION_CAP;
    }
    const recipients = resolveRecipients(subscriptions, intent.storeId);

    if (recipients.length === 0) {
      // An explicitly empty audience is a real configuration, not a success.
      await suppressIntentWithCtx(ctx, intent, "no_recipients");
      await recordNotificationFailureEventWithCtx(ctx, {
        intent,
        errorCode: "no_recipients",
        message: `Notification ${intent.kind} had no ${intent.category} subscribers and was not sent.`,
        subjectKey: `${intent._id}:no_recipients`,
      });
      return null;
    }

    // Recipients that dropped out of the audience (unsubscribed, removed from
    // ADMIN_EMAILS, re-scoped) leave non-terminal deliveries that reserve
    // would never touch again — they would be re-selected by the sweeper on
    // every tick forever, consuming its budget. Terminalize them here.
    const activeEmails = new Set(recipients.map((entry) => entry.email));
    const existingDeliveries = await ctx.db
      .query("notificationDelivery")
      .withIndex("by_intentId", (q) => q.eq("intentId", intent._id))
      .take(SUBSCRIPTION_RESOLUTION_CAP);
    for (const delivery of existingDeliveries) {
      const stranded =
        !activeEmails.has(normalizeRecipientEmail(delivery.recipientEmail)) &&
        (delivery.status === "retryable_failure" ||
          delivery.status === "outcome_unknown");
      if (!stranded) continue;
      await ctx.db.patch("notificationDelivery", delivery._id, {
        status: "suppressed",
        errorCode: "recipient_unsubscribed",
        leaseToken: undefined,
        leaseExpiresAt: undefined,
        nextAttemptAt: undefined,
        terminalAt: now,
        updatedAt: now,
      });
    }

    const batchSize = Math.min(recipients.length, MAX_DELIVERIES_PER_DISPATCH);
    const leaseMs = computeDeliveryLeaseMs(batchSize);
    const leased: LeasedDelivery[] = [];
    // hasMore drives SCHEDULING (another pass is needed); materialization
    // drives the intent's STATUS. They are not the same: an intent whose whole
    // audience already has rows can still fill a batch with due retries, and
    // treating that as "un-materialized" would move the intent backwards from
    // dispatched to pending, re-expose it to the abandonment clock, and label
    // a partially-delivered notification "dispatch_unrecoverable".
    const recipientsWithRows = new Set(
      existingDeliveries.map((delivery) =>
        normalizeRecipientEmail(delivery.recipientEmail),
      ),
    );
    let hasMore = false;
    for (const recipient of recipients) {
      if (leased.length >= MAX_DELIVERIES_PER_DISPATCH) {
        hasMore = true;
        break;
      }
      recipientsWithRows.add(recipient.email);
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
          leaseExpiresAt: now + leaseMs,
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
        leaseExpiresAt: now + leaseMs,
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

    // The un-leased tail of a large audience has no delivery rows yet, so it
    // exists only in the in-memory hasMore flag and the action's follow-on
    // schedule. Leaving the intent "pending" until the audience is fully
    // materialized keeps the sweeper's pending-intent phase as the backstop:
    // if the continuation is lost (action killed after the last completion,
    // or the schedule never commits), the sweep re-dispatches, and the
    // abandonment clock eventually reports it. Marking it "dispatched" here
    // would make the tail invisible to every sweeper phase.
    const audienceMaterialized = recipients.every((recipient) =>
      recipientsWithRows.has(recipient.email),
    );
    await ctx.db.patch("notificationIntent", intent._id, {
      status: audienceMaterialized ? "dispatched" : "pending",
      dispatchedAt: intent.dispatchedAt ?? now,
    });

    return {
      intent: {
        intentId: intent._id,
        kind: intent.kind,
        payload: intent.payload,
      },
      leased,
      hasMore,
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
export async function recordNotificationFailureEventWithCtx(
  ctx: MutationCtx,
  args: {
    intent: Doc<"notificationIntent">;
    errorCode: string;
    message: string;
    subjectKey: string;
  },
) {
  await recordOperationalEventWithCtx(ctx, {
    storeId: args.intent.storeId,
    organizationId: args.intent.organizationId,
    eventType: "notification_delivery_failed",
    subjectType: args.intent.subjectType,
    subjectId: args.intent.subjectId,
    actorType: "automation",
    message: args.message,
    metadata: {
      notificationKind: args.intent.kind,
      notificationIntentId: String(args.intent._id),
      notificationSubjectKey: args.subjectKey,
      errorCode: args.errorCode,
    },
    metadataDedupeKeys: ["notificationSubjectKey"],
  });
}

async function recordTerminalDeliveryFailureEvent(
  ctx: MutationCtx,
  delivery: Doc<"notificationDelivery">,
  errorCode: string,
) {
  const intent = await ctx.db.get("notificationIntent", delivery.intentId);
  if (!intent) return;
  await recordNotificationFailureEventWithCtx(ctx, {
    intent,
    errorCode,
    message: `Notification ${delivery.kind} could not be delivered after ${delivery.attemptCount} attempts.`,
    subjectKey: String(delivery._id),
  });
}

// Recording an operational event scans the subject's full event history, so
// a caller that needs many of them (the sweeper, during a mass failure) must
// schedule these individually rather than doing them inline — 25 stale leases
// plus 25 abandoned intents in one transaction is enough scanning to blow the
// read limit and roll back the entire sweep, permanently disabling the rail's
// only safety net.
export const recordNotificationFailureEvent = internalMutation({
  args: {
    intentId: v.id("notificationIntent"),
    errorCode: v.string(),
    message: v.string(),
    subjectKey: v.string(),
  },
  handler: async (ctx, args) => {
    const intent = await ctx.db.get("notificationIntent", args.intentId);
    if (!intent) return null;
    await recordNotificationFailureEventWithCtx(ctx, {
      intent,
      errorCode: args.errorCode,
      message: args.message,
      subjectKey: args.subjectKey,
    });
    return null;
  },
});

export const markIntentSuppressed = internalMutation({
  args: {
    intentId: v.id("notificationIntent"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const intent = await ctx.db.get("notificationIntent", args.intentId);
    if (!intent || intent.status === "suppressed") return null;
    await suppressIntentWithCtx(ctx, intent, args.reason);
    // Suppression permanently occupies the intent's dedupeKey, so a dropped
    // alert must leave a trace on the subject's operational timeline rather
    // than only a row in a table nothing queries.
    await recordNotificationFailureEventWithCtx(ctx, {
      intent,
      errorCode: args.reason,
      message: `Notification ${intent.kind} was suppressed (${args.reason}) and will not be delivered.`,
      subjectKey: `${intent._id}:${args.reason}`,
    });
    return null;
  },
});

// Reserve -> render fresh -> send -> complete. Rendering happens once per
// dispatch (recipients share content). A null from prepareEmail means the
// subject is genuinely no longer sendable and the batch suppresses; a THROW
// is a transient fault (read limit, OCC, momentarily missing row) and must
// stay retryable — collapsing the two would let one flaky query permanently
// silence an alert.
export const dispatchIntent = internalAction({
  args: { intentId: v.id("notificationIntent") },
  handler: async (ctx, args) => {
    const reserved: ReservedIntentBatch | null = await ctx.runMutation(
      internal.notifications.dispatch.reserveIntentDeliveries,
      { intentId: args.intentId },
    );
    if (!reserved || reserved.leased.length === 0) return null;

    const definition = findNotificationKind(reserved.intent.kind);
    if (!definition) return null;

    let prepared: PreparedNotificationEmail | null = null;
    let prepareError: unknown = null;
    try {
      prepared = await definition.prepareEmail(ctx, reserved.intent.payload);
    } catch (error) {
      prepareError = error;
    }

    if (prepareError) {
      console.error(
        `[notifications] prepareEmail failed for ${reserved.intent.kind}`,
        prepareError,
      );
      let earliestPrepareRetryAt: number | null = null;
      for (const lease of reserved.leased) {
        const now = Date.now();
        const canRetry = lease.attemptCount < MAX_DELIVERY_ATTEMPTS;
        const nextAttemptAt = canRetry
          ? now + nextBackoffMs(lease.attemptCount)
          : undefined;
        await ctx.runMutation(internal.notifications.dispatch.completeDelivery, {
          deliveryId: lease.deliveryId,
          leaseToken: lease.leaseToken,
          state: canRetry ? "retryable_failure" : "terminal_failure",
          errorCode: "payload_error",
          nextAttemptAt,
        });
        if (nextAttemptAt) {
          earliestPrepareRetryAt =
            earliestPrepareRetryAt === null
              ? nextAttemptAt
              : Math.min(earliestPrepareRetryAt, nextAttemptAt);
        }
      }
      // Continue the chain even when the whole batch is at the attempt cap:
      // the tail recipients have no rows yet and are nobody else's job.
      const prepareDelay = nextDispatchDelayMs({
        hasMore: reserved.hasMore,
        earliestRetryAt: earliestPrepareRetryAt,
        now: Date.now(),
      });
      if (prepareDelay !== null) {
        await ctx.scheduler.runAfter(
          prepareDelay,
          internal.notifications.dispatch.dispatchIntent,
          { intentId: args.intentId },
        );
      }
      return null;
    }

    if (!prepared) {
      for (const lease of reserved.leased) {
        await ctx.runMutation(internal.notifications.dispatch.completeDelivery, {
          deliveryId: lease.deliveryId,
          leaseToken: lease.leaseToken,
          state: "suppressed",
          errorCode: "payload_unavailable",
        });
      }
      await ctx.runMutation(
        internal.notifications.dispatch.markIntentSuppressed,
        { intentId: args.intentId, reason: "payload_unavailable" },
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

    const nextDelay = nextDispatchDelayMs({
      hasMore: reserved.hasMore,
      earliestRetryAt,
      now: Date.now(),
    });
    if (nextDelay !== null) {
      await ctx.scheduler.runAfter(
        nextDelay,
        internal.notifications.dispatch.dispatchIntent,
        { intentId: args.intentId },
      );
    }
    return null;
  },
});
