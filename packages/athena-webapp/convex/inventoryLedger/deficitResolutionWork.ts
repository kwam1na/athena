import { v } from "convex/values";

import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  internalAction,
  internalMutation,
  type MutationCtx,
} from "../_generated/server";
import { scheduleReportingWorkBestEffort } from "./scheduleWork";

export const DEFICIT_RESOLUTION_WORK_LIMIT = 20;
export const DEFICIT_REVENUE_COVERAGE_EVIDENCE_LIMIT = 100;
const DEFICIT_REVENUE_FACTS_PER_EFFECT_LIMIT = 20;

const deficitWorkInternal = (internal as any).reporting.inventory
  .deficitResolutionWork;

function historicalCostLane(
  lane: Doc<"reportingInventoryDeficitLot">["costLane"],
) {
  return `historical_${lane}` as const;
}

export function allocateDeferredDeficitCost(input: {
  allocatedCostMinor: number;
  nextQuantity: number;
  resolvedQuantity: number;
  totalReceiptCostMinor?: number;
  totalReceiptQuantity: number;
}) {
  if (input.totalReceiptCostMinor === undefined) {
    return { allocatedCostMinor: input.allocatedCostMinor, partCostMinor: 0 };
  }
  const targetAllocatedCost = Math.round(
    (input.totalReceiptCostMinor *
      (input.resolvedQuantity + input.nextQuantity)) /
      input.totalReceiptQuantity,
  );
  return {
    allocatedCostMinor: targetAllocatedCost,
    partCostMinor: targetAllocatedCost - input.allocatedCostMinor,
  };
}

export async function enqueueDeficitResolutionWorkWithCtx(
  ctx: MutationCtx,
  input: {
    currencyCode?: string;
    currencyMinorUnitScale?: number;
    inboundEffectId: Id<"reportingInventoryEffect">;
    ledgerId: Id<"reportingInventoryDeficitLedger">;
    occurrenceAt: number;
    operatingDate?: string;
    organizationId: Id<"organization">;
    positionId: Id<"reportingInventoryPosition">;
    productSkuId: Id<"productSku">;
    resolutionQuantity: number;
    scheduleVersionId?: Id<"storeSchedule">;
    storeId: Id<"store">;
    totalReceiptCostMinor?: number;
    totalReceiptQuantity: number;
  },
) {
  const existing = await ctx.db
    .query("reportingInventoryDeficitResolutionWork")
    .withIndex("by_inboundEffectId", (query) =>
      query.eq("inboundEffectId", input.inboundEffectId),
    )
    .first();
  if (existing) return existing._id;
  const now = Date.now();
  const workId = await ctx.db.insert(
    "reportingInventoryDeficitResolutionWork",
    {
      allocatedDeficitCostMinor: 0,
      attemptCount: 0,
      createdAt: now,
      currencyCode: input.currencyCode,
      currencyMinorUnitScale: input.currencyMinorUnitScale,
      inboundEffectId: input.inboundEffectId,
      ledgerId: input.ledgerId,
      occurrenceAt: input.occurrenceAt,
      operatingDate: input.operatingDate,
      organizationId: input.organizationId,
      positionId: input.positionId,
      productSkuId: input.productSkuId,
      remainingQuantity: input.resolutionQuantity,
      resolvedQuantity: 0,
      scheduleVersionId: input.scheduleVersionId,
      status: "pending",
      storeId: input.storeId,
      totalReceiptCostMinor: input.totalReceiptCostMinor,
      totalReceiptQuantity: input.totalReceiptQuantity,
      totalResolutionQuantity: input.resolutionQuantity,
      updatedAt: now,
    },
  );
  await scheduleReportingWorkBestEffort(
    ctx,
    deficitWorkInternal.processDeficitResolutionWork,
    { workId },
  );
  return workId;
}

async function materializeDeferredAdjustmentWithCtx(
  ctx: MutationCtx,
  input: {
    inboundEffect: Doc<"reportingInventoryEffect">;
    knownCostMinor: number;
    lot: Doc<"reportingInventoryDeficitLot">;
    quantity: number;
    work: Doc<"reportingInventoryDeficitResolutionWork">;
  },
) {
  if (!input.work.currencyCode) return;
  const businessEventKey = `${input.inboundEffect.businessEventKey}:deferred-deficit:${input.lot.outboundEffectId}`;
  const existing = await ctx.db
    .query("reportingInventoryEffect")
    .withIndex("by_storeId_sourceDomain_businessEventKey", (query) =>
      query
        .eq("storeId", input.work.storeId)
        .eq("sourceDomain", input.inboundEffect.sourceDomain)
        .eq("businessEventKey", businessEventKey),
    )
    .first();
  if (existing) return;
  const outbound = await ctx.db.get(
    "reportingInventoryEffect",
    input.lot.outboundEffectId,
  );
  if (
    !outbound ||
    outbound.organizationId !== input.work.organizationId ||
    outbound.storeId !== input.work.storeId ||
    outbound.positionId !== input.work.positionId ||
    outbound.productSkuId !== input.work.productSkuId ||
    input.lot.ledgerId !== input.work.ledgerId ||
    input.lot.positionId !== input.work.positionId
  ) {
    throw new Error(
      "Deferred deficit outbound evidence is outside the work scope",
    );
  }
  const now = Date.now();
  const adjustmentId = await ctx.db.insert("reportingInventoryEffect", {
    businessEventKey,
    completeness: input.inboundEffect.completeness,
    contentFingerprint: `deferred-deficit-resolution:v1:${input.work._id}:${input.lot.outboundEffectId}:${input.quantity}:${input.knownCostMinor}`,
    costLane: historicalCostLane(input.lot.costLane),
    costedQuantityDelta: 0,
    createdAt: now,
    currencyCode: input.work.currencyCode,
    currencyMinorUnitScale: input.work.currencyMinorUnitScale,
    effectType: "deficit_resolution",
    knownCostPoolDeltaMinor: 0,
    linkedOutboundEffectId: input.lot.outboundEffectId,
    occurrenceAt: input.work.occurrenceAt,
    operatingDate: input.work.operatingDate,
    organizationId: input.work.organizationId,
    physicalQuantityDelta: 0,
    positionId: input.work.positionId,
    productSkuId: input.work.productSkuId,
    revaluedQuantity: input.quantity,
    scheduleVersionId: input.work.scheduleVersionId,
    sellableQuantityDelta: 0,
    sourceDomain: input.inboundEffect.sourceDomain,
    storeId: input.work.storeId,
    uncostedQuantityDelta: 0,
    unresolvedDeficitDelta: 0,
    valuationStatus: "current",
    outboundBasisMinor: input.knownCostMinor,
  });
  const adjustment = await ctx.db.get("reportingInventoryEffect", adjustmentId);
  if (!adjustment)
    throw new Error("Deferred deficit adjustment was not persisted");
  await ctx.db.insert("reportingInventoryEffectSourceReference", {
    createdAt: now,
    effectId: adjustmentId,
    relation: historicalCostLane(input.lot.costLane),
    sourceId: String(input.lot.outboundEffectId),
    sourceType: "reportingInventoryBusinessEvent",
    storeId: input.work.storeId,
  });
}

export const processDeficitResolutionWorkMutation = internalMutation({
  args: { workId: v.id("reportingInventoryDeficitResolutionWork") },
  handler: async (ctx, args) => {
    const work = await ctx.db.get(
      "reportingInventoryDeficitResolutionWork",
      args.workId,
    );
    if (!work || work.status === "completed" || work.status === "failed")
      return;
    const inboundEffect = await ctx.db.get(
      "reportingInventoryEffect",
      work.inboundEffectId,
    );
    if (!inboundEffect) throw new Error("Deferred inbound effect is missing");
    const position = await ctx.db.get(
      "reportingInventoryPosition",
      work.positionId,
    );
    if (!position || position.deficitLedgerId !== work.ledgerId) {
      throw new Error("Deferred deficit ledger is no longer active");
    }
    const lots = await ctx.db
      .query("reportingInventoryDeficitLot")
      .withIndex("by_ledgerId_status_occurredAt_outboundEffectId", (query) =>
        query.eq("ledgerId", work.ledgerId).eq("status", "open"),
      )
      .order("asc")
      .take(DEFICIT_RESOLUTION_WORK_LIMIT);
    let remaining = work.remainingQuantity;
    let resolved = work.resolvedQuantity;
    let allocatedCost = work.allocatedDeficitCostMinor;
    let touched = 0;
    for (const lot of lots) {
      if (remaining === 0) break;
      const quantity = Math.min(remaining, lot.remainingQuantity);
      const nextResolved = resolved + quantity;
      const allocation = allocateDeferredDeficitCost({
        allocatedCostMinor: allocatedCost,
        nextQuantity: quantity,
        resolvedQuantity: resolved,
        totalReceiptCostMinor: work.totalReceiptCostMinor,
        totalReceiptQuantity: work.totalReceiptQuantity,
      });
      const targetAllocatedCost = allocation.allocatedCostMinor;
      const knownCostMinor = allocation.partCostMinor;
      if (work.totalReceiptCostMinor !== undefined) {
        await materializeDeferredAdjustmentWithCtx(ctx, {
          inboundEffect,
          knownCostMinor,
          lot,
          quantity,
          work,
        });
      }
      const lotRemaining = lot.remainingQuantity - quantity;
      await ctx.db.patch("reportingInventoryDeficitLot", lot._id, {
        remainingQuantity: lotRemaining,
        resolvedAt: lotRemaining === 0 ? Date.now() : undefined,
        status: lotRemaining === 0 ? "resolved" : "open",
        updatedAt: Date.now(),
      });
      allocatedCost = targetAllocatedCost;
      remaining -= quantity;
      resolved = nextResolved;
      touched += 1;
    }
    if (remaining > 0 && touched < DEFICIT_RESOLUTION_WORK_LIMIT) {
      throw new Error("Deferred deficit evidence is incomplete");
    }
    const now = Date.now();
    const completed = remaining === 0;
    await ctx.db.patch("reportingInventoryDeficitResolutionWork", work._id, {
      allocatedDeficitCostMinor: allocatedCost,
      attemptCount: work.attemptCount + 1,
      completedAt: completed ? now : undefined,
      remainingQuantity: remaining,
      resolvedQuantity: resolved,
      status: completed ? "completed" : "running",
      updatedAt: now,
    });
    if (!completed) {
      await ctx.scheduler.runAfter(
        0,
        deficitWorkInternal.processDeficitResolutionWork,
        { workId: work._id },
      );
    }
  },
});

export const recordDeficitResolutionWorkFailure = internalMutation({
  args: {
    safeCode: v.string(),
    workId: v.id("reportingInventoryDeficitResolutionWork"),
  },
  handler: async (ctx, args) => {
    const work = await ctx.db.get(
      "reportingInventoryDeficitResolutionWork",
      args.workId,
    );
    if (!work || work.status === "completed") return;
    const now = Date.now();
    await ctx.db.patch("reportingInventoryDeficitResolutionWork", work._id, {
      attemptCount: work.attemptCount + 1,
      latestFailureAt: now,
      latestFailureCode: args.safeCode,
      status: "failed",
      updatedAt: now,
    });
  },
});

export const processDeficitResolutionWork = internalAction({
  args: { workId: v.id("reportingInventoryDeficitResolutionWork") },
  handler: async (ctx, args) => {
    try {
      await ctx.runMutation(
        deficitWorkInternal.processDeficitResolutionWorkMutation,
        args,
      );
    } catch {
      await ctx.runMutation(
        deficitWorkInternal.recordDeficitResolutionWorkFailure,
        { safeCode: "deficit_resolution_worker_failed", workId: args.workId },
      );
    }
  },
});

export const resumeDeficitResolutionWorkForStore = internalMutation({
  args: { storeId: v.id("store") },
  handler: async (ctx, args) => {
    const [pending, failed] = await Promise.all([
      ctx.db
        .query("reportingInventoryDeficitResolutionWork")
        .withIndex("by_storeId_status_updatedAt", (query) =>
          query.eq("storeId", args.storeId).eq("status", "pending"),
        )
        .take(DEFICIT_RESOLUTION_WORK_LIMIT),
      ctx.db
        .query("reportingInventoryDeficitResolutionWork")
        .withIndex("by_storeId_status_updatedAt", (query) =>
          query.eq("storeId", args.storeId).eq("status", "failed"),
        )
        .take(DEFICIT_RESOLUTION_WORK_LIMIT),
    ]);
    const rows = [...pending, ...failed]
      .sort((left, right) => left.updatedAt - right.updatedAt)
      .slice(0, DEFICIT_RESOLUTION_WORK_LIMIT);
    for (const work of rows) {
      await ctx.db.patch("reportingInventoryDeficitResolutionWork", work._id, {
        status: "pending",
        updatedAt: Date.now(),
      });
      await scheduleReportingWorkBestEffort(
        ctx,
        deficitWorkInternal.processDeficitResolutionWork,
        { workId: work._id },
      );
    }
    return { inspectedCount: rows.length };
  },
});
