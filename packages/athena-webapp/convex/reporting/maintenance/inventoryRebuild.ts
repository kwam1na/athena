import { v } from "convex/values";
import { internal } from "../../_generated/api";
import type { Doc } from "../../_generated/dataModel";
import {
  internalAction,
  internalMutation,
  type MutationCtx,
} from "../../_generated/server";
import {
  REPORTING_FACT_CONTRACT_VERSION,
  REPORTING_PROJECTION_CONTRACT_VERSION,
} from "../../../shared/reportingContract";
import { projectInventoryPositionWithCtx } from "../projections/inventory";
import { materializeGenerationCoverageWithCtx } from "../coverage";
import { upsertProjectionHealthWithCtx } from "../health";
import { startOrResumeOccurrenceReplayWithCtx } from "../inventory/occurrenceReplay";
import { assertReportingRunTransition } from "./runLedger";

const inventoryRebuildInternal = (internal as any).reporting.maintenance
  .inventoryRebuild;
const INVENTORY_REBUILD_PAGE_SIZE = 20;

type ContractVersions = {
  factContractVersion: number;
  metricContractVersion: number;
  projectionContractVersion: number;
};

export function assessCurrentInventoryCandidate(input: {
  baseline: { sourceWatermark: number; status: string } | null;
  baselineRun: (ContractVersions & { frozenWatermark?: number }) | null;
  deficitEvidenceComplete?: boolean;
  deficitLotQuantity: number;
  frozenWatermark: number;
  positionCommittedAt: number | null;
  position: {
    lastEffectAt: number;
    mode: "authoritative" | "compatibility_shadow";
    onHandQuantity: number;
    sellableQuantity: number;
    unresolvedDeficitQuantity: number;
    valuationStatus?: "current" | "rebuild_required";
  } | null;
  productSku: {
    inventoryCount: number;
    quantityAvailable: number;
  } | null;
  runVersions: ContractVersions;
}) {
  const reject = (reason: string) => ({ reason, status: "rejected" as const });
  if (!input.position) {
    return reject("missing_inventory_position");
  }
  if (!input.baseline || input.baseline.status !== "accepted") {
    return reject("missing_accepted_baseline");
  }
  if (
    input.baseline.sourceWatermark > input.frozenWatermark ||
    input.baselineRun?.frozenWatermark !== input.baseline.sourceWatermark
  ) {
    return reject("baseline_after_frozen_watermark");
  }
  if (
    !input.baselineRun ||
    input.baselineRun.factContractVersion !==
      input.runVersions.factContractVersion ||
    input.baselineRun.metricContractVersion !==
      input.runVersions.metricContractVersion ||
    input.baselineRun.projectionContractVersion !==
      input.runVersions.projectionContractVersion
  ) {
    return reject("baseline_version_incompatible");
  }
  if (input.positionCommittedAt === null) {
    return reject("missing_position_revision");
  }
  if (input.positionCommittedAt > input.frozenWatermark) {
    return reject("position_after_frozen_watermark");
  }
  if (input.position.valuationStatus === "rebuild_required") {
    return reject("occurrence_order_rebuild_required");
  }
  if (
    !input.productSku ||
    input.position.onHandQuantity !== input.productSku.inventoryCount ||
    input.position.sellableQuantity !== input.productSku.quantityAvailable
  ) {
    return reject("product_sku_reconciliation_drift");
  }
  if (input.deficitEvidenceComplete === false) {
    return reject("deficit_evidence_truncated");
  }
  if (input.position.unresolvedDeficitQuantity !== input.deficitLotQuantity) {
    return reject("deficit_reconciliation_drift");
  }
  return { reason: null, status: "candidate_complete" as const };
}

async function assessSkuWithCtx(
  ctx: MutationCtx,
  input: {
    frozenWatermark: number;
    run: Doc<"reportingRun">;
    sku: Doc<"productSku">;
  },
) {
  const [baselines, positions] = await Promise.all([
    ctx.db
      .query("reportingCutoverBaseline")
      .withIndex("by_storeId_productSkuId_status", (q) =>
        q
          .eq("storeId", input.run.storeId)
          .eq("productSkuId", input.sku._id)
          .eq("status", "accepted"),
      )
      .take(2),
    ctx.db
      .query("reportingInventoryPosition")
      .withIndex("by_storeId_productSkuId", (q) =>
        q.eq("storeId", input.run.storeId).eq("productSkuId", input.sku._id),
      )
      .take(2),
  ]);
  if (baselines.length > 1) {
    return {
      assessment: {
        reason: "multiple_accepted_baselines",
        status: "rejected" as const,
      },
      position: positions[0] ?? null,
    };
  }
  if (positions.length > 1) {
    return {
      assessment: {
        reason: "multiple_inventory_positions",
        status: "rejected" as const,
      },
      position: positions[0] ?? null,
    };
  }
  const position = positions[0] ?? null;
  const positionRevision = position
    ? await ctx.db
        .query("reportingInventoryPositionRevision")
        .withIndex("by_positionId", (q) => q.eq("positionId", position._id))
        .order("desc")
        .first()
    : null;
  if (
    positionRevision &&
    (positionRevision.storeId !== input.run.storeId ||
      positionRevision.productSkuId !== input.sku._id)
  ) {
    return {
      assessment: {
        reason: "position_revision_ownership_mismatch",
        status: "rejected" as const,
      },
      position,
    };
  }
  const baselineRun = baselines[0]
    ? await ctx.db.get("reportingRun", baselines[0].runId)
    : null;
  const deficitLots = position?.deficitLedgerId
    ? await ctx.db
        .query("reportingInventoryDeficitLot")
        .withIndex(
          "by_ledgerId_status_occurredAt_outboundEffectId",
          (q) =>
            q
              .eq("ledgerId", position.deficitLedgerId)
              .eq("status", "open"),
        )
        .take(101)
    : position
      ? await ctx.db
          .query("reportingInventoryDeficitLot")
          .withIndex("by_positionId_status_occurredAt", (q) =>
            q.eq("positionId", position._id).eq("status", "open"),
          )
          .take(101)
      : [];
  return {
    assessment: assessCurrentInventoryCandidate({
      baseline: baselines[0] ?? null,
      baselineRun,
      deficitEvidenceComplete: deficitLots.length <= 100,
      deficitLotQuantity: deficitLots.reduce(
        (sum, lot) => sum + lot.remainingQuantity,
        0,
      ),
      frozenWatermark: input.frozenWatermark,
      positionCommittedAt: positionRevision?._creationTime ?? null,
      position,
      productSku: input.sku,
      runVersions: input.run,
    }),
    position,
  };
}

async function recordRebuildDiscrepancy(
  ctx: MutationCtx,
  input: {
    generation: Doc<"reportingProjectionGeneration">;
    position: Doc<"reportingInventoryPosition"> | null;
    productSku: Doc<"productSku">;
    reason: string;
    run: Doc<"reportingRun">;
  },
) {
  const reconciliationKey = `${input.reason}:sku:${input.productSku._id}`;
  const value = {
    actualMinorOrQuantity:
      input.position?.onHandQuantity ?? input.productSku.inventoryCount,
    detectedAt: Date.now(),
    explainedDifference: 0,
    expectedMinorOrQuantity: input.productSku.inventoryCount,
    generationId: input.generation._id,
    invariant: input.reason,
    organizationId: input.run.organizationId,
    productSkuId: input.productSku._id,
    reconciliationKey,
    runId: input.run._id,
    status: "open" as const,
    storeId: input.run.storeId,
    unexplainedDifference: 1,
  };
  const existing = await ctx.db
    .query("reportingReconciliationDiscrepancy")
    .withIndex("by_runId_reconciliationKey", (q) =>
      q.eq("runId", input.run._id).eq("reconciliationKey", reconciliationKey),
    )
    .first();
  if (existing) {
    await ctx.db.patch(
      "reportingReconciliationDiscrepancy",
      existing._id,
      value,
    );
  } else {
    await ctx.db.insert("reportingReconciliationDiscrepancy", value);
  }
}

export const startCurrentInventoryRebuild = internalMutation({
  args: {
    automationIdentity: v.string(),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    const store = await ctx.db.get("store", args.storeId);
    if (!store) throw new Error("Store not found");
    const currentActivation = await ctx.db
      .query("reportingProjectionActivation")
      .withIndex("by_storeId_projectionKind_activatedAt", (q) =>
        q.eq("storeId", args.storeId).eq("projectionKind", "current_inventory"),
      )
      .order("desc")
      .first();
    const now = Date.now();
    const frozenWatermark = Math.max(0, now - 1);
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
      operation: "current_inventory_rebuild_building",
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
      projectionKind: "current_inventory",
      runId,
      sourceWatermark: frozenWatermark,
      status: "building",
      storeId: args.storeId,
    });
    await ctx.db.patch("reportingRun", runId, { generationId });
    await ctx.scheduler.runAfter(
      0,
      inventoryRebuildInternal.processCurrentInventoryRebuildBatch,
      { runId },
    );
    return { generationId, runId };
  },
});

export const processCurrentInventoryRebuildBatchMutation = internalMutation({
  args: { runId: v.id("reportingRun") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get("reportingRun", args.runId);
    if (
      !run ||
      !run.generationId ||
      run.runType !== "rebuild" ||
      run.frozenWatermark === undefined ||
      ["paused", "cancelled", "completed"].includes(run.status)
    ) {
      return;
    }
    const generation = await ctx.db.get(
      "reportingProjectionGeneration",
      run.generationId,
    );
    if (!generation || generation.projectionKind !== "current_inventory") {
      throw new Error("Current inventory generation not found");
    }
    const catchingUp =
      run.operation === "current_inventory_rebuild_catching_up";
    const page = await ctx.db
      .query("productSku")
      .withIndex("by_storeId", (q) => q.eq("storeId", run.storeId))
      .paginate({
        cursor: run.cursor ?? null,
        numItems: INVENTORY_REBUILD_PAGE_SIZE,
      });
    let batchFailed = 0;
    let repairPending = false;
    for (const productSku of page.page) {
      if (productSku._creationTime > run.frozenWatermark) continue;
      const { assessment, position } = await assessSkuWithCtx(ctx, {
        frozenWatermark: run.frozenWatermark,
        run,
        sku: productSku,
      });
      if (assessment.reason === "position_after_frozen_watermark") continue;
      if (
        assessment.reason === "occurrence_order_rebuild_required" &&
        position
      ) {
        await startOrResumeOccurrenceReplayWithCtx(ctx, {
          organizationId: run.organizationId,
          positionId: position._id,
          productSkuId: productSku._id,
          storeId: run.storeId,
        });
        repairPending = true;
        continue;
      }
      if (assessment.status === "rejected") {
        batchFailed += 1;
        await recordRebuildDiscrepancy(ctx, {
          generation,
          position,
          productSku,
          reason: assessment.reason,
          run,
        });
        continue;
      }
      if (!position) throw new Error("Candidate position disappeared");
      await projectInventoryPositionWithCtx(ctx, {
        asOf: position.lastEffectAt,
        completeness: position.uncostedQuantity > 0 ? "partial" : "complete",
        generation,
        position,
        sourceWatermark: run.frozenWatermark,
      });
    }
    const processedCount = run.processedCount + page.page.length;
    const failedCount = run.failedCount + batchFailed;
    if (repairPending) {
      await ctx.db.patch("reportingRun", run._id, {
        startedAt: run.startedAt ?? Date.now(),
        status: "running",
      });
      await ctx.scheduler.runAfter(
        1_000,
        inventoryRebuildInternal.processCurrentInventoryRebuildBatch,
        { runId: run._id },
      );
      return;
    }
    if (!page.isDone) {
      await ctx.db.patch("reportingRun", run._id, {
        cursor: page.continueCursor,
        failedCount,
        processedCount,
        startedAt: run.startedAt ?? Date.now(),
        status: "running",
      });
      await ctx.scheduler.runAfter(
        0,
        inventoryRebuildInternal.processCurrentInventoryRebuildBatch,
        { runId: run._id },
      );
      return;
    }
    if (failedCount > 0) {
      const completedAt = Date.now();
      await ctx.db.patch("reportingProjectionGeneration", generation._id, {
        completeness: "partial",
        limitingReason: "reconciliation_drift",
        status: "failed",
      });
      await ctx.db.patch("reportingRun", run._id, {
        completedAt,
        failedCount,
        processedCount,
        status: "failed",
      });
      return;
    }
    if (!catchingUp) {
      const nextWatermark = Math.max(run.frozenWatermark, Date.now() - 1);
      await ctx.db.patch("reportingProjectionGeneration", generation._id, {
        sourceWatermark: nextWatermark,
        status: "catching_up",
      });
      await ctx.db.patch("reportingRun", run._id, {
        cursor: undefined,
        frozenWatermark: nextWatermark,
        operation: "current_inventory_rebuild_catching_up",
        periodStart: run.frozenWatermark,
        processedCount,
        startedAt: run.startedAt ?? Date.now(),
        status: "running",
      });
      await ctx.scheduler.runAfter(
        0,
        inventoryRebuildInternal.processCurrentInventoryRebuildBatch,
        { runId: run._id },
      );
      return;
    }
    const laterRevision = await ctx.db
      .query("reportingInventoryPositionRevision")
      .withIndex("by_storeId", (q) =>
        q.eq("storeId", run.storeId).gt("_creationTime", run.frozenWatermark!),
      )
      .first();
    if (laterRevision) {
      const nextWatermark = Math.max(run.frozenWatermark, Date.now() - 1);
      await ctx.db.patch("reportingProjectionGeneration", generation._id, {
        sourceWatermark: nextWatermark,
      });
      await ctx.db.patch("reportingRun", run._id, {
        cursor: undefined,
        frozenWatermark: nextWatermark,
        periodStart: run.frozenWatermark,
        processedCount,
      });
      await ctx.scheduler.runAfter(
        0,
        inventoryRebuildInternal.processCurrentInventoryRebuildBatch,
        { runId: run._id },
      );
      return;
    }
    const completedAt = Date.now();
    await materializeGenerationCoverageWithCtx(ctx, {
      defaultCompleteness: "complete",
      generation,
      periodEnd: run.frozenWatermark,
      periodStart: run.createdAt,
    });
    await ctx.db.patch("reportingProjectionGeneration", generation._id, {
      completeness: "complete",
      limitingReason: undefined,
      sourceWatermark: run.frozenWatermark,
      stableWatermark: run.frozenWatermark,
      status: "verified",
      verifiedAt: completedAt,
    });
    await ctx.db.patch("reportingRun", run._id, {
      completedAt,
      failedCount: 0,
      processedCount,
      status: "completed",
    });
    await upsertProjectionHealthWithCtx(ctx, {
      factContractVersion: generation.factContractVersion,
      latestSuccessfulReconciliationAt: completedAt,
      metricContractVersion: generation.metricContractVersion,
      organizationId: generation.organizationId,
      processingWatermark: run.frozenWatermark,
      projectionContractVersion: generation.projectionContractVersion,
      projectionKind: "current_inventory",
      quarantinedCount: 0,
      sourceDomain: "inventory",
      storeId: run.storeId,
      updatedAt: completedAt,
    });
  },
});

export const recordCurrentInventoryRebuildFailure = internalMutation({
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
    if (!generation || generation.projectionKind !== "current_inventory") {
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
      eventType: "current_inventory_rebuild_failed",
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

export const processCurrentInventoryRebuildBatch = internalAction({
  args: { runId: v.id("reportingRun") },
  handler: async (ctx, args) => {
    try {
      await ctx.runMutation(
        inventoryRebuildInternal.processCurrentInventoryRebuildBatchMutation,
        args,
      );
    } catch {
      await ctx.runMutation(
        inventoryRebuildInternal.recordCurrentInventoryRebuildFailure,
        {
          runId: args.runId,
          safeReason: "current_inventory_rebuild_worker_failed",
        },
      );
    }
  },
});

export const controlCurrentInventoryRebuild = internalMutation({
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
      generation.projectionKind !== "current_inventory"
    ) {
      throw new Error("Current inventory rebuild run not found");
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
        status:
          run.operation === "current_inventory_rebuild_catching_up"
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
      eventType: `current_inventory_rebuild_${args.action}`,
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
        inventoryRebuildInternal.processCurrentInventoryRebuildBatch,
        { runId: run._id },
      );
    }
  },
});
