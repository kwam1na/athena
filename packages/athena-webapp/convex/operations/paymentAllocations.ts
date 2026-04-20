import { internalMutation, internalQuery } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { v } from "convex/values";

export function buildPaymentAllocation(args: {
  storeId: Id<"store">;
  organizationId?: Id<"organization">;
  targetType: string;
  targetId: string;
  allocationType: string;
  direction?: "in" | "out";
  method: string;
  amount: number;
  currency?: string;
  collectedInStore?: boolean;
  actorUserId?: Id<"athenaUser">;
  actorStaffProfileId?: Id<"staffProfile">;
  customerProfileId?: Id<"customerProfile">;
  workItemId?: Id<"operationalWorkItem">;
  registerSessionId?: Id<"registerSession">;
  onlineOrderId?: Id<"onlineOrder">;
  posTransactionId?: Id<"posTransaction">;
  externalReference?: string;
  notes?: string;
}) {
  if (args.amount <= 0) {
    throw new Error("Payment allocation amount must be positive");
  }

  return {
    ...args,
    direction: args.direction ?? "in",
    status: "recorded" as const,
    collectedInStore: args.collectedInStore ?? false,
    recordedAt: Date.now(),
  };
}

export function summarizePaymentAllocations(
  allocations: Array<Pick<{ direction: "in" | "out"; amount: number }, "direction" | "amount">>
) {
  return allocations.reduce(
    (summary, allocation) => {
      const amount = allocation.direction === "in" ? allocation.amount : -allocation.amount;
      return {
        totalIn: summary.totalIn + (allocation.direction === "in" ? allocation.amount : 0),
        totalOut: summary.totalOut + (allocation.direction === "out" ? allocation.amount : 0),
        netAmount: summary.netAmount + amount,
      };
    },
    { totalIn: 0, totalOut: 0, netAmount: 0 }
  );
}

export const recordPaymentAllocation = internalMutation({
  args: {
    storeId: v.id("store"),
    organizationId: v.optional(v.id("organization")),
    targetType: v.string(),
    targetId: v.string(),
    allocationType: v.string(),
    direction: v.optional(v.union(v.literal("in"), v.literal("out"))),
    method: v.string(),
    amount: v.number(),
    currency: v.optional(v.string()),
    collectedInStore: v.optional(v.boolean()),
    actorUserId: v.optional(v.id("athenaUser")),
    actorStaffProfileId: v.optional(v.id("staffProfile")),
    customerProfileId: v.optional(v.id("customerProfile")),
    workItemId: v.optional(v.id("operationalWorkItem")),
    registerSessionId: v.optional(v.id("registerSession")),
    onlineOrderId: v.optional(v.id("onlineOrder")),
    posTransactionId: v.optional(v.id("posTransaction")),
    externalReference: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const allocationId = await ctx.db.insert(
      "paymentAllocation",
      buildPaymentAllocation(args)
    );

    return ctx.db.get(allocationId);
  },
});

export const listPaymentAllocationsForTarget = internalQuery({
  args: {
    storeId: v.id("store"),
    targetType: v.string(),
    targetId: v.string(),
  },
  handler: async (ctx, args) =>
    ctx.db
      .query("paymentAllocation")
      .withIndex("by_storeId_target", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("targetType", args.targetType)
          .eq("targetId", args.targetId)
      )
      .collect(),
});
