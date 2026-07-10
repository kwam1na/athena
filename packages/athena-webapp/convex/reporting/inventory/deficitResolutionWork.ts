import { v } from "convex/values";

import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import {
  internalAction,
  internalMutation,
  type MutationCtx,
} from "../../_generated/server";
import {
  recordFactSkuEvidenceWithCtx,
  recordInventoryEffectSkuEvidenceWithCtx,
} from "../evidence";
import {
  scheduleFactProjectionBatchWithCtx,
  scheduleInventoryEffectProjectionWithCtx,
} from "../projectionWork";
import { scheduleReportingWorkBestEffort } from "../scheduling";

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

export function allocateDeferredCoveredRevenue(input: {
  nextQuantity: number;
  originalAmountMinor?: number;
  originalCostedQuantity?: number;
  originalCoveredRevenueMinor?: number;
  originalQuantity?: number;
  priorCoveredRevenueMinor?: number;
  priorResolutionQuantities: number[];
}) {
  if (
    input.priorResolutionQuantities.length >
    DEFICIT_REVENUE_COVERAGE_EVIDENCE_LIMIT
  ) {
    throw new Error(
      "Deferred revenue coverage evidence exceeds the supported limit",
    );
  }
  const totalQuantity = Math.abs(input.originalQuantity ?? 0);
  const amountMinor = Math.abs(input.originalAmountMinor ?? 0);
  if (totalQuantity === 0) {
    throw new Error("Deferred revenue coverage is missing original quantity");
  }
  const originalCostedQuantity = Math.min(
    totalQuantity,
    Math.max(0, Math.abs(input.originalCostedQuantity ?? 0)),
  );
  const eligibleQuantity = totalQuantity - originalCostedQuantity;
  const originalCoveredRevenueMinor = Math.min(
    amountMinor,
    Math.max(
      0,
      Math.abs(
        input.originalCoveredRevenueMinor ??
          Math.round((amountMinor * originalCostedQuantity) / totalQuantity),
      ),
    ),
  );
  const uncoveredRevenueMinor = amountMinor - originalCoveredRevenueMinor;
  const resolvedQuantity = input.priorResolutionQuantities.reduce(
    (total, quantity) => {
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error(
          "Deferred revenue coverage evidence has invalid quantity",
        );
      }
      return total + quantity;
    },
    0,
  );
  if (!Number.isFinite(input.nextQuantity) || input.nextQuantity <= 0) {
    throw new Error("Deferred revenue coverage requires a positive quantity");
  }
  if (
    eligibleQuantity <= 0 ||
    resolvedQuantity > eligibleQuantity ||
    resolvedQuantity + input.nextQuantity > eligibleQuantity
  ) {
    throw new Error(
      "Deferred revenue coverage exceeds eligible unknown quantity",
    );
  }
  if (amountMinor === 0) {
    return {
      allocatedCoveredRevenueMinor: 0,
      partCoveredRevenueMinor: 0,
      resolvedQuantity,
    };
  }
  const priorTarget = Math.round(
    (uncoveredRevenueMinor * resolvedQuantity) / eligibleQuantity,
  );
  const allocatedCoveredRevenueMinor = Math.round(
    (uncoveredRevenueMinor * (resolvedQuantity + input.nextQuantity)) /
      eligibleQuantity,
  );
  const priorCoveredRevenueMinor =
    input.priorCoveredRevenueMinor ?? priorTarget;
  if (
    !Number.isSafeInteger(priorCoveredRevenueMinor) ||
    priorCoveredRevenueMinor < 0 ||
    priorCoveredRevenueMinor > uncoveredRevenueMinor
  ) {
    throw new Error("Deferred revenue coverage has invalid prior allocation");
  }
  return {
    allocatedCoveredRevenueMinor,
    partCoveredRevenueMinor:
      allocatedCoveredRevenueMinor - priorCoveredRevenueMinor,
    resolvedQuantity,
  };
}

export async function resolveDeficitCoveredRevenueWithCtx(
  ctx: MutationCtx,
  input: {
    excludeResolutionEffectId?: Id<"reportingInventoryEffect">;
    nextQuantity: number;
    organizationId: Id<"organization">;
    outbound: Doc<"reportingInventoryEffect">;
    positionId: Id<"reportingInventoryPosition">;
    productSkuId: Id<"productSku">;
    storeId: Id<"store">;
  },
) {
  if (
    input.outbound.organizationId !== input.organizationId ||
    input.outbound.storeId !== input.storeId ||
    input.outbound.positionId !== input.positionId ||
    input.outbound.productSkuId !== input.productSkuId
  ) {
    throw new Error(
      "Deferred deficit outbound evidence is outside the work scope",
    );
  }
  const [sourceFacts, resolutionEvidence] = await Promise.all([
    ctx.db
      .query("reportingFact")
      .withIndex("by_inventoryEffectId", (query) =>
        query.eq("inventoryEffectId", input.outbound._id),
      )
      .take(20),
    ctx.db
      .query("reportingInventoryEffect")
      .withIndex("by_linkedOutboundEffectId_effectType", (query) =>
        query
          .eq("linkedOutboundEffectId", input.outbound._id)
          .eq("effectType", "deficit_resolution"),
      )
      .take(
        DEFICIT_REVENUE_COVERAGE_EVIDENCE_LIMIT +
          (input.excludeResolutionEffectId ? 2 : 1),
      ),
  ]);
  const originalFact = sourceFacts.find(
    (fact) =>
      fact.sourceDomain !== "inventory" &&
      ["correction", "sale", "void"].includes(fact.factType),
  );
  const exactResolutionEvidence = resolutionEvidence.filter(
    (effect) =>
      effect._id !== input.excludeResolutionEffectId &&
      effect.linkedOutboundEffectId === input.outbound._id &&
      effect.effectType === "deficit_resolution",
  );
  if (
    exactResolutionEvidence.length > DEFICIT_REVENUE_COVERAGE_EVIDENCE_LIMIT
  ) {
    throw new Error(
      "Deferred revenue coverage evidence exceeds the supported limit",
    );
  }
  for (const effect of exactResolutionEvidence) {
    if (
      effect.organizationId !== input.organizationId ||
      effect.storeId !== input.storeId ||
      effect.positionId !== input.positionId ||
      effect.productSkuId !== input.productSkuId
    ) {
      throw new Error(
        "Deferred deficit resolution evidence is outside the work scope",
      );
    }
  }
  if (!originalFact) {
    return { coveredRevenueMinor: 0, originalFact: undefined };
  }
  const priorFactPages = await Promise.all(
    exactResolutionEvidence.map((effect) =>
      ctx.db
        .query("reportingFact")
        .withIndex("by_inventoryEffectId", (query) =>
          query.eq("inventoryEffectId", effect._id),
        )
        .take(DEFICIT_REVENUE_FACTS_PER_EFFECT_LIMIT + 1),
    ),
  );
  if (
    priorFactPages.some(
      (facts) => facts.length > DEFICIT_REVENUE_FACTS_PER_EFFECT_LIMIT,
    )
  ) {
    throw new Error(
      "Deferred revenue fact evidence exceeds the supported limit",
    );
  }
  if (
    originalFact.organizationId !== undefined &&
    (originalFact.organizationId !== input.organizationId ||
      originalFact.storeId !== input.storeId ||
      originalFact.productSkuId !== input.productSkuId)
  ) {
    throw new Error("Deferred revenue fact evidence is outside the work scope");
  }
  const originalRevenueCurrency =
    originalFact.revenueCurrencyCode ?? originalFact.currencyCode;
  let priorCoveredRevenueMinor = 0;
  for (const fact of priorFactPages.flat()) {
    if (
      fact.status !== "canonical" ||
      fact.adjustmentKind !== "deficit_cogs_revaluation" ||
      fact.businessEventKey.startsWith("occurrence-replay")
    ) {
      continue;
    }
    if (
      fact.organizationId !== input.organizationId ||
      fact.storeId !== input.storeId ||
      fact.productSkuId !== input.productSkuId
    ) {
      throw new Error(
        "Deferred revenue fact evidence is outside the work scope",
      );
    }
    const factRevenueCurrency = fact.revenueCurrencyCode ?? fact.currencyCode;
    if (
      (fact.coveredRevenueMinor ?? 0) !== 0 &&
      originalRevenueCurrency &&
      factRevenueCurrency &&
      factRevenueCurrency !== originalRevenueCurrency
    ) {
      throw new Error("Deferred revenue coverage currency changed");
    }
    priorCoveredRevenueMinor += fact.coveredRevenueMinor ?? 0;
  }
  const originalQuantity = Math.abs(originalFact.quantity ?? 0);
  const originalCostedQuantity =
    originalFact.cogsKnownQuantity ??
    (originalFact.costStatus === "known" ? originalQuantity : 0);
  const allocation = allocateDeferredCoveredRevenue({
    nextQuantity: input.nextQuantity,
    originalAmountMinor: originalFact.amountMinor,
    originalCostedQuantity,
    originalCoveredRevenueMinor: originalFact.coveredRevenueMinor,
    originalQuantity,
    priorCoveredRevenueMinor,
    priorResolutionQuantities: exactResolutionEvidence.map((effect) => {
      if (effect.revaluedQuantity === undefined) {
        throw new Error(
          "Deferred deficit resolution evidence is missing quantity",
        );
      }
      return effect.revaluedQuantity;
    }),
  });
  return {
    coveredRevenueMinor: allocation.partCoveredRevenueMinor,
    originalFact,
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
  const isMerchandiseAdjustment = input.lot.costLane === "merchandise_cogs";
  const isExchangeAdjustment =
    input.lot.costLane === "exchange_merchandise_cogs";
  let originalFact: Doc<"reportingFact"> | undefined;
  let coveredRevenueMinor = 0;
  if (isMerchandiseAdjustment) {
    const coverage = await resolveDeficitCoveredRevenueWithCtx(ctx, {
      nextQuantity: input.quantity,
      organizationId: input.work.organizationId,
      outbound,
      positionId: input.work.positionId,
      productSkuId: input.work.productSkuId,
      storeId: input.work.storeId,
    });
    coveredRevenueMinor = coverage.coveredRevenueMinor;
    originalFact = coverage.originalFact;
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
  await recordInventoryEffectSkuEvidenceWithCtx(ctx, adjustment);
  if (outbound.operatingDate && outbound.scheduleVersionId) {
    const factId = await ctx.db.insert("reportingFact", {
      acceptedAt: now,
      ...(isMerchandiseAdjustment
        ? { adjustmentKind: "deficit_cogs_revaluation" as const }
        : {}),
      amountMinor: 0,
      businessEventKey: `${businessEventKey}:post_close_adjustment`,
      cogsKnownMinor: input.knownCostMinor,
      completeness: input.inboundEffect.completeness,
      contentFingerprint: `deferred-deficit-cogs:v1:${adjustmentId}:${input.knownCostMinor}:${coveredRevenueMinor}`,
      costStatus: "known",
      coveredRevenueMinor,
      createdAt: now,
      currencyCode: input.work.currencyCode,
      currencyMinorUnitScale: input.work.currencyMinorUnitScale,
      factContractVersion: 1,
      factType: isMerchandiseAdjustment
        ? "post_close_adjustment"
        : input.lot.costLane === "inventory_consumed" || isExchangeAdjustment
          ? "inventory_issue"
          : "inventory_adjustment",
      ...(input.lot.costLane === "inventory_consumed"
        ? { inventoryContributionKind: "inventory_consumed" as const }
        : isExchangeAdjustment
          ? { inventoryContributionKind: "exchange_replacement_cogs" as const }
          : {}),
      inventoryEffectId: adjustmentId,
      linkedBusinessEventKey: outbound.businessEventKey,
      metricContractVersion: 1,
      occurrenceAt: outbound.occurrenceAt,
      operatingDate: outbound.operatingDate,
      organizationId: input.work.organizationId,
      productSkuId: input.work.productSkuId,
      quantity:
        input.lot.costLane === "inventory_consumed" ? 0 : input.quantity,
      recognitionAt: outbound.occurrenceAt,
      revenueCurrencyCode:
        originalFact?.revenueCurrencyCode ?? originalFact?.currencyCode,
      revenueCurrencyMinorUnitScale:
        originalFact?.revenueCurrencyMinorUnitScale ??
        originalFact?.currencyMinorUnitScale,
      scheduleVersionId: outbound.scheduleVersionId,
      sourceDomain: "inventory",
      status: "canonical",
      storeId: input.work.storeId,
      valuationCurrencyCode: input.work.currencyCode,
      valuationCurrencyMinorUnitScale: input.work.currencyMinorUnitScale,
    });
    const fact = await ctx.db.get("reportingFact", factId);
    if (!fact) throw new Error("Deferred deficit fact was not persisted");
    await ctx.db.insert("reportingFactSourceReference", {
      createdAt: now,
      factId,
      relation: "owns",
      sourceId: String(adjustmentId),
      sourceType: "reporting_inventory_effect",
      storeId: input.work.storeId,
    });
    await recordFactSkuEvidenceWithCtx(ctx, fact);
    await scheduleFactProjectionBatchWithCtx(ctx, [factId]);
  }
  await scheduleInventoryEffectProjectionWithCtx(ctx, adjustmentId);
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
