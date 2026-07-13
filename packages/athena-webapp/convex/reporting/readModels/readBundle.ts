import { internalMutation, type QueryCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { v } from "convex/values";
import {
  REPORTING_FACT_CONTRACT_VERSION,
  REPORTING_PROJECTION_CONTRACT_VERSION,
} from "../../../shared/reportingContract";
import { requireAuthorizedLineageWithCtx } from "../maintenance/authorizedPosBackfill";
import {
  findLatePreWatermarkPosJournalEvidenceWithCtx,
} from "../maintenance/posSourceReconciliationGate";
import { currentSkuAttributionCursorWithCtx } from "../skuAttributionSequence";

const REQUIRED_KINDS = ["store_day", "sku_day", "current_inventory"] as const;

export function skuAttributionTerminalCanActivate(input: {
  cursor: {
    latestAppliedSequence?: number;
    latestMaterialSequence: number;
  } | null;
  terminal?: number;
}) {
  return input.cursor
    ? input.terminal !== undefined &&
        input.cursor.latestMaterialSequence === input.terminal &&
        input.cursor.latestAppliedSequence === input.terminal
    : input.terminal === undefined;
}

export function skuAttributionTerminalIsCurrent(input: {
  cursor: null | {
    latestActivatedSequence?: number;
    latestAppliedSequence?: number;
    latestMaterialSequence: number;
  };
  terminal?: number;
}) {
  if (!input.cursor) return input.terminal === undefined;
  return (
    input.terminal !== undefined &&
    input.cursor.latestMaterialSequence === input.terminal &&
    input.cursor.latestAppliedSequence === input.terminal &&
    input.cursor.latestActivatedSequence === input.terminal
  );
}

type BundleMember = {
  generation: Doc<"reportingProjectionGeneration">;
  epoch: Doc<"reportingWorkspaceMaterializationEpoch">;
  run: Doc<"reportingRun">;
};

async function bundleCertificateIsReadableWithCtx(
  ctx: Pick<QueryCtx, "db">,
  bundle: Doc<"reportingReadBundle">,
) {
  const reconciliation = await ctx.db.get(
    "reportingPosSourceReconciliation",
    bundle.reconciliationId,
  );
  if (
    !reconciliation ||
    reconciliation.status !== "verified" ||
    reconciliation.completedAt === undefined ||
    reconciliation.organizationId !== bundle.organizationId ||
    reconciliation.storeId !== bundle.storeId ||
    reconciliation.grantId !== bundle.grantId ||
    reconciliation.censusToken !== bundle.censusToken ||
    reconciliation.sourceCensusHash !== bundle.sourceCensusHash ||
    reconciliation.factSnapshotWatermark !== bundle.sourceWatermark ||
    reconciliation.unexplainedCount !== 0
  ) {
    return null;
  }
  const sourceRun = await ctx.db.get("reportingRun", reconciliation.runId);
  if (
    !sourceRun ||
    sourceRun.runType !== "backfill" ||
    sourceRun.status !== "completed" ||
    sourceRun.organizationId !== bundle.organizationId ||
    sourceRun.storeId !== bundle.storeId ||
    sourceRun.backfillAuthorizationGrantId !== bundle.grantId ||
    sourceRun.censusToken !== bundle.censusToken ||
    sourceRun.sourceCensusHash !== bundle.sourceCensusHash ||
    sourceRun.factSnapshotWatermark !== bundle.sourceWatermark ||
    (reconciliation.orphanPaymentCorrectionCount ?? 0) !==
      (sourceRun.orphanPaymentCorrectionCount ?? 0) ||
    sourceRun.frozenWatermark === undefined
  ) {
    return null;
  }
  const terminalSequence = reconciliation.lifecycleJournalTerminalRecordedAt;
  const lateEvidence = await ctx.db
    .query("posLifecycleJournal")
    .withIndex("by_storeId_sequence", (q) => {
      const store = q.eq("storeId", bundle.storeId);
      return terminalSequence === undefined
        ? store
        : store.gt("sequence", terminalSequence);
    })
    .filter((q) => q.lte(q.field("occurredAt"), sourceRun.frozenWatermark!))
    .first();
  return lateEvidence ? null : { reconciliation, sourceRun };
}

function fnv1a(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function assertReadBundleMembers(input: {
  members: BundleMember[];
  reconciliation: Doc<"reportingPosSourceReconciliation">;
}) {
  const ordered = [...input.members].sort((left, right) =>
    left.generation.projectionKind.localeCompare(right.generation.projectionKind),
  );
  const kinds = ordered.map(({ generation }) => generation.projectionKind);
  if (
    ordered.length !== REQUIRED_KINDS.length ||
    REQUIRED_KINDS.some((kind) => !kinds.includes(kind))
  ) {
    throw new Error("Reports read bundle requires every projection member");
  }
  const first = ordered[0]!;
  for (const { generation, epoch, run } of ordered) {
    if (
      generation.status !== "active" ||
      generation.stableWatermark === undefined ||
      epoch.status !== "active" ||
      epoch.sourceGenerationId !== generation._id ||
      epoch.sourceWatermark !== generation.stableWatermark ||
      epoch.skuAttributionTerminalSequence !==
        generation.skuAttributionTerminalSequence ||
      run._id !== generation.runId ||
      run.organizationId !== generation.organizationId ||
      run.storeId !== generation.storeId ||
      run.backfillAuthorizationGrantId === undefined ||
      run.sourceScope !== "pos" ||
      !run.censusToken ||
      !run.sourceCensusHash ||
      run.financialDateContractVersion === undefined ||
      run.factSnapshotWatermark !== generation.stableWatermark ||
      run.skuAttributionTerminalSequence !==
        generation.skuAttributionTerminalSequence ||
      generation.organizationId !== first.generation.organizationId ||
      generation.storeId !== first.generation.storeId ||
      generation.stableWatermark !== first.generation.stableWatermark ||
      generation.factContractVersion !== REPORTING_FACT_CONTRACT_VERSION ||
      generation.projectionContractVersion !== REPORTING_PROJECTION_CONTRACT_VERSION ||
      generation.metricContractVersion !== 1 ||
      run.backfillAuthorizationGrantId !== first.run.backfillAuthorizationGrantId ||
      run.censusToken !== first.run.censusToken ||
      run.sourceCensusHash !== first.run.sourceCensusHash ||
      run.financialDateContractVersion !== first.run.financialDateContractVersion
    ) {
      throw new Error("Reports read bundle member lineage is incompatible");
    }
  }
  if (
    input.reconciliation.status !== "verified" ||
    input.reconciliation.completedAt === undefined ||
    input.reconciliation.unexplainedCount !== 0 ||
    !Number.isSafeInteger(
      input.reconciliation.orphanPaymentCorrectionCount ?? 0,
    ) ||
    (input.reconciliation.orphanPaymentCorrectionCount ?? 0) < 0 ||
    (input.reconciliation.orphanPaymentCorrectionCount ?? 0) !==
      (first.run.orphanPaymentCorrectionCount ?? 0) ||
    input.reconciliation.grantId !== first.run.backfillAuthorizationGrantId ||
    input.reconciliation.censusToken !== first.run.censusToken ||
    input.reconciliation.sourceCensusHash !== first.run.sourceCensusHash ||
    input.reconciliation.factSnapshotWatermark !== first.run.factSnapshotWatermark ||
    input.reconciliation.organizationId !== first.generation.organizationId ||
    input.reconciliation.storeId !== first.generation.storeId ||
    input.reconciliation.contractVersion !== first.run.financialDateContractVersion ||
    input.reconciliation.sourceCount !== input.reconciliation.factCount ||
    input.reconciliation.sourceAmountMinor !== input.reconciliation.factAmountMinor ||
    input.reconciliation.sourceQuantity !== input.reconciliation.factQuantity
  ) {
    throw new Error("Reports read bundle reconciliation is incompatible");
  }
  return {
    censusToken: first.run.censusToken!,
    factContractVersion: first.generation.factContractVersion,
    grantId: first.run.backfillAuthorizationGrantId!,
    metricContractVersion: first.generation.metricContractVersion,
    organizationId: first.generation.organizationId,
    projectionContractVersion: first.generation.projectionContractVersion,
    sourceWatermark: first.generation.stableWatermark!,
    sourceCensusHash: first.run.sourceCensusHash!,
    skuAttributionTerminalSequence:
      ordered.find(({ generation }) => generation.projectionKind === "sku_day")
        ?.generation.skuAttributionTerminalSequence,
    storeId: first.generation.storeId,
    members: ordered.map(({ generation, epoch }) => ({
      generationId: generation._id,
      projectionKind: generation.projectionKind as (typeof REQUIRED_KINDS)[number],
      workspaceEpochId: epoch._id,
    })),
  };
}

export const tryActivateVerifiedReportsReadBundleForStore = internalMutation({
  args: { storeId: v.id("store") },
  handler: async (ctx, args) => {
    const members: BundleMember[] = [];
    for (const projectionKind of REQUIRED_KINDS) {
      const activation = await ctx.db
        .query("reportingProjectionActivation")
        .withIndex("by_storeId_projectionKind_activatedAt", (q) =>
          q.eq("storeId", args.storeId).eq("projectionKind", projectionKind),
        )
        .order("desc")
        .first();
      if (!activation || activation.supersededAt !== undefined) return { status: "not_ready" as const };
      const generation = await ctx.db.get("reportingProjectionGeneration", activation.generationId);
      if (!generation || generation.stableWatermark === undefined) {
        return { status: "not_ready" as const };
      }
      const epoch = await ctx.db
        .query("reportingWorkspaceMaterializationEpoch")
        .withIndex("by_sourceGenerationId_sourceWatermark", (q) =>
          q.eq("sourceGenerationId", generation._id).eq("sourceWatermark", generation.stableWatermark!),
        )
        .first();
      const run = await ctx.db.get("reportingRun", generation.runId);
      if (!epoch || !run || epoch.status !== "active") return { status: "not_ready" as const };
      members.push({ epoch, generation, run });
    }
    const grantId = members[0]!.run.backfillAuthorizationGrantId;
    if (!grantId) return { status: "not_ready" as const };
    const reconciliations = await ctx.db
      .query("reportingPosSourceReconciliation")
      .withIndex("by_grantId", (q) => q.eq("grantId", grantId))
      .take(2);
    if (reconciliations.length !== 1) return { status: "not_ready" as const };
    const reconciliation = reconciliations[0]!;
    const value = assertReadBundleMembers({ members, reconciliation });
    await requireAuthorizedLineageWithCtx(ctx, {
      grantId,
      runId: reconciliation.runId,
    });
    const sourceRun = await ctx.db.get("reportingRun", reconciliation.runId);
    if (!sourceRun || sourceRun.frozenWatermark === undefined) return { status: "not_ready" as const };
    const lateJournalEvidence =
      await findLatePreWatermarkPosJournalEvidenceWithCtx(ctx, {
        frozenWatermark: sourceRun.frozenWatermark,
        recordedAfter: reconciliation.lifecycleJournalTerminalRecordedAt,
        storeId: args.storeId,
      });
    if (lateJournalEvidence) {
      await ctx.db.patch("reportingPosSourceReconciliation", reconciliation._id, {
        completedAt: undefined,
        status: "blocked",
        unexplainedCount: reconciliation.unexplainedCount + 1,
        updatedAt: Date.now(),
      });
      return { status: "not_ready" as const };
    }
    const contentHash = `reports-read-bundle-v1:${fnv1a(JSON.stringify(value))}`;
    const attributionCursor = await currentSkuAttributionCursorWithCtx(
      ctx,
      args.storeId,
    );
    if (!skuAttributionTerminalCanActivate({
      cursor: attributionCursor,
      terminal: value.skuAttributionTerminalSequence,
    })) {
      return { status: "not_ready" as const };
    }
    const prior = await ctx.db
      .query("reportingReadBundleActivation")
      .withIndex("by_storeId_activatedAt", (q) => q.eq("storeId", args.storeId))
      .order("desc")
      .first();
    if (prior && prior.supersededAt === undefined) {
      const bundle = await ctx.db.get("reportingReadBundle", prior.bundleId);
      if (bundle?.contentHash === contentHash) return { bundleId: bundle._id, status: "active" as const };
    }
    const existing = await ctx.db
      .query("reportingReadBundle")
      .withIndex("by_storeId_contentHash", (q) => q.eq("storeId", args.storeId).eq("contentHash", contentHash))
      .first();
    const now = Date.now();
    const bundleId = existing?._id ?? await ctx.db.insert("reportingReadBundle", {
      ...value,
      contentHash,
      createdAt: now,
      reconciliationId: reconciliation._id,
      status: "verified",
    });
    if (prior && prior.supersededAt === undefined) {
      await ctx.db.patch("reportingReadBundleActivation", prior._id, { supersededAt: now });
      await ctx.db.patch("reportingReadBundle", prior.bundleId, { status: "superseded", supersededAt: now });
    }
    await ctx.db.insert("reportingReadBundleActivation", {
      activatedAt: now,
      bundleId,
      organizationId: value.organizationId,
      priorBundleId: prior?.bundleId,
      storeId: value.storeId,
    });
    await ctx.db.patch("reportingReadBundle", bundleId, { activatedAt: now, status: "active" });
    if (attributionCursor && value.skuAttributionTerminalSequence !== undefined) {
      await ctx.db.patch("reportingSkuAttributionCursor", attributionCursor._id, {
        latestActivatedSequence: value.skuAttributionTerminalSequence,
        updatedAt: now,
      });
    }
    return { bundleId, status: "active" as const };
  },
});

export const rollbackReportsReadBundle = internalMutation({
  args: {
    expectedCurrentBundleId: v.id("reportingReadBundle"),
    storeId: v.id("store"),
    targetBundleId: v.id("reportingReadBundle"),
  },
  handler: async (ctx, args) => {
    const [target, current] = await Promise.all([
      ctx.db.get("reportingReadBundle", args.targetBundleId),
      ctx.db.query("reportingReadBundleActivation")
        .withIndex("by_storeId_activatedAt", (q) => q.eq("storeId", args.storeId))
        .order("desc").first(),
    ]);
    const attributionCursor = await currentSkuAttributionCursorWithCtx(
      ctx,
      args.storeId,
    );
    if (
      !target ||
      target.storeId !== args.storeId ||
      target.factContractVersion !== REPORTING_FACT_CONTRACT_VERSION ||
      target.projectionContractVersion !== REPORTING_PROJECTION_CONTRACT_VERSION ||
      target.metricContractVersion !== 1 ||
      !current ||
      current.supersededAt !== undefined ||
      current.bundleId !== args.expectedCurrentBundleId ||
      current.organizationId !== target.organizationId
      || !skuAttributionTerminalIsCurrent({
        cursor: attributionCursor,
        terminal: target.skuAttributionTerminalSequence,
      })
    ) {
      throw new Error("Reports read bundle rollback target is incompatible");
    }
    const certificate = await bundleCertificateIsReadableWithCtx(ctx, target);
    if (!certificate) {
      throw new Error("Reports read bundle rollback certificate is stale");
    }
    await requireAuthorizedLineageWithCtx(ctx, {
      grantId: target.grantId,
      runId: certificate.reconciliation.runId,
    });
    for (const member of target.members) {
      const [generation, epoch] = await Promise.all([
        ctx.db.get("reportingProjectionGeneration", member.generationId),
        ctx.db.get("reportingWorkspaceMaterializationEpoch", member.workspaceEpochId),
      ]);
      if (
        !generation ||
        (generation.status !== "active" && generation.status !== "superseded") ||
        generation.storeId !== args.storeId ||
        generation.organizationId !== target.organizationId ||
        generation.projectionKind !== member.projectionKind ||
        generation.stableWatermark !== target.sourceWatermark ||
        !epoch ||
        epoch.status !== "active" ||
        epoch.storeId !== args.storeId ||
        epoch.projectionKind !== member.projectionKind ||
        epoch.sourceGenerationId !== generation._id ||
        epoch.sourceWatermark !== target.sourceWatermark
      ) {
        throw new Error("Reports read bundle rollback member is unavailable");
      }
    }
    if (current.bundleId === target._id) {
      return { bundleId: target._id, status: "active" as const };
    }
    const now = Date.now();
    await ctx.db.patch("reportingReadBundleActivation", current._id, { supersededAt: now });
    await ctx.db.patch("reportingReadBundle", current.bundleId, { status: "superseded", supersededAt: now });
    await ctx.db.insert("reportingReadBundleActivation", {
      activatedAt: now,
      bundleId: target._id,
      organizationId: target.organizationId,
      priorBundleId: current.bundleId,
      storeId: target.storeId,
    });
    await ctx.db.patch("reportingReadBundle", target._id, {
      activatedAt: now,
      status: "active",
      supersededAt: undefined,
    });
    return { bundleId: target._id, status: "active" as const };
  },
});

export async function getActiveReadBundleWithCtx(
  ctx: Pick<QueryCtx, "db">,
  storeId: Id<"store">,
) {
  const activation = await ctx.db.query("reportingReadBundleActivation")
    .withIndex("by_storeId_activatedAt", (q) => q.eq("storeId", storeId))
    .order("desc").first();
  if (
    !activation ||
    activation.supersededAt !== undefined ||
    activation.storeId !== storeId
  ) return null;
  const bundle = await ctx.db.get("reportingReadBundle", activation.bundleId);
  if (
    !bundle ||
    bundle.status !== "active" ||
    bundle.storeId !== storeId ||
    bundle.organizationId !== activation.organizationId
  ) {
    return null;
  }
  return (await bundleCertificateIsReadableWithCtx(ctx, bundle)) ? bundle : null;
}
