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
};

function parseCustomRangeCursor(
  cursor: string | undefined,
  rangeStartDate: string,
): CustomRangeCursor {
  if (!cursor) {
    return { projectionCursor: null, operatingDate: rangeStartDate };
  }
  try {
    const parsed = JSON.parse(cursor) as Partial<CustomRangeCursor>;
    if (
      typeof parsed.operatingDate !== "string" ||
      (parsed.projectionCursor !== null &&
        typeof parsed.projectionCursor !== "string")
    ) {
      throw new Error("invalid cursor");
    }
    return {
      projectionCursor: parsed.projectionCursor ?? null,
      operatingDate: parsed.operatingDate,
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
    const request = {
      endOperatingDate: args.endOperatingDate,
      metricVersion: sourceGeneration.metricContractVersion,
      requestedWatermark,
      sourceGenerationId: String(sourceGeneration._id),
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
  const [sourceGeneration, activation] = await Promise.all([
    run.sourceGenerationId
      ? ctx.db.get("reportingProjectionGeneration", run.sourceGenerationId)
      : null,
    ctx.db
      .query("reportingProjectionActivation")
      .withIndex("by_storeId_projectionKind_activatedAt", (q) =>
        q.eq("storeId", run.storeId).eq("projectionKind", "store_day"),
      )
      .order("desc")
      .first(),
  ]);
  const sourceStillAuthoritative = Boolean(
    sourceGeneration &&
      activation &&
      activation.supersededAt === undefined &&
      activation.generationId === sourceGeneration._id &&
      sourceGeneration.status === "active" &&
      sourceGeneration.storeId === run.storeId &&
      sourceGeneration.sourceWatermark === run.frozenWatermark &&
      sourceGeneration.stableWatermark === run.frozenWatermark &&
      sourceGeneration.factContractVersion === run.factContractVersion &&
      sourceGeneration.metricContractVersion === run.metricContractVersion &&
      sourceGeneration.projectionContractVersion ===
        run.projectionContractVersion,
  );
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
    if (
      !sourceGeneration ||
      sourceGeneration.storeId !== run.storeId ||
      sourceGeneration.status !== "active" ||
      sourceGeneration.sourceWatermark !== run.frozenWatermark ||
      sourceGeneration.stableWatermark !== run.frozenWatermark ||
      sourceGeneration.factContractVersion !== run.factContractVersion ||
      sourceGeneration.metricContractVersion !== run.metricContractVersion ||
      sourceGeneration.projectionContractVersion !==
        run.projectionContractVersion
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
    const page = await ctx.db
      .query("reportingStoreDayProjection")
      .withIndex("by_generationId_operatingDate_metric", (q) =>
        q
          .eq("generationId", sourceGeneration._id)
          .eq("operatingDate", progress.operatingDate),
      )
      .paginate({
        cursor: progress.projectionCursor,
        numItems: CUSTOM_RANGE_FACT_PAGE_SIZE,
      });
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
      const nextDate = addOperatingDateDay(progress.operatingDate);
      if (nextDate > run.rangeEndDate) {
        await completeCustomRangeRequest(ctx, {
          ...run,
          failedCount: run.failedCount,
          frozenWatermark: run.frozenWatermark,
          generationId: run.generationId,
          omittedCount,
          processedCount,
        });
        return;
      }
      await ctx.db.patch("reportingRun", run._id, {
        cursor: serializeCustomRangeCursor({
          projectionCursor: null,
          operatingDate: nextDate,
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
    return {
      failedCount: run.failedCount,
      generationId: run.generationId ?? null,
      processedCount: run.processedCount,
      rangeEndDate: run.rangeEndDate ?? null,
      rangeStartDate: run.rangeStartDate ?? null,
      status: run.status,
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
    const result = await ctx.db
      .query("reportingRangeProjection")
      .withIndex("by_generationId_metric_currencyCode_productSkuId", (q) =>
        q.eq("generationId", generation._id),
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
      sourceWatermark: generation.stableWatermark,
    };
  },
});

export const getCustomRangeResult = action({
  args: {
    paginationOpts: paginationOptsValidator,
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
