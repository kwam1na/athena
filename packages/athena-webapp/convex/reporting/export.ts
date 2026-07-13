import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
  mutation,
} from "../_generated/server";
import { v } from "convex/values";

import { requireReportingStoreAccess } from "./access";
import { requireSharedDemoCapabilityIfApplicable } from "../sharedDemo/actor";

export const EXPORT_PAGE_SIZE = 100;
export const EXPORT_MAX_CHUNKS = 500;
export const EXPORT_CLEANUP_BATCH_SIZE = 20;
export const EXPORT_TTL_MS = 24 * 60 * 60 * 1_000;

type ExportRunStatus =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired";

export type ReportingExportRun = {
  actorUserId: string;
  expiresAt: number;
  generationId: string;
  metricVersion: number;
  requestKey: string;
  requestedAt: number;
  status: "pending";
  storeId: string;
};

export type StoreDayExportRow = {
  completeness: string;
  currencyCode?: string;
  currencyMinorUnitScale?: number;
  factContractVersion: number;
  generationId: string;
  knownValue?: number;
  limitingReason?: string;
  metric: string;
  metricContractVersion: number;
  operatingDate: string;
  projectionContractVersion: number;
  sourceWatermark: number;
  storeId: string;
  unknownQuantity?: number;
};

export const EXPORT_CSV_HEADER = [
  "storeId",
  "generationId",
  "factContractVersion",
  "metricContractVersion",
  "projectionContractVersion",
  "sourceWatermark",
  "operatingDate",
  "metric",
  "knownValue",
  "unknownQuantity",
  "completeness",
  "limitingReason",
  "currencyCode",
  "currencyMinorUnitScale",
].join(",");

function csvCell(value: string | number | undefined) {
  if (value === undefined) {
    return "";
  }
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function formatStoreDayExportRow(row: StoreDayExportRow) {
  return [
    row.storeId,
    row.generationId,
    row.factContractVersion,
    row.metricContractVersion,
    row.projectionContractVersion,
    row.sourceWatermark,
    row.operatingDate,
    row.metric,
    row.knownValue,
    row.unknownQuantity,
    row.completeness,
    row.limitingReason,
    row.currencyCode,
    row.currencyMinorUnitScale,
  ]
    .map(csvCell)
    .join(",");
}

export function buildExportRequest(
  input: Omit<ReportingExportRun, "requestKey" | "status">,
) {
  if (input.expiresAt <= input.requestedAt) {
    throw new Error("export expiry must follow request time");
  }
  return {
    ...input,
    requestKey: `${input.storeId}:${input.generationId}:v${input.metricVersion}:${input.actorUserId}`,
    status: "pending" as const,
  };
}

export function canRetrieveExport(input: {
  memberAuthorized: boolean;
  now: number;
  requestedStoreId: string;
  run: ReportingExportRun;
}) {
  return (
    input.memberAuthorized &&
    input.requestedStoreId === input.run.storeId &&
    input.now <= input.run.expiresAt
  );
}

export function shouldCleanupExportRun(input: {
  expiresAt: number;
  now: number;
  status: ExportRunStatus;
}) {
  return (
    input.now > input.expiresAt &&
    (input.status === "completed" ||
      input.status === "failed" ||
      input.status === "cancelled")
  );
}

const exportRequestResult = v.object({
  runId: v.id("reportingRun"),
  status: v.union(v.literal("created"), v.literal("reused")),
});

export const requestExport = mutation({
  args: { storeId: v.id("store") },
  returns: exportRequestResult,
  handler: async (ctx, args) => {
    await requireSharedDemoCapabilityIfApplicable(ctx, "exports.generate");
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
    if (!activation) {
      throw new Error("Verified reporting data is not available for this store.");
    }
    const generation = await ctx.db.get(
      "reportingProjectionGeneration",
      activation.generationId,
    );
    if (
      !generation ||
      generation.storeId !== args.storeId ||
      generation.status !== "active" ||
      generation.stableWatermark === undefined ||
      generation.factContractVersion !== activation.factContractVersion ||
      generation.metricContractVersion !== activation.metricContractVersion ||
      generation.projectionContractVersion !== activation.projectionContractVersion
    ) {
      throw new Error("Verified reporting data is not available for this store.");
    }

    const now = Date.now();
    const request = buildExportRequest({
      actorUserId: String(athenaUser._id),
      expiresAt: now + EXPORT_TTL_MS,
      generationId: String(generation._id),
      metricVersion: generation.metricContractVersion,
      requestedAt: now,
      storeId: String(args.storeId),
    });
    const existing = await ctx.db
      .query("reportingRun")
      .withIndex("by_storeId_runType_requestKey", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("runType", "export")
          .eq("requestKey", request.requestKey),
      )
      .order("desc")
      .first();
    if (
      existing &&
      existing.status !== "expired" &&
      (existing.expiresAt ?? 0) >= now
    ) {
      if (existing.status === "pending" || existing.status === "running") {
        await ctx.scheduler.runAfter(
          0,
          internal.reporting.export.processExportPage,
          { runId: existing._id },
        );
      }
      return { runId: existing._id, status: "reused" as const };
    }

    const runId = await ctx.db.insert("reportingRun", {
      actorKind: "human",
      actorUserId: athenaUser._id,
      createdAt: now,
      domain: "reporting",
      expiresAt: request.expiresAt,
      exportChunkCount: 0,
      exportPageComplete: false,
      factContractVersion: generation.factContractVersion,
      failedCount: 0,
      frozenWatermark: generation.stableWatermark,
      generationId: generation._id,
      metricContractVersion: generation.metricContractVersion,
      operation: "store_day_csv",
      organizationId: store.organizationId,
      processedCount: 0,
      projectionContractVersion: generation.projectionContractVersion,
      requestKey: request.requestKey,
      runType: "export",
      status: "pending",
      storeId: args.storeId,
    });
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
      internal.reporting.export.processExportPage,
      { runId },
    );
    return { runId, status: "created" as const };
  },
});

export const processExportPage = internalMutation({
  args: { runId: v.id("reportingRun") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get("reportingRun", args.runId);
    if (
      !run ||
      run.runType !== "export" ||
      !run.generationId ||
      run.status === "paused" ||
      run.status === "completed" ||
      run.status === "failed" ||
      run.status === "cancelled" ||
      run.status === "expired"
    ) {
      return null;
    }
    if (run.exportPageComplete) {
      await ctx.scheduler.runAfter(
        0,
        internal.reporting.export.finalizeExportArtifact,
        { runId: run._id },
      );
      return null;
    }
    const generation = await ctx.db.get(
      "reportingProjectionGeneration",
      run.generationId,
    );
    if (
      !generation ||
      generation.storeId !== run.storeId ||
      generation._id !== run.generationId ||
      generation.factContractVersion !== run.factContractVersion ||
      generation.metricContractVersion !== run.metricContractVersion ||
      generation.projectionContractVersion !== run.projectionContractVersion
    ) {
      throw new Error("Export generation is unavailable.");
    }

    const page = await ctx.db
      .query("reportingStoreDayProjection")
      .withIndex("by_generationId_operatingDate_metric", (q) =>
        q.eq("generationId", run.generationId!),
      )
      .paginate({ cursor: run.cursor ?? null, numItems: EXPORT_PAGE_SIZE });
    const content = page.page
      .map((row) =>
        formatStoreDayExportRow({
          completeness: row.completeness,
          currencyCode: row.currencyCode,
          currencyMinorUnitScale: row.currencyMinorUnitScale,
          factContractVersion: run.factContractVersion,
          generationId: String(run.generationId),
          knownValue: row.knownValue,
          limitingReason: row.limitingReason,
          metric: row.metric,
          metricContractVersion: run.metricContractVersion,
          operatingDate: row.operatingDate,
          projectionContractVersion: run.projectionContractVersion,
          sourceWatermark: row.sourceWatermark,
          storeId: String(run.storeId),
          unknownQuantity: row.unknownQuantity,
        }),
      )
      .join("\n");
    const chunkCount = run.exportChunkCount ?? 0;
    if (content.length > 0 && chunkCount >= EXPORT_MAX_CHUNKS) {
      const failedAt = Date.now();
      await ctx.db.patch("reportingRun", run._id, {
        completedAt: failedAt,
        failedCount: run.failedCount + 1,
        status: "failed",
      });
      await ctx.db.insert("reportingRunEvent", {
        eventType: "failed",
        occurredAt: failedAt,
        outcome: "bounded_limit",
        processedCount: run.processedCount,
        runId: run._id,
        safeReason: "export_chunk_limit",
        sequence: 2,
        storeId: run.storeId,
      });
      await ctx.scheduler.runAfter(
        Math.max(0, (run.expiresAt ?? failedAt) - failedAt + 1),
        internal.reporting.export.cleanupExportRun,
        { runId: run._id },
      );
      return null;
    }
    if (content.length > 0) {
      await ctx.db.insert("reportingExportChunk", {
        content,
        createdAt: Date.now(),
        generationId: run.generationId,
        inputCursor: run.cursor,
        nextCursor: page.continueCursor,
        rowCount: page.page.length,
        runId: run._id,
        sequence: chunkCount,
        storeId: run.storeId,
      });
    }
    await ctx.db.patch("reportingRun", run._id, {
      cursor: page.continueCursor,
      exportChunkCount: content.length > 0 ? chunkCount + 1 : chunkCount,
      exportPageComplete: page.isDone,
      processedCount: run.processedCount + page.page.length,
      startedAt: run.startedAt ?? Date.now(),
      status: "running",
    });
    await ctx.scheduler.runAfter(
      0,
      page.isDone
        ? internal.reporting.export.finalizeExportArtifact
        : internal.reporting.export.processExportPage,
      { runId: run._id },
    );
    return null;
  },
});

export const readExportArtifactInput = internalQuery({
  args: { runId: v.id("reportingRun") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get("reportingRun", args.runId);
    if (
      !run ||
      run.runType !== "export" ||
      run.status !== "running" ||
      !run.exportPageComplete
    ) {
      return null;
    }
    const chunks = await ctx.db
      .query("reportingExportChunk")
      .withIndex("by_runId_sequence", (q) => q.eq("runId", run._id))
      .order("asc")
      .take(EXPORT_MAX_CHUNKS + 1);
    if (chunks.length > EXPORT_MAX_CHUNKS) {
      throw new Error("Export exceeds the bounded artifact limit.");
    }
    return {
      chunks: chunks.map((chunk) => chunk.content),
      expiresAt: run.expiresAt ?? run.createdAt,
      runId: run._id,
    };
  },
});

export const finalizeExportArtifact = internalAction({
  args: { runId: v.id("reportingRun") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const input = await ctx.runQuery(
      internal.reporting.export.readExportArtifactInput,
      args,
    );
    if (!input) {
      return null;
    }
    const csv = [EXPORT_CSV_HEADER, ...input.chunks].join("\n") + "\n";
    const storageId = await ctx.storage.store(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const result = await ctx.runMutation(
      internal.reporting.export.commitExportArtifact,
      { runId: input.runId, storageId },
    );
    if (!result.accepted) {
      await ctx.storage.delete(storageId);
    }
    return null;
  },
});

export const commitExportArtifact = internalMutation({
  args: {
    runId: v.id("reportingRun"),
    storageId: v.id("_storage"),
  },
  returns: v.object({ accepted: v.boolean() }),
  handler: async (ctx, args) => {
    const run = await ctx.db.get("reportingRun", args.runId);
    if (
      !run ||
      run.runType !== "export" ||
      run.status !== "running" ||
      !run.exportPageComplete ||
      run.resultStorageId
    ) {
      return { accepted: false };
    }
    const now = Date.now();
    await ctx.db.patch("reportingRun", run._id, {
      completedAt: now,
      resultStorageId: args.storageId,
      status: "completed",
    });
    await ctx.db.insert("reportingRunEvent", {
      eventType: "completed",
      occurredAt: now,
      outcome: "complete",
      processedCount: run.processedCount,
      runId: run._id,
      sequence: 2,
      storeId: run.storeId,
    });
    await ctx.scheduler.runAfter(
      Math.max(0, (run.expiresAt ?? now) - now + 1),
      internal.reporting.export.cleanupExportRun,
      { runId: run._id },
    );
    return { accepted: true };
  },
});

const exportStatusResult = v.union(
  v.null(),
  v.object({
    completedAt: v.union(v.null(), v.number()),
    expiresAt: v.number(),
    failedCount: v.number(),
    generationId: v.id("reportingProjectionGeneration"),
    metricContractVersion: v.number(),
    processedCount: v.number(),
    projectionContractVersion: v.number(),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("paused"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
      v.literal("expired"),
    ),
  }),
);

const REPORTING_DIRECT_ACCESS_UNAVAILABLE = "Reports access unavailable.";

export const readExportStatus = internalQuery({
  args: { runId: v.id("reportingRun"), storeId: v.id("store") },
  returns: exportStatusResult,
  handler: async (ctx, args) => {
    await requireReportingStoreAccess(ctx, args.storeId);
    const run = await ctx.db.get("reportingRun", args.runId);
    if (
      !run ||
      run.runType !== "export" ||
      run.storeId !== args.storeId ||
      !run.generationId ||
      !run.expiresAt
    ) {
      throw new Error(REPORTING_DIRECT_ACCESS_UNAVAILABLE);
    }
    return {
      completedAt: run.completedAt ?? null,
      expiresAt: run.expiresAt,
      failedCount: run.failedCount,
      generationId: run.generationId,
      metricContractVersion: run.metricContractVersion,
      processedCount: run.processedCount,
      projectionContractVersion: run.projectionContractVersion,
      status: run.status,
    };
  },
});

export const getExportStatus = action({
  args: { runId: v.id("reportingRun"), storeId: v.id("store") },
  returns: exportStatusResult,
  handler: async (ctx, args): Promise<any> => {
    const directAccess: any = (internal as any).reporting.directAccess;
    const reportingExport: any = (internal as any).reporting.export;
    const preflight: { allowed: boolean } = await ctx.runMutation(
      directAccess.preflightReportingRunAccess,
      { expectedRunType: "export", operation: "export_status", ...args },
    );
    if (!preflight.allowed) throw new Error(REPORTING_DIRECT_ACCESS_UNAVAILABLE);
    try {
      return await ctx.runQuery(reportingExport.readExportStatus, args);
    } catch {
      await ctx.runMutation(directAccess.recordReportingRunReadRaceDenial, {
        operation: "export_status",
        requestedStoreRef: String(args.storeId),
        storeId: args.storeId,
      });
      throw new Error(REPORTING_DIRECT_ACCESS_UNAVAILABLE);
    }
  },
});

const exportDownloadResult = v.union(
  v.null(),
  v.object({
    expiresAt: v.number(),
    filename: v.string(),
    url: v.string(),
  }),
);

export const readExportDownloadUrl = internalQuery({
  args: { runId: v.id("reportingRun"), storeId: v.id("store") },
  returns: exportDownloadResult,
  handler: async (ctx, args) => {
    await requireReportingStoreAccess(ctx, args.storeId);
    const run = await ctx.db.get("reportingRun", args.runId);
    const now = Date.now();
    if (
      !run ||
      run.runType !== "export" ||
      run.storeId !== args.storeId
    ) {
      throw new Error(REPORTING_DIRECT_ACCESS_UNAVAILABLE);
    }
    if (
      run.status !== "completed" ||
      !run.resultStorageId ||
      !run.expiresAt ||
      now > run.expiresAt
    ) {
      return null;
    }
    const url = await ctx.storage.getUrl(run.resultStorageId);
    if (!url) {
      return null;
    }
    return {
      expiresAt: run.expiresAt,
      filename: `athena-report-${String(args.storeId)}-${String(run.generationId)}.csv`,
      url,
    };
  },
});

export const getExportDownloadUrl = action({
  args: { runId: v.id("reportingRun"), storeId: v.id("store") },
  returns: exportDownloadResult,
  handler: async (ctx, args): Promise<any> => {
    const directAccess: any = (internal as any).reporting.directAccess;
    const reportingExport: any = (internal as any).reporting.export;
    const preflight: { allowed: boolean } = await ctx.runMutation(
      directAccess.preflightReportingRunAccess,
      { expectedRunType: "export", operation: "export_download", ...args },
    );
    if (!preflight.allowed) throw new Error(REPORTING_DIRECT_ACCESS_UNAVAILABLE);
    try {
      return await ctx.runQuery(reportingExport.readExportDownloadUrl, args);
    } catch {
      await ctx.runMutation(directAccess.recordReportingRunReadRaceDenial, {
        operation: "export_download",
        requestedStoreRef: String(args.storeId),
        storeId: args.storeId,
      });
      throw new Error(REPORTING_DIRECT_ACCESS_UNAVAILABLE);
    }
  },
});

async function removeExportArtifact(
  ctx: Pick<MutationCtx, "db" | "scheduler" | "storage">,
  runId: Id<"reportingRun">,
) {
  const run = await ctx.db.get("reportingRun", runId);
  if (
    !run ||
    run.runType !== "export" ||
    !run.expiresAt ||
    !shouldCleanupExportRun({
      expiresAt: run.expiresAt,
      now: Date.now(),
      status: run.status,
    })
  ) {
    return false;
  }
  if (run.resultStorageId) {
    await ctx.storage.delete(run.resultStorageId);
    await ctx.db.patch("reportingRun", run._id, { resultStorageId: undefined });
  }
  const chunks = await ctx.db
    .query("reportingExportChunk")
    .withIndex("by_runId_sequence", (q) => q.eq("runId", run._id))
    .take(EXPORT_PAGE_SIZE);
  for (const chunk of chunks) {
    await ctx.db.delete("reportingExportChunk", chunk._id);
  }
  if (chunks.length === EXPORT_PAGE_SIZE) {
    await ctx.scheduler.runAfter(
      0,
      internal.reporting.export.cleanupExportRun,
      { runId: run._id },
    );
    return true;
  }
  await ctx.db.patch("reportingRun", run._id, { status: "expired" });
  await ctx.db.insert("reportingRunEvent", {
    eventType: "expired",
    occurredAt: Date.now(),
    outcome: "cleaned",
    runId: run._id,
    sequence: 3,
    storeId: run.storeId,
  });
  return true;
}

export const cleanupExportRun = internalMutation({
  args: { runId: v.id("reportingRun") },
  returns: v.boolean(),
  handler: async (ctx, args) => removeExportArtifact(ctx, args.runId),
});

export const cleanupExpiredExports = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const now = Date.now();
    const candidates = (
      await Promise.all(
        (["completed", "failed", "cancelled"] as const).map((status) =>
          ctx.db
            .query("reportingRun")
            .withIndex("by_runType_status_expiresAt", (q) =>
              q
                .eq("runType", "export")
                .eq("status", status)
                .lte("expiresAt", now - 1),
            )
            .take(EXPORT_CLEANUP_BATCH_SIZE),
        ),
      )
    ).flat();
    let cleanedCount = 0;
    for (const run of candidates.slice(0, EXPORT_CLEANUP_BATCH_SIZE)) {
      if (await removeExportArtifact(ctx, run._id)) {
        cleanedCount += 1;
      }
    }
    return cleanedCount;
  },
});
