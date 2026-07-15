import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { query, type QueryCtx } from "../_generated/server";
import {
  REPORTING_FACT_CONTRACT_VERSION,
  REPORTING_PROJECTION_CONTRACT_VERSION,
  type ReportingSourceDomain,
} from "../../shared/reportingContract";
import { requireReportingStoreAccess } from "./access";
import { getSharedDemoReportsOverviewWithCtx } from "../sharedDemo/reporting";
import { summarizeProjectionHealthRead } from "./health";
import { presentAttentionReason } from "./projections/attention";
import { resolveReportingCalendarDateRangeWithCtx, resolveReportingCalendarReferenceWithCtx, resolveReportingOperatingDateRangeWithCtx } from "./operatingPeriods";
import { resolveReportPeriod } from "./periods";
import {
  getActiveReadBundleWithCtx,
  skuAttributionTerminalIsCurrent,
} from "./readModels/readBundle";
import { getExactActiveWorkspaceEpochWithCtx } from "./readModels/materialize";
import { currentSkuAttributionCursorWithCtx } from "./skuAttributionSequence";
import {
  buildCursorContextKey,
  decodeReportingCursor,
  encodeReportingCursor,
} from "./readModels/reportingReadModels";

export function buildReportingOverview(input: {
  generation: null | {
    generationId: string;
    netRevenueMinor: number | null;
    status: "verified" | "partial" | "stale" | "failed";
  };
  health: { status: string };
  storeId: string;
}) {
  if (input.generation === null) {
    return {
      data: null,
      generationId: null,
      health: input.health,
      status: input.health.status,
      storeId: input.storeId,
    };
  }
  return {
    data: { netRevenueMinor: input.generation.netRevenueMinor },
    generationId: input.generation.generationId,
    health: input.health,
    status: input.generation.status,
    storeId: input.storeId,
  };
}

export function publicPeriodLineage(
  row: Pick<
    Doc<"reportingStoreDayProjection">,
    | "scheduleVersionId"
    | "historicalInterpretationPolicyId"
    | "historicalInterpretationPolicyHash"
    | "timezoneVersionId"
    | "timezoneVersionHash"
  >,
) {
  if (row.timezoneVersionId !== undefined) {
    if (!row.timezoneVersionHash || row.historicalInterpretationPolicyId !== undefined) {
      throw new Error("Reporting projection period lineage is invalid");
    }
    return {
      kind: "store_timezone" as const,
      id: row.timezoneVersionId,
      hash: row.timezoneVersionHash,
    };
  }
  if (row.historicalInterpretationPolicyId !== undefined) {
    if (row.scheduleVersionId !== undefined || !row.historicalInterpretationPolicyHash) {
      throw new Error("Reporting projection period lineage is invalid");
    }
    return {
      kind: "historical_policy" as const,
      id: row.historicalInterpretationPolicyId,
      hash: row.historicalInterpretationPolicyHash,
    };
  }
  if (!row.scheduleVersionId || row.historicalInterpretationPolicyHash) {
    throw new Error("Reporting projection period lineage is invalid");
  }
  return { kind: "store_schedule" as const, id: row.scheduleVersionId };
}

type ProjectionKind =
  | "store_day"
  | "sku_day"
  | "current_inventory"
  | "custom_range"
  | "attention"
  | "storefront_engagement";

const REPORTING_SOURCE_DOMAINS = [
  "pos",
  "storefront",
  "service",
  "payments",
  "inventory",
  "procurement",
  "daily_close",
] as const satisfies readonly ReportingSourceDomain[];

export const REPORTING_PUBLIC_PAGE_SIZE_MAX = 100;
export const REPORTING_WORKSPACE_PAGE_SIZE_MAX = 25;

export function boundReportingPagination(input: {
  cursor: string | null;
  numItems: number;
}) {
  const requested = Number.isFinite(input.numItems)
    ? Math.floor(input.numItems)
    : 1;
  return {
    cursor: input.cursor,
    numItems: Math.min(REPORTING_PUBLIC_PAGE_SIZE_MAX, Math.max(1, requested)),
  };
}

export function boundReportingWorkspacePagination(input: {
  cursor: string | null;
  numItems: number;
}) {
  const bounded = boundReportingPagination(input);
  return {
    ...bounded,
    numItems: Math.min(REPORTING_WORKSPACE_PAGE_SIZE_MAX, bounded.numItems),
  };
}

async function getReportingSourceActivity(ctx: QueryCtx, storeId: Id<"store">) {
  return Promise.all(
    REPORTING_SOURCE_DOMAINS.map(async (sourceDomain) => {
      const [
        pending,
        processing,
        processed,
        pendingFact,
        failedFact,
        pendingEffect,
        failedEffect,
      ] = await Promise.all([
        ctx.db
          .query("reportingIngress")
          .withIndex("by_storeId_sourceDomain_status_acceptedAt", (q) =>
            q
              .eq("storeId", storeId)
              .eq("sourceDomain", sourceDomain)
              .eq("status", "pending"),
          )
          .order("asc")
          .first(),
        ctx.db
          .query("reportingIngress")
          .withIndex("by_storeId_sourceDomain_status_acceptedAt", (q) =>
            q
              .eq("storeId", storeId)
              .eq("sourceDomain", sourceDomain)
              .eq("status", "processing"),
          )
          .order("asc")
          .first(),
        ctx.db
          .query("reportingIngress")
          .withIndex("by_storeId_sourceDomain_status_acceptedAt", (q) =>
            q
              .eq("storeId", storeId)
              .eq("sourceDomain", sourceDomain)
              .eq("status", "processed"),
          )
          .order("desc")
          .first(),
        ctx.db
          .query("reportingFact")
          .withIndex(
            "by_storeId_sourceDomain_projectionStatus_createdAt",
            (q) =>
              q
                .eq("storeId", storeId)
                .eq("sourceDomain", sourceDomain)
                .eq("projectionStatus", "pending"),
          )
          .order("asc")
          .first(),
        ctx.db
          .query("reportingFact")
          .withIndex(
            "by_storeId_sourceDomain_projectionStatus_createdAt",
            (q) =>
              q
                .eq("storeId", storeId)
                .eq("sourceDomain", sourceDomain)
                .eq("projectionStatus", "failed"),
          )
          .order("asc")
          .first(),
        ctx.db
          .query("reportingInventoryEffect")
          .withIndex(
            "by_storeId_sourceDomain_projectionStatus_createdAt",
            (q) =>
              q
                .eq("storeId", storeId)
                .eq("sourceDomain", sourceDomain)
                .eq("projectionStatus", "pending"),
          )
          .order("asc")
          .first(),
        ctx.db
          .query("reportingInventoryEffect")
          .withIndex(
            "by_storeId_sourceDomain_projectionStatus_createdAt",
            (q) =>
              q
                .eq("storeId", storeId)
                .eq("sourceDomain", sourceDomain)
                .eq("projectionStatus", "failed"),
          )
          .order("asc")
          .first(),
      ]);
      const failedProjectionAt = [
        failedFact?.createdAt,
        failedEffect?.createdAt,
      ]
        .filter((value): value is number => value !== undefined)
        .sort((left, right) => left - right)[0];
      const pendingAccepted = [
        pending?.acceptedAt,
        processing?.acceptedAt,
        pendingFact?.createdAt,
        pendingEffect?.createdAt,
        failedProjectionAt,
      ]
        .filter((value): value is number => value !== undefined)
        .sort((left, right) => left - right)[0];
      return {
        failedProjectionAt: failedProjectionAt ?? null,
        latestProcessedAcceptedAt: processed?.acceptedAt ?? null,
        oldestPendingAcceptedAt: pendingAccepted ?? null,
        sourceDomain,
      };
    }),
  );
}

function presentAttentionRow(row: Doc<"reportingAttentionProjection">) {
  return {
    completeness: row.completeness,
    limitingReason: row.limitingReason ?? null,
    primaryReason: row.primaryReason,
    productSkuId: row.productSkuId ?? null,
    projectedAt: row.projectedAt,
    reasons: row.reasons.map(presentAttentionReason),
    ruleVersion: row.ruleVersion,
    scope: row.scope,
    sourceGenerationIds: row.sourceGenerationIds,
    sourceWatermark: row.sourceWatermark,
  };
}

export function reportingGenerationHasReadableStableWatermark(input: {
  sourceWatermark: number;
  stableWatermark?: number;
}) {
  return input.stableWatermark !== undefined &&
    input.stableWatermark <= input.sourceWatermark;
}

export function presentReportItemMetrics(
  metrics: Record<string, number | null>,
) {
  const sold = metrics.units_sold;
  const returned = metrics.units_returned;
  return {
    costCoverageBasisPoints: metrics.cost_coverage_basis_points ?? null,
    inventoryValueMinor: metrics.inventory_value ?? null,
    knownGrossProfitMinor: metrics.merchandise_profit ?? null,
    netRevenueMinor: metrics.net_sales ?? null,
    netSoldUnits:
      sold === null
        ? null
        : sold === undefined && returned === undefined
          ? null
          : (sold ?? 0) - (returned ?? 0),
    onHandQuantity: metrics.on_hand_units ?? null,
    projectedDaysOfCover: metrics.projected_days_of_cover ?? null,
  };
}

export function presentCurrentValuationResult(input: {
  generation: {
    _id: unknown;
    completeness: string;
    limitingReason?: string;
    status: string;
  };
  rows: unknown[];
}) {
  return {
    completeness: input.generation.completeness,
    generationId: input.generation._id,
    limitingReason: input.generation.limitingReason ?? null,
    rows: input.rows,
    status:
      input.generation.completeness === "unavailable"
        ? ("unavailable" as const)
        : input.generation.status,
  };
}

export function reportingGenerationAttributionTerminalIsCurrent(input: {
  cursor: Parameters<typeof skuAttributionTerminalIsCurrent>[0]["cursor"];
  projectionKind: ProjectionKind;
  terminal?: number;
}) {
  return input.projectionKind !== "sku_day" ||
    skuAttributionTerminalIsCurrent({
      cursor: input.cursor,
      terminal: input.terminal,
    });
}

async function getActiveGeneration(
  ctx: QueryCtx,
  storeId: Id<"store">,
  projectionKind: ProjectionKind,
) {
  const bundle = await getActiveReadBundleWithCtx(ctx, storeId);
  const member = bundle?.members.find(
    (candidate: { projectionKind: string }) =>
      candidate.projectionKind === projectionKind,
  );
  if (!bundle || !member) return null;
  const generation = await ctx.db.get(
    "reportingProjectionGeneration",
    member.generationId,
  );
  const attributionCursor = projectionKind === "sku_day"
    ? await currentSkuAttributionCursorWithCtx(ctx, storeId)
    : null;
  if (
    !generation ||
    generation.storeId !== storeId ||
    generation.organizationId !== bundle.organizationId ||
    generation.projectionKind !== projectionKind ||
    (generation.status !== "active" && generation.status !== "superseded") ||
    !reportingGenerationHasReadableStableWatermark(generation) ||
    generation.factContractVersion !== REPORTING_FACT_CONTRACT_VERSION ||
    generation.projectionContractVersion !== REPORTING_PROJECTION_CONTRACT_VERSION ||
    generation.metricContractVersion !== 1 ||
    bundle.factContractVersion !== generation.factContractVersion ||
    bundle.metricContractVersion !== generation.metricContractVersion ||
    bundle.projectionContractVersion !== generation.projectionContractVersion ||
    bundle.sourceWatermark !== generation.stableWatermark ||
    !reportingGenerationAttributionTerminalIsCurrent({
        cursor: attributionCursor,
        projectionKind,
        terminal: generation.skuAttributionTerminalSequence,
      })
  ) {
    return null;
  }
  return generation;
}

async function getActiveWorkspaceEpoch(ctx: QueryCtx, generation: Doc<"reportingProjectionGeneration">) {
  if (generation.projectionKind === "custom_range") {
    return generation.stableWatermark === undefined
      ? null
      : await getExactActiveWorkspaceEpochWithCtx(ctx, {
          generationId: generation._id,
          sourceWatermark: generation.stableWatermark,
        });
  }
  const bundle = await getActiveReadBundleWithCtx(ctx, generation.storeId);
  const member = bundle?.members.find((candidate: { generationId: string; projectionKind: string }) => candidate.generationId === generation._id && candidate.projectionKind === generation.projectionKind);
  if (!bundle || !member || bundle.sourceWatermark !== generation.stableWatermark) return null;
  const epoch = await ctx.db.get("reportingWorkspaceMaterializationEpoch", member.workspaceEpochId);
  return epoch && epoch.status === "active" && epoch.sourceGenerationId === generation._id && epoch.sourceWatermark === generation.stableWatermark ? epoch : null;
}

export function reportingGenerationsAreCompatible(
  left: Pick<Doc<"reportingProjectionGeneration">, "factContractVersion" | "metricContractVersion" | "organizationId" | "projectionContractVersion" | "stableWatermark" | "storeId">,
  right: Pick<Doc<"reportingProjectionGeneration">, "factContractVersion" | "metricContractVersion" | "organizationId" | "projectionContractVersion" | "stableWatermark" | "storeId">,
) {
  return left.storeId === right.storeId &&
    left.organizationId === right.organizationId &&
    left.factContractVersion === right.factContractVersion &&
    left.metricContractVersion === right.metricContractVersion &&
    left.projectionContractVersion === right.projectionContractVersion &&
    left.stableWatermark === right.stableWatermark;
}

export const getOverview = query({
  args: {
    operatingDate: v.string(),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    await requireReportingStoreAccess(ctx, args.storeId);
    const generation = await getActiveGeneration(
      ctx,
      args.storeId,
      "store_day",
    );
    if (!generation) {
      return buildReportingOverview({
        generation: null,
        health: { status: "pre_cutover" },
        storeId: args.storeId,
      });
    }
    const rows = await ctx.db
      .query("reportingStoreDayProjection")
      .withIndex("by_generationId_operatingDate_metric", (q) =>
        q
          .eq("generationId", generation._id)
          .eq("operatingDate", args.operatingDate),
      )
      .take(100);
    return {
      data: {
        metrics: rows.map((row) => ({
          completeness: row.completeness,
          currencyCode: row.currencyCode ?? null,
          knownValue: row.knownValue ?? null,
          limitingReason: row.limitingReason ?? null,
          metric: row.metric,
          periodLineage: publicPeriodLineage(row),
          unknownQuantity: row.unknownQuantity ?? null,
        })),
      },
      factContractVersion: generation.factContractVersion,
      generationId: generation._id,
      metricContractVersion: generation.metricContractVersion,
      projectionContractVersion: generation.projectionContractVersion,
      sourceWatermark: generation.sourceWatermark,
      status: generation.status,
      storeId: args.storeId,
    };
  },
});

export const listSkuDay = query({
  args: {
    operatingDate: v.string(),
    paginationOpts: paginationOptsValidator,
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    await requireReportingStoreAccess(ctx, args.storeId);
    const generation = await getActiveGeneration(ctx, args.storeId, "sku_day");
    if (!generation) {
      return {
        continueCursor: "",
        isDone: true,
        page: [],
        splitCursor: null,
        pageStatus: null,
        status: "pre_cutover" as const,
      };
    }
    const page = await ctx.db
      .query("reportingSkuDayProjection")
      .withIndex("by_generationId_operatingDate_productSkuId_metric", (q) =>
        q
          .eq("generationId", generation._id)
          .eq("operatingDate", args.operatingDate),
      )
      .paginate(boundReportingPagination(args.paginationOpts));
    if (page.page.some((row) => row.storeId !== args.storeId)) {
      throw new Error("Reporting SKU detail is unavailable.");
    }
    return {
      ...page,
      page: page.page.map((row) => ({
        ...row,
        periodLineage: publicPeriodLineage(row),
      })),
      generationId: generation._id,
      status: generation.status,
    };
  },
});

export const getDailyClose = query({
  args: {
    operatingDate: v.string(),
    paginationOpts: paginationOptsValidator,
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    await requireReportingStoreAccess(ctx, args.storeId);
    const generation = await getActiveGeneration(
      ctx,
      args.storeId,
      "store_day",
    );
    if (!generation) {
      return {
        current: null,
        historyPage: {
          continueCursor: "",
          isDone: true,
          page: [],
          pageStatus: null,
          splitCursor: null,
        },
        status: "pre_cutover" as const,
      };
    }
    const closeHistoryQuery = () =>
      ctx.db
        .query("reportingDailyCloseProjection")
        .withIndex("by_generationId_operatingDate_acceptedCloseVersion", (q) =>
          q
            .eq("generationId", generation._id)
            .eq("operatingDate", args.operatingDate),
        )
        .order("desc");
    const [current, historyPage] = await Promise.all([
      closeHistoryQuery().first(),
      closeHistoryQuery().paginate(
        boundReportingPagination(args.paginationOpts),
      ),
    ]);
    if (historyPage.page.some((row) => row.storeId !== args.storeId)) {
      throw new Error("Reporting Daily Close is unavailable.");
    }
    const presentDailyClose = (
      row: Doc<"reportingDailyCloseProjection">,
    ) => ({ ...row, periodLineage: publicPeriodLineage(row) });
    return {
      current: current ? presentDailyClose(current) : null,
      factContractVersion: generation.factContractVersion,
      generationId: generation._id,
      historyPage: {
        ...historyPage,
        page: historyPage.page.map(presentDailyClose),
      },
      metricContractVersion: generation.metricContractVersion,
      projectionContractVersion: generation.projectionContractVersion,
      sourceWatermark: generation.sourceWatermark,
      status: generation.status,
    };
  },
});

export const listSkuInsights = query({
  args: {
    paginationOpts: paginationOptsValidator,
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    await requireReportingStoreAccess(ctx, args.storeId);
    const generation = await getActiveGeneration(ctx, args.storeId, "sku_day");
    if (!generation) {
      return {
        continueCursor: "",
        isDone: true,
        page: [],
        splitCursor: null,
        pageStatus: null,
        status: "pre_cutover" as const,
      };
    }
    const page = await ctx.db
      .query("reportingSkuInsightProjection")
      .withIndex("by_generationId_productSkuId", (q) =>
        q.eq("generationId", generation._id),
      )
      .paginate(boundReportingPagination(args.paginationOpts));
    if (page.page.some((row) => row.storeId !== args.storeId)) {
      throw new Error("Reporting SKU insights are unavailable.");
    }
    return {
      ...page,
      factContractVersion: generation.factContractVersion,
      generationId: generation._id,
      metricContractVersion: generation.metricContractVersion,
      projectionContractVersion: generation.projectionContractVersion,
      sourceWatermark: generation.sourceWatermark,
      status: generation.status,
    };
  },
});

export const getCurrentValuation = query({
  args: {
    productSkuId: v.id("productSku"),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    await requireReportingStoreAccess(ctx, args.storeId);
    const sku = await ctx.db.get("productSku", args.productSkuId);
    if (!sku || sku.storeId !== args.storeId) {
      return null;
    }
    const generation = await getActiveGeneration(
      ctx,
      args.storeId,
      "current_inventory",
    );
    if (!generation) {
      return { rows: [], status: "pre_cutover" as const };
    }
    const rows = await ctx.db
      .query("reportingCurrentValuationProjection")
      .withIndex("by_generationId_productSkuId_metric", (q) =>
        q
          .eq("generationId", generation._id)
          .eq("productSkuId", args.productSkuId),
      )
      .take(50);
    return presentCurrentValuationResult({ generation, rows });
  },
});

export const getStoreAttention = query({
  args: { storeId: v.id("store") },
  handler: async (ctx, args) => {
    await requireReportingStoreAccess(ctx, args.storeId);
    const generation = await getActiveGeneration(
      ctx,
      args.storeId,
      "attention",
    );
    if (!generation) {
      return { attention: null, status: "pre_cutover" as const };
    }
    const rows = await ctx.db
      .query("reportingAttentionProjection")
      .withIndex("by_generationId_scope_productSkuId", (q) =>
        q
          .eq("generationId", generation._id)
          .eq("scope", "store")
          .eq("productSkuId", undefined),
      )
      .take(2);
    if (rows.length > 1 || rows.some((row) => row.storeId !== args.storeId)) {
      throw new Error("Reporting attention is unavailable.");
    }
    return {
      attention: rows[0] ? presentAttentionRow(rows[0]) : null,
      factContractVersion: generation.factContractVersion,
      generationId: generation._id,
      metricContractVersion: generation.metricContractVersion,
      projectionContractVersion: generation.projectionContractVersion,
      status: generation.status,
    };
  },
});

export const listSkuAttention = query({
  args: {
    paginationOpts: paginationOptsValidator,
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    await requireReportingStoreAccess(ctx, args.storeId);
    const generation = await getActiveGeneration(
      ctx,
      args.storeId,
      "attention",
    );
    if (!generation) {
      return {
        continueCursor: "",
        isDone: true,
        page: [],
        splitCursor: null,
        pageStatus: null,
        status: "pre_cutover" as const,
      };
    }
    const page = await ctx.db
      .query("reportingAttentionProjection")
      .withIndex("by_generationId_scope_productSkuId", (q) =>
        q.eq("generationId", generation._id).eq("scope", "sku"),
      )
      .paginate(boundReportingPagination(args.paginationOpts));
    if (page.page.some((row) => row.storeId !== args.storeId)) {
      throw new Error("Reporting attention is unavailable.");
    }
    return {
      ...page,
      generationId: generation._id,
      page: page.page.map(presentAttentionRow),
      status: generation.status,
    };
  },
});

export const getProjectionHealth = query({
  args: { storeId: v.id("store") },
  handler: async (ctx, args) => {
    await requireReportingStoreAccess(ctx, args.storeId);
    const [rows, activity] = await Promise.all([
      ctx.db
        .query("reportingProjectionHealth")
        .withIndex("by_storeId_sourceDomain_projectionKind", (q) =>
          q.eq("storeId", args.storeId),
        )
        .take(101),
      getReportingSourceActivity(ctx, args.storeId),
    ]);
    if (rows.length > 100) {
      throw new Error("Reporting health is unavailable.");
    }
    return summarizeProjectionHealthRead({
      activity,
      now: Date.now(),
      rows,
    });
  },
});

export const listMetricCoverage = query({
  args: {
    paginationOpts: paginationOptsValidator,
    projectionKind: v.union(
      v.literal("store_day"),
      v.literal("sku_day"),
      v.literal("current_inventory"),
      v.literal("custom_range"),
      v.literal("attention"),
      v.literal("storefront_engagement"),
    ),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    await requireReportingStoreAccess(ctx, args.storeId);
    const generation = await getActiveGeneration(
      ctx,
      args.storeId,
      args.projectionKind,
    );
    if (!generation) {
      return {
        continueCursor: "",
        generationId: null,
        isDone: true,
        page: [],
        splitCursor: null,
        pageStatus: null,
        status: "pre_cutover" as const,
      };
    }
    const page = await ctx.db
      .query("reportingMetricCoverage")
      .withIndex("by_generationId_metric_sourceDomain", (q) =>
        q.eq("generationId", generation._id),
      )
      .paginate(boundReportingPagination(args.paginationOpts));
    return {
      ...page,
      generationId: generation._id,
      status: generation.status,
    };
  },
});

const reportPeriodKeyValidator = v.union(
  v.literal("today"),
  v.literal("wtd"),
  v.literal("prior_week"),
  v.literal("trailing_30"),
);

const reportPeriodArgs = {
  periodKey: reportPeriodKeyValidator,
  storeId: v.id("store"),
};

async function resolveRequestedReportsPeriod(
  ctx: QueryCtx,
  storeId: Id<"store">,
  periodKey: "today" | "wtd" | "prior_week" | "trailing_30",
) {
  const asOf = Date.now();
  const operatingPeriod = await resolveReportingCalendarReferenceWithCtx(ctx, { occurrenceAt: asOf, storeId });
  if (operatingPeriod.kind !== "resolved") return null;
  const preset = periodKey === "wtd" ? "week_to_date" : periodKey === "trailing_30" ? "trailing_30_days" : periodKey;
  return resolveReportPeriod({
    asOf: operatingPeriod.referenceAt,
    operatingDate: operatingPeriod.operatingDate,
    preset,
    timezone: operatingPeriod.timezone,
  });
}

function rowMatchesResolvedPeriod(
  row: { rangeEndDate: string; rangeStartDate: string },
  descriptor: { current: { endDate: string; startDate: string } },
) {
  return row.rangeStartDate === descriptor.current.startDate && row.rangeEndDate === descriptor.current.endDate;
}

export const resolveReportsPeriod = query({
  args: {
    asOf: v.optional(v.number()),
    customEndDate: v.optional(v.string()),
    customStartDate: v.optional(v.string()),
    preset: v.union(reportPeriodKeyValidator, v.literal("custom")),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    await requireReportingStoreAccess(ctx, args.storeId);
    const asOf = args.asOf ?? Date.now();
    let descriptorAsOf = asOf;
    const operatingPeriod = await resolveReportingCalendarReferenceWithCtx(ctx, {
      occurrenceAt: asOf,
      storeId: args.storeId,
    });
    if (operatingPeriod.kind === "resolved") {
      descriptorAsOf = operatingPeriod.referenceAt;
    }
    if (operatingPeriod.kind !== "resolved") return { descriptor: null, status: "timezone_unavailable" as const };
    const preset = args.preset === "wtd" ? "week_to_date" : args.preset === "trailing_30" ? "trailing_30_days" : args.preset;
    const descriptor = resolveReportPeriod({
      asOf: descriptorAsOf,
      customRange: preset === "custom" && args.customStartDate && args.customEndDate
        ? { endDate: args.customEndDate, startDate: args.customStartDate }
        : undefined,
      preset,
      operatingDate: operatingPeriod.operatingDate,
      timezone: operatingPeriod.timezone,
    });
    return {
      descriptor,
      periodKey: args.preset === "custom" ? `${descriptor.current.startDate}:${descriptor.current.endDate}` : args.preset,
      timezoneVersionId: operatingPeriod.timezoneVersionId,
      status: "resolved" as const,
    };
  },
});

export const getReportsOverview = query({
  args: reportPeriodArgs,
  handler: async (ctx, args) => {
    const { store } = await requireReportingStoreAccess(ctx, args.storeId);
    const demoOverview = await getSharedDemoReportsOverviewWithCtx(ctx, {
      currency: store.currency,
      storeId: args.storeId,
    });
    if (demoOverview) return demoOverview;
    const descriptor = await resolveRequestedReportsPeriod(ctx, args.storeId, args.periodKey);
    if (!descriptor) return { data: null, status: "schedule_unavailable" as const };
    const generation = await getActiveGeneration(ctx, args.storeId, "store_day");
    if (!generation) return { data: null, status: "pre_cutover" as const };
    const workspaceEpoch = await getActiveWorkspaceEpoch(ctx, generation);
    if (!workspaceEpoch) return { data: null, status: "materializing" as const };
    const summary = await ctx.db.query("reportingStorePeriodSummary")
        .withIndex("by_workspaceEpochId_periodKey", (q) => q.eq("workspaceEpochId", workspaceEpoch._id).eq("periodKey", args.periodKey))
        .first();
    if (!summary || summary.storeId !== args.storeId || !rowMatchesResolvedPeriod(summary, descriptor)) {
      return { data: null, generationId: generation._id, status: "unavailable" as const };
    }
    const currentIntraday = await ctx.db.query("reportingStoreIntradayProjection")
      .withIndex("by_generationId_operatingDate_checkpointAt", (q) => q
        .eq("generationId", generation._id)
        .eq("operatingDate", descriptor.operatingDate)
        .lte("checkpointAt", descriptor.sameElapsed.currentCutoffAt))
      .filter((q) => q.lte(q.field("cutoffAt"), descriptor.sameElapsed.currentCutoffAt))
      .order("desc").first();
    let comparisonIntraday: Doc<"reportingStoreIntradayProjection"> | null = null;
    if (descriptor.sameElapsed.comparisonOperatingDate && descriptor.sameElapsed.elapsedOperatingMs !== null) {
      const comparisonRange = await resolveReportingOperatingDateRangeWithCtx(ctx, { operatingDate: descriptor.sameElapsed.comparisonOperatingDate, storeId: args.storeId });
      // A single operating window has an exact elapsed-time cutoff. Split
      // windows require slice mapping; fail closed until that mapping resolves.
      if (comparisonRange.kind === "resolved" && comparisonRange.windowCount === 1) {
        const comparisonCutoffAt = comparisonRange.startAt + descriptor.sameElapsed.elapsedOperatingMs;
        comparisonIntraday = await ctx.db.query("reportingStoreIntradayProjection")
          .withIndex("by_generationId_operatingDate_checkpointAt", (q) => q
            .eq("generationId", generation._id)
            .eq("operatingDate", descriptor.sameElapsed.comparisonOperatingDate!)
            .lte("checkpointAt", comparisonCutoffAt))
          .filter((q) => q.lte(q.field("cutoffAt"), comparisonCutoffAt))
          .order("desc").first();
      }
    }
    const intradayCompatible = (row: Doc<"reportingStoreIntradayProjection"> | null) => Boolean(row && row.sourceGenerationId === generation._id && row.sourceWatermark === generation.stableWatermark && row.factContractVersion === generation.factContractVersion && row.metricContractVersion === generation.metricContractVersion && row.projectionContractVersion === generation.projectionContractVersion);
    const sameElapsedComparison = intradayCompatible(currentIntraday) && intradayCompatible(comparisonIntraday)
      ? { comparison: comparisonIntraday!, current: currentIntraday!, status: "available" as const }
      : { reason: "intraday_evidence_unavailable" as const, status: "unavailable" as const };
    const trustRows = await ctx.db.query("reportingDailyCloseTrust")
      .withIndex("by_generationId_operatingDate", (q) => q
        .eq("generationId", generation._id)
        .gte("operatingDate", summary.rangeStartDate)
        .lte("operatingDate", summary.rangeEndDate))
      .order("desc")
      .take(100);
    const newestTrustByDate = new Map<string, Doc<"reportingDailyCloseTrust">>();
    for (const row of trustRows) {
      const current = newestTrustByDate.get(row.operatingDate);
      if (!current || row.acceptedCloseVersion > current.acceptedCloseVersion ||
        (row.acceptedCloseVersion === current.acceptedCloseVersion && row.projectedAt > current.projectedAt)) {
        newestTrustByDate.set(row.operatingDate, row);
      }
    }
    const trust = [...newestTrustByDate.values()]
      .sort((left, right) => right.operatingDate.localeCompare(left.operatingDate))
      .slice(0, 30);
    return {
      data: { ...summary, dailyCloseTrust: trust.slice(0, 30), period: descriptor, sameElapsedComparison },
      generationId: generation._id,
      sourceWatermark: generation.stableWatermark ?? generation.sourceWatermark,
      status: generation.status,
    };
  },
});

const reportListArgs = {
  classification: v.union(
    v.literal("all"),
    v.literal("fast_mover"),
    v.literal("slow_mover"),
    v.literal("nonmoving"),
    v.literal("low_cover"),
    v.literal("high_revenue_low_margin"),
  ),
  paginationOpts: paginationOptsValidator,
  periodKey: reportPeriodKeyValidator,
  sort: v.union(
    v.literal("revenue"), v.literal("margin"), v.literal("units"),
    v.literal("cover"), v.literal("inventory_value"), v.literal("attention"),
  ),
  storeId: v.id("store"),
};

export const listReportItems = query({
  args: reportListArgs,
  handler: async (ctx, args) => {
    await requireReportingStoreAccess(ctx, args.storeId);
    const descriptor = await resolveRequestedReportsPeriod(ctx, args.storeId, args.periodKey);
    if (!descriptor) return { continueCursor: "", isDone: true, page: [], status: "schedule_unavailable" as const };
    const generation = await getActiveGeneration(ctx, args.storeId, "sku_day");
    if (!generation) return { continueCursor: "", isDone: true, page: [], status: "pre_cutover" as const };
    const workspaceEpoch = await getActiveWorkspaceEpoch(ctx, generation);
    if (!workspaceEpoch) return { continueCursor: "", isDone: true, page: [], status: "materializing" as const };
    const cursorContextKey = buildCursorContextKey({
      contractVersions: `${generation.factContractVersion}:${generation.metricContractVersion}:${generation.projectionContractVersion}`,
      filter: args.classification,
      generationIds: [String(generation._id)],
      pageKind: "items",
      period: args.periodKey,
      sort: args.sort,
      stableWatermarks: [generation.stableWatermark!],
      storeId: String(args.storeId),
    });
    const paginationOpts = {
      ...args.paginationOpts,
      cursor: args.paginationOpts.cursor
        ? decodeReportingCursor(args.paginationOpts.cursor, cursorContextKey)
        : null,
    };
    const index = {
      attention: "by_epoch_period_attention_sku", cover: "by_epoch_period_cover_sku", inventory_value: "by_epoch_period_inventory_value_sku", margin: "by_epoch_period_margin_sku", revenue: "by_epoch_period_revenue_sku", units: "by_epoch_period_units_sku",
    }[args.sort] as any;
    const filteredIndex = {
      attention: "by_epoch_period_class_attention_sku", cover: "by_epoch_period_class_cover_sku", inventory_value: "by_epoch_period_class_inventory_value_sku", margin: "by_epoch_period_class_margin_sku", revenue: "by_epoch_period_class_revenue_sku", units: "by_epoch_period_class_units_sku",
    }[args.sort] as any;
    const pageQuery = args.classification === "all"
      ? ctx.db.query("reportingSkuPeriodSummary").withIndex(index, (q: any) => q.eq("workspaceEpochId", workspaceEpoch._id).eq("periodKey", args.periodKey))
      : ctx.db.query("reportingSkuPeriodClassification").withIndex(filteredIndex, (q: any) => q.eq("workspaceEpochId", workspaceEpoch._id).eq("periodKey", args.periodKey).eq("classification", args.classification));
    const [page, rollups, facets] = await Promise.all([
      pageQuery.order("desc").paginate(boundReportingWorkspacePagination(paginationOpts)),
      ctx.db.query("reportingPeriodRollup").withIndex("by_epoch_period_dimension_id", (q) => q.eq("workspaceEpochId", workspaceEpoch._id).eq("periodKey", args.periodKey)).take(101),
      ctx.db.query("reportingPeriodFacet").withIndex("by_epoch_period_facet_value", (q) => q.eq("workspaceEpochId", workspaceEpoch._id).eq("periodKey", args.periodKey)).take(101),
    ]);
    const summaryRows = args.classification === "all" ? page.page as Doc<"reportingSkuPeriodSummary">[] : (await Promise.all(page.page.map((membership) => ctx.db.query("reportingSkuPeriodSummary").withIndex("by_epoch_period_sku", (q) => q.eq("workspaceEpochId", workspaceEpoch._id).eq("periodKey", args.periodKey).eq("productSkuId", membership.productSkuId)).first()))).filter((row): row is Doc<"reportingSkuPeriodSummary"> => row !== null);
    const hydrated = await Promise.all(summaryRows.map(async (row) => {
      if (!rowMatchesResolvedPeriod(row, descriptor)) throw new Error("Reports period summary is stale");
      const sku = await ctx.db.get("productSku", row.productSkuId);
      const product = sku ? await ctx.db.get("product", sku.productId) : null;
      const category = product?.categoryId ? await ctx.db.get("category", product.categoryId) : null;
      return {
        ...row,
        identity: { category, product, sku },
        metrics: presentReportItemMetrics(row.metrics),
        revenueCurrencyCode: row.revenueCurrencyCode ?? null,
        revenueCurrencyMinorUnitScale: row.revenueCurrencyMinorUnitScale ?? null,
        valuationCurrencyCode: row.valuationCurrencyCode ?? null,
        valuationCurrencyMinorUnitScale: row.valuationCurrencyMinorUnitScale ?? null,
      };
    }));
    return {
      ...page,
      continueCursor: page.isDone ? "" : encodeReportingCursor({ contextKey: cursorContextKey, cursor: page.continueCursor, version: 1 }),
      cursorContextKey,
      facets: facets.slice(0, 100),
      facetsTruncated: facets.length > 100,
      generationId: generation._id,
      page: hydrated,
      rollups: rollups.slice(0, 100),
      rollupsTruncated: rollups.length > 100,
      status: generation.status,
    };
  },
});

export const listReportInventory = query({
  args: { paginationOpts: paginationOptsValidator, periodKey: reportPeriodKeyValidator, storeId: v.id("store") },
  handler: async (ctx, args) => {
    await requireReportingStoreAccess(ctx, args.storeId);
    const descriptor = await resolveRequestedReportsPeriod(ctx, args.storeId, args.periodKey);
    if (!descriptor) return { continueCursor: "", isDone: true, page: [], status: "schedule_unavailable" as const };
    const [generation, movementGeneration] = await Promise.all([
      getActiveGeneration(ctx, args.storeId, "current_inventory"),
      getActiveGeneration(ctx, args.storeId, "sku_day"),
    ]);
    if (!generation) return { continueCursor: "", isDone: true, page: [], status: "pre_cutover" as const };
    const compatibleMovementGeneration = movementGeneration &&
      reportingGenerationsAreCompatible(generation, movementGeneration)
      ? movementGeneration
      : null;
    const [inventoryEpoch, movementEpoch] = await Promise.all([getActiveWorkspaceEpoch(ctx, generation), compatibleMovementGeneration ? getActiveWorkspaceEpoch(ctx, compatibleMovementGeneration) : null]);
    if (!inventoryEpoch) return { continueCursor: "", isDone: true, page: [], status: "materializing" as const };
    const cursorContextKey = buildCursorContextKey({
      contractVersions: `${generation.factContractVersion}:${generation.metricContractVersion}:${generation.projectionContractVersion}`,
      filter: "all",
      generationIds: [String(generation._id), ...(compatibleMovementGeneration ? [String(compatibleMovementGeneration._id)] : [])],
      pageKind: "inventory",
      period: args.periodKey,
      sort: "exposure",
      stableWatermarks: [generation.stableWatermark!, ...(compatibleMovementGeneration ? [compatibleMovementGeneration.stableWatermark!] : [])],
      storeId: String(args.storeId),
    });
    const paginationOpts = {
      ...args.paginationOpts,
      cursor: args.paginationOpts.cursor
        ? decodeReportingCursor(args.paginationOpts.cursor, cursorContextKey)
        : null,
    };
    const [page, movementSummary] = await Promise.all([
      ctx.db.query("reportingInventoryExposureSummary")
        .withIndex("by_workspaceEpochId_exposureSort_productSkuId", (q) => q.eq("workspaceEpochId", inventoryEpoch._id))
        .order("desc").paginate(boundReportingWorkspacePagination(paginationOpts)),
      compatibleMovementGeneration && movementEpoch ? ctx.db.query("reportingInventoryPeriodSummary")
        .withIndex("by_workspaceEpochId_periodKey", (q) => q.eq("workspaceEpochId", movementEpoch._id).eq("periodKey", args.periodKey))
        .first() : null,
    ]);
    const resolvedMovementSummary = movementSummary && rowMatchesResolvedPeriod(movementSummary, descriptor)
      ? movementSummary
      : null;
    const hydrated = await Promise.all(page.page.map(async (row) => {
      const [sku, movement] = await Promise.all([
        ctx.db.get("productSku", row.productSkuId),
        compatibleMovementGeneration && movementEpoch ? ctx.db.query("reportingInventoryMovementSummary")
          .withIndex("by_epoch_period_sku", (q) => q.eq("workspaceEpochId", movementEpoch._id).eq("periodKey", args.periodKey).eq("productSkuId", row.productSkuId))
          .first() : null,
      ]);
      const product = sku ? await ctx.db.get("product", sku.productId) : null;
      return {
        ...row,
        identity: { product, sku },
        movement: movement && rowMatchesResolvedPeriod(movement, descriptor) ? movement : null,
        valuationCurrencyCode: row.valuationCurrencyCode ?? null,
        valuationCurrencyMinorUnitScale: row.valuationCurrencyMinorUnitScale ?? null,
      };
    }));
    return {
      ...page,
      continueCursor: page.isDone ? "" : encodeReportingCursor({ contextKey: cursorContextKey, cursor: page.continueCursor, version: 1 }),
      cursorContextKey,
      generationId: generation._id,
      inventoryLimitingReason: generation.limitingReason ?? null,
      movementGenerationId: compatibleMovementGeneration?._id ?? null,
      movementLimitingReason: movementGeneration && !compatibleMovementGeneration ? "generation_incompatible" : null,
      movementSummary: resolvedMovementSummary,
      page: hydrated,
      status: generation.status,
    };
  },
});

export const getReportItemDetail = query({
  args: {
    periodKey: reportPeriodKeyValidator,
    productSkuId: v.id("productSku"),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    await requireReportingStoreAccess(ctx, args.storeId);
    const descriptor = await resolveRequestedReportsPeriod(ctx, args.storeId, args.periodKey);
    if (!descriptor) return { data: null, status: "schedule_unavailable" as const };
    const [skuGeneration, inventoryGeneration, periodStartRange, periodEndRange] = await Promise.all([
      getActiveGeneration(ctx, args.storeId, "sku_day"),
      getActiveGeneration(ctx, args.storeId, "current_inventory"),
      resolveReportingCalendarDateRangeWithCtx(ctx, { reportingDate: descriptor.current.startDate, storeId: args.storeId }),
      resolveReportingCalendarDateRangeWithCtx(ctx, { reportingDate: descriptor.current.endDate, storeId: args.storeId }),
    ]);
    if (periodStartRange.kind !== "resolved" || periodEndRange.kind !== "resolved") return { data: null, status: "timezone_unavailable" as const };
    if (!skuGeneration) return { data: null, status: "pre_cutover" as const };
    const [skuEpoch, inventoryEpoch] = await Promise.all([getActiveWorkspaceEpoch(ctx, skuGeneration), inventoryGeneration ? getActiveWorkspaceEpoch(ctx, inventoryGeneration) : null]);
    if (!skuEpoch) return { data: null, status: "materializing" as const };
    const compatibleInventoryGeneration = inventoryGeneration &&
      reportingGenerationsAreCompatible(skuGeneration, inventoryGeneration)
      ? inventoryGeneration
      : null;
    const [sku, periodSummary, movement, inventory] = await Promise.all([
      ctx.db.get("productSku", args.productSkuId),
      ctx.db.query("reportingSkuPeriodSummary")
        .withIndex("by_epoch_period_sku", (q) =>
          q.eq("workspaceEpochId", skuEpoch._id)
            .eq("periodKey", args.periodKey)
            .eq("productSkuId", args.productSkuId),
        ).first(),
      ctx.db.query("reportingInventoryMovementSummary")
        .withIndex("by_epoch_period_sku", (q) =>
          q.eq("workspaceEpochId", skuEpoch._id)
            .eq("periodKey", args.periodKey)
            .eq("productSkuId", args.productSkuId),
        ).first(),
      compatibleInventoryGeneration && inventoryEpoch
        ? ctx.db.query("reportingInventoryExposureSummary")
            .withIndex("by_workspaceEpochId_productSkuId", (q) =>
              q.eq("workspaceEpochId", inventoryEpoch._id)
                .eq("productSkuId", args.productSkuId),
            ).first()
        : null,
    ]);
    const product = sku ? await ctx.db.get("product", sku.productId) : null;
    if (!sku || !product || !periodSummary || periodSummary.storeId !== args.storeId || !rowMatchesResolvedPeriod(periodSummary, descriptor)) {
      return {
        data: null,
        generationId: skuGeneration._id,
        status: "unavailable" as const,
      };
    }
    return {
      data: {
        comparison: null,
        identity: { product, sku },
        inventory,
        movement,
        periodEnd: periodEndRange.endAt,
        periodStart: periodStartRange.startAt,
        periodSummary,
        trust: {
          completeness: periodSummary.completeness,
          limitingReason: periodSummary.limitingReason ?? null,
          sourceGenerationIds: periodSummary.sourceGenerationIds,
          sourceWatermark: periodSummary.sourceWatermark,
        },
      },
      generationId: skuGeneration._id,
      inventoryGenerationId: compatibleInventoryGeneration?._id ?? null,
      inventoryLimitingReason:
        inventoryGeneration && !compatibleInventoryGeneration
          ? "generation_incompatible"
          : compatibleInventoryGeneration?.limitingReason ?? null,
      status: skuGeneration.status,
    };
  },
});

const reportsCustomResultFamilyValidator = v.union(
  v.literal("overview"),
  v.literal("sku"),
  v.literal("product_rollup"),
  v.literal("category_rollup"),
  v.literal("facet"),
  v.literal("movement"),
);

export function customRangeSkuTerminalIsReadable(input: {
  cursor: Parameters<typeof skuAttributionTerminalIsCurrent>[0]["cursor"];
  generationTerminal?: number;
  requestedSurface: "overview" | "sku_dependent";
  runTerminal?: number;
  workspaceTerminal?: number;
}) {
  if (
    input.runTerminal !== input.generationTerminal ||
    input.runTerminal !== input.workspaceTerminal
  ) return false;
  return input.requestedSurface === "overview" ||
    skuAttributionTerminalIsCurrent({
      cursor: input.cursor,
      terminal: input.runTerminal,
    });
}

/**
 * One authenticated, generation-bound read contract for every Reports custom
 * range surface. Callers select the persisted family needed by Overview,
 * Items, or Inventory; no browser aggregation over daily projections occurs.
 */
export const getReportsCustomRange = query({
  args: {
    family: reportsCustomResultFamilyValidator,
    paginationOpts: paginationOptsValidator,
    runId: v.id("reportingRun"),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    await requireReportingStoreAccess(ctx, args.storeId);
    const run = await ctx.db.get("reportingRun", args.runId);
    if (
      !run ||
      run.storeId !== args.storeId ||
      run.runType !== "custom_range" ||
      run.status !== "completed" ||
      !run.generationId ||
      !run.rangeStartDate ||
      !run.rangeEndDate
    ) {
      return { continueCursor: "", data: null, isDone: true, page: [], status: "unavailable" as const };
    }
    const generation = await ctx.db.get("reportingProjectionGeneration", run.generationId);
    if (
      !generation ||
      generation.storeId !== args.storeId ||
      generation.runId !== run._id ||
      generation.projectionKind !== "custom_range" ||
      generation.status !== "verified" ||
      generation.stableWatermark === undefined ||
      generation.stableWatermark !== run.frozenWatermark ||
      generation.factContractVersion !== run.factContractVersion ||
      generation.metricContractVersion !== run.metricContractVersion ||
      generation.projectionContractVersion !== run.projectionContractVersion
    ) {
      return { continueCursor: "", data: null, isDone: true, page: [], status: "unavailable" as const };
    }
    const workspaceEpoch = await getActiveWorkspaceEpoch(ctx, generation);
    if (!workspaceEpoch) return { continueCursor: "", data: null, isDone: true, page: [], status: "materializing" as const };
    const attributionCursor = args.family === "overview"
      ? null
      : await currentSkuAttributionCursorWithCtx(ctx, args.storeId);
    if (!customRangeSkuTerminalIsReadable({
      cursor: attributionCursor,
      generationTerminal: generation.skuAttributionTerminalSequence,
      requestedSurface: args.family === "overview" ? "overview" : "sku_dependent",
      runTerminal: run.skuAttributionTerminalSequence,
      workspaceTerminal: workspaceEpoch.skuAttributionTerminalSequence,
    })) {
      return { continueCursor: "", data: null, isDone: true, page: [], status: "unavailable" as const };
    }
    const cursorContextKey = buildCursorContextKey({
      contractVersions: `${generation.factContractVersion}:${generation.metricContractVersion}:${generation.projectionContractVersion}`,
      filter: args.family,
      generationIds: [String(generation._id)],
      pageKind: "custom_range",
      period: `${run.rangeStartDate}:${run.rangeEndDate}`,
      sort: "result_key",
      stableWatermarks: [generation.stableWatermark],
      storeId: String(args.storeId),
    });
    const page = await ctx.db.query("reportingRangeProjection")
      .withIndex("by_generationId_resultFamily_resultKey", (q) =>
        q.eq("generationId", generation._id).eq("resultFamily", args.family),
      )
      .paginate(boundReportingWorkspacePagination({
        ...args.paginationOpts,
        cursor: args.paginationOpts.cursor
          ? decodeReportingCursor(args.paginationOpts.cursor, cursorContextKey)
          : null,
      }));
    return {
      ...page,
      continueCursor: page.isDone ? "" : encodeReportingCursor({ contextKey: cursorContextKey, cursor: page.continueCursor, version: 1 }),
      cursorContextKey,
      data: {
        family: args.family,
        generationId: generation._id,
        range: { endDate: run.rangeEndDate, startDate: run.rangeStartDate },
        sourceGenerationIds: run.sourceGenerationIds ?? [],
        sourceWatermark: generation.stableWatermark,
      },
      status: "verified" as const,
    };
  },
});

const customPresentationSurfaceValidator = v.union(
  v.literal("overview"),
  v.literal("items"),
  v.literal("inventory"),
  v.literal("item_detail"),
);

export const getReportsCustomRangePresentation = query({
  args: {
    classification: v.optional(v.union(v.literal("all"), v.literal("fast_mover"), v.literal("slow_mover"), v.literal("nonmoving"), v.literal("low_cover"), v.literal("high_revenue_low_margin"))),
    paginationOpts: paginationOptsValidator,
    productSkuId: v.optional(v.id("productSku")),
    runId: v.id("reportingRun"),
    sort: v.optional(v.union(v.literal("revenue"), v.literal("margin"), v.literal("units"), v.literal("cover"), v.literal("inventory_value"), v.literal("attention"))),
    storeId: v.id("store"),
    surface: customPresentationSurfaceValidator,
  },
  handler: async (ctx, args) => {
    await requireReportingStoreAccess(ctx, args.storeId);
    const run = await ctx.db.get("reportingRun", args.runId);
    const generation = run?.generationId
      ? await ctx.db.get("reportingProjectionGeneration", run.generationId)
      : null;
    if (!run || run.storeId !== args.storeId || run.runType !== "custom_range" ||
      run.status !== "completed" || !run.rangeStartDate || !run.rangeEndDate ||
      !generation || generation.runId !== run._id || generation.status !== "verified" ||
      generation.projectionKind !== "custom_range" || generation.stableWatermark !== run.frozenWatermark) {
      return { continueCursor: "", data: null, isDone: true, page: [], status: "unavailable" as const };
    }
    const workspaceEpoch = await getActiveWorkspaceEpoch(ctx, generation);
    if (!workspaceEpoch) return { continueCursor: "", data: null, isDone: true, page: [], status: "materializing" as const };
    const attributionCursor = args.surface === "overview"
      ? null
      : await currentSkuAttributionCursorWithCtx(ctx, args.storeId);
    if (!customRangeSkuTerminalIsReadable({
      cursor: attributionCursor,
      generationTerminal: generation.skuAttributionTerminalSequence,
      requestedSurface: args.surface === "overview" ? "overview" : "sku_dependent",
      runTerminal: run.skuAttributionTerminalSequence,
      workspaceTerminal: workspaceEpoch.skuAttributionTerminalSequence,
    })) {
      return { continueCursor: "", data: null, isDone: true, page: [], status: "unavailable" as const };
    }
    const [startPeriod, endPeriod] = await Promise.all([
      resolveReportingCalendarDateRangeWithCtx(ctx, { reportingDate: run.rangeStartDate, storeId: args.storeId }),
      resolveReportingCalendarDateRangeWithCtx(ctx, { reportingDate: run.rangeEndDate, storeId: args.storeId }),
    ]);
    if (startPeriod.kind !== "resolved" || endPeriod.kind !== "resolved") {
      return { continueCursor: "", data: null, isDone: true, page: [], status: "timezone_unavailable" as const };
    }
    const customPeriodKey = `${run.rangeStartDate}:${run.rangeEndDate}`;
    const movementSummary = await ctx.db.query("reportingInventoryPeriodSummary")
      .withIndex("by_workspaceEpochId_periodKey", (q) => q.eq("workspaceEpochId", workspaceEpoch._id).eq("periodKey", customPeriodKey)).first();
    const authority = {
      completeness: generation.completeness,
      generationId: generation._id,
      limitingReason: generation.limitingReason ?? null,
      periodEnd: endPeriod.endAt,
      periodStart: startPeriod.startAt,
      period: { endOperatingDate: run.rangeEndDate, startOperatingDate: run.rangeStartDate },
      range: { endDate: run.rangeEndDate, startDate: run.rangeStartDate },
      sourceGenerationIds: run.sourceGenerationIds ?? [],
      sourceWatermark: generation.stableWatermark!,
      movementSummary,
    };
    if (args.surface === "overview") {
      const rows = await ctx.db.query("reportingRangeProjection")
        .withIndex("by_generationId_resultFamily_resultKey", (q) => q.eq("generationId", generation._id).eq("resultFamily", "overview")).take(100);
      const currency = rows.find((row) => row.currencyCode && row.currencyMinorUnitScale !== undefined);
      const currencyCodes = new Set(rows.map((row) => row.currencyCode).filter((value): value is string => Boolean(value)));
      const mixedCurrency = currencyCodes.size > 1 || rows.some((row) => row.limitingReason === "mixed_currency");
      const metrics = Object.fromEntries(rows.map((row) => [row.metric, mixedCurrency && row.currencyCode ? null : row.knownValue ?? null]));
      return {
        continueCursor: "", isDone: true, page: [], status: "verified" as const,
        data: { ...authority, currencyCode: mixedCurrency ? null : currency?.currencyCode ?? null, currencyMinorUnitScale: mixedCurrency ? null : currency?.currencyMinorUnitScale ?? null, metrics, trust: { completeness: !mixedCurrency && rows.every((row) => row.completeness === "complete") ? "complete" : "partial", limitingReason: mixedCurrency ? "mixed_currency" : rows.find((row) => row.limitingReason)?.limitingReason ?? generation.limitingReason ?? null } },
      };
    }
    const periodKey = customPeriodKey;
    const classification = args.classification ?? "all";
    const sort = args.sort ?? "revenue";
    const contextKey = buildCursorContextKey({
      contractVersions: `${generation.factContractVersion}:${generation.metricContractVersion}:${generation.projectionContractVersion}`,
      filter: `${classification}:${args.productSkuId ? String(args.productSkuId) : "all"}`,
      generationIds: [String(generation._id)], pageKind: args.surface,
      period: periodKey, sort, stableWatermarks: [generation.stableWatermark!], storeId: String(args.storeId),
    });
    const paginationOpts = boundReportingWorkspacePagination({ cursor: args.paginationOpts.cursor ? decodeReportingCursor(args.paginationOpts.cursor, contextKey) : null, numItems: args.paginationOpts.numItems });
    const index = ({ attention: "by_epoch_period_attention_sku", cover: "by_epoch_period_cover_sku", inventory_value: "by_epoch_period_inventory_value_sku", margin: "by_epoch_period_margin_sku", revenue: "by_epoch_period_revenue_sku", units: "by_epoch_period_units_sku" } as const)[sort];
    const filteredIndex = ({ attention: "by_epoch_period_class_attention_sku", cover: "by_epoch_period_class_cover_sku", inventory_value: "by_epoch_period_class_inventory_value_sku", margin: "by_epoch_period_class_margin_sku", revenue: "by_epoch_period_class_revenue_sku", units: "by_epoch_period_class_units_sku" } as const)[sort];
    const summaryQuery = classification === "all"
      ? ctx.db.query("reportingSkuPeriodSummary").withIndex(index as any, (q: any) => q.eq("workspaceEpochId", workspaceEpoch._id).eq("periodKey", periodKey))
      : ctx.db.query("reportingSkuPeriodClassification").withIndex(filteredIndex as any, (q: any) => q.eq("workspaceEpochId", workspaceEpoch._id).eq("periodKey", periodKey).eq("classification", classification));
    const rawSummaryPage = args.productSkuId
      ? { continueCursor: "", isDone: true, page: [await ctx.db.query("reportingSkuPeriodSummary").withIndex("by_epoch_period_sku", (q) => q.eq("workspaceEpochId", workspaceEpoch._id).eq("periodKey", periodKey).eq("productSkuId", args.productSkuId!)).first()].filter(Boolean) as Doc<"reportingSkuPeriodSummary">[] }
      : await summaryQuery.order("desc").paginate(paginationOpts);
    const summaryPage = classification === "all" || args.productSkuId
      ? rawSummaryPage as { continueCursor: string; isDone: boolean; page: Doc<"reportingSkuPeriodSummary">[] }
      : { ...rawSummaryPage, page: (await Promise.all(rawSummaryPage.page.map((membership) => ctx.db.query("reportingSkuPeriodSummary").withIndex("by_epoch_period_sku", (q) => q.eq("workspaceEpochId", workspaceEpoch._id).eq("periodKey", periodKey).eq("productSkuId", membership.productSkuId)).first()))).filter((row): row is Doc<"reportingSkuPeriodSummary"> => row !== null) };
    const currentInventory = await getActiveGeneration(ctx, args.storeId, "current_inventory");
    const currentInventoryEpoch = currentInventory ? await getActiveWorkspaceEpoch(ctx, currentInventory) : null;
    const inventoryCompatible = currentInventory && currentInventory.stableWatermark === generation.stableWatermark &&
      currentInventory.factContractVersion === generation.factContractVersion &&
      currentInventory.metricContractVersion === generation.metricContractVersion &&
      currentInventory.projectionContractVersion === generation.projectionContractVersion;
    const page = await Promise.all(summaryPage.page.map(async (summary) => {
      const productSkuId = summary.productSkuId;
      const sku = await ctx.db.get("productSku", productSkuId);
      const product = sku ? await ctx.db.get("product", sku.productId) : null;
      const inventory = inventoryCompatible && currentInventoryEpoch ? await ctx.db.query("reportingInventoryExposureSummary")
        .withIndex("by_workspaceEpochId_productSkuId", (q) => q.eq("workspaceEpochId", currentInventoryEpoch._id).eq("productSkuId", productSkuId)).first() : null;
      return { classifications: summary.classifications, currencyCode: summary.revenueCurrencyCode ?? null, currencyMinorUnitScale: summary.revenueCurrencyMinorUnitScale ?? null, identity: { product, sku }, inventory, metrics: summary.metrics, period: authority.period, productSkuId, trust: { completeness: summary.completeness, limitingReason: summary.limitingReason ?? null, sourceGenerationIds: authority.sourceGenerationIds, sourceWatermark: authority.sourceWatermark } };
    }));
    const isDone = summaryPage.isDone;
    return {
      continueCursor: isDone ? "" : encodeReportingCursor({ contextKey, cursor: summaryPage.continueCursor, version: 1 }),
      data: { ...authority, classification, inventoryLimitingReason: currentInventory && !inventoryCompatible ? "generation_incompatible" : currentInventory?.limitingReason ?? null, sort, trust: { completeness: page.every((row) => row.trust.completeness === "complete") ? "complete" : "partial", limitingReason: page.find((row) => row.trust.limitingReason)?.trust.limitingReason ?? generation.limitingReason ?? null } },
      isDone, page, status: "verified" as const,
    };
  },
});
