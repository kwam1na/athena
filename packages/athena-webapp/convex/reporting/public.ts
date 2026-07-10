import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { query, type QueryCtx } from "../_generated/server";
import type { ReportingSourceDomain } from "../../shared/reportingContract";
import { requireReportingStoreAccess } from "./access";
import { summarizeProjectionHealthRead } from "./health";
import { presentAttentionReason } from "./projections/attention";

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

async function getActiveGeneration(
  ctx: QueryCtx,
  storeId: Id<"store">,
  projectionKind: ProjectionKind,
) {
  const activation = await ctx.db
    .query("reportingProjectionActivation")
    .withIndex("by_storeId_projectionKind_activatedAt", (q) =>
      q.eq("storeId", storeId).eq("projectionKind", projectionKind),
    )
    .order("desc")
    .first();
  if (!activation) {
    return null;
  }
  const generation = await ctx.db.get(
    "reportingProjectionGeneration",
    activation.generationId,
  );
  if (!generation || generation.storeId !== storeId) {
    return null;
  }
  return generation;
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
    return { ...page, generationId: generation._id, status: generation.status };
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
    return {
      current,
      factContractVersion: generation.factContractVersion,
      generationId: generation._id,
      historyPage,
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
    return { generationId: generation._id, rows, status: generation.status };
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
