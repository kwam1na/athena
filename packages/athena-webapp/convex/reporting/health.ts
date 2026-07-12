import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { ReportingSourceDomain } from "../../shared/reportingContract";
import type { ReportingLimitingReason } from "../../shared/reportingContract";

export const REPORTING_FRESHNESS_TARGET_MS = 5 * 60_000;

export type ReportingSourceActivitySignal = {
  failedProjectionAt?: number | null;
  latestProcessedAcceptedAt: number | null;
  oldestPendingAcceptedAt: number | null;
  sourceDomain: ReportingSourceDomain;
};

type ProjectionHealthReadRow = {
  freshnessLagMs?: number;
  limitingReason?: ReportingLimitingReason;
  processingWatermark?: number;
  quarantinedCount: number;
  sourceDomain: ReportingSourceDomain;
  updatedAt: number;
};

export function presentProjectionHealthRow<
  Row extends ProjectionHealthReadRow,
>(input: { activity: ReportingSourceActivitySignal; now: number; row: Row }) {
  const pendingAcceptedAt = input.activity.oldestPendingAcceptedAt;
  const failedProjectionAt = input.activity.failedProjectionAt ?? null;
  const processedAheadOfProjection =
    input.activity.latestProcessedAcceptedAt !== null &&
    input.activity.latestProcessedAcceptedAt >
      (input.row.processingWatermark ?? Number.NEGATIVE_INFINITY)
      ? input.activity.latestProcessedAcceptedAt
      : null;
  const unprojectedAcceptedAt =
    pendingAcceptedAt === null
      ? processedAheadOfProjection
      : processedAheadOfProjection === null
        ? pendingAcceptedAt
        : Math.min(pendingAcceptedAt, processedAheadOfProjection);
  const projectionAgeMs = Math.max(0, input.now - input.row.updatedAt);
  const unprojectedAgeMs =
    unprojectedAcceptedAt === null
      ? null
      : Math.max(0, input.now - unprojectedAcceptedAt);
  const freshnessLagMs = Math.max(
    input.row.freshnessLagMs ?? 0,
    projectionAgeMs,
    unprojectedAgeMs ?? 0,
  );
  const stale = freshnessLagMs > REPORTING_FRESHNESS_TARGET_MS;
  const limitingReason =
    input.row.limitingReason ??
    (failedProjectionAt !== null
      ? "processing_failed"
      : stale
        ? unprojectedAcceptedAt === null
          ? "projection_stale"
          : "processing_delayed"
        : undefined);
  const status =
    failedProjectionAt !== null ||
    input.row.quarantinedCount > 0 ||
    (limitingReason !== undefined && !stale)
      ? ("partial" as const)
      : stale
        ? ("stale" as const)
        : unprojectedAcceptedAt !== null
          ? ("processing" as const)
          : ("healthy" as const);

  return {
    ...input.row,
    freshnessLagMs,
    freshnessStatus: stale ? ("stale" as const) : ("current" as const),
    limitingReason,
    projectionAgeMs,
    status,
    unprojectedAcceptedAt,
    unprojectedAgeMs,
  };
}

export function summarizeProjectionHealthRead<
  Row extends ProjectionHealthReadRow,
>(input: {
  activity: ReportingSourceActivitySignal[];
  now: number;
  rows: Row[];
}) {
  const activityByDomain = new Map(
    input.activity.map((signal) => [signal.sourceDomain, signal]),
  );
  const rows = input.rows.map((row) =>
    presentProjectionHealthRow({
      activity: activityByDomain.get(row.sourceDomain) ?? {
        latestProcessedAcceptedAt: null,
        oldestPendingAcceptedAt: null,
        sourceDomain: row.sourceDomain,
      },
      now: input.now,
      row,
    }),
  );
  const rowDomains = new Set(rows.map((row) => row.sourceDomain));
  const unprojectedSources = input.activity.flatMap((signal) => {
    if (rowDomains.has(signal.sourceDomain)) return [];
    const acceptedAt =
      signal.oldestPendingAcceptedAt ?? signal.latestProcessedAcceptedAt;
    return acceptedAt === null
      ? []
      : [
          {
            acceptedAt,
            ageMs: Math.max(0, input.now - acceptedAt),
            sourceDomain: signal.sourceDomain,
          },
        ];
  });
  const statuses = rows.map((row) => row.status);
  const status =
    rows.length === 0 && unprojectedSources.length === 0
      ? ("pre_cutover" as const)
      : statuses.includes("partial")
        ? ("partial" as const)
        : statuses.includes("stale") ||
            unprojectedSources.some(
              (signal) => signal.ageMs > REPORTING_FRESHNESS_TARGET_MS,
            )
          ? ("stale" as const)
          : statuses.includes("processing") || unprojectedSources.length > 0
            ? ("processing" as const)
            : ("healthy" as const);

  return {
    freshnessTargetMs: REPORTING_FRESHNESS_TARGET_MS,
    rows,
    status,
    unprojectedSources,
  };
}

export type ReportingHealthInput = {
  activated: boolean;
  failedRunCount: number;
  latestAcceptedSourceAt: number;
  latestProjectedSourceAt: number;
  now: number;
  projectionUpdatedAt: number | null;
  quarantineCount: number;
  requiredCoverageComplete: boolean;
};

export function summarizeReportingHealth(input: ReportingHealthInput) {
  const projectionLagMs = Math.max(
    0,
    input.latestAcceptedSourceAt - input.latestProjectedSourceAt,
  );
  const ageMs =
    input.projectionUpdatedAt === null
      ? null
      : Math.max(0, input.now - input.projectionUpdatedAt);
  const freshness =
    ageMs !== null &&
    ageMs <= REPORTING_FRESHNESS_TARGET_MS &&
    projectionLagMs <= REPORTING_FRESHNESS_TARGET_MS
      ? ("current" as const)
      : ("stale" as const);
  const status = !input.activated
    ? ("pre_cutover" as const)
    : input.failedRunCount > 0
      ? ("failed" as const)
      : !input.requiredCoverageComplete || input.quarantineCount > 0
        ? ("partial" as const)
        : freshness === "stale"
          ? ("stale" as const)
          : ("healthy" as const);

  return {
    ageMs,
    failedRunCount: input.failedRunCount,
    freshness,
    freshnessTargetMs: REPORTING_FRESHNESS_TARGET_MS,
    projectionLagMs,
    quarantineCount: input.quarantineCount,
    requiredCoverageComplete: input.requiredCoverageComplete,
    status,
  };
}

export function mergeProjectionHealthState<
  Current extends {
    activeGenerationId?: unknown;
    latestSuccessfulReconciliationAt?: number;
  },
  Incoming extends {
    activeGenerationId?: unknown;
    latestSuccessfulReconciliationAt?: number;
  },
>(current: Current, incoming: Incoming) {
  return {
    ...current,
    ...incoming,
    activeGenerationId:
      incoming.activeGenerationId ?? current.activeGenerationId,
    latestSuccessfulReconciliationAt:
      incoming.latestSuccessfulReconciliationAt ??
      current.latestSuccessfulReconciliationAt,
  };
}

export async function upsertProjectionHealthWithCtx(
  ctx: MutationCtx,
  input: {
    activeGenerationId?: Id<"reportingProjectionGeneration">;
    backfillState?: string;
    factContractVersion: number;
    freshnessLagMs?: number;
    latestSuccessfulReconciliationAt?: number;
    limitingReason?: ReportingLimitingReason;
    metricContractVersion: number;
    organizationId: Id<"organization">;
    processingWatermark?: number;
    projectionContractVersion: number;
    projectionKind:
      | "store_day"
      | "store_intraday"
      | "sku_day"
      | "current_inventory"
      | "custom_range"
      | "attention"
      | "storefront_engagement";
    quarantinedCount: number;
    sourceDomain: ReportingSourceDomain;
    storeId: Id<"store">;
    updatedAt: number;
  },
) {
  const current = await ctx.db
    .query("reportingProjectionHealth")
    .withIndex("by_storeId_sourceDomain_projectionKind", (q) =>
      q
        .eq("storeId", input.storeId)
        .eq("sourceDomain", input.sourceDomain)
        .eq("projectionKind", input.projectionKind),
    )
    .first();
  if (current) {
    await ctx.db.patch(
      "reportingProjectionHealth",
      current._id,
      mergeProjectionHealthState(current, input),
    );
    return current._id;
  }
  return ctx.db.insert("reportingProjectionHealth", input);
}
