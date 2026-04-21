import { internalMutation, internalQuery, MutationCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { v } from "convex/values";

export type RecordPaymentAllocationArgs = {
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
};

export function buildPaymentAllocation(args: RecordPaymentAllocationArgs) {
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

function matchesExistingAllocation(
  existingAllocation: {
    allocationType: string;
    amount: number;
    collectedInStore?: boolean;
    direction: "in" | "out";
    externalReference?: string;
    method: string;
  },
  args: RecordPaymentAllocationArgs
) {
  return (
    existingAllocation.allocationType === args.allocationType &&
    existingAllocation.amount === args.amount &&
    existingAllocation.collectedInStore === (args.collectedInStore ?? false) &&
    existingAllocation.direction === (args.direction ?? "in") &&
    existingAllocation.externalReference === args.externalReference &&
    existingAllocation.method === args.method
  );
}

export async function recordPaymentAllocationWithCtx(
  ctx: MutationCtx,
  args: RecordPaymentAllocationArgs
) {
  // eslint-disable-next-line @convex-dev/no-collect-in-query -- Target-scoped dedupe needs the full indexed allocation set so replayed writes stay idempotent.
  const existingAllocations = await ctx.db
    .query("paymentAllocation")
    .withIndex("by_storeId_target", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("targetType", args.targetType)
        .eq("targetId", args.targetId)
    )
    .collect();

  const existingAllocation = existingAllocations.find((allocation) =>
    matchesExistingAllocation(allocation, args)
  );

  if (existingAllocation) {
    return existingAllocation;
  }

  const allocationId = await ctx.db.insert(
    "paymentAllocation",
    buildPaymentAllocation(args)
  );

  return ctx.db.get("paymentAllocation", allocationId);
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
  handler: (ctx, args) => recordPaymentAllocationWithCtx(ctx, args),
});

export const listPaymentAllocationsForTarget = internalQuery({
  args: {
    storeId: v.id("store"),
    targetType: v.string(),
    targetId: v.string(),
  },
  handler: async (ctx, args) =>
    // eslint-disable-next-line @convex-dev/no-collect-in-query -- This ledger helper intentionally returns the full indexed history for one target; limiting it would change semantics.
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
