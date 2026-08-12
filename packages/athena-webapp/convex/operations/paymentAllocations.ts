import { internalMutation, internalQuery, MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { recordFacts } from "../reports/ingest";
import {
  normalizeReportPaymentMethod,
  type NewReportFact,
  type ReportPaymentMethod,
} from "../../shared/reportsContract";

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
      | "_id"
      | "amount"
      | "direction"
      | "method"
      | "posTransactionId"
      | "recordedAt"
      | "status"
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

/**
 * The allocation record is the payment source of truth, so it can state
 * allocation coverage without exposing a tender method to Reports.
 */
export function paymentAllocationReportingDimensions(
  allocation: Pick<Doc<"paymentAllocation">, "amount" | "direction" | "status">,
) {
  const amountMinor = Math.abs(allocation.amount);
  const isReversal = allocation.status === "voided";
  const isRefund = allocation.direction === "out" && !isReversal;

  return {
    factKind: isReversal || isRefund ? ("payment_refund" as const) : ("payment" as const),
    amountMinor,
    paymentAllocationMinor: isReversal || isRefund ? -amountMinor : amountMinor,
    paymentAllocationCoverage: "known" as const,
  };
}

/**
 * The Daily Close-aligned participation identity for one allocation.
 *
 * A POS transaction is the unit Daily Close counts (`buildPaymentTotals`), so
 * several same-method allocations on one transaction are ONE tender use. An
 * allocation with no POS transaction has no such grouping to belong to, so it
 * stands for itself — which keeps non-POS receipts independently countable.
 *
 * Kept here, centrally, rather than asked of each payment source: the plan's
 * scope boundary is one derivation from fields `paymentAllocation` already has.
 */
export function paymentAllocationParticipationId(
  allocation: Pick<Doc<"paymentAllocation">, "_id" | "posTransactionId">,
): string {
  return allocation.posTransactionId
    ? String(allocation.posTransactionId)
    : String(allocation._id);
}

/**
 * The gross payment-mix contribution of one allocation, or null when there is
 * none to make.
 *
 * This describes a RECEIPT — money that came in — so it follows the emitted
 * fact kind, not the allocation's later fate. An inbound allocation that was
 * subsequently voided still contributes its gross method value on the day it
 * was received: the reversal moves settlement, and reducing gross mix would
 * leave the day's rows unable to reconcile to its own `paymentsCollectedMinor`,
 * which counts that receipt either way. Outbound refunds contribute nothing.
 *
 * An unsupported or blank method is evidence reporting cannot classify — the
 * value still counts toward Payments totals, the mix just cannot be published.
 *
 * Callers apply this only where they emit a `payment` fact; a `payment_refund`
 * never carries mix dimensions.
 */
export function paymentAllocationMixDimensions(
  allocation: Pick<
    Doc<"paymentAllocation">,
    "_id" | "amount" | "direction" | "method" | "posTransactionId"
  >,
): {
  paymentMethod: ReportPaymentMethod;
  paymentParticipationId: string;
  paymentMixMinor: number;
} | null {
  if (allocation.direction === "out") return null;
  const paymentMethod = normalizeReportPaymentMethod(allocation.method);
  if (!paymentMethod) return null;

  return {
    paymentMethod,
    paymentParticipationId: paymentAllocationParticipationId(allocation),
    paymentMixMinor: Math.abs(allocation.amount),
  };
}

/**
 * KEEP IN SYNC WITH convex/reports/reseed.ts (`paymentFacts`).
 *
 * Reseed re-derives a whole allocation's evidence; the live path emits the one
 * event that just happened. The two must agree on what each allocation SHAPE
 * looks like in the fact stream, including the shapes no live event can date:
 * a legacy voided row (no `voidedAt`) and a voided outbound refund. Those
 * cannot be filed as a dated reversal without inventing a time, so they are
 * recorded with unknown allocation coverage — omitted value, disclosed — rather
 * than dropped, which would silently understate the day's payment volume.
 */
async function ensurePaymentAllocationReportingWithCtx(
  ctx: MutationCtx,
  allocation: Doc<"paymentAllocation">,
) {
  const store = await ctx.db.get("store", allocation.storeId);
  if (!store) throw new Error("Payment allocation store is unavailable.");
  const posture = paymentAllocationReportingDimensions(allocation);
  const currencyCode = (allocation.currency ?? store.currency)
    ?.trim()
    .toUpperCase();

  const base = {
    sourceDomain: "payments" as const,
    sourceId: String(allocation._id),
    lineId: "",
    currency: currencyCode ?? store.currency,
    grossAmountMinor: posture.amountMinor,
    netAmountMinor: posture.amountMinor,
    taxAmountMinor: 0,
    discountAmountMinor: 0,
    quantity: 0,
  };

  const isUndatedVoid =
    allocation.status === "voided" && allocation.voidedAt === undefined;
  const isVoidedRefund =
    allocation.status === "voided" && allocation.direction === "out";

  const fact: NewReportFact =
    isUndatedVoid || isVoidedRefund
      ? {
          ...base,
          // The reversal date is never guessed from `recordedAt`; only the
          // original event time is source-proven, and coverage stays unknown.
          factKind: isVoidedRefund ? "payment_refund" : "payment",
          occurredAt: allocation.recordedAt,
          paymentAllocationCoverage: "unknown",
          // An undated void still emits its ORIGINAL receipt, so the gross
          // method evidence rides along; only settlement coverage is unknown.
          ...(isVoidedRefund
            ? {}
            : (paymentAllocationMixDimensions(allocation) ?? {})),
        }
      : {
          ...base,
          factKind: posture.factKind,
          occurredAt:
            allocation.status === "voided"
              ? allocation.voidedAt!
              : allocation.recordedAt,
          paymentAllocationMinor: posture.paymentAllocationMinor,
          paymentAllocationCoverage: posture.paymentAllocationCoverage,
          // Only a `payment` fact is a receipt. A timed void emits a
          // `payment_refund` here, and refunds carry no gross mix evidence.
          ...(posture.factKind === "payment"
            ? (paymentAllocationMixDimensions(allocation) ?? {})
            : {}),
        };

  await recordFacts(ctx, allocation.storeId, [fact]);
}

/**
 * Operator/maintenance surface: no domain flow voids an allocation yet, and
 * this is deliberately reachable only from internal callers until one does.
 * Registered as `voidPaymentAllocation` (internalMutation) — never public.
 */
export async function voidPaymentAllocationWithCtx(
  ctx: MutationCtx,
  allocationId: Id<"paymentAllocation">,
) {
  const allocation = await ctx.db.get("paymentAllocation", allocationId);
  if (!allocation) throw new Error("Payment allocation was not found.");
  if (allocation.status === "voided") return allocation;

  const voidedAt = Date.now();
  await ctx.db.patch("paymentAllocation", allocation._id, {
    status: "voided",
    voidedAt,
  });
  const voidedAllocation = { ...allocation, status: "voided" as const, voidedAt };
  await ensurePaymentAllocationReportingWithCtx(ctx, voidedAllocation);
  return voidedAllocation;
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

/** Internal maintenance tooling — kept pending a domain caller. Not public. */
export const voidPaymentAllocation = internalMutation({
  args: { paymentAllocationId: v.id("paymentAllocation") },
  handler: (ctx, args) =>
    voidPaymentAllocationWithCtx(ctx, args.paymentAllocationId),
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
