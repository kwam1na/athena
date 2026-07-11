import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  type MutationCtx,
} from "../_generated/server";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { requireReportingStoreAccess } from "./access";
import { assertReportingRunTransition } from "./maintenance/runLedger";

export type CustomRangeRequest = {
  endOperatingDate: string;
  metricVersion: number;
  requestedWatermark: number;
  sourceGenerationId: string;
  startOperatingDate: string;
  storeId: string;
};

type CustomRangeRun = {
  requestKey: string;
  status: "building" | "catching_up" | "verified" | "failed";
  storeId?: string;
};

type CustomRangeSourceAuthority = {
  factContractVersion: number;
  metricContractVersion: number;
  organizationId: string;
  projectionContractVersion: number;
  stableWatermark: number;
  storeId: string;
};

export function customRangeSourcesAreAuthoritative(input: {
  authority: CustomRangeSourceAuthority;
  skuActivation: null | { factContractVersion: number; generationId: string; metricContractVersion: number; organizationId: string; projectionContractVersion: number; storeId: string; supersededAt?: number };
  skuGeneration: null | { factContractVersion: number; metricContractVersion: number; organizationId: string; projectionContractVersion: number; projectionKind: string; sourceWatermark: number; stableWatermark?: number; status: string; storeId: string; generationId: string };
  storeActivation: null | { factContractVersion: number; generationId: string; metricContractVersion: number; organizationId: string; projectionContractVersion: number; storeId: string; supersededAt?: number };
  storeGeneration: null | { factContractVersion: number; metricContractVersion: number; organizationId: string; projectionContractVersion: number; projectionKind: string; sourceWatermark: number; stableWatermark?: number; status: string; storeId: string; generationId: string };
}) {
  const { authority, skuActivation, skuGeneration, storeActivation, storeGeneration } = input;
  const generationMatches = (generation: NonNullable<typeof storeGeneration>, kind: "store_day" | "sku_day") =>
    generation.projectionKind === kind && generation.status === "active" &&
    generation.storeId === authority.storeId && generation.organizationId === authority.organizationId &&
    generation.sourceWatermark === authority.stableWatermark && generation.stableWatermark === authority.stableWatermark &&
    generation.factContractVersion === authority.factContractVersion &&
    generation.metricContractVersion === authority.metricContractVersion &&
    generation.projectionContractVersion === authority.projectionContractVersion;
  const activationMatches = (activation: NonNullable<typeof storeActivation>, generationId: string) =>
    activation.supersededAt === undefined && activation.generationId === generationId &&
    activation.storeId === authority.storeId && activation.organizationId === authority.organizationId &&
    activation.factContractVersion === authority.factContractVersion &&
    activation.metricContractVersion === authority.metricContractVersion &&
    activation.projectionContractVersion === authority.projectionContractVersion;
  return Boolean(storeGeneration && skuGeneration && storeActivation && skuActivation &&
    generationMatches(storeGeneration, "store_day") && generationMatches(skuGeneration, "sku_day") &&
    activationMatches(storeActivation, storeGeneration.generationId) && activationMatches(skuActivation, skuGeneration.generationId));
}

export function classifyCustomRangeSourceRow(
  row: {
    completeness: string;
    limitingReason?: string;
    metricContractVersion: number;
    sourceWatermark: number;
  },
  snapshot: {
    frozenWatermark: number;
    metricContractVersion: number;
  },
) {
  if (row.sourceWatermark > snapshot.frozenWatermark) {
    return { eligible: false as const, limited: true };
  }
  if (row.metricContractVersion !== snapshot.metricContractVersion) {
    return { eligible: false as const, limited: true };
  }
  return {
    eligible: true as const,
    limited: row.completeness !== "complete" || Boolean(row.limitingReason),
  };
}

const OPERATING_DATE = /^\d{4}-\d{2}-\d{2}$/;
const customRangeResultFamilyValidator = v.union(
  v.literal("overview"),
  v.literal("sku"),
  v.literal("product_rollup"),
  v.literal("category_rollup"),
  v.literal("facet"),
  v.literal("movement"),
  v.literal("daily_close_trust"),
);
export const CUSTOM_RANGE_CONCURRENCY_LIMIT = 2;
export const CUSTOM_RANGE_FACT_PAGE_SIZE = 20;
export const CUSTOM_RANGE_MAX_DAYS = 3_660;
export const CUSTOM_RANGE_RESULT_PAGE_SIZE_MAX = 100;

function operatingDateTimestamp(operatingDate: string) {
  if (!OPERATING_DATE.test(operatingDate)) return null;
  const timestamp = Date.parse(`${operatingDate}T00:00:00.000Z`);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString().slice(0, 10) !== operatingDate
  ) {
    return null;
  }
  return timestamp;
}

export function validateCustomRangeDates(input: {
  endOperatingDate: string;
  startOperatingDate: string;
}) {
  const start = operatingDateTimestamp(input.startOperatingDate);
  const end = operatingDateTimestamp(input.endOperatingDate);
  if (start === null || end === null || start > end) {
    throw new Error("invalid operating date range");
  }
  const dayCount = Math.floor((end - start) / 86_400_000) + 1;
  if (dayCount > CUSTOM_RANGE_MAX_DAYS) {
    throw new Error("custom range exceeds supported day limit");
  }
  return { dayCount, end, start };
}

export function boundCustomRangePagination(input: {
  cursor: string | null;
  numItems: number;
}) {
  const requested = Number.isFinite(input.numItems)
    ? Math.floor(input.numItems)
    : 1;
  return {
    cursor: input.cursor,
    numItems: Math.min(
      CUSTOM_RANGE_RESULT_PAGE_SIZE_MAX,
      Math.max(1, requested),
    ),
  };
}

export function buildCustomRangeRequestKey(request: CustomRangeRequest) {
  validateCustomRangeDates(request);
  if (
    !Number.isSafeInteger(request.metricVersion) ||
    request.metricVersion < 1 ||
    !Number.isSafeInteger(request.requestedWatermark) ||
    request.requestedWatermark < 0
  ) {
    throw new Error("invalid custom range version or watermark");
  }
  return `${request.storeId}:${request.startOperatingDate}:${request.endOperatingDate}:v${request.metricVersion}:w${request.requestedWatermark}:g${request.sourceGenerationId}`;
}

export function decideCustomRangeRequest(input: {
  activeRuns: CustomRangeRun[];
  existingRun: CustomRangeRun | null;
  request: CustomRangeRequest;
}) {
  const requestKey = buildCustomRangeRequestKey(input.request);
  if (input.existingRun?.requestKey === requestKey) {
    return { requestKey, status: "reused" as const };
  }
  const activeForStore = input.activeRuns.filter(
    (run) =>
      run.storeId === input.request.storeId &&
      (run.status === "building" || run.status === "catching_up"),
  );
  if (activeForStore.length >= CUSTOM_RANGE_CONCURRENCY_LIMIT) {
    throw new Error("custom range concurrency limit reached");
  }
  return { requestKey, status: "created" as const };
}

export function customRangeResultBelongsToStore(input: {
  generation: {
    generationId: string;
    projectionKind: string;
    rangeEndDate?: string;
    rangeStartDate?: string;
    runId: string;
    status: string;
    storeId: string;
  } | null;
  run: {
    generationId?: string;
    rangeEndDate?: string;
    rangeStartDate?: string;
    runId: string;
    runType: string;
    status: string;
    storeId: string;
  } | null;
  storeId: string;
}) {
  return Boolean(
    input.run &&
    input.generation &&
    input.run.storeId === input.storeId &&
    input.run.runType === "custom_range" &&
    input.run.status === "completed" &&
    input.run.generationId === input.generation.generationId &&
    input.generation.storeId === input.storeId &&
    input.generation.runId === input.run.runId &&
    input.generation.projectionKind === "custom_range" &&
    input.generation.status === "verified" &&
    input.generation.rangeStartDate === input.run.rangeStartDate &&
    input.generation.rangeEndDate === input.run.rangeEndDate,
  );
}

function addOperatingDateDay(operatingDate: string) {
  const timestamp = operatingDateTimestamp(operatingDate);
  if (timestamp === null) throw new Error("invalid operating date");
  return new Date(timestamp + 86_400_000).toISOString().slice(0, 10);
}

type CustomRangeCursor = {
  projectionCursor: string | null;
  operatingDate: string;
  phase: "store" | "sku" | "derive";
};

export function customRangeResultIdentity(input: {
  dimensionId?: string;
  family: string;
  metric: string;
  productSkuId?: string;
}) {
  return [input.family, input.productSkuId ?? input.dimensionId, input.metric]
    .filter(Boolean)
    .join(":");
}

export function nextCustomRangeWork(input: {
  date: string;
  endDate: string;
  pageDone: boolean;
  phase: CustomRangeCursor["phase"];
}) {
  if (!input.pageDone) return { date: input.date, phase: input.phase };
  if (input.phase === "store") return { date: input.date, phase: "sku" as const };
  if (input.phase === "sku") {
    if (input.date === input.endDate) return { date: input.date, phase: "derive" as const };
    return { date: addOperatingDateDay(input.date), phase: "store" as const };
  }
  return { date: input.date, phase: "derive" as const };
}

function parseCustomRangeCursor(
  cursor: string | undefined,
  rangeStartDate: string,
): CustomRangeCursor {
  if (!cursor) {
    return { projectionCursor: null, operatingDate: rangeStartDate, phase: "store" };
  }
  try {
    const parsed = JSON.parse(cursor) as Partial<CustomRangeCursor>;
    if (
      typeof parsed.operatingDate !== "string" ||
      (parsed.phase !== undefined && !["store", "sku", "derive"].includes(parsed.phase)) ||
      (parsed.projectionCursor !== null &&
        typeof parsed.projectionCursor !== "string")
    ) {
      throw new Error("invalid cursor");
    }
    return {
      projectionCursor: parsed.projectionCursor ?? null,
      operatingDate: parsed.operatingDate,
      phase: parsed.phase ?? "store",
    };
  } catch {
    throw new Error("Custom range cursor is invalid");
  }
}

function serializeCustomRangeCursor(cursor: CustomRangeCursor) {
  return JSON.stringify(cursor);
}

async function nextCustomRangeEventSequence(
  ctx: MutationCtx,
  runId: Id<"reportingRun">,
) {
  const latest = await ctx.db
    .query("reportingRunEvent")
    .withIndex("by_runId_sequence", (q) => q.eq("runId", runId))
    .order("desc")
    .first();
  return (latest?.sequence ?? 0) + 1;
}

export const requestCustomRange = mutation({
  args: {
    endOperatingDate: v.string(),
    startOperatingDate: v.string(),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    validateCustomRangeDates(args);
    const { athenaUser, store } = await requireReportingStoreAccess(
      ctx,
      args.storeId,
    );
    const activation = await ctx.db
      .query("reportingProjectionActivation")
      .withIndex("by_storeId_projectionKind_activatedAt", (q) =>
        q.eq("storeId", args.storeId).eq("projectionKind", "store_day"),
      )
      .order("desc")
      .first();
    if (!activation || activation.supersededAt !== undefined) {
      throw new Error(
        "Verified reporting data is not available for this store.",
      );
    }
    const sourceGeneration = await ctx.db.get(
      "reportingProjectionGeneration",
      activation.generationId,
    );
    if (
      !sourceGeneration ||
      sourceGeneration.storeId !== args.storeId ||
      sourceGeneration.organizationId !== store.organizationId ||
      sourceGeneration.status !== "active" ||
      sourceGeneration.stableWatermark === undefined ||
      sourceGeneration.sourceWatermark !== sourceGeneration.stableWatermark ||
      sourceGeneration.factContractVersion !== activation.factContractVersion ||
      sourceGeneration.metricContractVersion !==
        activation.metricContractVersion ||
      sourceGeneration.projectionContractVersion !==
        activation.projectionContractVersion
    ) {
      throw new Error(
        "Verified reporting data is not available for this store.",
      );
    }
    const requestedWatermark = sourceGeneration.stableWatermark;
    const skuActivation = await ctx.db
      .query("reportingProjectionActivation")
      .withIndex("by_storeId_projectionKind_activatedAt", (q) =>
        q.eq("storeId", args.storeId).eq("projectionKind", "sku_day"),
      )
      .order("desc")
      .first();
    const skuSourceGeneration = skuActivation
      ? await ctx.db.get("reportingProjectionGeneration", skuActivation.generationId)
      : null;
    if (!customRangeSourcesAreAuthoritative({
      authority: {
        factContractVersion: sourceGeneration.factContractVersion,
        metricContractVersion: sourceGeneration.metricContractVersion,
        organizationId: String(store.organizationId),
        projectionContractVersion: sourceGeneration.projectionContractVersion,
        stableWatermark: requestedWatermark,
        storeId: String(args.storeId),
      },
      skuActivation: skuActivation ? { ...skuActivation, generationId: String(skuActivation.generationId), organizationId: String(skuActivation.organizationId), storeId: String(skuActivation.storeId) } : null,
      skuGeneration: skuSourceGeneration ? { ...skuSourceGeneration, generationId: String(skuSourceGeneration._id), organizationId: String(skuSourceGeneration.organizationId), storeId: String(skuSourceGeneration.storeId) } : null,
      storeActivation: { ...activation, generationId: String(activation.generationId), organizationId: String(activation.organizationId), storeId: String(activation.storeId) },
      storeGeneration: { ...sourceGeneration, generationId: String(sourceGeneration._id), organizationId: String(sourceGeneration.organizationId), storeId: String(sourceGeneration.storeId) },
    })) {
      throw new Error("Verified SKU reporting data is not available for this store.");
    }
    if (!skuSourceGeneration) {
      throw new Error("Verified SKU reporting data is not available for this store.");
    }
    const request = {
      endOperatingDate: args.endOperatingDate,
      metricVersion: sourceGeneration.metricContractVersion,
      requestedWatermark,
      sourceGenerationId: `${String(sourceGeneration._id)}+${String(skuSourceGeneration._id)}`,
      startOperatingDate: args.startOperatingDate,
      storeId: String(args.storeId),
    };
    const requestKey = buildCustomRangeRequestKey(request);
    const existing = await ctx.db
      .query("reportingRun")
      .withIndex("by_storeId_runType_requestKey", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("runType", "custom_range")
          .eq("requestKey", requestKey),
      )
      .first();
    if (existing) {
      if (
        existing.status === "pending" ||
        existing.status === "running" ||
        existing.status === "failed"
      ) {
        if (existing.status === "failed") {
          await ctx.db.patch("reportingRun", existing._id, {
            completedAt: undefined,
            failedCount: 0,
            status: "running",
          });
          if (existing.generationId) {
            await ctx.db.patch(
              "reportingProjectionGeneration",
              existing.generationId,
              {
                limitingReason: undefined,
                status: "building",
              },
            );
          }
        }
        await ctx.scheduler.runAfter(
          0,
          internal.reporting.customRangeRequests.processCustomRangeRequest,
          { runId: existing._id },
        );
      }
      return { runId: existing._id, status: "reused" as const };
    }
    const [pendingRuns, runningRuns] = await Promise.all([
        ctx.db
          .query("reportingRun")
          .withIndex("by_storeId_runType_status", (q) =>
            q
              .eq("storeId", args.storeId)
              .eq("runType", "custom_range")
              .eq("status", "pending"),
          )
          .take(CUSTOM_RANGE_CONCURRENCY_LIMIT + 1),
        ctx.db
          .query("reportingRun")
          .withIndex("by_storeId_runType_status", (q) =>
            q
              .eq("storeId", args.storeId)
              .eq("runType", "custom_range")
              .eq("status", "running"),
          )
          .take(CUSTOM_RANGE_CONCURRENCY_LIMIT + 1),
      ]);
    decideCustomRangeRequest({
      activeRuns: [...pendingRuns, ...runningRuns].map((run) => ({
        requestKey: run.requestKey ?? String(run._id),
        status: run.status === "pending" ? "building" : "catching_up",
        storeId: String(run.storeId),
      })),
      existingRun: null,
      request,
    });
    const now = Date.now();
    const runId = await ctx.db.insert("reportingRun", {
      actorKind: "human",
      actorUserId: athenaUser._id,
      createdAt: now,
      domain: "reporting",
      factContractVersion: sourceGeneration.factContractVersion,
      failedCount: 0,
      frozenWatermark: requestedWatermark,
      metricContractVersion: sourceGeneration.metricContractVersion,
      operation: "custom_range",
      organizationId: store.organizationId,
      processedCount: 0,
      projectionContractVersion: sourceGeneration.projectionContractVersion,
      rangeEndDate: args.endOperatingDate,
      rangeStartDate: args.startOperatingDate,
      requestKey,
      runType: "custom_range",
      sourceGenerationId: sourceGeneration._id,
      sourceGenerationIds: [sourceGeneration._id, skuSourceGeneration._id],
      status: "pending",
      storeId: args.storeId,
    });
    const generationId = await ctx.db.insert("reportingProjectionGeneration", {
      completeness: "provisional",
      createdAt: now,
      factContractVersion: sourceGeneration.factContractVersion,
      metricContractVersion: sourceGeneration.metricContractVersion,
      organizationId: store.organizationId,
      projectionContractVersion: sourceGeneration.projectionContractVersion,
      projectionKind: "custom_range",
      rangeEndDate: args.endOperatingDate,
      rangeStartDate: args.startOperatingDate,
      runId,
      sourceWatermark: requestedWatermark,
      sourceGenerationIds: [sourceGeneration._id, skuSourceGeneration._id],
      status: "building",
      storeId: args.storeId,
    });
    await ctx.db.patch("reportingRun", runId, { generationId });
    await ctx.db.insert("reportingRunEvent", {
      eventType: "created",
      occurredAt: now,
      outcome: "pending",
      runId,
      sequence: 1,
      storeId: args.storeId,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.reporting.customRangeRequests.processCustomRangeRequest,
      { runId },
    );
    return { runId, status: "created" as const };
  },
});

async function completeCustomRangeRequest(
  ctx: MutationCtx,
  run: Doc<"reportingRun"> & {
    frozenWatermark: number;
    generationId: Id<"reportingProjectionGeneration">;
  },
) {
  const completedAt = Date.now();
  const skuSourceGenerationId = run.sourceGenerationIds?.find(
    (id) => id !== run.sourceGenerationId,
  );
  const [sourceGeneration, skuSourceGeneration, activation, skuActivation] = await Promise.all([
    run.sourceGenerationId
      ? ctx.db.get("reportingProjectionGeneration", run.sourceGenerationId)
      : null,
    skuSourceGenerationId
      ? ctx.db.get("reportingProjectionGeneration", skuSourceGenerationId)
      : null,
    ctx.db
      .query("reportingProjectionActivation")
      .withIndex("by_storeId_projectionKind_activatedAt", (q) =>
        q.eq("storeId", run.storeId).eq("projectionKind", "store_day"),
      )
      .order("desc")
      .first(),
    ctx.db.query("reportingProjectionActivation")
      .withIndex("by_storeId_projectionKind_activatedAt", (q) =>
        q.eq("storeId", run.storeId).eq("projectionKind", "sku_day"),
      ).order("desc").first(),
  ]);
  const sourceStillAuthoritative = customRangeSourcesAreAuthoritative({
    authority: { factContractVersion: run.factContractVersion, metricContractVersion: run.metricContractVersion, organizationId: String(run.organizationId), projectionContractVersion: run.projectionContractVersion, stableWatermark: run.frozenWatermark, storeId: String(run.storeId) },
    skuActivation: skuActivation ? { ...skuActivation, generationId: String(skuActivation.generationId), organizationId: String(skuActivation.organizationId), storeId: String(skuActivation.storeId) } : null,
    skuGeneration: skuSourceGeneration ? { ...skuSourceGeneration, generationId: String(skuSourceGeneration._id), organizationId: String(skuSourceGeneration.organizationId), storeId: String(skuSourceGeneration.storeId) } : null,
    storeActivation: activation ? { ...activation, generationId: String(activation.generationId), organizationId: String(activation.organizationId), storeId: String(activation.storeId) } : null,
    storeGeneration: sourceGeneration ? { ...sourceGeneration, generationId: String(sourceGeneration._id), organizationId: String(sourceGeneration.organizationId), storeId: String(sourceGeneration.storeId) } : null,
  });
  const incompleteSourceCount = run.omittedCount ?? 0;
  if (!sourceStillAuthoritative || incompleteSourceCount > 0) {
    await ctx.db.patch("reportingProjectionGeneration", run.generationId, {
      completeness: "partial",
      limitingReason: sourceStillAuthoritative
        ? "source_incomplete"
        : "projection_stale",
      status: "failed",
    });
    await ctx.db.patch("reportingRun", run._id, {
      completedAt,
      cursor: undefined,
      failedCount: Math.max(1, incompleteSourceCount),
      processedCount: run.processedCount,
      status: "failed",
    });
    await ctx.db.insert("reportingRunEvent", {
      eventType: "custom_range_verification_failed",
      failedCount: Math.max(1, incompleteSourceCount),
      occurredAt: completedAt,
      outcome: "failed",
      processedCount: run.processedCount,
      runId: run._id,
      safeReason: sourceStillAuthoritative
        ? "custom_range_source_incomplete"
        : "custom_range_source_generation_changed",
      sequence: await nextCustomRangeEventSequence(ctx, run._id),
      storeId: run.storeId,
    });
    return;
  }
  await ctx.db.patch("reportingProjectionGeneration", run.generationId, {
    completeness: "complete",
    limitingReason: undefined,
    stableWatermark: run.frozenWatermark,
    status: "verified",
    verifiedAt: completedAt,
  });
  await ctx.db.patch("reportingRun", run._id, {
    completedAt,
    cursor: undefined,
    failedCount: run.failedCount,
    processedCount: run.processedCount,
    status: "completed",
  });
  await ctx.scheduler.runAfter(
    0,
    (internal as any).reporting.readModels.materialize.startReportsWorkspaceMaterialization,
    { generationId: run.generationId },
  );
  await ctx.db.insert("reportingRunEvent", {
    eventType: "completed",
    occurredAt: completedAt,
    outcome: "complete",
    processedCount: run.processedCount,
    runId: run._id,
    sequence: await nextCustomRangeEventSequence(ctx, run._id),
    storeId: run.storeId,
  });
}

async function addCustomRangeResultWithCtx(
  ctx: MutationCtx,
  input: {
    currencyCode?: string;
    currencyMinorUnitScale?: number;
    family: "sku" | "product_rollup" | "category_rollup" | "facet" | "movement";
    generationId: Id<"reportingProjectionGeneration">;
    knownValue: number;
    metric: string;
    metricContractVersion: number;
    organizationId: Id<"organization">;
    productSkuId?: Id<"productSku">;
    rangeEndDate: string;
    rangeStartDate: string;
    resultKey: string;
    setIfPresent?: boolean;
    sourceWatermark: number;
    storeId: Id<"store">;
  },
) {
  const existing = await ctx.db.query("reportingRangeProjection")
    .withIndex("by_generationId_resultFamily_resultKey", (q) =>
      q.eq("generationId", input.generationId).eq("resultFamily", input.family).eq("resultKey", input.resultKey),
    ).first();
  if (existing) {
    await ctx.db.patch(existing._id, {
      knownValue: input.setIfPresent
        ? existing.knownValue
        : (existing.knownValue ?? 0) + input.knownValue,
      projectedAt: Date.now(),
    });
    return;
  }
  await ctx.db.insert("reportingRangeProjection", {
    completeness: "complete",
    currencyCode: input.currencyCode,
    currencyMinorUnitScale: input.currencyMinorUnitScale,
    generationId: input.generationId,
    knownValue: input.knownValue,
    metric: input.metric,
    metricContractVersion: input.metricContractVersion,
    organizationId: input.organizationId,
    productSkuId: input.productSkuId,
    projectedAt: Date.now(),
    rangeEndDate: input.rangeEndDate,
    rangeStartDate: input.rangeStartDate,
    resultFamily: input.family,
    resultKey: input.resultKey,
    sourceWatermark: input.sourceWatermark,
    storeId: input.storeId,
    unknownQuantity: 0,
  });
}

export const processCustomRangeRequestMutation = internalMutation({
  args: { runId: v.id("reportingRun") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get("reportingRun", args.runId);
    if (
      !run ||
      run.runType !== "custom_range" ||
      !run.generationId ||
      !run.sourceGenerationId ||
      !run.rangeStartDate ||
      !run.rangeEndDate ||
      run.frozenWatermark === undefined ||
      ["paused", "cancelled", "completed", "failed"].includes(run.status)
    ) {
      return;
    }
    const progress = parseCustomRangeCursor(run.cursor, run.rangeStartDate);
    if (
      progress.operatingDate < run.rangeStartDate ||
      progress.operatingDate > run.rangeEndDate
    ) {
      throw new Error("Custom range cursor is outside the requested range");
    }
    const sourceGeneration = await ctx.db.get(
      "reportingProjectionGeneration",
      run.sourceGenerationId,
    );
    const skuSourceGenerationId = run.sourceGenerationIds?.find(
      (id) => id !== run.sourceGenerationId,
    );
    const skuSourceGeneration = skuSourceGenerationId
      ? await ctx.db.get("reportingProjectionGeneration", skuSourceGenerationId)
      : null;
    if (
      !sourceGeneration ||
      sourceGeneration.storeId !== run.storeId ||
      sourceGeneration.status !== "active" ||
      sourceGeneration.sourceWatermark !== run.frozenWatermark ||
      sourceGeneration.stableWatermark !== run.frozenWatermark ||
      sourceGeneration.factContractVersion !== run.factContractVersion ||
      sourceGeneration.metricContractVersion !== run.metricContractVersion ||
      sourceGeneration.projectionContractVersion !==
        run.projectionContractVersion ||
      !skuSourceGeneration ||
      skuSourceGeneration.projectionKind !== "sku_day" ||
      skuSourceGeneration.storeId !== run.storeId ||
      skuSourceGeneration.organizationId !== run.organizationId ||
      skuSourceGeneration.status !== "active" ||
      skuSourceGeneration.sourceWatermark !== run.frozenWatermark ||
      skuSourceGeneration.stableWatermark !== run.frozenWatermark ||
      skuSourceGeneration.factContractVersion !== run.factContractVersion ||
      skuSourceGeneration.metricContractVersion !== run.metricContractVersion ||
      skuSourceGeneration.projectionContractVersion !== run.projectionContractVersion
    ) {
      throw new Error("Custom range source generation changed");
    }
    const activation = await ctx.db
      .query("reportingProjectionActivation")
      .withIndex("by_storeId_projectionKind_activatedAt", (q) =>
        q.eq("storeId", run.storeId).eq("projectionKind", "store_day"),
      )
      .order("desc")
      .first();
    if (
      !activation ||
      activation.supersededAt !== undefined ||
      activation.generationId !== sourceGeneration._id
    ) {
      throw new Error("Custom range source generation is no longer active");
    }
    const skuActivation = await ctx.db
      .query("reportingProjectionActivation")
      .withIndex("by_storeId_projectionKind_activatedAt", (q) =>
        q.eq("storeId", run.storeId).eq("projectionKind", "sku_day"),
      )
      .order("desc")
      .first();
    if (
      !skuActivation ||
      skuActivation.supersededAt !== undefined ||
      skuActivation.generationId !== skuSourceGeneration._id
    ) {
      throw new Error("Custom range SKU source generation is no longer active");
    }
    if (!customRangeSourcesAreAuthoritative({
      authority: { factContractVersion: run.factContractVersion, metricContractVersion: run.metricContractVersion, organizationId: String(run.organizationId), projectionContractVersion: run.projectionContractVersion, stableWatermark: run.frozenWatermark, storeId: String(run.storeId) },
      skuActivation: { ...skuActivation, generationId: String(skuActivation.generationId), organizationId: String(skuActivation.organizationId), storeId: String(skuActivation.storeId) },
      skuGeneration: { ...skuSourceGeneration, generationId: String(skuSourceGeneration._id), organizationId: String(skuSourceGeneration.organizationId), storeId: String(skuSourceGeneration.storeId) },
      storeActivation: { ...activation, generationId: String(activation.generationId), organizationId: String(activation.organizationId), storeId: String(activation.storeId) },
      storeGeneration: { ...sourceGeneration, generationId: String(sourceGeneration._id), organizationId: String(sourceGeneration.organizationId), storeId: String(sourceGeneration.storeId) },
    })) {
      throw new Error("Custom range source authority changed");
    }
    if (progress.phase === "derive") {
      await completeCustomRangeRequest(ctx, { ...run, frozenWatermark: run.frozenWatermark, generationId: run.generationId });
      return;
    }
    const page = progress.phase === "store"
      ? await ctx.db.query("reportingStoreDayProjection")
          .withIndex("by_generationId_operatingDate_metric", (q) => q.eq("generationId", sourceGeneration._id).eq("operatingDate", progress.operatingDate))
          .paginate({ cursor: progress.projectionCursor, numItems: CUSTOM_RANGE_FACT_PAGE_SIZE })
      : await ctx.db.query("reportingSkuDayProjection")
          .withIndex("by_generationId_operatingDate_productSkuId_metric", (q) => q.eq("generationId", skuSourceGeneration._id).eq("operatingDate", progress.operatingDate))
          .paginate({ cursor: progress.projectionCursor, numItems: CUSTOM_RANGE_FACT_PAGE_SIZE });
    let limitationCount = 0;
    let projectedContributionCount = 0;
    for (const sourceRow of page.page) {
      const classification = classifyCustomRangeSourceRow(sourceRow, {
        frozenWatermark: run.frozenWatermark,
        metricContractVersion: run.metricContractVersion,
      });
      if (classification.limited && !classification.eligible) {
        limitationCount += 1;
      }
      if (!classification.eligible) continue;
      if (progress.phase === "sku") {
        const skuRow = sourceRow as Doc<"reportingSkuDayProjection">;
        if (skuRow.knownValue === undefined) { limitationCount += 1; continue; }
        const sku = await ctx.db.get("productSku", skuRow.productSkuId);
        const product = sku ? await ctx.db.get("product", sku.productId) : null;
        const common = {
          currencyCode: skuRow.currencyCode,
          currencyMinorUnitScale: skuRow.currencyMinorUnitScale,
          generationId: run.generationId,
          knownValue: skuRow.knownValue,
          metric: skuRow.metric,
          metricContractVersion: run.metricContractVersion,
          organizationId: run.organizationId,
          rangeEndDate: run.rangeEndDate,
          rangeStartDate: run.rangeStartDate,
          sourceWatermark: skuSourceGeneration.stableWatermark!,
          storeId: run.storeId,
        };
        await addCustomRangeResultWithCtx(ctx, { ...common, family: "sku", productSkuId: skuRow.productSkuId, resultKey: customRangeResultIdentity({ family: "sku", metric: skuRow.metric, productSkuId: String(skuRow.productSkuId) }) });
        if (product) await addCustomRangeResultWithCtx(ctx, { ...common, family: "product_rollup", resultKey: customRangeResultIdentity({ dimensionId: String(product._id), family: "product_rollup", metric: skuRow.metric }) });
        if (product?.categoryId) await addCustomRangeResultWithCtx(ctx, { ...common, family: "category_rollup", resultKey: customRangeResultIdentity({ dimensionId: String(product.categoryId), family: "category_rollup", metric: skuRow.metric }) });
        if (["units_sold", "units_returned", "inventory_consumed_units", "purchase_commitment_units"].includes(skuRow.metric)) {
          await addCustomRangeResultWithCtx(ctx, { ...common, family: "movement", productSkuId: skuRow.productSkuId, resultKey: customRangeResultIdentity({ family: "movement", metric: skuRow.metric, productSkuId: String(skuRow.productSkuId) }) });
        }
        await addCustomRangeResultWithCtx(ctx, { ...common, currencyCode: undefined, currencyMinorUnitScale: undefined, family: "facet", knownValue: 1, metric: "active_sku", productSkuId: skuRow.productSkuId, resultKey: customRangeResultIdentity({ family: "facet", metric: "active_sku", productSkuId: String(skuRow.productSkuId) }), setIfPresent: true });
        const activeDayMetric = `__active_day:${progress.operatingDate}`;
        await addCustomRangeResultWithCtx(ctx, { ...common, currencyCode: undefined, currencyMinorUnitScale: undefined, family: "sku", knownValue: 1, metric: activeDayMetric, productSkuId: skuRow.productSkuId, resultKey: customRangeResultIdentity({ family: "sku", metric: activeDayMetric, productSkuId: String(skuRow.productSkuId) }), setIfPresent: true });
        projectedContributionCount += 1;
        continue;
      }
      {
        const currencyCode = sourceRow.currencyCode;
        const currencyMinorUnitScale = sourceRow.currencyMinorUnitScale;
        const existing = await ctx.db
          .query("reportingRangeProjection")
          .withIndex("by_generationId_metric_currencyCode_productSkuId", (q) =>
            q
              .eq("generationId", run.generationId!)
              .eq("metric", sourceRow.metric)
              .eq("currencyCode", currencyCode)
              .eq("productSkuId", undefined),
          )
          .first();
        const sourceIncomplete =
          sourceRow.completeness !== "complete" ||
          sourceRow.limitingReason !== undefined ||
          sourceRow.knownValue === undefined;
        const scaleMismatch = Boolean(
          existing &&
          existing.currencyMinorUnitScale !== undefined &&
          currencyMinorUnitScale !== undefined &&
          existing.currencyMinorUnitScale !== currencyMinorUnitScale,
        );
        if (sourceIncomplete || scaleMismatch) limitationCount += 1;
        const withholdKnownValue = sourceIncomplete || scaleMismatch;
        if (existing) {
          await ctx.db.patch("reportingRangeProjection", existing._id, {
            completeness:
              !withholdKnownValue &&
              existing.completeness === "complete" &&
              sourceRow.completeness === "complete"
                ? "complete"
                : "partial",
            knownValue:
              withholdKnownValue || existing.knownValue === undefined
                ? undefined
                : existing.knownValue + sourceRow.knownValue!,
            limitingReason: withholdKnownValue
              ? sourceIncomplete
                ? "source_incomplete"
                : "mixed_currency"
              : existing.limitingReason,
            projectedAt: Date.now(),
            sourceWatermark: run.frozenWatermark,
            unknownQuantity:
              (existing.unknownQuantity ?? 0) +
              (sourceRow.unknownQuantity ?? 0),
          });
        } else {
          await ctx.db.insert("reportingRangeProjection", {
            completeness:
              withholdKnownValue || sourceRow.completeness !== "complete"
                ? "partial"
                : "complete",
            currencyCode,
            currencyMinorUnitScale,
            generationId: run.generationId,
            knownValue: withholdKnownValue
              ? undefined
              : sourceRow.knownValue,
            limitingReason: withholdKnownValue
              ? sourceIncomplete
                ? "source_incomplete"
                : "mixed_currency"
              : undefined,
            metric: sourceRow.metric,
            resultFamily: "overview",
            resultKey: sourceRow.metric,
            metricContractVersion: run.metricContractVersion,
            organizationId: run.organizationId,
            projectedAt: Date.now(),
            rangeEndDate: run.rangeEndDate,
            rangeStartDate: run.rangeStartDate,
            sourceWatermark: run.frozenWatermark,
            storeId: run.storeId,
            unknownQuantity: sourceRow.unknownQuantity,
          });
        }
        projectedContributionCount += 1;
      }
    }
    const omittedCount = (run.omittedCount ?? 0) + limitationCount;
    const processedCount = run.processedCount + page.page.length;
    if (page.isDone) {
      const next = nextCustomRangeWork({ date: progress.operatingDate, endDate: run.rangeEndDate, pageDone: true, phase: progress.phase });
      await ctx.db.patch("reportingRun", run._id, {
        cursor: serializeCustomRangeCursor({
          projectionCursor: null,
          operatingDate: next.date,
          phase: next.phase,
        }),
        omittedCount,
        processedCount,
        startedAt: run.startedAt ?? Date.now(),
        status: "running",
      });
    } else {
      await ctx.db.patch("reportingRun", run._id, {
        cursor: serializeCustomRangeCursor({
          projectionCursor: page.continueCursor,
          operatingDate: progress.operatingDate,
          phase: progress.phase,
        }),
        omittedCount,
        processedCount,
        startedAt: run.startedAt ?? Date.now(),
        status: "running",
      });
    }
    await ctx.db.insert("reportingRunEvent", {
      cursor: page.continueCursor,
      eventType: "custom_range_page_processed",
      failedCount: limitationCount,
      occurredAt: Date.now(),
      outcome: "running",
      processedCount: projectedContributionCount,
      runId: run._id,
      sequence: await nextCustomRangeEventSequence(ctx, run._id),
      storeId: run.storeId,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.reporting.customRangeRequests.processCustomRangeRequest,
      { runId: run._id },
    );
  },
});

export const recordCustomRangeFailure = internalMutation({
  args: {
    runId: v.id("reportingRun"),
    safeReason: v.string(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get("reportingRun", args.runId);
    if (
      !run ||
      run.runType !== "custom_range" ||
      ["completed", "cancelled", "expired"].includes(run.status)
    ) {
      return;
    }
    const failedAt = Date.now();
    await ctx.db.patch("reportingRun", run._id, {
      completedAt: failedAt,
      failedCount: run.failedCount + 1,
      status: "failed",
    });
    if (run.generationId) {
      await ctx.db.patch("reportingProjectionGeneration", run.generationId, {
        completeness: "partial",
        limitingReason: "processing_failed",
        status: "failed",
      });
    }
    await ctx.db.insert("reportingRunEvent", {
      cursor: run.cursor,
      eventType: "custom_range_failed",
      failedCount: run.failedCount + 1,
      occurredAt: failedAt,
      outcome: "failed",
      processedCount: run.processedCount,
      runId: run._id,
      safeReason: args.safeReason.slice(0, 100),
      sequence: await nextCustomRangeEventSequence(ctx, run._id),
      storeId: run.storeId,
    });
  },
});

export const processCustomRangeRequest = internalAction({
  args: { runId: v.id("reportingRun") },
  handler: async (ctx, args) => {
    try {
      await ctx.runMutation(
        internal.reporting.customRangeRequests
          .processCustomRangeRequestMutation,
        args,
      );
    } catch {
      await ctx.runMutation(
        internal.reporting.customRangeRequests.recordCustomRangeFailure,
        { runId: args.runId, safeReason: "custom_range_worker_failed" },
      );
    }
  },
});

export const controlCustomRangeRequest = internalMutation({
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
    if (!run || run.runType !== "custom_range" || run.status === "expired") {
      throw new Error("Custom range run not found");
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
    if (run.generationId && nextStatus === "running") {
      await ctx.db.patch("reportingProjectionGeneration", run.generationId, {
        limitingReason: undefined,
        status: "building",
      });
    }
    await ctx.db.insert("reportingRunEvent", {
      cursor: run.cursor,
      eventType: `custom_range_${args.action}`,
      occurredAt: now,
      outcome: nextStatus,
      processedCount: run.processedCount,
      runId: run._id,
      sequence: await nextCustomRangeEventSequence(ctx, run._id),
      storeId: run.storeId,
    });
    if (nextStatus === "running") {
      await ctx.scheduler.runAfter(
        0,
        internal.reporting.customRangeRequests.processCustomRangeRequest,
        { runId: run._id },
      );
    }
  },
});

const REPORTING_DIRECT_ACCESS_UNAVAILABLE = "Reports access unavailable.";

export const readCustomRangeStatus = internalQuery({
  args: { runId: v.id("reportingRun"), storeId: v.id("store") },
  handler: async (ctx, args) => {
    await requireReportingStoreAccess(ctx, args.storeId);
    const run = await ctx.db.get("reportingRun", args.runId);
    if (
      !run ||
      run.storeId !== args.storeId ||
      run.runType !== "custom_range"
    ) {
      throw new Error(REPORTING_DIRECT_ACCESS_UNAVAILABLE);
    }
    const workspaceActivation = run.generationId ? await ctx.db.query("reportingWorkspaceReadModelActivation").withIndex("by_storeId_projectionKind_activatedAt", (q) => q.eq("storeId", run.storeId).eq("projectionKind", "custom_range")).order("desc").first() : null;
    const materializationReady = Boolean(workspaceActivation && workspaceActivation.supersededAt === undefined && workspaceActivation.sourceGenerationId === run.generationId);
    return {
      failedCount: run.failedCount,
      generationId: run.generationId ?? null,
      processedCount: run.processedCount,
      rangeEndDate: run.rangeEndDate ?? null,
      rangeStartDate: run.rangeStartDate ?? null,
      status: run.status === "completed" && !materializationReady ? "materializing" : run.status,
    };
  },
});

export const getCustomRangeStatus = action({
  args: { runId: v.id("reportingRun"), storeId: v.id("store") },
  handler: async (ctx, args): Promise<any> => {
    const directAccess: any = (internal as any).reporting.directAccess;
    const customRange: any = (internal as any).reporting.customRangeRequests;
    const preflight: { allowed: boolean } = await ctx.runMutation(
      directAccess.preflightReportingRunAccess,
      {
        expectedRunType: "custom_range",
        operation: "custom_range_status",
        ...args,
      },
    );
    if (!preflight.allowed)
      throw new Error(REPORTING_DIRECT_ACCESS_UNAVAILABLE);
    try {
      return await ctx.runQuery(customRange.readCustomRangeStatus, args);
    } catch {
      await ctx.runMutation(directAccess.recordReportingRunReadRaceDenial, {
        operation: "custom_range_status",
        requestedStoreRef: String(args.storeId),
        storeId: args.storeId,
      });
      throw new Error(REPORTING_DIRECT_ACCESS_UNAVAILABLE);
    }
  },
});

export const readCustomRangeResult = internalQuery({
  args: {
    paginationOpts: paginationOptsValidator,
    resultFamily: v.optional(customRangeResultFamilyValidator),
    runId: v.id("reportingRun"),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    await requireReportingStoreAccess(ctx, args.storeId);
    const run = await ctx.db.get("reportingRun", args.runId);
    if (
      !run ||
      run.storeId !== args.storeId ||
      run.runType !== "custom_range"
    ) {
      throw new Error(REPORTING_DIRECT_ACCESS_UNAVAILABLE);
    }
    if (run.status !== "completed" || !run.generationId) {
      return null;
    }
    const workspaceActivation = await ctx.db.query("reportingWorkspaceReadModelActivation").withIndex("by_storeId_projectionKind_activatedAt", (q) => q.eq("storeId", run.storeId).eq("projectionKind", "custom_range")).order("desc").first();
    if (!workspaceActivation || workspaceActivation.supersededAt !== undefined || workspaceActivation.sourceGenerationId !== run.generationId) return null;
    const generation = await ctx.db.get(
      "reportingProjectionGeneration",
      run.generationId,
    );
    if (
      !generation ||
      !customRangeResultBelongsToStore({
        generation: {
          generationId: String(generation._id),
          projectionKind: generation.projectionKind,
          rangeEndDate: generation.rangeEndDate,
          rangeStartDate: generation.rangeStartDate,
          runId: String(generation.runId),
          status: generation.status,
          storeId: String(generation.storeId),
        },
        run: {
          generationId: run.generationId ? String(run.generationId) : undefined,
          rangeEndDate: run.rangeEndDate,
          rangeStartDate: run.rangeStartDate,
          runId: String(run._id),
          runType: run.runType,
          status: run.status,
          storeId: String(run.storeId),
        },
        storeId: String(args.storeId),
      })
    ) {
      throw new Error(REPORTING_DIRECT_ACCESS_UNAVAILABLE);
    }
    const resultFamily = args.resultFamily ?? "overview";
    const result = await ctx.db
      .query("reportingRangeProjection")
      .withIndex("by_generationId_resultFamily_resultKey", (q) =>
        q.eq("generationId", generation._id).eq("resultFamily", resultFamily),
      )
      .paginate(boundCustomRangePagination(args.paginationOpts));
    return {
      ...result,
      page: result.page.map((row) => ({
        completeness: row.completeness,
        currencyCode: row.currencyCode ?? null,
        knownValue: row.knownValue ?? null,
        limitingReason: row.limitingReason ?? null,
        metric: row.metric,
        productSkuId: row.productSkuId ?? null,
        sourceWatermark: row.sourceWatermark,
        unknownQuantity: row.unknownQuantity ?? 0,
      })),
      rangeEndDate: generation.rangeEndDate,
      rangeStartDate: generation.rangeStartDate,
      resultFamily,
      sourceWatermark: generation.stableWatermark,
    };
  },
});

export const getCustomRangeResult = action({
  args: {
    paginationOpts: paginationOptsValidator,
    resultFamily: v.optional(customRangeResultFamilyValidator),
    runId: v.id("reportingRun"),
    storeId: v.id("store"),
  },
  handler: async (ctx, args): Promise<any> => {
    const directAccess: any = (internal as any).reporting.directAccess;
    const customRange: any = (internal as any).reporting.customRangeRequests;
    const preflight: { allowed: boolean } = await ctx.runMutation(
      directAccess.preflightReportingRunAccess,
      {
        expectedRunType: "custom_range",
        operation: "custom_range_result",
        runId: args.runId,
        storeId: args.storeId,
      },
    );
    if (!preflight.allowed)
      throw new Error(REPORTING_DIRECT_ACCESS_UNAVAILABLE);
    try {
      return await ctx.runQuery(customRange.readCustomRangeResult, args);
    } catch {
      await ctx.runMutation(directAccess.recordReportingRunReadRaceDenial, {
        operation: "custom_range_result",
        requestedStoreRef: String(args.storeId),
        storeId: args.storeId,
      });
      throw new Error(REPORTING_DIRECT_ACCESS_UNAVAILABLE);
    }
  },
});
