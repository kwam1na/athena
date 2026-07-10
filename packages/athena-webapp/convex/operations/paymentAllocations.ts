import { internalMutation, internalQuery, MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { recordPaymentAllocationSkuEvidenceWithCtx } from "../reporting/evidence";
import { appendReportingIngressWithCtx } from "../reporting/ingress";

export type RecordPaymentAllocationArgs = {
  storeId: Id<"store">;
  businessEventKey?: string;
  organizationId?: Id<"organization">;
  targetType: string;
  targetId: string;
  allocationType: string;
  direction?: "in" | "out";
  method: string;
  amount: number;
  currency?: string;
  evidenceProductSkuIds?: Array<Id<"productSku">>;
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
  recordedAt?: number;
};

export function buildPaymentAllocation(args: RecordPaymentAllocationArgs) {
  if (args.amount <= 0) {
    throw new Error("Payment allocation amount must be positive");
  }

  return {
    ...args,
    ...(args.evidenceProductSkuIds === undefined
      ? {}
      : {
          evidenceProductSkuIds: [...new Set(args.evidenceProductSkuIds)].sort(),
        }),
    direction: args.direction ?? "in",
    status: "recorded" as const,
    collectedInStore: args.collectedInStore ?? false,
    recordedAt: Date.now(),
    ...(args.recordedAt === undefined ? {} : { recordedAt: args.recordedAt }),
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

export function findSameAmountSinglePaymentAllocation(
  allocations: Array<
    Pick<
      Doc<"paymentAllocation">,
      "_id" | "amount" | "direction" | "method" | "status"
    >
  >,
  args: {
    amount: number;
  }
) {
  const recordedIncomingAllocations = allocations.filter(
    (allocation) =>
      allocation.status === "recorded" && allocation.direction === "in"
  );

  if (recordedIncomingAllocations.length !== 1) {
    return null;
  }

  const [allocation] = recordedIncomingAllocations;
  return allocation.amount === args.amount ? allocation : null;
}

function matchesExistingAllocation(
  existingAllocation: {
    allocationType: string;
    amount: number;
    collectedInStore?: boolean;
    direction: "in" | "out";
    externalReference?: string;
    method: string;
    businessEventKey?: string;
    organizationId?: Id<"organization">;
    targetType?: string;
    targetId?: string;
    currency?: string;
    evidenceProductSkuIds?: Array<Id<"productSku">>;
    actorUserId?: Id<"athenaUser">;
    actorStaffProfileId?: Id<"staffProfile">;
    customerProfileId?: Id<"customerProfile">;
    workItemId?: Id<"operationalWorkItem">;
    registerSessionId?: Id<"registerSession">;
    onlineOrderId?: Id<"onlineOrder">;
    posTransactionId?: Id<"posTransaction">;
    recordedAt?: number;
  },
  args: RecordPaymentAllocationArgs
) {
  const existingEvidenceSkuIds = [
    ...new Set(existingAllocation.evidenceProductSkuIds ?? []),
  ].sort();
  const requestedEvidenceSkuIds = args.evidenceProductSkuIds
    ? [...new Set(args.evidenceProductSkuIds)].sort()
    : [];
  const evidenceSkuIdsAreCompatible =
    args.evidenceProductSkuIds === undefined ||
    existingAllocation.evidenceProductSkuIds === undefined ||
    JSON.stringify(existingEvidenceSkuIds) ===
      JSON.stringify(requestedEvidenceSkuIds);
  return (
    existingAllocation.allocationType === args.allocationType &&
    existingAllocation.amount === args.amount &&
    existingAllocation.collectedInStore === (args.collectedInStore ?? false) &&
    existingAllocation.direction === (args.direction ?? "in") &&
    existingAllocation.externalReference === args.externalReference &&
    existingAllocation.method === args.method &&
    evidenceSkuIdsAreCompatible
  );
}

function matchesKeyedAllocation(
  existingAllocation: Parameters<typeof matchesExistingAllocation>[0],
  args: RecordPaymentAllocationArgs,
) {
  return (
    matchesExistingAllocation(existingAllocation, args) &&
    existingAllocation.businessEventKey === args.businessEventKey &&
    existingAllocation.organizationId === args.organizationId &&
    existingAllocation.targetType === args.targetType &&
    existingAllocation.targetId === args.targetId &&
    existingAllocation.currency === args.currency &&
    existingAllocation.actorUserId === args.actorUserId &&
    existingAllocation.actorStaffProfileId === args.actorStaffProfileId &&
    existingAllocation.customerProfileId === args.customerProfileId &&
    existingAllocation.workItemId === args.workItemId &&
    existingAllocation.registerSessionId === args.registerSessionId &&
    existingAllocation.onlineOrderId === args.onlineOrderId &&
    existingAllocation.posTransactionId === args.posTransactionId &&
    (args.recordedAt === undefined ||
      existingAllocation.recordedAt === args.recordedAt)
  );
}

export function paymentAllocationReportingIdentity(
  allocation: Pick<Doc<"paymentAllocation">, "_id" | "status">,
) {
  return `payment_allocation:${String(allocation._id)}:${allocation.status}`;
}

async function ensurePaymentAllocationReportingWithCtx(
  ctx: MutationCtx,
  allocation: Doc<"paymentAllocation">,
) {
  const store = await ctx.db.get("store", allocation.storeId);
  if (!store) throw new Error("Payment allocation store is unavailable.");
  const organizationId = allocation.organizationId ?? store.organizationId;
  const businessEventKey = paymentAllocationReportingIdentity(allocation);
  const isReversal = allocation.status === "voided";
  const isRefund = allocation.direction === "out" && !isReversal;
  const settlementAmountMinor =
    isReversal || isRefund
      ? -Math.abs(allocation.amount)
      : Math.abs(allocation.amount);
  const currencyCode = (allocation.currency ?? store.currency)
    ?.trim()
    .toUpperCase();
  const result = await appendReportingIngressWithCtx(ctx, {
    acceptedAt: allocation.recordedAt,
    adapterVersion: 1,
    businessEventKey,
    contentFingerprint: [
      "payment-allocation-v1",
      allocation._id,
      allocation.status,
      allocation.direction,
      allocation.amount,
      allocation.currency ?? store.currency,
      allocation.method,
      allocation.targetType,
      allocation.targetId,
    ].join(":"),
    ...(currencyCode ? { currencyCode, currencyMinorUnitScale: 2 } : {}),
    linkedBusinessEventKey: isReversal
      ? `payment_allocation:${String(allocation._id)}:recorded`
      : undefined,
    materialFields: [
      "amountMinor",
      "currency",
      "direction",
      "method",
      "status",
      "storeId",
    ],
    occurredAt: allocation.recordedAt,
    organizationId,
    settlementAmountMinor,
    sourceDomain: "payments",
    sourceEventType: isReversal
      ? "payment_allocation_reversed"
      : isRefund
        ? "payment_refund_recorded"
        : "payment_collection_recorded",
    sourceReferences: [
      {
        relation: isReversal ? "reverses" : "owns",
        sourceId: String(allocation._id),
        sourceType: "payment_allocation",
      },
    ],
    storeId: allocation.storeId,
  });
  if (result.kind === "conflict") return result;
  await recordPaymentAllocationSkuEvidenceWithCtx(
    ctx,
    allocation,
    organizationId,
  );
  return result;
}

export async function recordPaymentAllocationWithCtx(
  ctx: MutationCtx,
  args: RecordPaymentAllocationArgs
) {
  if (args.businessEventKey !== undefined) {
    if (!args.businessEventKey.trim()) {
      throw new Error("Payment business event key is required when provided.");
    }

    const keyedAllocations = await ctx.db
      .query("paymentAllocation")
      .withIndex("by_storeId_businessEventKey", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("businessEventKey", args.businessEventKey),
      )
      .take(2);

    if (keyedAllocations.length > 1) {
      throw new Error("Payment business event key is not unique.");
    }

    const keyedAllocation = keyedAllocations[0];
    if (keyedAllocation) {
      if (!matchesKeyedAllocation(keyedAllocation, args)) {
        throw new Error(
          "Payment business event conflicts with an existing allocation.",
        );
      }
      const replayedAllocation =
        args.evidenceProductSkuIds !== undefined &&
        keyedAllocation.evidenceProductSkuIds === undefined
          ? {
              ...keyedAllocation,
              evidenceProductSkuIds: [
                ...new Set(args.evidenceProductSkuIds),
              ].sort(),
            }
          : keyedAllocation;
      if (replayedAllocation !== keyedAllocation) {
        await ctx.db.patch("paymentAllocation", keyedAllocation._id, {
          evidenceProductSkuIds: replayedAllocation.evidenceProductSkuIds,
        });
      }
      await ensurePaymentAllocationReportingWithCtx(ctx, replayedAllocation);
      return replayedAllocation;
    }

    const allocationId = await ctx.db.insert(
      "paymentAllocation",
      buildPaymentAllocation(args),
    );
    const allocation = await ctx.db.get("paymentAllocation", allocationId);
    if (!allocation) throw new Error("Payment allocation was not persisted.");
    await ensurePaymentAllocationReportingWithCtx(ctx, allocation);
    return allocation;
  }

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
    const replayedAllocation =
      args.evidenceProductSkuIds !== undefined &&
      existingAllocation.evidenceProductSkuIds === undefined
        ? {
            ...existingAllocation,
            evidenceProductSkuIds: [
              ...new Set(args.evidenceProductSkuIds),
            ].sort(),
          }
        : existingAllocation;
    if (replayedAllocation !== existingAllocation) {
      await ctx.db.patch("paymentAllocation", existingAllocation._id, {
        evidenceProductSkuIds: replayedAllocation.evidenceProductSkuIds,
      });
    }
    await ensurePaymentAllocationReportingWithCtx(ctx, replayedAllocation);
    return replayedAllocation;
  }

  const allocationId = await ctx.db.insert(
    "paymentAllocation",
    buildPaymentAllocation(args)
  );

  const allocation = await ctx.db.get("paymentAllocation", allocationId);
  if (!allocation) throw new Error("Payment allocation was not persisted.");
  await ensurePaymentAllocationReportingWithCtx(ctx, allocation);
  return allocation;
}

export async function listPaymentAllocationsForTargetWithCtx(
  ctx: MutationCtx,
  args: {
    storeId: Id<"store">;
    targetType: string;
    targetId: string;
  }
) {
  // eslint-disable-next-line @convex-dev/no-collect-in-query -- Correction validation needs the full target-scoped ledger before mutating one allocation.
  return ctx.db
    .query("paymentAllocation")
    .withIndex("by_storeId_target", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("targetType", args.targetType)
        .eq("targetId", args.targetId)
    )
    .collect();
}

export async function correctSameAmountSinglePaymentAllocationWithCtx(
  ctx: MutationCtx,
  args: {
    storeId: Id<"store">;
    targetType: string;
    targetId: string;
    amount: number;
    method: string;
  }
) {
  const allocations = await listPaymentAllocationsForTargetWithCtx(ctx, args);
  const allocation = findSameAmountSinglePaymentAllocation(allocations, args);

  if (!allocation) {
    return null;
  }

  if (allocation.method !== args.method) {
    await ctx.db.patch("paymentAllocation", allocation._id, {
      method: args.method,
    });
  }

  return { ...allocation, method: args.method };
}

export const recordPaymentAllocation = internalMutation({
  args: {
    storeId: v.id("store"),
    businessEventKey: v.optional(v.string()),
    organizationId: v.optional(v.id("organization")),
    targetType: v.string(),
    targetId: v.string(),
    allocationType: v.string(),
    direction: v.optional(v.union(v.literal("in"), v.literal("out"))),
    method: v.string(),
    amount: v.number(),
    currency: v.optional(v.string()),
    evidenceProductSkuIds: v.optional(v.array(v.id("productSku"))),
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
    recordedAt: v.optional(v.number()),
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
