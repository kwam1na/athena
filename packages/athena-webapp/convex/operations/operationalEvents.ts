import { internalMutation, internalQuery, MutationCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { buildOperationalEventMessage } from "./helpers/eventBuilders";

export type RecordOperationalEventArgs = {
  storeId: Id<"store">;
  organizationId?: Id<"organization">;
  eventType: string;
  subjectType: string;
  subjectId: string;
  subjectLabel?: string;
  message?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
  actorUserId?: Id<"athenaUser">;
  actorStaffProfileId?: Id<"staffProfile">;
  customerProfileId?: Id<"customerProfile">;
  workItemId?: Id<"operationalWorkItem">;
  registerSessionId?: Id<"registerSession">;
  approvalRequestId?: Id<"approvalRequest">;
  inventoryMovementId?: Id<"inventoryMovement">;
  paymentAllocationId?: Id<"paymentAllocation">;
  onlineOrderId?: Id<"onlineOrder">;
  posTransactionId?: Id<"posTransaction">;
};

export function buildOperationalEvent(args: RecordOperationalEventArgs) {
  return {
    ...args,
    message:
      args.message ??
      buildOperationalEventMessage({
        eventType: args.eventType,
        subjectType: args.subjectType,
        subjectLabel: args.subjectLabel,
      }),
    createdAt: Date.now(),
  };
}

function matchesExistingEvent(
  existingEvent: {
    eventType: string;
    subjectType: string;
    subjectId: string;
    reason?: string;
    approvalRequestId?: Id<"approvalRequest">;
    inventoryMovementId?: Id<"inventoryMovement">;
    onlineOrderId?: Id<"onlineOrder">;
    paymentAllocationId?: Id<"paymentAllocation">;
    posTransactionId?: Id<"posTransaction">;
    registerSessionId?: Id<"registerSession">;
    workItemId?: Id<"operationalWorkItem">;
  },
  args: RecordOperationalEventArgs
) {
  return (
    existingEvent.eventType === args.eventType &&
    existingEvent.subjectType === args.subjectType &&
    existingEvent.subjectId === args.subjectId &&
    existingEvent.reason === args.reason &&
    existingEvent.approvalRequestId === args.approvalRequestId &&
    existingEvent.inventoryMovementId === args.inventoryMovementId &&
    existingEvent.onlineOrderId === args.onlineOrderId &&
    existingEvent.paymentAllocationId === args.paymentAllocationId &&
    existingEvent.posTransactionId === args.posTransactionId &&
    existingEvent.registerSessionId === args.registerSessionId &&
    existingEvent.workItemId === args.workItemId
  );
}

export async function recordOperationalEventWithCtx(
  ctx: MutationCtx,
  args: RecordOperationalEventArgs
) {
  // eslint-disable-next-line @convex-dev/no-collect-in-query -- Subject-scoped dedupe must inspect the full indexed event history so idempotent replays do not create duplicates.
  const existingEvents = await ctx.db
    .query("operationalEvent")
    .withIndex("by_storeId_subject", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("subjectType", args.subjectType)
        .eq("subjectId", args.subjectId)
    )
    .collect();

  const existingEvent = existingEvents.find((event) =>
    matchesExistingEvent(event, args)
  );

  if (existingEvent) {
    return existingEvent;
  }

  const eventId = await ctx.db.insert(
    "operationalEvent",
    buildOperationalEvent(args)
  );

  return ctx.db.get("operationalEvent", eventId);
}

export const recordOperationalEvent = internalMutation({
  args: {
    storeId: v.id("store"),
    organizationId: v.optional(v.id("organization")),
    eventType: v.string(),
    subjectType: v.string(),
    subjectId: v.string(),
    message: v.optional(v.string()),
    reason: v.optional(v.string()),
    metadata: v.optional(v.record(v.string(), v.any())),
    actorUserId: v.optional(v.id("athenaUser")),
    actorStaffProfileId: v.optional(v.id("staffProfile")),
    customerProfileId: v.optional(v.id("customerProfile")),
    workItemId: v.optional(v.id("operationalWorkItem")),
    registerSessionId: v.optional(v.id("registerSession")),
    approvalRequestId: v.optional(v.id("approvalRequest")),
    inventoryMovementId: v.optional(v.id("inventoryMovement")),
    paymentAllocationId: v.optional(v.id("paymentAllocation")),
    onlineOrderId: v.optional(v.id("onlineOrder")),
    posTransactionId: v.optional(v.id("posTransaction")),
  },
  handler: (ctx, args) => recordOperationalEventWithCtx(ctx, args),
});

export const listOperationalEventsForSubject = internalQuery({
  args: {
    storeId: v.id("store"),
    subjectType: v.string(),
    subjectId: v.string(),
  },
  handler: async (ctx, args) =>
    // eslint-disable-next-line @convex-dev/no-collect-in-query -- This timeline query returns the full indexed history for one subject and should not silently truncate results.
    ctx.db
      .query("operationalEvent")
      .withIndex("by_storeId_subject", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("subjectType", args.subjectType)
          .eq("subjectId", args.subjectId)
      )
      .collect(),
});
