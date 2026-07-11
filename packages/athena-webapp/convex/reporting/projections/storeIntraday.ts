import { internal } from "../../_generated/api";
import type { Doc } from "../../_generated/dataModel";
import { internalMutation, internalQuery } from "../../_generated/server";
import { v } from "convex/values";
import { deriveFactMetricContributions } from "./factContributions";
import { upsertProjectionHealthWithCtx } from "../health";
import { resolveReportingOperatingDateRangeWithCtx, resolveReportingOperatingPeriodWithCtx } from "../operatingPeriods";

export const STORE_INTRADAY_CHECKPOINT_MINUTES = 15;
export const STORE_INTRADAY_REMAINDER_LIMIT = 200;
const CHECKPOINT_MS = STORE_INTRADAY_CHECKPOINT_MINUTES * 60_000;

type IntradayFact = {
  recognizedAt: number;
  discountMinor?: number;
  grossRevenueMinor: number;
  netRevenueMinor: number;
  refundMinor?: number;
  cogsKnownMinor: number | null;
  quantity: number;
};

type IntradayBase = {
  discountMinor: number;
  factCount: number;
  grossRevenueMinor: number;
  knownCogsMinor: number;
  netRevenueMinor: number;
  refundMinor: number;
  uncoveredRevenueMinor: number;
  unitsSold: number;
};

function safeAdd(left: number, right: number, label: string) {
  const value = left + right;
  if (!Number.isSafeInteger(value)) throw new Error(`${label} must be a safe integer`);
  return value;
}

export function checkpointAtOrBefore(cutoffAt: number) {
  return Math.floor(cutoffAt / CHECKPOINT_MS) * CHECKPOINT_MS;
}

export function persistedCheckpointAt(cutoffAt: number, checkpointIntervalMs: number) {
  return checkpointIntervalMs === CHECKPOINT_MS
    ? checkpointAtOrBefore(cutoffAt)
    : cutoffAt;
}

export function intradayScheduleKey(generationId: string, operatingDate: string) {
  return `${generationId}:${operatingDate}`;
}

export function historicalOperatingDates(rows: Array<{ operatingDate?: string }>) {
  return [...new Set(rows.flatMap((row) => row.operatingDate ? [row.operatingDate] : []))];
}

export function exactOperatingDateRemainder<T extends { operatingDate?: string }>(
  rows: T[],
  operatingDate: string,
) {
  const matching = rows.filter((row) => row.operatingDate === operatingDate);
  if (matching.length > STORE_INTRADAY_REMAINDER_LIMIT) {
    throw new Error("evidence_truncated: intraday remainder exceeds 200 indexed rows");
  }
  return matching;
}

export function nextIntradayScheduleStep(input: {
  checkpointAt: number;
  checkpointIntervalMs?: number;
  mode: "active" | "historical";
  operatingEndAt: number;
  sourceActive: boolean;
}) {
  if (input.mode === "active" && !input.sourceActive) {
    return { status: "superseded" as const };
  }
  const nextCheckpointAt = input.checkpointAt + (input.checkpointIntervalMs ?? CHECKPOINT_MS);
  return nextCheckpointAt > input.operatingEndAt
    ? { status: "complete" as const }
    : { nextCheckpointAt, status: "scheduled" as const };
}

export function buildStoreIntradayProjection(input: {
  base?: IntradayBase;
  currencyCode: string;
  currencyMinorUnitScale: number;
  generationId: string;
  sourceGenerationId: string;
  sourceWatermark: number;
  operatingDate: string;
  checkpointAt: number;
  cutoffAt: number;
  facts: IntradayFact[];
}) {
  if (input.cutoffAt < input.checkpointAt) throw new Error("cutoff precedes checkpoint");
  if (input.facts.length > STORE_INTRADAY_REMAINDER_LIMIT) {
    throw new Error("evidence_truncated: intraday remainder exceeds 200 indexed rows");
  }
  let grossRevenueMinor = input.base?.grossRevenueMinor ?? 0;
  let netRevenueMinor = input.base?.netRevenueMinor ?? 0;
  let knownCogsMinor = input.base?.knownCogsMinor ?? 0;
  let uncoveredRevenueMinor = input.base?.uncoveredRevenueMinor ?? 0;
  let unitsSold = input.base?.unitsSold ?? 0;
  let factCount = input.base?.factCount ?? 0;
  let discountMinor = input.base?.discountMinor ?? 0;
  let refundMinor = input.base?.refundMinor ?? 0;
  for (const fact of input.facts) {
    if (fact.recognizedAt <= input.checkpointAt || fact.recognizedAt > input.cutoffAt) continue;
    factCount += 1;
    grossRevenueMinor = safeAdd(grossRevenueMinor, fact.grossRevenueMinor, "gross revenue");
    netRevenueMinor = safeAdd(netRevenueMinor, fact.netRevenueMinor, "net revenue");
    unitsSold = safeAdd(unitsSold, fact.quantity, "units sold");
    discountMinor = safeAdd(discountMinor, fact.discountMinor ?? 0, "discount");
    refundMinor = safeAdd(refundMinor, fact.refundMinor ?? 0, "refund");
    if (fact.cogsKnownMinor === null) {
      uncoveredRevenueMinor = safeAdd(uncoveredRevenueMinor, fact.netRevenueMinor, "uncovered revenue");
    } else {
      knownCogsMinor = safeAdd(knownCogsMinor, fact.cogsKnownMinor, "known COGS");
    }
  }
  return {
    ...input,
    facts: undefined,
    factCount,
    grossRevenueMinor,
    discountMinor,
    netRevenueMinor,
    refundMinor,
    knownCogsMinor,
    uncoveredRevenueMinor,
    unitsSold,
    status: uncoveredRevenueMinor > 0 ? ("partial" as const) : ("complete" as const),
  };
}

function baseFrom(row: Doc<"reportingStoreIntradayProjection"> | null): IntradayBase | undefined {
  return row ? {
    discountMinor: row.discountMinor,
    factCount: row.factCount,
    grossRevenueMinor: row.grossRevenueMinor,
    knownCogsMinor: row.knownCogsMinor,
    netRevenueMinor: row.netRevenueMinor,
    refundMinor: row.refundMinor,
    uncoveredRevenueMinor: row.uncoveredRevenueMinor,
    unitsSold: row.unitsSold,
  } : undefined;
}

/**
 * Source-owned intraday worker. Callers identify only the immutable Store Day
 * generation and cutoff; the worker reads indexed projection evidence itself.
 * This prevents callers from supplying authoritative totals or prefiltered facts.
 */
export const materializeStoreIntradayCheckpoint = internalMutation({
  args: {
    cutoffAt: v.number(),
    operatingDate: v.string(),
    sourceGenerationId: v.id("reportingProjectionGeneration"),
    scheduleStateId: v.optional(v.id("reportingStoreIntradayScheduleState")),
  },
  handler: async (ctx, args) => {
    const source = await ctx.db.get("reportingProjectionGeneration", args.sourceGenerationId);
    if (source?.status === "superseded" && args.scheduleStateId) {
      const state = await ctx.db.get("reportingStoreIntradayScheduleState", args.scheduleStateId);
      if (state?.generationId === source._id) {
        await ctx.db.patch("reportingStoreIntradayScheduleState", state._id, {
          nextCheckpointAt: undefined,
          status: "superseded",
          updatedAt: Date.now(),
        });
      }
      return { status: "superseded" as const };
    }
    if (!source || source.projectionKind !== "store_day" ||
      (source.status !== "active" && source.status !== "building" && source.status !== "catching_up")) {
      throw new Error("Intraday source generation is incompatible");
    }
    const scheduleState = args.scheduleStateId
      ? await ctx.db.get("reportingStoreIntradayScheduleState", args.scheduleStateId)
      : null;
    if (scheduleState && scheduleState.generationId !== source._id) {
      throw new Error("Intraday schedule state is incompatible");
    }
    const checkpointAt = persistedCheckpointAt(
      args.cutoffAt,
      scheduleState?.checkpointIntervalMs ?? CHECKPOINT_MS,
    );
    const prior = await ctx.db.query("reportingStoreIntradayProjection")
      .withIndex("by_sourceGenerationId_operatingDate_checkpointAt", (q) =>
        q.eq("sourceGenerationId", source._id)
          .eq("operatingDate", args.operatingDate)
          .lt("checkpointAt", checkpointAt),
      ).order("desc").first();
    const lowerBound = prior?.cutoffAt ?? Number.MIN_SAFE_INTEGER;
    const indexedEvidence = await ctx.db.query("reportingProjectionEvidence")
      .withIndex("by_generationId_operatingDate_recognitionAt_factId_metric", (q) =>
        q.eq("generationId", source._id)
          .eq("operatingDate", args.operatingDate)
          .gt("recognitionAt", lowerBound)
          .lte("recognitionAt", args.cutoffAt),
      ).take(STORE_INTRADAY_REMAINDER_LIMIT + 1);
    if (indexedEvidence.length > STORE_INTRADAY_REMAINDER_LIMIT) {
      const domains = [...new Set(indexedEvidence.map((row) => row.sourceDomain))];
      for (const sourceDomain of domains) {
        await upsertProjectionHealthWithCtx(ctx, {
          activeGenerationId: source.status === "active" ? source._id : undefined,
          factContractVersion: source.factContractVersion,
          limitingReason: "evidence_truncated",
          metricContractVersion: source.metricContractVersion,
          organizationId: source.organizationId,
          processingWatermark: source.stableWatermark ?? source.sourceWatermark,
          projectionContractVersion: source.projectionContractVersion,
          projectionKind: "store_intraday",
          quarantinedCount: 0,
          sourceDomain,
          storeId: source.storeId,
          updatedAt: Date.now(),
        });
      }
      if (args.scheduleStateId) {
        await ctx.db.patch("reportingStoreIntradayScheduleState", args.scheduleStateId, {
          blockingReason: "evidence_truncated",
          nextCheckpointAt: undefined,
          status: "blocked",
          updatedAt: Date.now(),
        });
      }
      return { scannedRowCount: indexedEvidence.length, status: "evidence_truncated" as const };
    }
    const evidence = exactOperatingDateRemainder(indexedEvidence, args.operatingDate);
    const factIds = [...new Set(evidence.flatMap((row) => row.factId ? [row.factId] : []))];
    const facts = await Promise.all(factIds.map((factId) => ctx.db.get("reportingFact", factId)));
    const factById = new Map(facts.filter((fact): fact is Doc<"reportingFact"> => fact !== null)
      .map((fact) => [String(fact._id), fact]));
    const totals = new Map<string, number>();
    for (const row of evidence) {
      if (row.operatingDate !== args.operatingDate || row.disposition === "omitted_missing_currency") continue;
      const fact = row.factId ? factById.get(String(row.factId)) : undefined;
      const contribution = fact
        ? deriveFactMetricContributions(fact).find((item) => item.metric === row.metric)
        : undefined;
      if (contribution) totals.set(row.metric, safeAdd(totals.get(row.metric) ?? 0, contribution.value, row.metric));
    }
    const currencyFact = facts.find((fact) => fact?.currencyCode !== undefined);
    const result = buildStoreIntradayProjection({
      base: baseFrom(prior),
      checkpointAt: lowerBound,
      currencyCode: currencyFact?.currencyCode ?? currencyFact?.revenueCurrencyCode ?? "UNKNOWN",
      currencyMinorUnitScale: currencyFact?.currencyMinorUnitScale ?? currencyFact?.revenueCurrencyMinorUnitScale ?? 0,
      cutoffAt: args.cutoffAt,
      facts: [{
        cogsKnownMinor: totals.get("known_cogs") ?? (totals.has("uncosted_revenue") ? null : 0),
        discountMinor: totals.get("discounts") ?? 0,
        grossRevenueMinor: totals.get("gross_sales") ?? totals.get("net_sales") ?? 0,
        netRevenueMinor: totals.get("net_sales") ?? 0,
        quantity: totals.get("units_sold") ?? 0,
        recognizedAt: args.cutoffAt,
        refundMinor: totals.get("refunds") ?? 0,
      }],
      generationId: String(source._id),
      operatingDate: args.operatingDate,
      sourceGenerationId: String(source._id),
      sourceWatermark: source.stableWatermark ?? source.sourceWatermark,
    });
    const existing = await ctx.db.query("reportingStoreIntradayProjection")
      .withIndex("by_generationId_operatingDate_checkpointAt", (q) =>
        q.eq("generationId", source._id).eq("operatingDate", args.operatingDate).eq("checkpointAt", checkpointAt),
      ).first();
    const row = {
      checkpointAt,
      completeness: result.status,
      currencyCode: result.currencyCode,
      currencyMinorUnitScale: result.currencyMinorUnitScale,
      cutoffAt: args.cutoffAt,
      discountMinor: result.discountMinor,
      factContractVersion: source.factContractVersion,
      factCount: (prior?.factCount ?? 0) + evidence.length,
      generationId: source._id,
      grossRevenueMinor: result.grossRevenueMinor,
      knownCogsMinor: result.knownCogsMinor,
      limitingReason: result.status === "partial" ? ("uncosted" as const) : undefined,
      metricContractVersion: source.metricContractVersion,
      netRevenueMinor: result.netRevenueMinor,
      operatingDate: args.operatingDate,
      organizationId: source.organizationId,
      projectedAt: Date.now(),
      projectionContractVersion: source.projectionContractVersion,
      refundMinor: result.refundMinor,
      sourceGenerationId: source._id,
      sourceWatermark: source.stableWatermark ?? source.sourceWatermark,
      storeId: source.storeId,
      uncoveredRevenueMinor: (prior?.uncoveredRevenueMinor ?? 0) + (totals.get("uncosted_revenue") ?? 0),
      unitsSold: result.unitsSold,
    };
    if (existing) await ctx.db.replace("reportingStoreIntradayProjection", existing._id, row);
    else await ctx.db.insert("reportingStoreIntradayProjection", row);
    if (args.scheduleStateId) {
      const state = scheduleState;
      if (!state || state.generationId !== source._id) throw new Error("Intraday schedule state is incompatible");
      const next = nextIntradayScheduleStep({ checkpointAt, checkpointIntervalMs: state.checkpointIntervalMs, mode: state.mode, operatingEndAt: state.operatingEndAt, sourceActive: source.status === "active" });
      if (next.status !== "scheduled") {
        await ctx.db.patch("reportingStoreIntradayScheduleState", state._id, {
          nextCheckpointAt: undefined,
          status: next.status,
          updatedAt: Date.now(),
        });
        if (state.mode === "historical" && next.status === "complete") {
          const lineageWatermark = source.stableWatermark ?? source.sourceWatermark;
          const [pending, blocked, marker, epoch] = await Promise.all([
            ctx.db.query("reportingStoreIntradayScheduleState")
              .withIndex("by_generationId_status_mode", (q) => q.eq("generationId", source._id).eq("status", "scheduled").eq("mode", "historical")).first(),
            ctx.db.query("reportingStoreIntradayScheduleState")
              .withIndex("by_generationId_status_mode", (q) => q.eq("generationId", source._id).eq("status", "blocked").eq("mode", "historical")).first(),
            ctx.db.query("reportingStoreIntradayScheduleState")
              .withIndex("by_generationId_operatingDate", (q) => q.eq("generationId", source._id).eq("operatingDate", "__historical_rebuild__")).first(),
            ctx.db.query("reportingWorkspaceMaterializationEpoch")
              .withIndex("by_sourceGenerationId_sourceWatermark", (q) => q.eq("sourceGenerationId", source._id).eq("sourceWatermark", lineageWatermark)).first(),
          ]);
          if (!pending && !blocked && marker?.status === "complete" && epoch?.status === "verified") {
            await ctx.scheduler.runAfter(0, (internal as any).reporting.readModels.materialize.activateVerifiedReportsWorkspaceEpoch, { epochId: epoch._id });
          }
        }
        return row;
      }
      const nextCutoffAt = next.nextCheckpointAt;
      await ctx.db.patch("reportingStoreIntradayScheduleState", state._id, {
        nextCheckpointAt: nextCutoffAt,
        updatedAt: Date.now(),
      });
      await ctx.scheduler.runAt(
        state.mode === "active" ? Math.max(Date.now(), nextCutoffAt) : Date.now(),
        internal.reporting.projections.storeIntraday.materializeStoreIntradayCheckpoint,
        { ...args, cutoffAt: nextCutoffAt, scheduleStateId: state._id },
      );
    }
    return row;
  },
});

async function ensureScheduleState(ctx: any, input: {
  firstCheckpointAt: number;
  checkpointIntervalMs?: number;
  generation: Doc<"reportingProjectionGeneration">;
  mode: "active" | "historical";
  operatingDate: string;
  operatingStartAt: number;
  operatingEndAt: number;
}) {
  const existing = await ctx.db.query("reportingStoreIntradayScheduleState")
    .withIndex("by_generationId_operatingDate", (q: any) =>
      q.eq("generationId", input.generation._id).eq("operatingDate", input.operatingDate),
    ).first();
  if (existing) return { created: false, state: existing };
  const stateId = await ctx.db.insert("reportingStoreIntradayScheduleState", {
    generationId: input.generation._id,
    checkpointIntervalMs: input.checkpointIntervalMs ?? CHECKPOINT_MS,
    mode: input.mode,
    nextCheckpointAt: input.firstCheckpointAt,
    operatingDate: input.operatingDate,
    operatingStartAt: input.operatingStartAt,
    operatingEndAt: input.operatingEndAt,
    organizationId: input.generation.organizationId,
    status: "scheduled",
    storeId: input.generation.storeId,
    updatedAt: Date.now(),
  });
  await ctx.scheduler.runAfter(0,
    internal.reporting.projections.storeIntraday.materializeStoreIntradayCheckpoint, {
      cutoffAt: input.firstCheckpointAt,
      operatingDate: input.operatingDate,
      scheduleStateId: stateId,
      sourceGenerationId: input.generation._id,
    });
  return { created: true, stateId };
}

export const startActiveStoreIntradaySchedule = internalMutation({
  args: { sourceGenerationId: v.id("reportingProjectionGeneration") },
  handler: async (ctx, args) => {
    const generation = await ctx.db.get("reportingProjectionGeneration", args.sourceGenerationId);
    if (!generation || generation.projectionKind !== "store_day" || generation.status !== "active") return { status: "superseded" as const };
    const period = await resolveReportingOperatingPeriodWithCtx(ctx, { occurrenceAt: Date.now(), storeId: generation.storeId });
    if (period.kind !== "resolved") return { status: "schedule_unavailable" as const };
    const firstCheckpointAt = Math.min(period.endsAt, Math.max(period.startsAt, Date.now()));
    return ensureScheduleState(ctx, { firstCheckpointAt, generation, mode: "active", operatingDate: period.operatingDate, operatingEndAt: period.endsAt, operatingStartAt: period.startsAt });
  },
});

export const rebuildHistoricalStoreIntradayPage = internalMutation({
  args: { cursor: v.optional(v.string()), sourceGenerationId: v.id("reportingProjectionGeneration") },
  handler: async (ctx, args) => {
    const generation = await ctx.db.get("reportingProjectionGeneration", args.sourceGenerationId);
    if (!generation || generation.projectionKind !== "store_day") throw new Error("Historical intraday source is incompatible");
    let marker = await ctx.db.query("reportingStoreIntradayScheduleState")
      .withIndex("by_generationId_operatingDate", (q) =>
        q.eq("generationId", generation._id).eq("operatingDate", "__historical_rebuild__"),
      ).first();
    if (!marker) {
      const markerId = await ctx.db.insert("reportingStoreIntradayScheduleState", {
        generationId: generation._id,
        checkpointIntervalMs: CHECKPOINT_MS,
        mode: "historical",
        operatingDate: "__historical_rebuild__",
        operatingStartAt: generation.stableWatermark ?? generation.sourceWatermark,
        operatingEndAt: generation.stableWatermark ?? generation.sourceWatermark,
        organizationId: generation.organizationId,
        status: "scheduled",
        storeId: generation.storeId,
        updatedAt: Date.now(),
      });
      marker = await ctx.db.get("reportingStoreIntradayScheduleState", markerId);
    }
    const page = await ctx.db.query("reportingProjectionEvidence")
      .withIndex("by_generationId_recognitionAt_factId_metric", (q) => q.eq("generationId", generation._id))
      .paginate({ cursor: args.cursor ?? null, numItems: 100 });
    const dates = historicalOperatingDates(page.page);
    for (const operatingDate of dates) {
      const range = await resolveReportingOperatingDateRangeWithCtx(ctx, { operatingDate, storeId: generation.storeId });
      if (range.kind !== "resolved") continue;
      if (range.endAt > (generation.stableWatermark ?? generation.sourceWatermark)) continue;
      await ensureScheduleState(ctx, { firstCheckpointAt: range.startAt, generation, mode: "historical", operatingDate, operatingEndAt: range.endAt, operatingStartAt: range.startAt });
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.reporting.projections.storeIntraday.rebuildHistoricalStoreIntradayPage, {
        cursor: page.continueCursor,
        sourceGenerationId: generation._id,
      });
    } else if (marker) {
      await ctx.db.patch("reportingStoreIntradayScheduleState", marker._id, {
        status: "complete",
        updatedAt: Date.now(),
      });
      const pending = await ctx.db.query("reportingStoreIntradayScheduleState")
        .withIndex("by_generationId_status_mode", (q) => q.eq("generationId", generation._id).eq("status", "scheduled").eq("mode", "historical")).first();
      const blocked = await ctx.db.query("reportingStoreIntradayScheduleState")
        .withIndex("by_generationId_status_mode", (q) => q.eq("generationId", generation._id).eq("status", "blocked").eq("mode", "historical")).first();
      const lineageWatermark = generation.stableWatermark ?? generation.sourceWatermark;
      const epoch = await ctx.db.query("reportingWorkspaceMaterializationEpoch")
        .withIndex("by_sourceGenerationId_sourceWatermark", (q) => q.eq("sourceGenerationId", generation._id).eq("sourceWatermark", lineageWatermark)).first();
      if (!pending && !blocked && epoch?.status === "verified") {
        await ctx.scheduler.runAfter(0, (internal as any).reporting.readModels.materialize.activateVerifiedReportsWorkspaceEpoch, { epochId: epoch._id });
      }
    }
    return { continueCursor: page.continueCursor, isDone: page.isDone, operatingDateCount: dates.length };
  },
});

export const getHistoricalStoreIntradayReadiness = internalQuery({
  args: { sourceGenerationId: v.id("reportingProjectionGeneration"), sourceWatermark: v.number() },
  handler: async (ctx, args) => {
    const generation = await ctx.db.get("reportingProjectionGeneration", args.sourceGenerationId);
    const lineageWatermark = generation?.stableWatermark ?? generation?.sourceWatermark;
    if (!generation || lineageWatermark !== args.sourceWatermark) return { ready: false, reason: "lineage_changed" as const };
    const scheduled = await ctx.db.query("reportingStoreIntradayScheduleState")
      .withIndex("by_generationId_status_mode", (q) => q.eq("generationId", generation._id).eq("status", "scheduled").eq("mode", "historical")).first();
    const blocked = await ctx.db.query("reportingStoreIntradayScheduleState")
      .withIndex("by_generationId_status_mode", (q) => q.eq("generationId", generation._id).eq("status", "blocked").eq("mode", "historical")).first();
    const marker = await ctx.db.query("reportingStoreIntradayScheduleState")
      .withIndex("by_generationId_operatingDate", (q) => q.eq("generationId", generation._id).eq("operatingDate", "__historical_rebuild__")).first();
    return {
      ...(blocked ? {
        blockedOperatingDate: blocked.operatingDate,
        reason: "evidence_truncated" as const,
        retryCheckpointIntervalMs: Math.max(1_000, Math.floor(blocked.checkpointIntervalMs / 2)),
      } : {}),
      ready: marker?.status === "complete" && !scheduled && !blocked,
      sourceGenerationId: generation._id,
      sourceWatermark: lineageWatermark,
    };
  },
});

export const retryBlockedStoreIntradaySchedule = internalMutation({
  args: {
    checkpointIntervalMs: v.number(),
    scheduleStateId: v.id("reportingStoreIntradayScheduleState"),
  },
  handler: async (ctx, args) => {
    if (!Number.isSafeInteger(args.checkpointIntervalMs) || args.checkpointIntervalMs < 1_000 || args.checkpointIntervalMs >= CHECKPOINT_MS) {
      throw new Error("Intraday retry interval must be between one second and fifteen minutes");
    }
    const state = await ctx.db.get("reportingStoreIntradayScheduleState", args.scheduleStateId);
    if (!state || state.status !== "blocked" || state.blockingReason !== "evidence_truncated") {
      throw new Error("Blocked intraday schedule is unavailable");
    }
    const prior = await ctx.db.query("reportingStoreIntradayProjection")
      .withIndex("by_sourceGenerationId_operatingDate_checkpointAt", (q) =>
        q.eq("sourceGenerationId", state.generationId).eq("operatingDate", state.operatingDate),
      ).order("desc").first();
    const cutoffAt = Math.min(state.operatingEndAt, (prior?.cutoffAt ?? state.operatingStartAt) + args.checkpointIntervalMs);
    await ctx.db.patch("reportingStoreIntradayScheduleState", state._id, {
      blockingReason: undefined,
      checkpointIntervalMs: args.checkpointIntervalMs,
      nextCheckpointAt: cutoffAt,
      status: "scheduled",
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.reporting.projections.storeIntraday.materializeStoreIntradayCheckpoint, {
      cutoffAt,
      operatingDate: state.operatingDate,
      scheduleStateId: state._id,
      sourceGenerationId: state.generationId,
    });
    return { checkpointIntervalMs: args.checkpointIntervalMs, cutoffAt, status: "scheduled" as const };
  },
});
