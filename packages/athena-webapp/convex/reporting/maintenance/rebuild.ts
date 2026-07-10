import { v } from "convex/values";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import {
  internalAction,
  internalMutation,
  type MutationCtx,
} from "../../_generated/server";
import {
  REPORTING_FACT_CONTRACT_VERSION,
  REPORTING_PROJECTION_CONTRACT_VERSION,
  REPORTING_SOURCE_DOMAINS,
} from "../../../shared/reportingContract";
import {
  applyFactToGenerationWithCtx,
  currencyForFactMetric,
  minorUnitScaleForFactMetric,
} from "../projections/processor";
import { deriveFactMetricContributions } from "../projections/factContributions";
import { materializeGenerationCoverageWithCtx } from "../coverage";
import { upsertProjectionHealthWithCtx } from "../health";
import { assertReportingRunTransition } from "./runLedger";

const reportingRebuildInternal = (internal as any).reporting.maintenance
  .rebuild;
const PROJECTION_REBUILD_PAGE_SIZE = 20;

export function stableRebuildWatermark(now: number) {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error(
      "Rebuild watermark time must be a nonnegative safe integer",
    );
  }
  return Math.max(0, now - 1);
}

const projectionKindValidator = v.union(
  v.literal("store_day"),
  v.literal("sku_day"),
);

type RebuildSegment = {
  currencyCode: string | null;
  generationId: string;
  logicalKey: string;
  metric: string;
  rowCount: number;
  value: number;
};

type RebuildEvidence = {
  factId: string;
  generationId: string;
  metric: string;
};

type RebuildDifference = {
  actual: number;
  expected: number;
  explainedDifference: number;
  invariant: string;
  logicalKey: string;
  metric: string;
  unexplainedDifference: number;
};

function difference(
  invariant: string,
  logicalKey: string,
  metric: string,
  expected: number,
  actual: number,
): RebuildDifference {
  return {
    actual,
    expected,
    explainedDifference: 0,
    invariant,
    logicalKey,
    metric,
    unexplainedDifference: actual - expected,
  };
}

function groupSegments(segments: RebuildSegment[]) {
  const groups = new Map<string, RebuildSegment[]>();
  for (const segment of segments) {
    const current = groups.get(segment.logicalKey) ?? [];
    current.push(segment);
    groups.set(segment.logicalKey, current);
  }
  return groups;
}

export function reconcileRebuildSnapshot(input: {
  active?: RebuildSegment[];
  candidate: RebuildSegment[];
  candidateGenerationId: string;
  evidence: RebuildEvidence[];
  expected: RebuildSegment[];
}) {
  const candidate = input.candidate.filter(
    (row) => row.generationId === input.candidateGenerationId,
  );
  const evidence = input.evidence.filter(
    (row) => row.generationId === input.candidateGenerationId,
  );
  const expectedGroups = groupSegments(input.expected);
  const candidateGroups = groupSegments(candidate);
  const activeGroups = groupSegments(input.active ?? []);
  const discrepancies: RebuildDifference[] = [];

  for (const logicalKey of new Set([
    ...expectedGroups.keys(),
    ...candidateGroups.keys(),
  ])) {
    const expectedRows = expectedGroups.get(logicalKey) ?? [];
    const candidateRows = candidateGroups.get(logicalKey) ?? [];
    const metric =
      expectedRows[0]?.metric ?? candidateRows[0]?.metric ?? "unknown";
    if (
      !isQuantityMetric(metric) &&
      [...expectedRows, ...candidateRows].some(
        (row) => row.currencyCode === null,
      )
    ) {
      discrepancies.push(
        difference("currency_missing", logicalKey, metric, 1, 0),
      );
    }
    if (new Set(expectedRows.map((row) => row.currencyCode)).size > 1) {
      discrepancies.push(
        difference(
          "mixed_currency",
          logicalKey,
          metric,
          1,
          new Set(expectedRows.map((row) => row.currencyCode)).size,
        ),
      );
      continue;
    }
    if (candidateRows.reduce((sum, row) => sum + row.rowCount, 0) > 1) {
      discrepancies.push(
        difference(
          "duplicate_candidate_row",
          logicalKey,
          metric,
          1,
          candidateRows.reduce((sum, row) => sum + row.rowCount, 0),
        ),
      );
    }
    const expectedValue = expectedRows.reduce((sum, row) => sum + row.value, 0);
    const candidateValue = candidateRows.reduce(
      (sum, row) => sum + row.value,
      0,
    );
    const expectedCurrency = expectedRows[0]?.currencyCode ?? null;
    const candidateCurrencies = new Set(
      candidateRows.map((row) => row.currencyCode),
    );
    if (
      candidateRows.length > 0 &&
      (candidateCurrencies.size > 1 ||
        !candidateCurrencies.has(expectedCurrency))
    ) {
      discrepancies.push(
        difference(
          "currency_segment_mismatch",
          logicalKey,
          metric,
          expectedRows.length === 0 ? 0 : 1,
          candidateCurrencies.size,
        ),
      );
    }
    if (expectedValue !== candidateValue) {
      discrepancies.push(
        difference(
          "source_to_projection",
          logicalKey,
          metric,
          expectedValue,
          candidateValue,
        ),
      );
    }
  }

  if (input.active) {
    for (const logicalKey of new Set([
      ...candidateGroups.keys(),
      ...activeGroups.keys(),
    ])) {
      const candidateRows = candidateGroups.get(logicalKey) ?? [];
      const activeRows = activeGroups.get(logicalKey) ?? [];
      const currencies = new Set([
        ...candidateRows.map((row) => row.currencyCode),
        ...activeRows.map((row) => row.currencyCode),
      ]);
      for (const currencyCode of currencies) {
        const candidateValue = candidateRows
          .filter((row) => row.currencyCode === currencyCode)
          .reduce((sum, row) => sum + row.value, 0);
        const activeValue = activeRows
          .filter((row) => row.currencyCode === currencyCode)
          .reduce((sum, row) => sum + row.value, 0);
        if (candidateValue !== activeValue) {
          discrepancies.push(
            difference(
              "incremental_to_rebuild",
              `${logicalKey}:currency=${currencyCode ?? "__none__"}`,
              candidateRows[0]?.metric ?? activeRows[0]?.metric ?? "unknown",
              activeValue,
              candidateValue,
            ),
          );
        }
      }
    }
  }

  const evidenceCounts = new Map<string, number>();
  for (const row of evidence) {
    const key = `${row.factId}:${row.metric}`;
    evidenceCounts.set(key, (evidenceCounts.get(key) ?? 0) + 1);
  }
  for (const [key, count] of evidenceCounts) {
    if (count > 1) {
      discrepancies.push(
        difference(
          "duplicate_projection_evidence",
          key,
          key.slice(key.indexOf(":") + 1),
          1,
          count,
        ),
      );
    }
  }

  discrepancies.sort(
    (left, right) =>
      left.logicalKey.localeCompare(right.logicalKey) ||
      left.invariant.localeCompare(right.invariant),
  );
  return {
    discrepancies,
    status:
      discrepancies.length === 0 ? ("verified" as const) : ("failed" as const),
  };
}

export function decideStableCatchUp(input: {
  currentWatermark: number;
  laterAcceptedAt: number | null;
  nextWatermark: number;
}) {
  return input.laterAcceptedAt !== null &&
    input.laterAcceptedAt > input.currentWatermark
    ? {
        nextPeriodStart: input.currentWatermark,
        nextWatermark: input.nextWatermark,
        restart: true as const,
      }
    : { restart: false as const };
}

type AccumulatorSource =
  "expected" | "candidate" | "active" | "evidence" | "expected_evidence";

const RECONCILIATION_PAGE_SIZE = 100;
const CURRENCY_SEGMENT_READ_LIMIT = 3;
const RECONCILIATION_EXPECTED = "projection_reconciliation_expected";
const RECONCILIATION_CANDIDATE = "projection_reconciliation_candidate";
const RECONCILIATION_EVIDENCE = "projection_reconciliation_evidence";
const RECONCILIATION_ACTIVE = "projection_reconciliation_active";
const RECONCILIATION_COMPARE_EXPECTED =
  "projection_reconciliation_compare_expected";
const RECONCILIATION_COMPARE_CANDIDATE =
  "projection_reconciliation_compare_candidate";
const RECONCILIATION_COMPARE_EVIDENCE =
  "projection_reconciliation_compare_evidence";
const RECONCILIATION_COMPARE_ACTIVE =
  "projection_reconciliation_compare_active";

function isQuantityMetric(metric: string) {
  return (
    metric.endsWith("_units") ||
    metric.endsWith("_quantity") ||
    metric === "units_sold" ||
    metric === "units_returned"
  );
}

function reconciliationLogicalKey(input: {
  metric: string;
  operatingDate: string;
  productSkuId?: Id<"productSku">;
}) {
  return JSON.stringify([
    input.operatingDate,
    input.productSkuId ? String(input.productSkuId) : null,
    input.metric,
  ]);
}

export function reconciliationCurrencySegmentKey(
  currencyCode?: string,
  currencyMinorUnitScale?: number,
) {
  if (currencyCode === undefined) return "__none__";
  return `${currencyCode}@${currencyMinorUnitScale ?? "unknown"}`;
}

function currencyCodeFromSegmentKey(currencyKey: string) {
  return currencyKey === "__none__"
    ? undefined
    : currencyKey.slice(0, currencyKey.lastIndexOf("@"));
}

async function addAccumulator(
  ctx: MutationCtx,
  input: {
    currencyCode?: string;
    currencyMinorUnitScale?: number;
    generationId: Id<"reportingProjectionGeneration">;
    logicalKey: string;
    metric: string;
    operatingDate?: string;
    productSkuId?: Id<"productSku">;
    runId: Id<"reportingRun">;
    source: AccumulatorSource;
    storeId: Id<"store">;
    value: number;
  },
) {
  if (!Number.isSafeInteger(input.value)) {
    throw new Error("Reconciliation values must use safe integers");
  }
  const currencyKey = reconciliationCurrencySegmentKey(
    input.currencyCode,
    input.currencyMinorUnitScale,
  );
  const existing = await ctx.db
    .query("reportingReconciliationAccumulator")
    .withIndex("by_runId_source_logicalKey_currencyKey", (q) =>
      q
        .eq("runId", input.runId)
        .eq("source", input.source)
        .eq("logicalKey", input.logicalKey)
        .eq("currencyKey", currencyKey),
    )
    .first();
  if (existing) {
    await ctx.db.patch("reportingReconciliationAccumulator", existing._id, {
      rowCount: existing.rowCount + 1,
      updatedAt: Date.now(),
      value: existing.value + input.value,
    });
    return existing._id;
  }
  return ctx.db.insert("reportingReconciliationAccumulator", {
    currencyKey,
    generationId: input.generationId,
    logicalKey: input.logicalKey,
    metric: input.metric,
    operatingDate: input.operatingDate,
    productSkuId: input.productSkuId,
    rowCount: 1,
    runId: input.runId,
    source: input.source,
    storeId: input.storeId,
    updatedAt: Date.now(),
    value: input.value,
  });
}

async function recordDiscrepancy(
  ctx: MutationCtx,
  input: {
    actual: number;
    currencyCode?: string;
    expected: number;
    explainedDifference?: number;
    generationId: Id<"reportingProjectionGeneration">;
    invariant: string;
    logicalKey: string;
    metric?: string;
    operatingDate?: string;
    organizationId: Id<"organization">;
    productSkuId?: Id<"productSku">;
    runId: Id<"reportingRun">;
    storeId: Id<"store">;
  },
) {
  const reconciliationKey = `${input.invariant}:${input.logicalKey}`;
  const explainedDifference = input.explainedDifference ?? 0;
  const value = {
    actualMinorOrQuantity: input.actual,
    currencyCode: input.currencyCode,
    detectedAt: Date.now(),
    expectedMinorOrQuantity: input.expected,
    explainedDifference,
    generationId: input.generationId,
    invariant: input.invariant,
    metric: input.metric,
    operatingDate: input.operatingDate,
    organizationId: input.organizationId,
    productSkuId: input.productSkuId,
    reconciliationKey,
    runId: input.runId,
    status: "open" as const,
    storeId: input.storeId,
    unexplainedDifference: input.actual - input.expected - explainedDifference,
  };
  const existing = await ctx.db
    .query("reportingReconciliationDiscrepancy")
    .withIndex("by_runId_reconciliationKey", (q) =>
      q.eq("runId", input.runId).eq("reconciliationKey", reconciliationKey),
    )
    .first();
  if (existing) {
    await ctx.db.patch(
      "reportingReconciliationDiscrepancy",
      existing._id,
      value,
    );
    return existing._id;
  }
  return ctx.db.insert("reportingReconciliationDiscrepancy", value);
}

function accumulatorSegment(
  row: Doc<"reportingReconciliationAccumulator">,
): RebuildSegment {
  return {
    currencyCode: row.currencyKey === "__none__" ? null : row.currencyKey,
    generationId: String(row.generationId),
    logicalKey: row.logicalKey,
    metric: row.metric,
    rowCount: row.rowCount,
    value: row.value,
  };
}

async function recordSnapshotDifferences(
  ctx: MutationCtx,
  input: {
    active?: Array<Doc<"reportingReconciliationAccumulator">>;
    candidate: Array<Doc<"reportingReconciliationAccumulator">>;
    expected: Array<Doc<"reportingReconciliationAccumulator">>;
    generation: Doc<"reportingProjectionGeneration">;
    run: Doc<"reportingRun">;
  },
) {
  const result = reconcileRebuildSnapshot({
    active: input.active?.map(accumulatorSegment),
    candidate: input.candidate.map(accumulatorSegment),
    candidateGenerationId: String(input.generation._id),
    evidence: [],
    expected: input.expected.map(accumulatorSegment),
  });
  for (const discrepancy of result.discrepancies) {
    const source = input.expected[0] ?? input.candidate[0] ?? input.active?.[0];
    await recordDiscrepancy(ctx, {
      actual: discrepancy.actual,
      currencyCode:
        source === undefined
          ? undefined
          : currencyCodeFromSegmentKey(source.currencyKey),
      expected: discrepancy.expected,
      generationId: input.generation._id,
      invariant: discrepancy.invariant,
      logicalKey: discrepancy.logicalKey,
      metric: discrepancy.metric,
      operatingDate: source?.operatingDate,
      organizationId: input.generation.organizationId,
      productSkuId: source?.productSkuId,
      runId: input.run._id,
      storeId: input.run.storeId,
    });
  }
}

async function scheduleReconciliationPhase(
  ctx: MutationCtx,
  run: Doc<"reportingRun">,
  operation: string,
  patch: { sourceGenerationId?: Id<"reportingProjectionGeneration"> } = {},
) {
  await ctx.db.patch("reportingRun", run._id, {
    cursor: undefined,
    operation,
    ...patch,
  });
  await ctx.scheduler.runAfter(
    0,
    reportingRebuildInternal.processProjectionReconciliationBatch,
    { runId: run._id },
  );
}

async function continueReconciliationPage(
  ctx: MutationCtx,
  run: Doc<"reportingRun">,
  page: { continueCursor: string; isDone: boolean },
  nextOperation: string,
  patch: { sourceGenerationId?: Id<"reportingProjectionGeneration"> } = {},
) {
  if (page.isDone) {
    await scheduleReconciliationPhase(ctx, run, nextOperation, patch);
    return;
  }
  await ctx.db.patch("reportingRun", run._id, {
    cursor: page.continueCursor,
    ...patch,
  });
  await ctx.scheduler.runAfter(
    0,
    reportingRebuildInternal.processProjectionReconciliationBatch,
    { runId: run._id },
  );
}

async function paginateStoreDayGenerationRows(
  ctx: MutationCtx,
  args: {
    cursor?: string;
    generationId: Id<"reportingProjectionGeneration">;
  },
) {
  return ctx.db
    .query("reportingStoreDayProjection")
    .withIndex("by_generationId_operatingDate_metric", (q) =>
      q.eq("generationId", args.generationId),
    )
    .paginate({
      cursor: args.cursor ?? null,
      numItems: RECONCILIATION_PAGE_SIZE,
    });
}

async function paginateSkuDayGenerationRows(
  ctx: MutationCtx,
  args: {
    cursor?: string;
    generationId: Id<"reportingProjectionGeneration">;
  },
) {
  return ctx.db
    .query("reportingSkuDayProjection")
    .withIndex("by_generationId_operatingDate_productSkuId_metric", (q) =>
      q.eq("generationId", args.generationId),
    )
    .paginate({
      cursor: args.cursor ?? null,
      numItems: RECONCILIATION_PAGE_SIZE,
    });
}

async function paginateProjectionGenerationRows(
  ctx: MutationCtx,
  args: {
    cursor?: string;
    generationId: Id<"reportingProjectionGeneration">;
    projectionKind: Doc<"reportingProjectionGeneration">["projectionKind"];
  },
) {
  if (args.projectionKind === "store_day") {
    return paginateStoreDayGenerationRows(ctx, args);
  }
  if (args.projectionKind === "sku_day") {
    return paginateSkuDayGenerationRows(ctx, args);
  }
  throw new Error(
    "Projection reconciliation supports store-day and SKU-day generations",
  );
}

async function paginateReconciliationFacts(
  ctx: MutationCtx,
  args: { cursor?: string; frozenWatermark: number; storeId: Id<"store"> },
) {
  return ctx.db
    .query("reportingFact")
    .withIndex("by_storeId", (q) =>
      q
        .eq("storeId", args.storeId)
        .lte("_creationTime", args.frozenWatermark),
    )
    .paginate({
      cursor: args.cursor ?? null,
      numItems: RECONCILIATION_PAGE_SIZE,
    });
}

async function paginateReconciliationEvidence(
  ctx: MutationCtx,
  args: {
    cursor?: string;
    generationId: Id<"reportingProjectionGeneration">;
  },
) {
  return ctx.db
    .query("reportingProjectionEvidence")
    .withIndex("by_generationId_recognitionAt_factId_metric", (q) =>
      q.eq("generationId", args.generationId),
    )
    .paginate({
      cursor: args.cursor ?? null,
      numItems: RECONCILIATION_PAGE_SIZE,
    });
}

async function paginateReconciliationAccumulators(
  ctx: MutationCtx,
  args: {
    cursor?: string;
    runId: Id<"reportingRun">;
    source: AccumulatorSource;
  },
) {
  return ctx.db
    .query("reportingReconciliationAccumulator")
    .withIndex("by_runId_source", (q) =>
      q.eq("runId", args.runId).eq("source", args.source),
    )
    .paginate({
      cursor: args.cursor ?? null,
      numItems: RECONCILIATION_PAGE_SIZE,
    });
}

async function accumulatorGroup(
  ctx: MutationCtx,
  runId: Id<"reportingRun">,
  source: AccumulatorSource,
  logicalKey: string,
) {
  return ctx.db
    .query("reportingReconciliationAccumulator")
    .withIndex("by_runId_source_logicalKey", (q) =>
      q.eq("runId", runId).eq("source", source).eq("logicalKey", logicalKey),
    )
    .take(CURRENCY_SEGMENT_READ_LIMIT);
}

export const startProjectionRebuild = internalMutation({
  args: {
    automationIdentity: v.string(),
    projectionKind: projectionKindValidator,
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    const store = await ctx.db.get("store", args.storeId);
    if (!store) throw new Error("Store not found");
    const currentActivation = await ctx.db
      .query("reportingProjectionActivation")
      .withIndex("by_storeId_projectionKind_activatedAt", (q) =>
        q.eq("storeId", args.storeId).eq("projectionKind", args.projectionKind),
      )
      .order("desc")
      .first();
    const now = Date.now();
    const frozenWatermark = stableRebuildWatermark(now);
    const runId = await ctx.db.insert("reportingRun", {
      actorKind: "automation",
      automationIdentity: args.automationIdentity,
      createdAt: now,
      domain: "reporting",
      factContractVersion: REPORTING_FACT_CONTRACT_VERSION,
      failedCount: 0,
      frozenWatermark,
      expectedPriorGenerationId: currentActivation?.generationId,
      metricContractVersion: 1,
      operation: "projection_rebuild_building",
      organizationId: store.organizationId,
      processedCount: 0,
      projectionContractVersion: REPORTING_PROJECTION_CONTRACT_VERSION,
      runType: "rebuild",
      status: "pending",
      storeId: args.storeId,
    });
    const generationId = await ctx.db.insert("reportingProjectionGeneration", {
      completeness: "provisional",
      createdAt: now,
      factContractVersion: REPORTING_FACT_CONTRACT_VERSION,
      metricContractVersion: 1,
      organizationId: store.organizationId,
      projectionContractVersion: REPORTING_PROJECTION_CONTRACT_VERSION,
      projectionKind: args.projectionKind,
      runId,
      sourceWatermark: frozenWatermark,
      status: "building",
      storeId: args.storeId,
    });
    await ctx.db.patch("reportingRun", runId, { generationId });
    await ctx.db.insert("reportingRunEvent", {
      eventType: "rebuild_started",
      occurredAt: now,
      outcome: "pending",
      runId,
      sequence: 1,
      storeId: args.storeId,
    });
    await ctx.scheduler.runAfter(
      0,
      reportingRebuildInternal.processProjectionRebuildBatch,
      { runId },
    );
    return { generationId, runId };
  },
});

export const processProjectionRebuildBatchMutation = internalMutation({
  args: { runId: v.id("reportingRun") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get("reportingRun", args.runId);
    if (
      !run ||
      run.runType !== "rebuild" ||
      !run.generationId ||
      run.frozenWatermark === undefined ||
      ["paused", "cancelled", "completed"].includes(run.status)
    ) {
      return;
    }
    const generation = await ctx.db.get(
      "reportingProjectionGeneration",
      run.generationId,
    );
    if (!generation) throw new Error("Projection generation not found");
    const catchingUp = run.operation === "projection_rebuild_catching_up";
    const page = await ctx.db
      .query("reportingFact")
      .withIndex("by_storeId", (q) => {
        const store = q.eq("storeId", run.storeId);
        return catchingUp && run.periodStart !== undefined
          ? store
              .gt("_creationTime", run.periodStart)
              .lte("_creationTime", run.frozenWatermark!)
          : store.lte("_creationTime", run.frozenWatermark!);
      })
      .paginate({
        cursor: run.cursor ?? null,
        numItems: PROJECTION_REBUILD_PAGE_SIZE,
      });
    let processedCount = 0;
    for (const fact of page.page) {
      if (fact.status !== "canonical") continue;
      await applyFactToGenerationWithCtx(ctx, generation, fact);
      processedCount += 1;
    }
    const totalProcessed = run.processedCount + processedCount;
    if (!page.isDone) {
      await ctx.db.patch("reportingRun", run._id, {
        cursor: page.continueCursor,
        processedCount: totalProcessed,
        startedAt: run.startedAt ?? Date.now(),
        status: "running",
      });
      await ctx.scheduler.runAfter(
        0,
        reportingRebuildInternal.processProjectionRebuildBatch,
        { runId: run._id },
      );
      return;
    }
    if (!catchingUp) {
      const nextWatermark = Math.max(
        run.frozenWatermark,
        stableRebuildWatermark(Date.now()),
      );
      await ctx.db.patch("reportingProjectionGeneration", generation._id, {
        status: "catching_up",
      });
      await ctx.db.patch("reportingRun", run._id, {
        cursor: undefined,
        frozenWatermark: nextWatermark,
        operation: "projection_rebuild_catching_up",
        periodStart: run.frozenWatermark,
        processedCount: totalProcessed,
        status: "running",
      });
      await ctx.scheduler.runAfter(
        0,
        reportingRebuildInternal.processProjectionRebuildBatch,
        { runId: run._id },
      );
      return;
    }
    const laterFact = await ctx.db
      .query("reportingFact")
      .withIndex("by_storeId", (q) =>
        q
          .eq("storeId", run.storeId)
          .gt("_creationTime", run.frozenWatermark!),
      )
      .first();
    if (laterFact) {
      const nextWatermark = Math.max(
        run.frozenWatermark,
        stableRebuildWatermark(Date.now()),
      );
      const catchUp = decideStableCatchUp({
        currentWatermark: run.frozenWatermark,
        laterAcceptedAt: laterFact._creationTime,
        nextWatermark,
      });
      if (!catchUp.restart) return;
      await ctx.db.patch("reportingRun", run._id, {
        cursor: undefined,
        frozenWatermark: catchUp.nextWatermark,
        periodStart: catchUp.nextPeriodStart,
        processedCount: totalProcessed,
      });
      await ctx.scheduler.runAfter(
        0,
        reportingRebuildInternal.processProjectionRebuildBatch,
        { runId: run._id },
      );
      return;
    }
    await ctx.db.patch("reportingProjectionGeneration", generation._id, {
      status: "reconciling",
    });
    await ctx.db.patch("reportingProjectionGeneration", generation._id, {
      sourceWatermark: run.frozenWatermark,
      stableWatermark: run.frozenWatermark,
    });
    await ctx.db.patch("reportingRun", run._id, {
      cursor: undefined,
      operation: RECONCILIATION_EXPECTED,
      processedCount: totalProcessed,
    });
    await ctx.scheduler.runAfter(
      0,
      reportingRebuildInternal.processProjectionReconciliationBatch,
      { runId: run._id },
    );
  },
});

export const processProjectionReconciliationBatchMutation = internalMutation({
  args: { runId: v.id("reportingRun") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get("reportingRun", args.runId);
    if (
      !run ||
      run.runType !== "rebuild" ||
      !run.generationId ||
      run.frozenWatermark === undefined ||
      run.status !== "running"
    ) {
      return;
    }
    const generation = await ctx.db.get(
      "reportingProjectionGeneration",
      run.generationId,
    );
    if (!generation || generation.storeId !== run.storeId) {
      throw new Error("Projection generation not found for rebuild store");
    }

    if (run.operation === RECONCILIATION_EXPECTED) {
      if (run.cursor === undefined) {
        const versionChecks = [
          [
            "fact_contract_version",
            run.factContractVersion,
            generation.factContractVersion,
          ],
          [
            "metric_contract_version",
            run.metricContractVersion,
            generation.metricContractVersion,
          ],
          [
            "projection_contract_version",
            run.projectionContractVersion,
            generation.projectionContractVersion,
          ],
        ] as const;
        for (const [name, expected, actual] of versionChecks) {
          if (expected !== actual) {
            await recordDiscrepancy(ctx, {
              actual,
              expected,
              generationId: generation._id,
              invariant: "version_incompatible",
              logicalKey: `candidate:${name}`,
              metric: name,
              organizationId: generation.organizationId,
              runId: run._id,
              storeId: run.storeId,
            });
          }
        }
      }
      const page = await paginateReconciliationFacts(ctx, {
        cursor: run.cursor,
        frozenWatermark: run.frozenWatermark,
        storeId: run.storeId,
      });
      for (const fact of page.page) {
        if (fact.status !== "canonical") continue;
        if (
          fact.factContractVersion !== generation.factContractVersion ||
          fact.metricContractVersion !== generation.metricContractVersion
        ) {
          await recordDiscrepancy(ctx, {
            actual:
              fact.factContractVersion !== generation.factContractVersion
                ? fact.factContractVersion
                : fact.metricContractVersion,
            expected:
              fact.factContractVersion !== generation.factContractVersion
                ? generation.factContractVersion
                : generation.metricContractVersion,
            generationId: generation._id,
            invariant: "version_incompatible",
            logicalKey: `fact:${fact._id}`,
            metric:
              fact.factContractVersion !== generation.factContractVersion
                ? "fact_contract_version"
                : "metric_contract_version",
            operatingDate: fact.operatingDate,
            organizationId: generation.organizationId,
            productSkuId: fact.productSkuId,
            runId: run._id,
            storeId: run.storeId,
          });
          continue;
        }
        const contributions = deriveFactMetricContributions(fact);
        for (const contribution of contributions) {
          if (generation.projectionKind === "sku_day" && !fact.productSkuId) {
            continue;
          }
          const logicalKey = reconciliationLogicalKey({
            metric: contribution.metric,
            operatingDate: fact.operatingDate,
            productSkuId:
              generation.projectionKind === "sku_day"
                ? fact.productSkuId
                : undefined,
          });
          const contributionCurrency = currencyForFactMetric(
            fact,
            contribution.metric,
          );
          const contributionCurrencyMinorUnitScale =
            minorUnitScaleForFactMetric(fact, contribution.metric);
          if (
            !isQuantityMetric(contribution.metric) &&
            (contributionCurrency === undefined ||
              contributionCurrencyMinorUnitScale === undefined)
          ) {
            await recordDiscrepancy(ctx, {
              actual: 0,
              expected: 1,
              generationId: generation._id,
              invariant: "currency_missing",
              logicalKey: `${fact._id}:${contribution.metric}`,
              metric: contribution.metric,
              operatingDate: fact.operatingDate,
              organizationId: generation.organizationId,
              productSkuId: fact.productSkuId,
              runId: run._id,
              storeId: run.storeId,
            });
          }
          await addAccumulator(ctx, {
            currencyCode: isQuantityMetric(contribution.metric)
              ? undefined
              : contributionCurrency,
            currencyMinorUnitScale: isQuantityMetric(contribution.metric)
              ? undefined
              : contributionCurrencyMinorUnitScale,
            generationId: generation._id,
            logicalKey,
            metric: contribution.metric,
            operatingDate: fact.operatingDate,
            productSkuId:
              generation.projectionKind === "sku_day"
                ? fact.productSkuId
                : undefined,
            runId: run._id,
            source: "expected",
            storeId: run.storeId,
            value: contribution.value,
          });
          await addAccumulator(ctx, {
            generationId: generation._id,
            logicalKey: `${fact._id}:${contribution.metric}`,
            metric: contribution.metric,
            operatingDate: fact.operatingDate,
            productSkuId:
              generation.projectionKind === "sku_day"
                ? fact.productSkuId
                : undefined,
            runId: run._id,
            source: "expected_evidence",
            storeId: run.storeId,
            value: 0,
          });
        }
      }
      await continueReconciliationPage(
        ctx,
        run,
        page,
        RECONCILIATION_CANDIDATE,
      );
      return;
    }

    if (run.operation === RECONCILIATION_CANDIDATE) {
      const processRow = async (
        row:
          Doc<"reportingStoreDayProjection"> | Doc<"reportingSkuDayProjection">,
      ) => {
        const productSkuId =
          "productSkuId" in row ? row.productSkuId : undefined;
        const logicalKey = reconciliationLogicalKey({
          metric: row.metric,
          operatingDate: row.operatingDate,
          productSkuId,
        });
        if (row.metricContractVersion !== generation.metricContractVersion) {
          await recordDiscrepancy(ctx, {
            actual: row.metricContractVersion,
            expected: generation.metricContractVersion,
            generationId: generation._id,
            invariant: "version_incompatible",
            logicalKey: `projection:${row._id}`,
            metric: "metric_contract_version",
            operatingDate: row.operatingDate,
            organizationId: generation.organizationId,
            productSkuId,
            runId: run._id,
            storeId: run.storeId,
          });
        }
        if (
          !isQuantityMetric(row.metric) &&
          (row.currencyCode === undefined ||
            row.currencyMinorUnitScale === undefined)
        ) {
          await recordDiscrepancy(ctx, {
            actual: 0,
            expected: 1,
            generationId: generation._id,
            invariant: "currency_missing",
            logicalKey: `projection:${row._id}`,
            metric: row.metric,
            operatingDate: row.operatingDate,
            organizationId: generation.organizationId,
            productSkuId,
            runId: run._id,
            storeId: run.storeId,
          });
        }
        await addAccumulator(ctx, {
          currencyCode: isQuantityMetric(row.metric)
            ? undefined
            : row.currencyCode,
          currencyMinorUnitScale: isQuantityMetric(row.metric)
            ? undefined
            : row.currencyMinorUnitScale,
          generationId: generation._id,
          logicalKey,
          metric: row.metric,
          operatingDate: row.operatingDate,
          productSkuId,
          runId: run._id,
          source: "candidate",
          storeId: run.storeId,
          value: row.knownValue ?? 0,
        });
        if (row.unknownQuantity !== undefined) {
          await addAccumulator(ctx, {
            generationId: generation._id,
            logicalKey: reconciliationLogicalKey({
              metric: `${row.metric}__unknown_quantity`,
              operatingDate: row.operatingDate,
              productSkuId,
            }),
            metric: `${row.metric}__unknown_quantity`,
            operatingDate: row.operatingDate,
            productSkuId,
            runId: run._id,
            source: "candidate",
            storeId: run.storeId,
            value: row.unknownQuantity,
          });
        }
      };
      const page = await paginateProjectionGenerationRows(ctx, {
        cursor: run.cursor,
        generationId: generation._id,
        projectionKind: generation.projectionKind,
      });
      for (const row of page.page) await processRow(row);
      await continueReconciliationPage(ctx, run, page, RECONCILIATION_EVIDENCE);
      return;
    }

    if (run.operation === RECONCILIATION_EVIDENCE) {
      const page = await paginateReconciliationEvidence(ctx, {
        cursor: run.cursor,
        generationId: generation._id,
      });
      for (const evidence of page.page) {
        if (!evidence.factId) {
          await recordDiscrepancy(ctx, {
            actual: 1,
            expected: 0,
            generationId: generation._id,
            invariant: "projection_evidence_identity_missing",
            logicalKey: `evidence:${evidence._id}`,
            metric: evidence.metric,
            organizationId: generation.organizationId,
            productSkuId: evidence.productSkuId,
            runId: run._id,
            storeId: run.storeId,
          });
          continue;
        }
        const logicalKey = `${evidence.factId}:${evidence.metric}`;
        const expectedEvidence = await ctx.db
          .query("reportingReconciliationAccumulator")
          .withIndex("by_runId_source_logicalKey_currencyKey", (q) =>
            q
              .eq("runId", run._id)
              .eq("source", "expected_evidence")
              .eq("logicalKey", logicalKey)
              .eq("currencyKey", "__none__"),
          )
          .first();
        if (!expectedEvidence) {
          await recordDiscrepancy(ctx, {
            actual: 1,
            expected: 0,
            generationId: generation._id,
            invariant: "unexpected_projection_evidence",
            logicalKey,
            metric: evidence.metric,
            organizationId: generation.organizationId,
            productSkuId: evidence.productSkuId,
            runId: run._id,
            storeId: run.storeId,
          });
        }
        await addAccumulator(ctx, {
          generationId: generation._id,
          logicalKey,
          metric: evidence.metric,
          productSkuId: evidence.productSkuId,
          runId: run._id,
          source: "evidence",
          storeId: run.storeId,
          value: 0,
        });
      }
      if (!page.isDone) {
        await continueReconciliationPage(
          ctx,
          run,
          page,
          RECONCILIATION_EVIDENCE,
        );
        return;
      }
      const activation = await ctx.db
        .query("reportingProjectionActivation")
        .withIndex("by_storeId_projectionKind_activatedAt", (q) =>
          q
            .eq("storeId", run.storeId)
            .eq("projectionKind", generation.projectionKind),
        )
        .order("desc")
        .first();
      const active = activation
        ? await ctx.db.get(
            "reportingProjectionGeneration",
            activation.generationId,
          )
        : null;
      const compatibleActive =
        active &&
        active._id !== generation._id &&
        active.storeId === run.storeId &&
        active.projectionKind === generation.projectionKind &&
        active.status === "active" &&
        active.factContractVersion === generation.factContractVersion &&
        active.metricContractVersion === generation.metricContractVersion &&
        active.projectionContractVersion ===
          generation.projectionContractVersion &&
        active.sourceWatermark === run.frozenWatermark
          ? active
          : null;
      await scheduleReconciliationPhase(
        ctx,
        run,
        compatibleActive
          ? RECONCILIATION_ACTIVE
          : RECONCILIATION_COMPARE_EXPECTED,
        compatibleActive ? { sourceGenerationId: compatibleActive._id } : {},
      );
      return;
    }

    if (run.operation === RECONCILIATION_ACTIVE) {
      if (!run.sourceGenerationId) {
        await scheduleReconciliationPhase(
          ctx,
          run,
          RECONCILIATION_COMPARE_EXPECTED,
        );
        return;
      }
      const sourceGeneration = await ctx.db.get(
        "reportingProjectionGeneration",
        run.sourceGenerationId,
      );
      if (!sourceGeneration || sourceGeneration.storeId !== run.storeId) {
        await recordDiscrepancy(ctx, {
          actual: 0,
          expected: 1,
          generationId: generation._id,
          invariant: "active_generation_unavailable",
          logicalKey: `active:${run.sourceGenerationId}`,
          organizationId: generation.organizationId,
          runId: run._id,
          storeId: run.storeId,
        });
        await scheduleReconciliationPhase(
          ctx,
          run,
          RECONCILIATION_COMPARE_EXPECTED,
        );
        return;
      }
      const processRow = async (
        row:
          Doc<"reportingStoreDayProjection"> | Doc<"reportingSkuDayProjection">,
      ) => {
        const productSkuId =
          "productSkuId" in row ? row.productSkuId : undefined;
        await addAccumulator(ctx, {
          currencyCode: isQuantityMetric(row.metric)
            ? undefined
            : row.currencyCode,
          currencyMinorUnitScale: isQuantityMetric(row.metric)
            ? undefined
            : row.currencyMinorUnitScale,
          generationId: sourceGeneration._id,
          logicalKey: reconciliationLogicalKey({
            metric: row.metric,
            operatingDate: row.operatingDate,
            productSkuId,
          }),
          metric: row.metric,
          operatingDate: row.operatingDate,
          productSkuId,
          runId: run._id,
          source: "active",
          storeId: run.storeId,
          value: row.knownValue ?? 0,
        });
        if (row.unknownQuantity !== undefined) {
          await addAccumulator(ctx, {
            generationId: sourceGeneration._id,
            logicalKey: reconciliationLogicalKey({
              metric: `${row.metric}__unknown_quantity`,
              operatingDate: row.operatingDate,
              productSkuId,
            }),
            metric: `${row.metric}__unknown_quantity`,
            operatingDate: row.operatingDate,
            productSkuId,
            runId: run._id,
            source: "active",
            storeId: run.storeId,
            value: row.unknownQuantity,
          });
        }
      };
      const page = await paginateProjectionGenerationRows(ctx, {
        cursor: run.cursor,
        generationId: sourceGeneration._id,
        projectionKind: sourceGeneration.projectionKind,
      });
      for (const row of page.page) await processRow(row);
      await continueReconciliationPage(
        ctx,
        run,
        page,
        RECONCILIATION_COMPARE_EXPECTED,
      );
      return;
    }

    if (
      run.operation === RECONCILIATION_COMPARE_EXPECTED ||
      run.operation === RECONCILIATION_COMPARE_CANDIDATE ||
      run.operation === RECONCILIATION_COMPARE_EVIDENCE ||
      run.operation === RECONCILIATION_COMPARE_ACTIVE
    ) {
      const source: AccumulatorSource =
        run.operation === RECONCILIATION_COMPARE_EXPECTED
          ? "expected"
          : run.operation === RECONCILIATION_COMPARE_CANDIDATE
            ? "candidate"
            : run.operation === RECONCILIATION_COMPARE_EVIDENCE
              ? "expected_evidence"
              : "active";
      const page = await paginateReconciliationAccumulators(ctx, {
        cursor: run.cursor,
        runId: run._id,
        source,
      });
      for (const row of page.page) {
        const sourceGroup = await accumulatorGroup(
          ctx,
          run._id,
          source,
          row.logicalKey,
        );
        if (String(sourceGroup[0]?._id) !== String(row._id)) continue;
        if (run.operation === RECONCILIATION_COMPARE_EXPECTED) {
          await recordSnapshotDifferences(ctx, {
            candidate: await accumulatorGroup(
              ctx,
              run._id,
              "candidate",
              row.logicalKey,
            ),
            expected: sourceGroup,
            generation,
            run,
          });
        } else if (run.operation === RECONCILIATION_COMPARE_CANDIDATE) {
          const expected = await accumulatorGroup(
            ctx,
            run._id,
            "expected",
            row.logicalKey,
          );
          if (expected.length === 0) {
            await recordSnapshotDifferences(ctx, {
              candidate: sourceGroup,
              expected,
              generation,
              run,
            });
          }
          if (run.sourceGenerationId) {
            await recordSnapshotDifferences(ctx, {
              active: await accumulatorGroup(
                ctx,
                run._id,
                "active",
                row.logicalKey,
              ),
              candidate: sourceGroup,
              expected: sourceGroup,
              generation,
              run,
            });
          }
        } else if (run.operation === RECONCILIATION_COMPARE_EVIDENCE) {
          const actual = await ctx.db
            .query("reportingReconciliationAccumulator")
            .withIndex("by_runId_source_logicalKey_currencyKey", (q) =>
              q
                .eq("runId", run._id)
                .eq("source", "evidence")
                .eq("logicalKey", row.logicalKey)
                .eq("currencyKey", "__none__"),
            )
            .first();
          if ((actual?.rowCount ?? 0) !== row.rowCount) {
            await recordDiscrepancy(ctx, {
              actual: actual?.rowCount ?? 0,
              expected: row.rowCount,
              generationId: generation._id,
              invariant:
                (actual?.rowCount ?? 0) > row.rowCount
                  ? "duplicate_projection_evidence"
                  : "projection_evidence_cardinality",
              logicalKey: row.logicalKey,
              metric: row.metric,
              operatingDate: row.operatingDate,
              organizationId: generation.organizationId,
              productSkuId: row.productSkuId,
              runId: run._id,
              storeId: run.storeId,
            });
          }
        } else {
          const candidate = await accumulatorGroup(
            ctx,
            run._id,
            "candidate",
            row.logicalKey,
          );
          if (candidate.length === 0) {
            await recordSnapshotDifferences(ctx, {
              active: sourceGroup,
              candidate,
              expected: candidate,
              generation,
              run,
            });
          }
        }
      }
      const nextOperation =
        run.operation === RECONCILIATION_COMPARE_EXPECTED
          ? RECONCILIATION_COMPARE_CANDIDATE
          : run.operation === RECONCILIATION_COMPARE_CANDIDATE
            ? RECONCILIATION_COMPARE_EVIDENCE
            : run.operation === RECONCILIATION_COMPARE_EVIDENCE &&
                run.sourceGenerationId
              ? RECONCILIATION_COMPARE_ACTIVE
              : "projection_reconciliation_finalize";
      await continueReconciliationPage(ctx, run, page, nextOperation);
      return;
    }

    if (run.operation !== "projection_reconciliation_finalize") return;
    const quarantines = await ctx.db
      .query("reportingQuarantine")
      .withIndex("by_storeId_status_detectedAt", (q) =>
        q.eq("storeId", run.storeId).eq("status", "open"),
      )
      .take(100);
    const sourceHealthRows = await ctx.db
      .query("reportingProjectionHealth")
      .withIndex("by_storeId_sourceDomain_projectionKind", (q) =>
        q.eq("storeId", run.storeId),
      )
      .take(100);
    const laterFact = await ctx.db
      .query("reportingFact")
      .withIndex("by_storeId", (q) =>
        q
          .eq("storeId", run.storeId)
          .gt("_creationTime", run.frozenWatermark!),
      )
      .first();
    if (laterFact) {
      await recordDiscrepancy(ctx, {
        actual: laterFact._creationTime,
        expected: run.frozenWatermark,
        generationId: generation._id,
        invariant: "source_watermark_advanced",
        logicalKey: String(laterFact._id),
        organizationId: generation.organizationId,
        runId: run._id,
        storeId: run.storeId,
      });
    }
    const discrepancy = await ctx.db
      .query("reportingReconciliationDiscrepancy")
      .withIndex("by_runId", (q) => q.eq("runId", run._id))
      .first();
    const freshnessDiscrepancy = await ctx.db
      .query("reportingReconciliationDiscrepancy")
      .withIndex("by_runId_invariant", (q) =>
        q.eq("runId", run._id).eq("invariant", "source_watermark_advanced"),
      )
      .first();
    const versionDiscrepancy = await ctx.db
      .query("reportingReconciliationDiscrepancy")
      .withIndex("by_runId_invariant", (q) =>
        q.eq("runId", run._id).eq("invariant", "version_incompatible"),
      )
      .first();
    const currencyDiscrepancy =
      (await ctx.db
        .query("reportingReconciliationDiscrepancy")
        .withIndex("by_runId_invariant", (q) =>
          q.eq("runId", run._id).eq("invariant", "mixed_currency"),
        )
        .first()) ??
      (await ctx.db
        .query("reportingReconciliationDiscrepancy")
        .withIndex("by_runId_invariant", (q) =>
          q.eq("runId", run._id).eq("invariant", "currency_segment_mismatch"),
        )
        .first()) ??
      (await ctx.db
        .query("reportingReconciliationDiscrepancy")
        .withIndex("by_runId_invariant", (q) =>
          q.eq("runId", run._id).eq("invariant", "currency_missing"),
        )
        .first());
    const quarantineCounts = Object.fromEntries(
      REPORTING_SOURCE_DOMAINS.map((sourceDomain) => [
        sourceDomain,
        quarantines.filter((row) => row.sourceDomain === sourceDomain).length,
      ]),
    );
    const omittedCounts = Object.fromEntries(
      REPORTING_SOURCE_DOMAINS.map((sourceDomain) => [
        sourceDomain,
        sourceHealthRows.some(
          (row) =>
            row.sourceDomain === sourceDomain &&
            row.projectionKind === generation.projectionKind &&
            (row.processingWatermark !== undefined ||
              row.backfillState === "completed" ||
              row.backfillState === "completed_with_quarantine"),
        )
          ? 0
          : 1,
      ]),
    );
    const failed = Boolean(discrepancy);
    const limitingReason = freshnessDiscrepancy
      ? ("projection_stale" as const)
      : versionDiscrepancy
        ? ("version_incompatible" as const)
        : currencyDiscrepancy
          ? ("mixed_currency" as const)
          : discrepancy
            ? ("reconciliation_drift" as const)
            : quarantines.length > 0
              ? ("source_incomplete" as const)
              : undefined;
    const completedAt = Date.now();
    await materializeGenerationCoverageWithCtx(ctx, {
      defaultCompleteness: failed ? "partial" : "complete",
      failedSources: failed
        ? Object.fromEntries(
            REPORTING_SOURCE_DOMAINS.map((sourceDomain) => [sourceDomain, 1]),
          )
        : undefined,
      generation,
      globalLimitingReason:
        versionDiscrepancy || currencyDiscrepancy ? limitingReason : undefined,
      periodEnd: run.frozenWatermark,
      periodStart: run.createdAt,
      omittedSources: omittedCounts,
      quarantinedSources: quarantineCounts,
      truncated: quarantines.length === 100,
    });
    await ctx.db.patch("reportingProjectionGeneration", generation._id, {
      completeness: failed ? "partial" : "complete",
      limitingReason,
      sourceWatermark: run.frozenWatermark,
      stableWatermark: run.frozenWatermark,
      status: failed ? "failed" : "verified",
      verifiedAt: failed ? undefined : completedAt,
    });
    await ctx.db.patch("reportingRun", run._id, {
      completedAt,
      failedCount: failed ? Math.max(1, run.failedCount) : run.failedCount,
      status: failed ? "failed" : "completed",
    });
    await ctx.db.insert("reportingRunEvent", {
      eventType: "rebuild_completed",
      failedCount: failed ? Math.max(1, run.failedCount) : run.failedCount,
      occurredAt: completedAt,
      outcome: failed ? "failed" : "verified",
      processedCount: run.processedCount,
      runId: run._id,
      sequence: run.processedCount + 2,
      storeId: run.storeId,
    });
    for (const sourceDomain of REPORTING_SOURCE_DOMAINS) {
      await upsertProjectionHealthWithCtx(ctx, {
        factContractVersion: generation.factContractVersion,
        latestSuccessfulReconciliationAt: failed ? undefined : completedAt,
        limitingReason:
          quarantineCounts[sourceDomain] > 0
            ? "source_incomplete"
            : failed
              ? "reconciliation_drift"
              : undefined,
        metricContractVersion: generation.metricContractVersion,
        organizationId: generation.organizationId,
        processingWatermark: run.frozenWatermark,
        projectionContractVersion: generation.projectionContractVersion,
        projectionKind: generation.projectionKind,
        quarantinedCount: quarantineCounts[sourceDomain],
        sourceDomain,
        storeId: run.storeId,
        updatedAt: completedAt,
      });
    }
  },
});

export const recordProjectionRebuildFailure = internalMutation({
  args: {
    runId: v.id("reportingRun"),
    safeReason: v.string(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get("reportingRun", args.runId);
    if (
      !run ||
      run.runType !== "rebuild" ||
      ["completed", "cancelled", "expired"].includes(run.status)
    ) {
      return;
    }
    const generation = run.generationId
      ? await ctx.db.get("reportingProjectionGeneration", run.generationId)
      : null;
    if (
      !generation ||
      (generation.projectionKind !== "store_day" &&
        generation.projectionKind !== "sku_day")
    ) {
      return;
    }
    const failedAt = Date.now();
    await ctx.db.patch("reportingRun", run._id, {
      completedAt: failedAt,
      failedCount: run.failedCount + 1,
      status: "failed",
    });
    await ctx.db.patch("reportingProjectionGeneration", generation._id, {
      completeness: "partial",
      limitingReason: "rebuild_failed",
      status: "failed",
    });
    const latestEvent = await ctx.db
      .query("reportingRunEvent")
      .withIndex("by_runId_sequence", (q) => q.eq("runId", run._id))
      .order("desc")
      .first();
    await ctx.db.insert("reportingRunEvent", {
      cursor: run.cursor,
      eventType: "projection_rebuild_failed",
      failedCount: run.failedCount + 1,
      occurredAt: failedAt,
      outcome: "failed",
      processedCount: run.processedCount,
      runId: run._id,
      safeReason: args.safeReason.slice(0, 100),
      sequence: (latestEvent?.sequence ?? 0) + 1,
      storeId: run.storeId,
    });
  },
});

export const processProjectionRebuildBatch = internalAction({
  args: { runId: v.id("reportingRun") },
  handler: async (ctx, args) => {
    try {
      await ctx.runMutation(
        reportingRebuildInternal.processProjectionRebuildBatchMutation,
        args,
      );
    } catch {
      await ctx.runMutation(
        reportingRebuildInternal.recordProjectionRebuildFailure,
        { runId: args.runId, safeReason: "projection_rebuild_worker_failed" },
      );
    }
  },
});

export const processProjectionReconciliationBatch = internalAction({
  args: { runId: v.id("reportingRun") },
  handler: async (ctx, args) => {
    try {
      await ctx.runMutation(
        reportingRebuildInternal.processProjectionReconciliationBatchMutation,
        args,
      );
    } catch {
      await ctx.runMutation(
        reportingRebuildInternal.recordProjectionRebuildFailure,
        {
          runId: args.runId,
          safeReason: "projection_reconciliation_worker_failed",
        },
      );
    }
  },
});

export const controlProjectionRebuild = internalMutation({
  args: {
    action: v.union(
      v.literal("pause"),
      v.literal("resume"),
      v.literal("retry"),
      v.literal("cancel"),
    ),
    runId: v.id("reportingRun"),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get("reportingRun", args.runId);
    const generation = run?.generationId
      ? await ctx.db.get("reportingProjectionGeneration", run.generationId)
      : null;
    if (
      !run ||
      run.runType !== "rebuild" ||
      run.status === "expired" ||
      !generation ||
      (generation.projectionKind !== "store_day" &&
        generation.projectionKind !== "sku_day")
    ) {
      throw new Error("Projection rebuild run not found");
    }
    const nextStatus =
      args.action === "pause"
        ? ("paused" as const)
        : args.action === "cancel"
          ? ("cancelled" as const)
          : ("running" as const);
    assertReportingRunTransition(run.status, nextStatus);
    const now = Date.now();
    await ctx.db.patch("reportingRun", run._id, {
      completedAt: nextStatus === "cancelled" ? now : undefined,
      status: nextStatus,
    });
    if (nextStatus === "running") {
      await ctx.db.patch("reportingProjectionGeneration", generation._id, {
        limitingReason: undefined,
        status: run.operation.startsWith("projection_reconciliation")
          ? "reconciling"
          : run.operation === "projection_rebuild_catching_up"
            ? "catching_up"
            : "building",
      });
    }
    const latestEvent = await ctx.db
      .query("reportingRunEvent")
      .withIndex("by_runId_sequence", (q) => q.eq("runId", run._id))
      .order("desc")
      .first();
    await ctx.db.insert("reportingRunEvent", {
      cursor: run.cursor,
      eventType: `projection_rebuild_${args.action}`,
      occurredAt: now,
      outcome: nextStatus,
      processedCount: run.processedCount,
      runId: run._id,
      sequence: (latestEvent?.sequence ?? 0) + 1,
      storeId: run.storeId,
    });
    if (nextStatus === "running") {
      await ctx.scheduler.runAfter(
        0,
        run.operation.startsWith("projection_reconciliation")
          ? reportingRebuildInternal.processProjectionReconciliationBatch
          : reportingRebuildInternal.processProjectionRebuildBatch,
        { runId: run._id },
      );
    }
  },
});
