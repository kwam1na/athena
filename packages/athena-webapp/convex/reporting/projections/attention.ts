import { v } from "convex/values";

import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../../_generated/server";
import {
  REPORTING_ATTENTION_RULE_VERSION,
  evaluateAttention,
  type ReportingAttentionInput,
  type ReportingAttentionReason,
  type ReportingAttentionRoute,
} from "../attentionRules";
import { resolveReportingOperatingPeriodWithCtx } from "../operatingPeriods";

export const ATTENTION_SOURCE_LIMIT = 5;

type ReportingCompleteness =
  | "complete"
  | "provisional"
  | "partial"
  | "stale"
  | "unavailable";

type SourceProjectionKind =
  | "store_day"
  | "sku_day"
  | "current_inventory"
  | "custom_range";

type SourceGenerationStatus =
  | "building"
  | "catching_up"
  | "reconciling"
  | "verified"
  | "active"
  | "superseded"
  | "failed";

export type AttentionProjectionSourceInput = {
  completeness: ReportingCompleteness;
  generationId: string;
  limitingReason?: string;
  projectionKind: SourceProjectionKind;
  sourceWatermark: number;
  stableWatermark?: number;
  status: SourceGenerationStatus;
};

type AttentionValues = Omit<
  ReportingAttentionInput,
  "completenessLimitation" | "requiredSourceCoverageComplete" | "skuId"
>;

export type AttentionProjectionInput = {
  attentionGenerationId: string;
  factContractVersion: number;
  metricContractVersion: number;
  organizationId: string;
  productSkuId?: string;
  projectionContractVersion: number;
  scope: "store" | "sku";
  sourceInputs: AttentionProjectionSourceInput[];
  storeId: string;
  values: AttentionValues;
};

const COMPLETENESS_RANK: Record<ReportingCompleteness, number> = {
  complete: 0,
  provisional: 1,
  partial: 2,
  stale: 3,
  unavailable: 4,
};

const STORE_PRECEDENCE = ["source_integrity", "cash_variance"] as const;

export const REPORTING_ATTENTION_DESTINATIONS = {
  cash_controls: { label: "Cash Controls", type: "cash_controls" },
  procurement: { label: "Procurement", type: "procurement" },
  product_edit: { label: "Product editor", type: "product_edit" },
  sku_activity: { label: "SKU Activity", type: "sku_activity" },
  terminal_health: { label: "Terminal Health", type: "terminal_health" },
  transactions: { label: "Transactions", type: "transactions" },
} as const satisfies Record<
  ReportingAttentionRoute,
  { label: string; type: ReportingAttentionRoute }
>;

function projectionCompleteness(sourceInputs: AttentionProjectionSourceInput[]) {
  return sourceInputs.reduce<ReportingCompleteness>(
    (worst, source) => {
      const sourceCompleteness =
        source.limitingReason === "projection_stale"
          ? "stale"
          : source.limitingReason && source.completeness === "complete"
            ? "partial"
            : source.completeness;
      return COMPLETENESS_RANK[sourceCompleteness] > COMPLETENESS_RANK[worst]
        ? sourceCompleteness
        : worst;
    },
    "complete",
  );
}

export function assertAttentionSourceCoverage(input: {
  persisted: {
    completeness: ReportingCompleteness;
    limitingReason?: string;
  };
  requested: {
    completeness: ReportingCompleteness;
    limitingReason?: string;
  };
}) {
  if (
    input.persisted.completeness !== input.requested.completeness ||
    input.persisted.limitingReason !== input.requested.limitingReason
  ) {
    throw new Error("attention source coverage does not match persisted generation truth");
  }
}

export function buildAttentionProjection(input: AttentionProjectionInput) {
  if (input.sourceInputs.length === 0 || input.sourceInputs.length > ATTENTION_SOURCE_LIMIT) {
    throw new Error("attention requires a bounded set of verified source generations");
  }
  if (
    new Set(input.sourceInputs.map((source) => source.generationId)).size !==
    input.sourceInputs.length
  ) {
    throw new Error("attention source generations must be unique");
  }
  if (
    input.sourceInputs.some(
      (source) =>
        (source.status !== "verified" && source.status !== "active") ||
        source.stableWatermark === undefined,
    )
  ) {
    throw new Error("attention requires stable verified source generations");
  }
  if (input.scope === "sku" && !input.productSkuId) {
    throw new Error("SKU attention requires a SKU");
  }
  if (input.scope === "store" && input.productSkuId) {
    throw new Error("Store attention cannot be bound to a SKU");
  }

  const completeness = projectionCompleteness(input.sourceInputs);
  const coverageComplete = completeness === "complete";
  const completenessLimitation = coverageComplete
    ? undefined
    : "Attention is limited to positive known signals because one or more verified projection inputs are incomplete.";
  const evaluated = evaluateAttention({
    ...input.values,
    completenessLimitation,
    requiredSourceCoverageComplete: coverageComplete,
    skuId: input.productSkuId,
  });
  const reasons =
    input.scope === "sku"
      ? evaluated.reasons
      : [
          ...evaluated.reasons.filter((reason) => reason.code === "source_integrity"),
          ...evaluated.storeReasons,
        ].sort(
          (left, right) =>
            STORE_PRECEDENCE.indexOf(left.code as (typeof STORE_PRECEDENCE)[number]) -
            STORE_PRECEDENCE.indexOf(right.code as (typeof STORE_PRECEDENCE)[number]),
        );

  return {
    attentionGenerationId: input.attentionGenerationId,
    completeness,
    factContractVersion: input.factContractVersion,
    limitingReason:
      completeness === "complete"
        ? null
        : completeness === "stale"
          ? ("projection_stale" as const)
          : ("source_incomplete" as const),
    metricContractVersion: input.metricContractVersion,
    organizationId: input.organizationId,
    primaryReason: reasons[0]?.code ?? null,
    productSkuId: input.productSkuId ?? null,
    projectionContractVersion: input.projectionContractVersion,
    reasons,
    ruleVersion: REPORTING_ATTENTION_RULE_VERSION,
    scope: input.scope,
    sourceGenerationIds: Array.from(
      new Set(input.sourceInputs.map((source) => source.generationId)),
    ).sort(),
    sourceWatermark: Math.min(
      ...input.sourceInputs.map((source) => source.stableWatermark!),
    ),
    storeId: input.storeId,
  };
}

export function presentAttentionReason(
  reason: Omit<ReportingAttentionReason, "ruleVersion"> & {
    ruleVersion: number;
  },
) {
  return {
    ...reason,
    destination: REPORTING_ATTENTION_DESTINATIONS[reason.route],
  };
}

const completenessValidator = v.union(
  v.literal("complete"),
  v.literal("provisional"),
  v.literal("partial"),
  v.literal("stale"),
  v.literal("unavailable"),
);

const limitingReasonValidator = v.union(
  v.literal("unauthorized"),
  v.literal("cross_store_reference"),
  v.literal("duplicate_conflict"),
  v.literal("source_incomplete"),
  v.literal("source_unsynchronized"),
  v.literal("pre_cutover_unknown"),
  v.literal("uncosted"),
  v.literal("processing_delayed"),
  v.literal("processing_failed"),
  v.literal("reconciliation_drift"),
  v.literal("rebuild_in_progress"),
  v.literal("rebuild_failed"),
  v.literal("version_incompatible"),
  v.literal("projection_stale"),
  v.literal("evidence_truncated"),
  v.literal("mixed_currency"),
);

const attentionValuesValidator = v.object({
  activeDays: v.number(),
  acceptedCloudLagMs: v.optional(v.number()),
  cashVarianceMinor: v.optional(v.number()),
  confirmedInboundQuantity: v.number(),
  expectedInboundAt: v.optional(v.number()),
  grossRecognizedSalesMinor: v.number(),
  hasFailedOrReviewActivity: v.optional(v.boolean()),
  netSoldUnits: v.number(),
  now: v.number(),
  projectedDaysOfCover: v.optional(v.union(v.number(), v.null())),
  refundVoidCorrectionCount: v.number(),
  refundVoidCorrectionMinor: v.number(),
  shortReceipt: v.optional(v.boolean()),
  uncostedEligibleRevenueMinor: v.number(),
  uncostedOnHandQuantity: v.number(),
});

type MaterializeAttentionArgs = {
  attentionGenerationId: Id<"reportingProjectionGeneration">;
  completenessBySource: Array<{
    completeness: ReportingCompleteness;
    generationId: Id<"reportingProjectionGeneration">;
    limitingReason?: Doc<"reportingProjectionGeneration">["limitingReason"];
  }>;
  productSkuId?: Id<"productSku">;
  scope: "store" | "sku";
  values: AttentionValues;
};

export async function materializeAttentionProjectionWithCtx(
  ctx: MutationCtx,
  args: MaterializeAttentionArgs,
) {
    const sourceGenerationIds = args.completenessBySource.map(
      (source) => source.generationId,
    );
    if (
      sourceGenerationIds.length === 0 ||
      sourceGenerationIds.length > ATTENTION_SOURCE_LIMIT
    ) {
      throw new Error("attention source generation limit exceeded");
    }
    const [attentionGeneration, ...sourceGenerations] = await Promise.all([
      ctx.db.get("reportingProjectionGeneration", args.attentionGenerationId),
      ...sourceGenerationIds.map((generationId) =>
        ctx.db.get("reportingProjectionGeneration", generationId),
      ),
    ]);
    if (
      !attentionGeneration ||
      attentionGeneration.projectionKind !== "attention" ||
      attentionGeneration.status === "failed" ||
      attentionGeneration.status === "superseded"
    ) {
      throw new Error("attention generation is unavailable");
    }
    const sources = sourceGenerations.map((generation, index) => {
      const requested = args.completenessBySource[index]!;
      if (
        !generation ||
        generation.storeId !== attentionGeneration.storeId ||
        generation.organizationId !== attentionGeneration.organizationId ||
        (generation.status !== "verified" && generation.status !== "active") ||
        generation.stableWatermark === undefined ||
        generation.factContractVersion !== attentionGeneration.factContractVersion ||
        generation.metricContractVersion !== attentionGeneration.metricContractVersion ||
        generation.projectionContractVersion !==
          attentionGeneration.projectionContractVersion ||
        generation.projectionKind === "attention" ||
        generation.projectionKind === "storefront_engagement"
      ) {
        throw new Error("attention source generation is incompatible");
      }
      assertAttentionSourceCoverage({
        persisted: {
          completeness: generation.completeness,
          limitingReason: generation.limitingReason,
        },
        requested,
      });
      return {
        completeness: generation.completeness,
        generationId: String(generation._id),
        limitingReason: generation.limitingReason,
        projectionKind: generation.projectionKind,
        sourceWatermark: generation.sourceWatermark,
        stableWatermark: generation.stableWatermark,
        status: generation.status,
      } satisfies AttentionProjectionSourceInput;
    });
    const projection = buildAttentionProjection({
      attentionGenerationId: String(attentionGeneration._id),
      factContractVersion: attentionGeneration.factContractVersion,
      metricContractVersion: attentionGeneration.metricContractVersion,
      organizationId: String(attentionGeneration.organizationId),
      productSkuId: args.productSkuId ? String(args.productSkuId) : undefined,
      projectionContractVersion: attentionGeneration.projectionContractVersion,
      scope: args.scope,
      sourceInputs: sources,
      storeId: String(attentionGeneration.storeId),
      values: args.values,
    });
    const existing = await ctx.db
      .query("reportingAttentionProjection")
      .withIndex("by_generationId_scope_productSkuId", (q) =>
        q
          .eq("generationId", attentionGeneration._id)
          .eq("scope", args.scope)
          .eq("productSkuId", args.productSkuId),
      )
      .take(2);
    if (existing.length > 1) {
      throw new Error("attention projection identity is duplicated");
    }
    if (!projection.primaryReason) {
      if (existing[0]) {
        await ctx.db.delete("reportingAttentionProjection", existing[0]._id);
      }
      return null;
    }
    const sourceGenerationIdByString = new Map(
      sourceGenerations.map((generation) => [String(generation!._id), generation!._id]),
    );
    const sortedSourceGenerationIds = projection.sourceGenerationIds.map(
      (generationId) => {
        const typedGenerationId = sourceGenerationIdByString.get(generationId);
        if (!typedGenerationId) {
          throw new Error("attention source generation identity is unavailable");
        }
        return typedGenerationId;
      },
    );
    const value: Omit<Doc<"reportingAttentionProjection">, "_creationTime" | "_id"> = {
      completeness: projection.completeness,
      factContractVersion: projection.factContractVersion,
      generationId: attentionGeneration._id,
      limitingReason: projection.limitingReason ?? undefined,
      metricContractVersion: projection.metricContractVersion,
      organizationId: attentionGeneration.organizationId,
      primaryReason: projection.primaryReason,
      productSkuId: args.productSkuId,
      projectedAt: Date.now(),
      projectionContractVersion: projection.projectionContractVersion,
      reasons: projection.reasons,
      ruleVersion: projection.ruleVersion,
      scope: projection.scope,
      sourceGenerationIds: sortedSourceGenerationIds,
      sourceWatermark: projection.sourceWatermark,
      storeId: attentionGeneration.storeId,
    };
    if (existing[0]) {
      await ctx.db.patch("reportingAttentionProjection", existing[0]._id, value);
      return existing[0]._id;
    }
    return ctx.db.insert("reportingAttentionProjection", value);
}

export const materializeAttentionProjection = internalMutation({
  args: {
    attentionGenerationId: v.id("reportingProjectionGeneration"),
    completenessBySource: v.array(
      v.object({
        completeness: completenessValidator,
        generationId: v.id("reportingProjectionGeneration"),
        limitingReason: v.optional(limitingReasonValidator),
      }),
    ),
    productSkuId: v.optional(v.id("productSku")),
    scope: v.union(v.literal("store"), v.literal("sku")),
    values: attentionValuesValidator,
  },
  handler: materializeAttentionProjectionWithCtx,
});

const ATTENTION_BUILD_PAGE_SIZE = 50;
const ATTENTION_SOURCE_RETRY_LIMIT = 5;
const attentionInternal = (internal as any).reporting.projections;

async function activeGenerationWithCtx(
  ctx: MutationCtx,
  storeId: Id<"store">,
  projectionKind: "sku_day" | "current_inventory" | "attention",
) {
  const activation = await ctx.db
    .query("reportingProjectionActivation")
    .withIndex("by_storeId_projectionKind_activatedAt", (q) =>
      q.eq("storeId", storeId).eq("projectionKind", projectionKind),
    )
    .order("desc")
    .first();
  if (!activation || activation.supersededAt !== undefined) return null;
  const generation = await ctx.db.get(
    "reportingProjectionGeneration",
    activation.generationId,
  );
  return generation?.status === "active" && generation.storeId === storeId
    ? generation
    : null;
}

export const startAttentionGeneration = internalMutation({
  args: {
    automationIdentity: v.string(),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    const [store, skuDay, currentInventory, priorAttention] =
      await Promise.all([
        ctx.db.get("store", args.storeId),
        activeGenerationWithCtx(ctx, args.storeId, "sku_day"),
        activeGenerationWithCtx(ctx, args.storeId, "current_inventory"),
        activeGenerationWithCtx(ctx, args.storeId, "attention"),
      ]);
    if (!store || !skuDay || !currentInventory) return null;
    const reportingPeriod = await resolveReportingOperatingPeriodWithCtx(ctx, {
      occurrenceAt: Date.now(),
      storeId: args.storeId,
    });
    if (reportingPeriod.kind !== "resolved") return null;
    if (
      skuDay.organizationId !== store.organizationId ||
      currentInventory.organizationId !== store.organizationId ||
      skuDay.factContractVersion !== currentInventory.factContractVersion ||
      skuDay.metricContractVersion !== currentInventory.metricContractVersion ||
      skuDay.projectionContractVersion !==
        currentInventory.projectionContractVersion ||
      skuDay.stableWatermark === undefined ||
      currentInventory.stableWatermark === undefined
    ) {
      throw new Error("attention source generations are incompatible");
    }
    const sourceGenerationIds = [skuDay._id, currentInventory._id].sort(
      (left, right) => String(left).localeCompare(String(right)),
    );
    const requestKey = `attention:${sourceGenerationIds.join(":")}`;
    const matchingRuns = await ctx.db
      .query("reportingRun")
      .withIndex("by_storeId_runType_requestKey", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("runType", "rebuild")
          .eq("requestKey", requestKey),
      )
      .order("desc")
      .take(10);
    const existing = matchingRuns.find(
      (run) => run.status !== "failed" && run.status !== "cancelled",
    );
    if (existing) {
      if (existing.generationId && existing.status === "completed") {
        const candidate = await ctx.db.get(
          "reportingProjectionGeneration",
          existing.generationId,
        );
        if (candidate?.status === "verified") {
          await ctx.scheduler.runAfter(
            0,
            (internal as any).reporting.activation.activateVerifiedGeneration,
            {
              candidateGenerationId: candidate._id,
              expectedPriorGenerationId: existing.expectedPriorGenerationId,
              runId: existing._id,
            },
          );
        }
      }
      return { generationId: existing.generationId ?? null, runId: existing._id };
    }
    const now = Date.now();
    const sourceWatermark = Math.min(
      skuDay.stableWatermark,
      currentInventory.stableWatermark,
    );
    const runId = await ctx.db.insert("reportingRun", {
      actorKind: "automation",
      automationIdentity: args.automationIdentity,
      createdAt: now,
      domain: "reporting",
      expectedPriorGenerationId: priorAttention?._id,
      factContractVersion: skuDay.factContractVersion,
      failedCount: 0,
      frozenWatermark: sourceWatermark,
      metricContractVersion: skuDay.metricContractVersion,
      operation: "attention_generation_building",
      organizationId: store.organizationId,
      processedCount: 0,
      projectionContractVersion: skuDay.projectionContractVersion,
      requestKey,
      rangeEndDate: reportingPeriod.operatingDate,
      runType: "rebuild",
      sourceGenerationIds,
      status: "pending",
      storeId: args.storeId,
    });
    const generationId = await ctx.db.insert("reportingProjectionGeneration", {
      completeness: "provisional",
      createdAt: now,
      factContractVersion: skuDay.factContractVersion,
      metricContractVersion: skuDay.metricContractVersion,
      organizationId: store.organizationId,
      projectionContractVersion: skuDay.projectionContractVersion,
      projectionKind: "attention",
      runId,
      sourceWatermark,
      status: "building",
      storeId: args.storeId,
    });
    await ctx.db.patch("reportingRun", runId, { generationId });
    await ctx.db.insert("reportingRunEvent", {
      eventType: "attention_generation_created",
      occurredAt: now,
      outcome: "pending",
      runId,
      sequence: 1,
      storeId: args.storeId,
    });
    await ctx.scheduler.runAfter(
      0,
      attentionInternal.skuInsights.refreshActiveSkuInsightPage,
      { operatingDate: reportingPeriod.operatingDate, storeId: args.storeId },
    );
    await ctx.scheduler.runAfter(
      100,
      attentionInternal.attention.processAttentionGenerationBatch,
      { runId },
    );
    return { generationId, runId };
  },
});

export const processAttentionGenerationBatch = internalMutation({
  args: { runId: v.id("reportingRun") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get("reportingRun", args.runId);
    if (
      !run ||
      run.operation !== "attention_generation_building" ||
      !run.generationId ||
      run.sourceGenerationIds?.length !== 2 ||
      (run.status !== "pending" && run.status !== "running")
    ) {
      return;
    }
    const [generation, firstSource, secondSource] = await Promise.all([
      ctx.db.get("reportingProjectionGeneration", run.generationId),
      ctx.db.get("reportingProjectionGeneration", run.sourceGenerationIds[0]),
      ctx.db.get("reportingProjectionGeneration", run.sourceGenerationIds[1]),
    ]);
    if (!generation || generation.projectionKind !== "attention") {
      throw new Error("attention generation is unavailable");
    }
    const sources = [firstSource, secondSource].filter(
      (source): source is Doc<"reportingProjectionGeneration"> => Boolean(source),
    );
    const skuDay = sources.find((source) => source.projectionKind === "sku_day");
    const currentInventory = sources.find(
      (source) => source.projectionKind === "current_inventory",
    );
    if (
      !skuDay ||
      !currentInventory ||
      sources.some(
        (source) =>
          source.storeId !== run.storeId ||
          source.status !== "active" ||
          source.stableWatermark === undefined ||
          source.factContractVersion !== generation.factContractVersion ||
          source.metricContractVersion !== generation.metricContractVersion ||
          source.projectionContractVersion !==
            generation.projectionContractVersion,
      )
    ) {
      throw new Error("attention source generation changed during build");
    }
    const page = await ctx.db
      .query("productSku")
      .withIndex("by_storeId", (q) => q.eq("storeId", run.storeId))
      .paginate({
        cursor: run.cursor ?? null,
        numItems: ATTENTION_BUILD_PAGE_SIZE,
      });
    const insightRows = await Promise.all(
      page.page.map((sku) =>
        ctx.db
          .query("reportingSkuInsightProjection")
          .withIndex("by_generationId_productSkuId", (q) =>
            q
              .eq("generationId", skuDay._id)
              .eq("productSkuId", sku._id),
          )
          .first(),
      ),
    );
    const missingSkus = page.page.filter((_, index) => !insightRows[index]);
    if (missingSkus.length > 0) {
      const retryCount = run.periodStart ?? 0;
      if (retryCount >= ATTENTION_SOURCE_RETRY_LIMIT) {
        const completedAt = Date.now();
        await ctx.db.patch("reportingProjectionGeneration", generation._id, {
          completeness: "partial",
          limitingReason: "source_incomplete",
          status: "failed",
        });
        await ctx.db.patch("reportingRun", run._id, {
          completedAt,
          failedCount: missingSkus.length,
          status: "failed",
        });
        await ctx.db.insert("reportingRunEvent", {
          eventType: "attention_generation_failed",
          failedCount: missingSkus.length,
          occurredAt: completedAt,
          outcome: "source_incomplete",
          runId: run._id,
          sequence: run.processedCount + 2,
          storeId: run.storeId,
        });
        return;
      }
      if (!run.rangeEndDate) {
        throw new Error("attention operating date is unavailable");
      }
      for (const sku of missingSkus) {
        await ctx.scheduler.runAfter(
          0,
          attentionInternal.skuInsights.refreshActiveSkuInsight,
          {
            operatingDate: run.rangeEndDate,
            productSkuId: sku._id,
            storeId: run.storeId,
          },
        );
      }
      await ctx.db.patch("reportingRun", run._id, {
        periodStart: retryCount + 1,
        startedAt: run.startedAt ?? Date.now(),
        status: "running",
      });
      await ctx.scheduler.runAfter(
        100,
        attentionInternal.attention.processAttentionGenerationBatch,
        { runId: run._id },
      );
      return;
    }
    const completenessBySource = sources.map((source) => ({
      completeness: source.completeness,
      generationId: source._id,
      limitingReason: source.limitingReason,
    }));
    for (const insight of insightRows) {
      if (!insight) continue;
      await materializeAttentionProjectionWithCtx(ctx, {
        attentionGenerationId: generation._id,
        completenessBySource,
        productSkuId: insight.productSkuId,
        scope: "sku",
        values: {
          activeDays: insight.activeDays,
          confirmedInboundQuantity: insight.confirmedInboundQuantity,
          expectedInboundAt: insight.expectedInboundAt,
          grossRecognizedSalesMinor: insight.eligibleMerchandiseRevenueMinor,
          netSoldUnits: insight.netSoldUnits,
          now: Date.now(),
          projectedDaysOfCover: insight.projectedDaysOfCover,
          refundVoidCorrectionCount: insight.refundVoidCorrectionCount,
          refundVoidCorrectionMinor: insight.refundVoidCorrectionMinor,
          shortReceipt: insight.shortReceipt,
          uncostedEligibleRevenueMinor:
            insight.uncoveredEligibleRevenueMinor,
          uncostedOnHandQuantity: insight.uncostedOnHandQuantity,
        },
      });
    }
    const processedCount = run.processedCount + page.page.length;
    if (!page.isDone) {
      await ctx.db.patch("reportingRun", run._id, {
        cursor: page.continueCursor,
        periodStart: 0,
        processedCount,
        startedAt: run.startedAt ?? Date.now(),
        status: "running",
      });
      await ctx.scheduler.runAfter(
        0,
        attentionInternal.attention.processAttentionGenerationBatch,
        { runId: run._id },
      );
      return;
    }
    if (!run.rangeEndDate) {
      throw new Error("attention operating date is unavailable");
    }
    const [registerSessions, openQuarantine] = await Promise.all([
      ctx.db
        .query("registerSession")
        .withIndex("by_storeId_closeoutOperatingDate", (q) =>
          q
            .eq("storeId", run.storeId)
            .eq("closeoutOperatingDate", run.rangeEndDate),
        )
        .take(101),
      ctx.db
        .query("reportingQuarantine")
        .withIndex("by_storeId_status_detectedAt", (q) =>
          q.eq("storeId", run.storeId).eq("status", "open"),
        )
        .first(),
    ]);
    const cashVarianceMinor = registerSessions
      .slice(0, 100)
      .filter((session) => session.status !== "closed")
      .reduce((sum, session) => sum + (session.variance ?? 0), 0);
    await materializeAttentionProjectionWithCtx(ctx, {
      attentionGenerationId: generation._id,
      completenessBySource,
      scope: "store",
      values: {
        activeDays: 0,
        cashVarianceMinor,
        confirmedInboundQuantity: 0,
        grossRecognizedSalesMinor: 0,
        hasFailedOrReviewActivity:
          Boolean(openQuarantine) || registerSessions.length > 100,
        netSoldUnits: 0,
        now: Date.now(),
        refundVoidCorrectionCount: 0,
        refundVoidCorrectionMinor: 0,
        uncostedEligibleRevenueMinor: 0,
        uncostedOnHandQuantity: 0,
      },
    });
    const completedAt = Date.now();
    const stableWatermark = Math.min(
      skuDay.stableWatermark!,
      currentInventory.stableWatermark!,
    );
    await ctx.db.patch("reportingProjectionGeneration", generation._id, {
      completeness: "complete",
      sourceWatermark: stableWatermark,
      stableWatermark,
      status: "verified",
      verifiedAt: completedAt,
    });
    await ctx.db.patch("reportingRun", run._id, {
      completedAt,
      cursor: undefined,
      failedCount: 0,
      periodStart: undefined,
      processedCount,
      status: "completed",
    });
    await ctx.db.insert("reportingRunEvent", {
      eventType: "attention_generation_verified",
      occurredAt: completedAt,
      outcome: "verified",
      processedCount,
      runId: run._id,
      sequence: processedCount + 2,
      storeId: run.storeId,
    });
    await ctx.scheduler.runAfter(
      0,
      (internal as any).reporting.activation.activateVerifiedGeneration,
      {
        candidateGenerationId: generation._id,
        expectedPriorGenerationId: run.expectedPriorGenerationId,
        runId: run._id,
      },
    );
  },
});
