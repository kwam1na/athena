import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation, type MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { getNotificationKind } from "./registry";
import { SUBSCRIPTION_RESOLUTION_CAP } from "./deliveryPolicy";

export type EmitNotificationArgs = {
  kind: string;
  storeId: Id<"store">;
  organizationId?: Id<"organization">;
  subjectType: string;
  subjectId: string;
  payload: Record<string, unknown>;
};

export type EmitNotificationResult = {
  intentId: Id<"notificationIntent">;
  created: boolean;
};

export async function scheduleNotificationWithCtx(
  ctx: Pick<MutationCtx, "scheduler">,
  args: EmitNotificationArgs & { deliverAt: number },
): Promise<Id<"_scheduled_functions">> {
  const { deliverAt, ...notification } = args;
  return ctx.scheduler.runAt(
    deliverAt,
    internal.notifications.emit.emitNotification,
    notification,
  );
}

// The one function domain code calls. Runs inside the domain mutation's
// transaction; idempotent by the kind's structural dedupe key, so replayed
// domain mutations are no-ops. Dispatch is scheduled immediately here; the
// sweeper is the safety net for crashes between this insert and the
// scheduled dispatch landing.
export async function emitNotificationWithCtx(
  ctx: MutationCtx,
  args: EmitNotificationArgs,
): Promise<EmitNotificationResult> {
  const definition = getNotificationKind(args.kind);
  const dedupeKey = definition.dedupeKey(args.payload);

  const existing = await ctx.db
    .query("notificationIntent")
    .withIndex("by_dedupeKey", (q) => q.eq("dedupeKey", dedupeKey))
    .unique();
  if (existing) {
    // A stale-close alert remains true until the close completes. If its first
    // dispatch found no EOD audience, let a later sweep re-arm the same intent
    // after subscriptions are configured. The permanent dedupe key and
    // recipient delivery keys still prevent duplicate sends.
    if (
      args.kind === "eod.stale_daily_close" &&
      existing.status === "suppressed" &&
      existing.suppressedReason === "no_recipients"
    ) {
      const deliveries = await ctx.db
        .query("notificationDelivery")
        .withIndex("by_intentId", (q) => q.eq("intentId", existing._id))
        .take(SUBSCRIPTION_RESOLUTION_CAP);
      const now = Date.now();
      for (const delivery of deliveries) {
        if (
          delivery.status !== "suppressed" ||
          delivery.errorCode !== "no_recipients"
        ) {
          continue;
        }
        await ctx.db.patch("notificationDelivery", delivery._id, {
          status: "retryable_failure",
          errorCode: undefined,
          nextAttemptAt: now,
          terminalAt: undefined,
          updatedAt: now,
        });
      }
      await ctx.db.patch("notificationIntent", existing._id, {
        status: "pending",
        suppressedReason: undefined,
      });
      await ctx.scheduler.runAfter(
        0,
        internal.notifications.dispatch.dispatchIntent,
        { intentId: existing._id },
      );
    }
    return { intentId: existing._id, created: false };
  }

  let organizationId = args.organizationId;
  if (!organizationId) {
    const store = await ctx.db.get("store", args.storeId);
    organizationId = store?.organizationId;
  }

  const intentId = await ctx.db.insert("notificationIntent", {
    kind: args.kind,
    category: definition.category,
    storeId: args.storeId,
    organizationId,
    subjectType: args.subjectType,
    subjectId: args.subjectId,
    dedupeKey,
    payload: args.payload,
    status: "pending",
    emittedAt: Date.now(),
  });

  await ctx.scheduler.runAfter(
    0,
    internal.notifications.dispatch.dispatchIntent,
    { intentId },
  );

  return { intentId, created: true };
}

export const emitNotification = internalMutation({
  args: {
    kind: v.string(),
    storeId: v.id("store"),
    organizationId: v.optional(v.id("organization")),
    subjectType: v.string(),
    subjectId: v.string(),
    payload: v.record(v.string(), v.any()),
  },
  handler: (ctx, args) => emitNotificationWithCtx(ctx, args),
});
