import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { v } from "convex/values";
import { generationCoverageIsActivatable } from "./coverage";
import { resolveReportingOperatingPeriodWithCtx } from "./operatingPeriods";
import { requirePosSourceReconciliationReadinessWithCtx } from "./maintenance/posSourceReconciliationGate";
import {
  currentSkuAttributionCursorWithCtx,
  unresolvedSkuAttributionConflictAtOrBeforeWithCtx,
} from "./skuAttributionSequence";
import type { ReportingMetricName } from "../../shared/reportingContract";

const POS_MIGRATION_METRICS: ReportingMetricName[] = [
  "gross_sales",
  "discounts",
  "net_sales",
  "refunds",
  "units_sold",
  "units_returned",
  "known_cogs",
  "uncosted_revenue",
  "gross_profit",
];

export type ProjectionGeneration = {
  contractVersion: number;
  generationId: string;
  metricVersion: number;
  reconciliationDifferenceCount: number;
  requiredCoverageComplete: boolean;
  stableWatermark: boolean;
  status:
    | "building"
    | "catching_up"
    | "reconciling"
    | "verified"
    | "superseded"
    | "failed";
};

type ActivationInput = {
  candidate: ProjectionGeneration;
  currentGenerationId: string | null;
  expectedCurrentGenerationId: string | null;
  requiredContractVersion: number;
  requiredMetricVersion: number;
};

function assertActivatable(
  candidate: ProjectionGeneration,
  requiredContractVersion: number,
  requiredMetricVersion: number,
) {
  if (candidate.status !== "verified") {
    throw new Error("candidate is not verified");
  }
  if (!candidate.requiredCoverageComplete) {
    throw new Error("candidate coverage is incomplete");
  }
  if (!candidate.stableWatermark) {
    throw new Error("candidate watermark is not stable");
  }
  if (candidate.reconciliationDifferenceCount !== 0) {
    throw new Error("candidate has unexplained reconciliation differences");
  }
  if (
    candidate.contractVersion !== requiredContractVersion ||
    candidate.metricVersion !== requiredMetricVersion
  ) {
    throw new Error("candidate version is incompatible");
  }
}

export function activateGeneration(input: ActivationInput) {
  if (input.currentGenerationId !== input.expectedCurrentGenerationId) {
    throw new Error("active generation changed");
  }
  assertActivatable(
    input.candidate,
    input.requiredContractVersion,
    input.requiredMetricVersion,
  );
  return {
    activatedGenerationId: input.candidate.generationId,
    supersededGenerationId: input.currentGenerationId,
  };
}

const CURRENT_INVENTORY_METRICS = new Set([
  "inventory_value",
  "on_hand_units",
  "sellable_units",
]);

export function unavailableCurrentInventoryCoverageIsActivatable(input: {
  candidate: {
    completeness: string;
    limitingReason?: string;
    projectionKind: string;
  };
  coverage: Array<{
    completeness: string;
    failedCount: number;
    limitingReason?: string;
    metric: string;
    omittedCount: number;
    quarantinedCount: number;
    sourceDomain: string;
    truncated: boolean;
  }>;
  discrepancyCount: number;
  hasProjectionRows: boolean;
}) {
  return (
    input.candidate.projectionKind === "current_inventory" &&
    input.candidate.completeness === "unavailable" &&
    input.candidate.limitingReason === "source_incomplete" &&
    input.discrepancyCount === 0 &&
    !input.hasProjectionRows &&
    input.coverage.length === CURRENT_INVENTORY_METRICS.size &&
    input.coverage.every(
      (row) =>
        CURRENT_INVENTORY_METRICS.has(row.metric) &&
        row.sourceDomain === "inventory" &&
        row.completeness === "unavailable" &&
        row.limitingReason === "source_incomplete" &&
        row.failedCount === 0 &&
        row.omittedCount === 0 &&
        row.quarantinedCount === 0 &&
        row.truncated === false,
    ) &&
    new Set(input.coverage.map((row) => row.metric)).size ===
      CURRENT_INVENTORY_METRICS.size
  );
}

async function activationCoverageWithCtx(
  ctx: MutationCtx,
  candidate: Doc<"reportingProjectionGeneration">,
  sourceScope?: "pos",
) {
  const [discrepancies, coverage, currentInventoryProjections] = await Promise.all([
    ctx.db
      .query("reportingReconciliationDiscrepancy")
      .withIndex("by_generationId", (q) => q.eq("generationId", candidate._id))
      .take(1),
    ctx.db
      .query("reportingMetricCoverage")
      .withIndex("by_generationId_metric_sourceDomain", (q) =>
        q.eq("generationId", candidate._id),
      )
      .take(500),
    candidate.projectionKind === "current_inventory"
      ? ctx.db
          .query("reportingCurrentValuationProjection")
          .withIndex("by_generationId_productSkuId_metric", (q) =>
            q.eq("generationId", candidate._id),
          )
          .take(1)
      : Promise.resolve([]),
  ]);
  const unavailableCoverageReady =
    unavailableCurrentInventoryCoverageIsActivatable({
      candidate,
      coverage,
      discrepancyCount: discrepancies.length,
      hasProjectionRows: currentInventoryProjections.length > 0,
    });
  return {
    coverageReady: generationCoverageIsActivatable({
      coverage: coverage.map((row) => ({
        completeness: row.completeness,
        failedCount: row.failedCount,
        knownLagMs: row.knownLagMs,
        limitingReason: row.limitingReason ?? null,
        metric: row.metric,
        omittedCount: row.omittedCount,
        quarantinedCount: row.quarantinedCount,
        sourceDomain: row.sourceDomain,
        truncated: row.truncated,
      })),
      ...(sourceScope === "pos" && candidate.projectionKind !== "current_inventory"
        ? {
            metrics: POS_MIGRATION_METRICS,
            requiredSourceDomains: ["pos"],
          }
        : {}),
      projectionKind: candidate.projectionKind,
    }) || unavailableCoverageReady,
    discrepancyCount: discrepancies.length,
  };
}

export function identityMigrationRunIsActivationReady(
  run: Pick<
    Doc<"reportingIdentityMigrationRun">,
    "conflictCount" | "coverageComplete" | "operation" | "status"
  > | null,
) {
  return Boolean(
    run &&
    run.operation === "apply" &&
    run.status === "completed" &&
    run.coverageComplete === true &&
    run.conflictCount === 0,
  );
}

async function requireIdentityMigrationReadinessWithCtx(ctx: MutationCtx) {
  const completedRuns = await ctx.db
    .query("reportingIdentityMigrationRun")
    .withIndex("by_operation_status_completedAt", (q) =>
      q.eq("operation", "apply").eq("status", "completed"),
    )
    .order("desc")
    .take(1);
  const completedRun = completedRuns[0];
  if (!identityMigrationRunIsActivationReady(completedRun ?? null)) {
    throw new Error("Reporting identity migration is not ready for activation");
  }
  const missingNormalizedIdentity = await ctx.db
    .query("athenaUser")
    .withIndex("by_normalizedEmail", (q) => q.eq("normalizedEmail", undefined))
    .first();
  if (missingNormalizedIdentity) {
    throw new Error("Reporting identity migration is not ready for activation");
  }
  return completedRun;
}

export function assertActivationRunLineage(
  candidate: Doc<"reportingProjectionGeneration">,
  run: Doc<"reportingRun">,
) {
  if (
    candidate.runId !== run._id ||
    run.generationId !== candidate._id ||
    run.storeId !== candidate.storeId ||
    run.organizationId !== candidate.organizationId ||
    run.domain !== "reporting" ||
    run.runType !== "rebuild" ||
    run.status !== "completed" ||
    run.completedAt === undefined ||
    candidate.verifiedAt === undefined ||
    run.factContractVersion !== candidate.factContractVersion ||
    run.metricContractVersion !== candidate.metricContractVersion ||
    run.projectionContractVersion !== candidate.projectionContractVersion ||
    run.frozenWatermark !== candidate.stableWatermark ||
    !activationOperationMatchesProjectionKind(
      run.operation,
      candidate.projectionKind,
    )
  ) {
    throw new Error("Reporting activation lineage is incompatible");
  }
}

export function activationOperationMatchesProjectionKind(
  operation: string,
  projectionKind: Doc<"reportingProjectionGeneration">["projectionKind"],
) {
  if (
    projectionKind === "store_day" ||
    projectionKind === "store_intraday" ||
    projectionKind === "sku_day"
  ) {
    return (
      operation.startsWith("projection_rebuild_") ||
      operation === "projection_reconciliation_finalize"
    );
  }
  if (projectionKind === "current_inventory") {
    return operation.startsWith("current_inventory_rebuild_");
  }
  if (projectionKind === "attention") {
    return operation.startsWith("attention_generation_");
  }
  if (projectionKind === "custom_range") {
    return operation === "custom_range";
  }
  return operation.startsWith("storefront_engagement_");
}

async function assertActiveDerivedSourceLineageWithCtx(
  ctx: MutationCtx,
  input: {
    candidate: Doc<"reportingProjectionGeneration">;
    run: Doc<"reportingRun">;
  },
) {
  const sourceGenerationIds =
    input.run.sourceGenerationIds ??
    (input.run.sourceGenerationId ? [input.run.sourceGenerationId] : []);
  if (sourceGenerationIds.length === 0) {
    throw new Error("Reporting derived source lineage is unavailable");
  }
  const sourceGenerations = await Promise.all(
    sourceGenerationIds.map((generationId) =>
      ctx.db.get("reportingProjectionGeneration", generationId),
    ),
  );
  for (const sourceGeneration of sourceGenerations) {
    if (
      !sourceGeneration ||
      sourceGeneration.storeId !== input.candidate.storeId ||
      sourceGeneration.organizationId !== input.candidate.organizationId ||
      sourceGeneration.status !== "active" ||
      sourceGeneration.stableWatermark === undefined ||
      sourceGeneration.factContractVersion !==
        input.candidate.factContractVersion ||
      sourceGeneration.metricContractVersion !==
        input.candidate.metricContractVersion ||
      sourceGeneration.projectionContractVersion !==
        input.candidate.projectionContractVersion
    ) {
      throw new Error("Reporting derived source lineage is incompatible");
    }
    const activation = await ctx.db
      .query("reportingProjectionActivation")
      .withIndex("by_storeId_projectionKind_activatedAt", (q) =>
        q
          .eq("storeId", sourceGeneration.storeId)
          .eq("projectionKind", sourceGeneration.projectionKind),
      )
      .order("desc")
      .first();
    if (
      !activation ||
      activation.generationId !== sourceGeneration._id ||
      activation.supersededAt !== undefined
    ) {
      throw new Error("Reporting derived source lineage is no longer active");
    }
  }
  const sourceWatermark = Math.min(
    ...sourceGenerations.map((generation) => generation!.stableWatermark!),
  );
  if (sourceWatermark !== input.candidate.stableWatermark) {
    throw new Error("Reporting derived source watermark is incompatible");
  }
}

async function assertNoPostVerificationWritesWithCtx(
  ctx: MutationCtx,
  input: {
    candidate: Doc<"reportingProjectionGeneration">;
    run: Doc<"reportingRun">;
  },
) {
  const stableWatermark = input.candidate.stableWatermark;
  if (stableWatermark === undefined) {
    throw new Error("candidate watermark is not stable");
  }
  const freshnessAuthority = activationFreshnessAuthority(
    input.candidate.projectionKind,
  );
  if (freshnessAuthority === "facts") {
    const laterFact = await ctx.db
      .query("reportingFact")
      .withIndex("by_storeId", (q) =>
        q
          .eq("storeId", input.candidate.storeId)
          .gt("_creationTime", stableWatermark),
      )
      .first();
    if (laterFact) {
      throw new Error("Reporting candidate is stale at activation");
    }
    return;
  }
  if (freshnessAuthority === "inventory_positions") {
    const laterRevision = await findAuthoritativeInventoryRevisionAfterWithCtx(
      ctx,
      {
        stableWatermark,
        storeId: input.candidate.storeId,
      },
    );
    if (laterRevision) {
      throw new Error("Reporting candidate is stale at activation");
    }
    return;
  }
  if (freshnessAuthority === "source_generations") {
    await assertActiveDerivedSourceLineageWithCtx(ctx, input);
  }
}

export async function findAuthoritativeInventoryRevisionAfterWithCtx(
  ctx: Pick<MutationCtx, "db">,
  input: { stableWatermark: number; storeId: Id<"store"> },
) {
  const revisions = await ctx.db
    .query("reportingInventoryPositionRevision")
    .withIndex("by_storeId", (q) =>
      q
        .eq("storeId", input.storeId)
        .gt("_creationTime", input.stableWatermark),
    )
    .take(101);
  if (revisions.length > 100) {
    throw new Error("Authoritative inventory freshness evidence is truncated");
  }
  for (const revision of revisions) {
    const position = await ctx.db.get(
      "reportingInventoryPosition",
      revision.positionId,
    );
    if (!position || position.mode === "authoritative") return revision;
  }
  return null;
}

export function activationFreshnessAuthority(
  projectionKind: Doc<"reportingProjectionGeneration">["projectionKind"],
) {
  if (
    projectionKind === "store_day" ||
    projectionKind === "sku_day" ||
    projectionKind === "storefront_engagement"
  ) {
    return "facts" as const;
  }
  if (projectionKind === "current_inventory") {
    return "inventory_positions" as const;
  }
  return "source_generations" as const;
}

async function scheduleDerivedRefreshes(
  ctx: MutationCtx,
  input: {
    projectionKind: "sku_day" | "current_inventory" | "attention" | string;
    storeId: Id<"store">;
  },
) {
  if (
    input.projectionKind !== "sku_day" &&
    input.projectionKind !== "current_inventory" &&
    input.projectionKind !== "attention"
  ) {
    return;
  }
  const reportingPeriod = await resolveReportingOperatingPeriodWithCtx(ctx, {
    occurrenceAt: Date.now(),
    storeId: input.storeId,
  });
  if (reportingPeriod.kind !== "resolved") return;
  await ctx.scheduler.runAfter(
    0,
    (internal as any).reporting.projections.skuInsights
      .refreshActiveSkuInsightPage,
    { operatingDate: reportingPeriod.operatingDate, storeId: input.storeId },
  );
  if (
    input.projectionKind === "sku_day" ||
    input.projectionKind === "current_inventory"
  ) {
    await ctx.scheduler.runAfter(
      0,
      (internal as any).reporting.projections.attention
        .startAttentionGeneration,
      {
        automationIdentity: "reporting-derived-activation",
        storeId: input.storeId,
      },
    );
  }
}

export const activateVerifiedGeneration = internalMutation({
  args: {
    activatedByUserId: v.optional(v.id("athenaUser")),
    candidateGenerationId: v.id("reportingProjectionGeneration"),
    expectedPriorGenerationId: v.optional(
      v.id("reportingProjectionGeneration"),
    ),
    runId: v.id("reportingRun"),
  },
  handler: async (ctx, args) => {
    const [candidate, run] = await Promise.all([
      ctx.db.get("reportingProjectionGeneration", args.candidateGenerationId),
      ctx.db.get("reportingRun", args.runId),
    ]);
    if (!candidate || !run) {
      throw new Error("Reporting activation input is unavailable");
    }
    if (candidate.status !== "verified") {
      throw new Error("candidate is not verified");
    }
    assertActivationRunLineage(candidate, run);
    if (run.expectedPriorGenerationId !== args.expectedPriorGenerationId) {
      throw new Error("Reporting activation lineage is incompatible");
    }
    await requireIdentityMigrationReadinessWithCtx(ctx);
    await requirePosSourceReconciliationReadinessWithCtx(ctx, {
      candidate,
      run,
    });
    await assertNoPostVerificationWritesWithCtx(ctx, { candidate, run });
    if (
      candidate.projectionKind === "sku_day" &&
      candidate.skuAttributionTerminalSequence !== undefined
    ) {
      const attributionCursor = await currentSkuAttributionCursorWithCtx(
        ctx,
        candidate.storeId,
      );
      const unresolvedAttributionConflict =
        await unresolvedSkuAttributionConflictAtOrBeforeWithCtx(ctx, {
          storeId: candidate.storeId,
          terminalSequence: candidate.skuAttributionTerminalSequence,
        });
      if (
        attributionCursor?.latestMaterialSequence !==
          candidate.skuAttributionTerminalSequence ||
        attributionCursor.latestAppliedSequence !==
          candidate.skuAttributionTerminalSequence ||
        unresolvedAttributionConflict
      ) {
        throw new Error("SKU attribution refresh was superseded");
      }
    }
    const currentActivation = await ctx.db
      .query("reportingProjectionActivation")
      .withIndex("by_storeId_projectionKind_activatedAt", (q) =>
        q
          .eq("storeId", candidate.storeId)
          .eq("projectionKind", candidate.projectionKind),
      )
      .order("desc")
      .first();
    const currentGeneration = currentActivation
      ? await ctx.db.get(
          "reportingProjectionGeneration",
          currentActivation.generationId,
        )
      : null;
    if (
      currentActivation &&
      (currentActivation.supersededAt !== undefined ||
        !currentGeneration ||
        currentGeneration.status !== "active" ||
        currentGeneration.storeId !== candidate.storeId ||
        currentGeneration.organizationId !== candidate.organizationId ||
        currentGeneration.projectionKind !== candidate.projectionKind ||
        currentActivation.storeId !== candidate.storeId ||
        currentActivation.organizationId !== candidate.organizationId ||
        currentActivation.projectionKind !== candidate.projectionKind)
    ) {
      throw new Error("active generation changed");
    }
    const { coverageReady, discrepancyCount } = await activationCoverageWithCtx(
      ctx,
      candidate,
      run.sourceScope,
    );
    activateGeneration({
      candidate: {
        contractVersion: candidate.projectionContractVersion,
        generationId: String(candidate._id),
        metricVersion: candidate.metricContractVersion,
        reconciliationDifferenceCount: discrepancyCount,
        requiredCoverageComplete:
          (candidate.completeness === "complete" && coverageReady) ||
          (candidate.completeness === "unavailable" && coverageReady),
        stableWatermark: candidate.stableWatermark !== undefined,
        status: "verified",
      },
      currentGenerationId: currentActivation
        ? String(currentActivation.generationId)
        : null,
      expectedCurrentGenerationId: args.expectedPriorGenerationId
        ? String(args.expectedPriorGenerationId)
        : null,
      requiredContractVersion: run.projectionContractVersion,
      requiredMetricVersion: run.metricContractVersion,
    });
    const now = Date.now();
    if (currentActivation) {
      await ctx.db.patch(
        "reportingProjectionActivation",
        currentActivation._id,
        { supersededAt: now },
      );
      await ctx.db.patch(
        "reportingProjectionGeneration",
        currentActivation.generationId,
        { status: "superseded", supersededAt: now },
      );
    }
    const activationId = await ctx.db.insert("reportingProjectionActivation", {
      activatedAt: now,
      activatedByUserId: args.activatedByUserId,
      activationRunId: args.runId,
      expectedPriorGenerationId: args.expectedPriorGenerationId,
      factContractVersion: candidate.factContractVersion,
      generationId: candidate._id,
      metricContractVersion: candidate.metricContractVersion,
      organizationId: candidate.organizationId,
      priorGenerationId: currentActivation?.generationId,
      projectionContractVersion: candidate.projectionContractVersion,
      projectionKind: candidate.projectionKind,
      storeId: candidate.storeId,
    });
    await ctx.db.patch("reportingProjectionGeneration", candidate._id, {
      activatedAt: now,
      status: "active",
    });
    await scheduleDerivedRefreshes(ctx, candidate);
    if (candidate.projectionKind === "store_day") {
      await ctx.scheduler.runAfter(0, (internal as any).reporting.projections.storeIntraday.startActiveStoreIntradaySchedule, { sourceGenerationId: candidate._id });
      await ctx.scheduler.runAfter(0, (internal as any).reporting.projections.storeIntraday.rebuildHistoricalStoreIntradayPage, { sourceGenerationId: candidate._id });
    }
    if (candidate.projectionKind === "store_day" || candidate.projectionKind === "sku_day" || candidate.projectionKind === "current_inventory") {
      await ctx.scheduler.runAfter(
        0,
        (internal as any).reporting.readModels.materialize.startReportsWorkspaceMaterialization,
        { generationId: candidate._id },
      );
    }
    return activationId;
  },
});
