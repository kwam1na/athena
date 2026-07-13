import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type {
  ReportingCompleteness,
  ReportingLimitingReason,
  ReportingMetricName,
  ReportingSourceDomain,
} from "../../shared/reportingContract";
import { REPORTING_FRESHNESS_TARGET_MS } from "./health";
import { METRIC_CONTRACTS } from "./metricContracts";
import type { FactMetricContribution } from "./projections/factContributions";

export type MetricCoverageObservation = {
  completeness: ReportingCompleteness;
  failedCount: number;
  knownLagMs?: number;
  processingWatermark?: number;
  limitingReason: ReportingLimitingReason | null;
  omittedCount: number;
  quarantinedCount: number;
  sourceDomain: string;
  truncated: boolean;
};

export function metricsForProjectionKind(
  projectionKind: Doc<"reportingProjectionGeneration">["projectionKind"],
): ReportingMetricName[] {
  const all = Object.keys(METRIC_CONTRACTS) as ReportingMetricName[];
  if (projectionKind === "current_inventory") {
    return ["on_hand_units", "sellable_units", "inventory_value"];
  }
  if (projectionKind === "sku_day") {
    return all.filter(
      (metric) =>
        !metric.startsWith("payment") &&
        ![
          "payments_refunded",
          "payments_reversed",
          "on_hand_units",
          "sellable_units",
          "inventory_value",
        ].includes(metric),
    );
  }
  if (projectionKind === "store_day" || projectionKind === "custom_range") {
    return all.filter(
      (metric) =>
        !["on_hand_units", "sellable_units", "inventory_value"].includes(
          metric,
        ),
    );
  }
  return [];
}

export function summarizeRequiredMetricCoverage(input: {
  metric: ReportingMetricName;
  observations: MetricCoverageObservation[];
  requiredSourceDomains?: string[];
}) {
  const requiredSources =
    input.requiredSourceDomains ??
    METRIC_CONTRACTS[input.metric].requiredSourceDomains;
  const bySource = new Map(
    input.observations.map((observation) => [
      observation.sourceDomain,
      observation,
    ]),
  );
  const sources = requiredSources.map((sourceDomain) => {
    const observation = bySource.get(sourceDomain);
    if (!observation) {
      return {
        completeness: "unavailable" as const,
        failedCount: 0,
        knownLagMs: null,
        limitingReason: "source_incomplete" as const,
        omittedCount: 1,
        quarantinedCount: 0,
        sourceDomain,
        truncated: false,
      };
    }
    const limitingReason =
      observation.failedCount > 0
        ? ("processing_failed" as const)
        : observation.truncated
          ? ("evidence_truncated" as const)
          : observation.quarantinedCount > 0 || observation.omittedCount > 0
            ? ("source_incomplete" as const)
            : (observation.knownLagMs ?? 0) > REPORTING_FRESHNESS_TARGET_MS
              ? ("projection_stale" as const)
              : observation.limitingReason;
    const completeness =
      observation.failedCount > 0 || observation.truncated
        ? ("partial" as const)
        : observation.quarantinedCount > 0 || observation.omittedCount > 0
          ? ("partial" as const)
          : (observation.knownLagMs ?? 0) > REPORTING_FRESHNESS_TARGET_MS
            ? ("stale" as const)
            : observation.completeness;
    return { ...observation, completeness, limitingReason };
  });
  const failedCount = sources.reduce((sum, row) => sum + row.failedCount, 0);
  const omittedCount = sources.reduce((sum, row) => sum + row.omittedCount, 0);
  const quarantinedCount = sources.reduce(
    (sum, row) => sum + row.quarantinedCount,
    0,
  );
  const truncated = sources.some((row) => row.truncated);
  const unavailable = sources.find((row) => row.completeness === "unavailable");
  const partial = sources.find((row) => row.completeness === "partial");
  const stale = sources.find((row) => row.completeness === "stale");
  const limiting = unavailable ?? partial ?? stale;
  return {
    completeness:
      unavailable || partial
        ? ("partial" as const)
        : stale
          ? ("stale" as const)
          : ("complete" as const),
    failedCount,
    limitingReason: limiting?.limitingReason ?? null,
    omittedCount,
    quarantinedCount,
    sources,
    truncated,
  };
}

const COST_LIMITED_METRICS = new Set<ReportingMetricName>([
  "known_cogs",
  "gross_profit",
  "uncosted_revenue",
  "inventory_consumed_value",
  "inventory_value",
]);

export function coverageForFactContribution(input: {
  completeness: ReportingCompleteness;
  limitingReason?: ReportingLimitingReason;
  metric: ReportingMetricName;
}) {
  if (
    input.limitingReason === "uncosted" &&
    !COST_LIMITED_METRICS.has(input.metric)
  ) {
    return { completeness: "complete" as const, limitingReason: undefined };
  }
  return {
    completeness: input.completeness,
    limitingReason: input.limitingReason,
  };
}

export function metricCoverageIsActivatable(input: {
  metric: ReportingMetricName;
  observations: MetricCoverageObservation[];
  requiredSourceDomains?: string[];
}) {
  const summary = summarizeRequiredMetricCoverage(input);
  const allowsUncostedKnownComponent =
    METRIC_CONTRACTS[input.metric].unknownData ===
    "publish_known_component_with_coverage";
  return summary.sources.every(
    (source) =>
      source.failedCount === 0 &&
      source.omittedCount === 0 &&
      source.quarantinedCount === 0 &&
      source.truncated === false &&
      (source.knownLagMs ?? 0) <= REPORTING_FRESHNESS_TARGET_MS &&
      ((source.completeness === "complete" &&
        source.limitingReason == null) ||
        (allowsUncostedKnownComponent &&
          source.completeness === "partial" &&
          source.limitingReason === "uncosted")),
  );
}

export function coverageOnlyMetricsForFact(
  fact: Pick<
    Doc<"reportingFact">,
    "costStatus" | "inventoryContributionKind" | "revenueKind"
  >,
): ReportingMetricName[] {
  if (fact.costStatus !== "unknown") return [];
  return [
    ...(fact.revenueKind === "merchandise"
      ? (["known_cogs", "gross_profit"] as const)
      : []),
    ...(fact.inventoryContributionKind === "inventory_consumed" ||
    fact.inventoryContributionKind === "inventory_consumed_reversal"
      ? (["inventory_consumed_value"] as const)
      : []),
  ];
}

function coverageSource(
  metric: ReportingMetricName,
  factSource: ReportingSourceDomain,
) {
  return metric.startsWith("payment") ||
    metric === "payments_refunded" ||
    metric === "payments_reversed"
    ? "payments"
    : factSource;
}

async function upsertCoverage(
  ctx: MutationCtx,
  input: {
    completeness: ReportingCompleteness;
    failedDelta?: number;
    generation: Doc<"reportingProjectionGeneration">;
    knownLagMs?: number;
    latestOccurrenceAt?: number;
    limitingReason?: ReportingLimitingReason;
    metric: ReportingMetricName;
    omittedDelta?: number;
    periodEnd: number;
    periodStart: number;
    projectedAt?: number;
    processingWatermark?: number;
    quarantinedDelta?: number;
    sourceDomain: string;
    truncated?: boolean;
  },
) {
  const rows = await ctx.db
    .query("reportingMetricCoverage")
    .withIndex("by_generationId_metric_sourceDomain", (q) =>
      q
        .eq("generationId", input.generation._id)
        .eq("metric", input.metric)
        .eq("sourceDomain", input.sourceDomain),
    )
    .take(2);
  if (rows.length > 1)
    throw new Error("Metric coverage identity is not unique");
  const current = rows[0];
  const incomingIsLatest =
    input.processingWatermark !== undefined &&
    input.processingWatermark >= (current?.processingWatermark ?? -1);
  const value = {
    completeness:
      current?.completeness === "partial" || input.completeness === "partial"
        ? ("partial" as const)
        : input.completeness,
    failedCount: (current?.failedCount ?? 0) + (input.failedDelta ?? 0),
    generationId: input.generation._id,
    knownLagMs: incomingIsLatest
      ? input.knownLagMs
      : (current?.knownLagMs ?? input.knownLagMs),
    latestOccurrenceAt:
      Math.max(
        current?.latestOccurrenceAt ?? 0,
        input.latestOccurrenceAt ?? 0,
      ) || undefined,
    limitingReason: input.limitingReason ?? current?.limitingReason,
    metric: input.metric,
    omittedCount: (current?.omittedCount ?? 0) + (input.omittedDelta ?? 0),
    organizationId: input.generation.organizationId,
    periodEnd: Math.max(current?.periodEnd ?? input.periodEnd, input.periodEnd),
    periodStart: Math.min(
      current?.periodStart ?? input.periodStart,
      input.periodStart,
    ),
    projectedAt:
      Math.max(current?.projectedAt ?? 0, input.projectedAt ?? 0) || undefined,
    processingWatermark:
      Math.max(
        current?.processingWatermark ?? 0,
        input.processingWatermark ?? 0,
      ) || undefined,
    quarantinedCount:
      (current?.quarantinedCount ?? 0) + (input.quarantinedDelta ?? 0),
    sourceDomain: input.sourceDomain,
    storeId: input.generation.storeId,
    truncated: current?.truncated === true || input.truncated === true,
    updatedAt: Date.now(),
  };
  if (current) {
    await ctx.db.patch("reportingMetricCoverage", current._id, value);
    return current._id;
  }
  return ctx.db.insert("reportingMetricCoverage", value);
}

export async function updateMetricCoverageForFactWithCtx(
  ctx: MutationCtx,
  input: {
    contributions: FactMetricContribution[];
    fact: Doc<"reportingFact">;
    generation: Doc<"reportingProjectionGeneration">;
    omittedContributions?: FactMetricContribution[];
    projectedAt: number;
  },
) {
  const contributionMetrics = new Set(
    input.contributions.map((contribution) => contribution.metric),
  );
  const contributionsAndCoverageOnly = [
    ...input.contributions.map((contribution) => contribution.metric),
    ...coverageOnlyMetricsForFact(input.fact).filter(
      (metric) => !contributionMetrics.has(metric),
    ),
  ];
  for (const metric of contributionsAndCoverageOnly) {
    const coverage = coverageForFactContribution({
      completeness: input.fact.completeness,
      limitingReason: input.fact.limitingReason,
      metric,
    });
    await upsertCoverage(ctx, {
      completeness: coverage.completeness,
      generation: input.generation,
      knownLagMs: Math.max(0, input.projectedAt - input.fact.acceptedAt),
      latestOccurrenceAt: input.fact.occurrenceAt,
      limitingReason: coverage.limitingReason,
      metric,
      periodEnd: input.fact.occurrenceAt,
      periodStart: input.fact.occurrenceAt,
      projectedAt: input.projectedAt,
      processingWatermark: input.fact.acceptedAt,
      sourceDomain: coverageSource(metric, input.fact.sourceDomain),
    });
  }
  for (const contribution of input.omittedContributions ?? []) {
    await upsertCoverage(ctx, {
      completeness: "partial",
      generation: input.generation,
      knownLagMs: Math.max(0, input.projectedAt - input.fact.acceptedAt),
      latestOccurrenceAt: input.fact.occurrenceAt,
      limitingReason: "source_incomplete",
      metric: contribution.metric,
      omittedDelta: 1,
      periodEnd: input.fact.occurrenceAt,
      periodStart: input.fact.occurrenceAt,
      projectedAt: input.projectedAt,
      processingWatermark: input.fact.acceptedAt,
      sourceDomain: coverageSource(
        contribution.metric,
        input.fact.sourceDomain,
      ),
    });
  }
}

export async function recordUncostedCurrentInventoryCoverageWithCtx(
  ctx: MutationCtx,
  input: {
    generation: Doc<"reportingProjectionGeneration">;
    periodEnd: number;
    periodStart: number;
    processingWatermark: number;
  },
) {
  await upsertCoverage(ctx, {
    completeness: "partial",
    generation: input.generation,
    knownLagMs: 0,
    limitingReason: "uncosted",
    metric: "inventory_value",
    periodEnd: input.periodEnd,
    periodStart: input.periodStart,
    processingWatermark: input.processingWatermark,
    sourceDomain: "inventory",
  });
}

export function materializedGenerationCoverageCompleteness(input: {
  defaultCompleteness: "complete" | "partial" | "unavailable";
  hasLimitation: boolean;
}) {
  if (input.defaultCompleteness === "unavailable") return "unavailable" as const;
  return input.hasLimitation
    ? ("partial" as const)
    : input.defaultCompleteness;
}

export async function materializeGenerationCoverageWithCtx(
  ctx: MutationCtx,
  input: {
    defaultCompleteness: "complete" | "partial" | "unavailable";
    failedSources?: Partial<Record<ReportingSourceDomain, number>>;
    generation: Doc<"reportingProjectionGeneration">;
    globalLimitingReason?: ReportingLimitingReason;
    omittedSources?: Partial<Record<ReportingSourceDomain, number>>;
    periodEnd: number;
    periodStart: number;
    processingWatermark?: number;
    quarantinedSources?: Partial<Record<ReportingSourceDomain, number>>;
    truncated?: boolean;
  },
) {
  for (const metric of metricsForProjectionKind(
    input.generation.projectionKind,
  )) {
    for (const sourceDomain of METRIC_CONTRACTS[metric].requiredSourceDomains) {
      const failed =
        input.failedSources?.[sourceDomain as ReportingSourceDomain] ?? 0;
      const quarantined =
        input.quarantinedSources?.[sourceDomain as ReportingSourceDomain] ?? 0;
      const omitted =
        input.omittedSources?.[sourceDomain as ReportingSourceDomain] ?? 0;
      await upsertCoverage(ctx, {
        completeness: materializedGenerationCoverageCompleteness({
          defaultCompleteness: input.defaultCompleteness,
          hasLimitation: Boolean(
            failed > 0 ||
              quarantined > 0 ||
              omitted > 0 ||
              input.truncated ||
              input.globalLimitingReason,
          ),
        }),
        failedDelta: failed,
        generation: input.generation,
        limitingReason:
          input.globalLimitingReason ??
          (failed > 0
            ? "processing_failed"
            : input.truncated
              ? "evidence_truncated"
              : quarantined > 0
                ? "source_incomplete"
                : omitted > 0
                  ? "source_incomplete"
                  : undefined),
        metric,
        omittedDelta: omitted,
        periodEnd: input.periodEnd,
        periodStart: input.periodStart,
        processingWatermark: input.processingWatermark,
        knownLagMs: input.processingWatermark === undefined ? undefined : 0,
        quarantinedDelta: quarantined,
        sourceDomain,
        truncated: input.truncated,
      });
    }
  }
}

export function generationCoverageIsActivatable(input: {
  coverage: Array<MetricCoverageObservation & { metric: string }>;
  metrics?: ReportingMetricName[];
  projectionKind: Doc<"reportingProjectionGeneration">["projectionKind"];
  requiredSourceDomains?: string[];
}) {
  return (input.metrics ?? metricsForProjectionKind(input.projectionKind)).every((metric) => {
    const observations = input.coverage.filter((row) => row.metric === metric);
    return metricCoverageIsActivatable({
      metric,
      observations,
      requiredSourceDomains: input.requiredSourceDomains,
    });
  });
}
