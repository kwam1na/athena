import { internalMutation, internalQuery } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { buildOperationalEventMessage } from "./helpers/eventBuilders";

export function buildOperationalEvent(args: {
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
}) {
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
  handler: async (ctx, args) => {
    const eventId = await ctx.db.insert(
      "operationalEvent",
      buildOperationalEvent(args)
    );

    return ctx.db.get(eventId);
  },
});

export const listOperationalEventsForSubject = internalQuery({
  args: {
    storeId: v.id("store"),
    subjectType: v.string(),
    subjectId: v.string(),
  },
  handler: async (ctx, args) =>
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
