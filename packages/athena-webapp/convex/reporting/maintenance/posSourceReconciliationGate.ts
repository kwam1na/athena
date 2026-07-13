import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { sourceDerivedPosCensusHash } from "./posCensusContract";
import { requireAuthorizedLineageWithCtx } from "./authorizedPosBackfill";
import {
  currentSkuAttributionCursorWithCtx,
  unresolvedSkuAttributionConflictAtOrBeforeWithCtx,
} from "../skuAttributionSequence";

type PosLineageRun = {
  backfillAuthorizationGrantId?: string;
  censusToken?: string;
  financialDateContractVersion?: number;
  organizationId?: string;
  sourceScope?: "pos";
  storeId?: string;
  sourceCensusHash?: string;
  factSnapshotWatermark?: number;
  orphanPaymentCorrectionCount?: number;
};

type PosLineageGrant = {
  _id: string;
  contractVersion: number;
  migrationPurpose: "reports_financial_truth_reset_backfill";
  organizationId: string;
  runId?: string;
  sourceScope: "pos";
  status: "authorized" | "running" | "completed" | "failed" | "cancelled";
  storeId: string;
};

type PosReconciliationEvidence = {
  censusToken: string;
  completedAt?: number;
  contractVersion: number;
  factAmountMinor: number;
  factCount: number;
  factQuantity: number;
  grantId: string;
  organizationId: string;
  runId: string;
  sourceAmountMinor: number;
  sourceCount: number;
  sourceQuantity: number;
  status: "building" | "verified" | "blocked";
  storeId: string;
  unexplainedCount: number;
  sourceCensusHash?: string;
  factSnapshotWatermark?: number;
  journalCount?: number;
  journalMatchedCount?: number;
  authoritativeSourceCount?: number;
  authoritativeSourceDigest?: string;
  orphanPaymentCorrectionCount?: number;
  lifecycleJournalTerminalId?: string;
  lifecycleJournalTerminalRecordedAt?: number;
  sourceManifestDigest?: string;
  sourceManifestId?: string;
};

export async function findLatePreWatermarkPosJournalEvidenceWithCtx(
  ctx: MutationCtx,
  input: {
    frozenWatermark: number;
    recordedAfter?: number;
    storeId: Id<"store">;
  },
) {
  return await ctx.db
    .query("posLifecycleJournal")
    .withIndex("by_storeId_sequence", (q) => {
      const store = q.eq("storeId", input.storeId);
      return input.recordedAfter === undefined
        ? store
        : store.gt("sequence", input.recordedAfter);
    })
    .filter((q) => q.lte(q.field("occurredAt"), input.frozenWatermark))
    .first();
}

const POS_LINEAGE_FIELDS = [
  "backfillAuthorizationGrantId",
  "censusToken",
  "financialDateContractVersion",
  "sourceCensusHash",
  "factSnapshotWatermark",
  "sourceScope",
] as const;

type ProjectionRebuildLineageInput = {
  backfillAuthorizationGrantId?: string;
  censusToken?: string;
  factSnapshotWatermark?: number;
  financialDateContractVersion?: number;
  frozenWatermark?: number;
  sourceCensusHash?: string;
  sourceScope?: "pos";
  skuAttributionTerminalSequence?: number;
};

export function isValidConvexCreationTime(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function projectionRebuildLineage(
  input: ProjectionRebuildLineageInput,
) {
  const fields = [
    input.backfillAuthorizationGrantId,
    input.censusToken,
    input.factSnapshotWatermark,
    input.financialDateContractVersion,
    input.frozenWatermark,
    input.sourceCensusHash,
    input.sourceScope,
  ];
  const present = fields.filter((value) => value !== undefined).length;
  if (present === 0) {
    if (input.skuAttributionTerminalSequence !== undefined) {
      throw new Error("Projection rebuild POS lineage must be all-or-none");
    }
    return null;
  }
  if (present !== fields.length) {
    throw new Error("Projection rebuild POS lineage must be all-or-none");
  }
  if (!input.backfillAuthorizationGrantId?.trim()) {
    throw new Error("Projection rebuild grant id is required");
  }
  if (!input.censusToken?.trim()) {
    throw new Error("Projection rebuild censusToken is required");
  }
  if (!input.sourceCensusHash?.trim()) {
    throw new Error("Projection rebuild sourceCensusHash is required");
  }
  if (input.sourceScope !== "pos") {
    throw new Error("Projection rebuild sourceScope must be pos");
  }
  if (
    !Number.isSafeInteger(input.financialDateContractVersion) ||
    (input.financialDateContractVersion ?? 0) < 1
  ) {
    throw new Error(
      "Projection rebuild financialDateContractVersion is invalid",
    );
  }
  if (
    !Number.isSafeInteger(input.frozenWatermark) ||
    (input.frozenWatermark ?? -1) < 0
  ) {
    throw new Error("Projection rebuild frozenWatermark is invalid");
  }
  if (!isValidConvexCreationTime(input.factSnapshotWatermark)) {
    throw new Error("Projection rebuild factSnapshotWatermark is invalid");
  }
  if (
    input.skuAttributionTerminalSequence !== undefined &&
    (!Number.isSafeInteger(input.skuAttributionTerminalSequence) ||
      input.skuAttributionTerminalSequence < 1)
  ) {
    throw new Error(
      "Projection rebuild skuAttributionTerminalSequence is invalid",
    );
  }
  return {
    backfillAuthorizationGrantId: input.backfillAuthorizationGrantId,
    censusToken: input.censusToken,
    factSnapshotWatermark: input.factSnapshotWatermark,
    financialDateContractVersion: input.financialDateContractVersion,
    frozenWatermark: input.frozenWatermark,
    sourceCensusHash: input.sourceCensusHash,
    sourceScope: input.sourceScope,
    ...(input.skuAttributionTerminalSequence !== undefined
      ? {
        skuAttributionTerminalSequence:
          input.skuAttributionTerminalSequence,
      }
      : {}),
  } as const;
}

export async function requireVerifiedPosBackfillLineageWithCtx(
  ctx: MutationCtx,
  input: {
    lineage: NonNullable<ReturnType<typeof projectionRebuildLineage>>;
    organizationId: Id<"organization">;
    storeId: Id<"store">;
  },
) {
  const grantId = input.lineage
    .backfillAuthorizationGrantId as Id<"reportingBackfillAuthorizationGrant">;
  const [grant, reconciliations] = await Promise.all([
    ctx.db.get("reportingBackfillAuthorizationGrant", grantId),
    ctx.db
      .query("reportingPosSourceReconciliation")
      .withIndex("by_grantId", (q) => q.eq("grantId", grantId))
      .take(2),
  ]);
  const sourceRun = grant?.runId
    ? await ctx.db.get("reportingRun", grant.runId)
    : null;
  const reconciliation = reconciliations[0];
  const sourceManifest = reconciliation?.sourceManifestId
    ? await ctx.db.get(
        "reportingBackfillApplyManifest",
        reconciliation.sourceManifestId,
      )
    : null;
  const attributionCursor = await currentSkuAttributionCursorWithCtx(
    ctx,
    input.storeId,
  );
  const lateJournalEvidence =
    sourceRun?.frozenWatermark !== undefined && reconciliation
      ? await findLatePreWatermarkPosJournalEvidenceWithCtx(ctx, {
          frozenWatermark: sourceRun.frozenWatermark,
          recordedAfter: reconciliation.lifecycleJournalTerminalRecordedAt,
          storeId: input.storeId,
        })
      : null;
  const expectedSourceCensusHash =
    sourceRun &&
    sourceRun.frozenWatermark !== undefined &&
    sourceRun.financialDateContractVersion !== undefined &&
    reconciliation?.sourceManifestDigest
      ? sourceDerivedPosCensusHash({
          authoritativeSourceCount: reconciliation.authoritativeSourceCount,
          authoritativeSourceDigest: reconciliation.authoritativeSourceDigest,
          factContractVersion: sourceRun.factContractVersion,
          financialDateContractVersion:
            sourceRun.financialDateContractVersion!,
          frozenWatermark: sourceRun.frozenWatermark!,
          journalTerminalId: reconciliation.lifecycleJournalTerminalId,
          journalTerminalRecordedAt:
            reconciliation.lifecycleJournalTerminalRecordedAt,
          manifestDigest: reconciliation.sourceManifestDigest,
          orphanPaymentCorrectionCount:
            reconciliation.orphanPaymentCorrectionCount,
          skuAttributionTerminalSequence:
            reconciliation.skuAttributionTerminalSequence,
        })
      : null;
  const originalAttributionTerminal =
    sourceRun?.skuAttributionTerminalSequence;
  const candidateAttributionTerminal =
    input.lineage.skuAttributionTerminalSequence ??
    originalAttributionTerminal;
  const unresolvedAttributionConflict = candidateAttributionTerminal === undefined
    ? null
    : await unresolvedSkuAttributionConflictAtOrBeforeWithCtx(ctx, {
        storeId: input.storeId,
        terminalSequence: candidateAttributionTerminal,
      });
  if (
    !grant ||
    reconciliations.length !== 1 ||
    !sourceRun ||
    sourceRun.runType !== "backfill" ||
    sourceRun.status !== "completed" ||
    sourceRun.backfillAuthorizationGrantId !== grant._id ||
    sourceRun.organizationId !== input.organizationId ||
    sourceRun.storeId !== input.storeId ||
    sourceRun.sourceScope !== input.lineage.sourceScope ||
    sourceRun.censusToken !== input.lineage.censusToken ||
    sourceRun.financialDateContractVersion !==
      input.lineage.financialDateContractVersion ||
    sourceRun.frozenWatermark !== input.lineage.frozenWatermark ||
    sourceRun.factSnapshotWatermark !== input.lineage.factSnapshotWatermark ||
    sourceRun.sourceCensusHash !== input.lineage.sourceCensusHash
    || !sourceManifest
    || sourceManifest.status !== "completed"
    || sourceManifest.digest !== reconciliation?.sourceManifestDigest
    || sourceManifest.organizationId !== input.organizationId
    || sourceManifest.storeId !== input.storeId
    || expectedSourceCensusHash !== sourceRun.sourceCensusHash
    || lateJournalEvidence
    || unresolvedAttributionConflict
    || reconciliation?.skuAttributionTerminalSequence !==
      originalAttributionTerminal
    || (attributionCursor
      ? candidateAttributionTerminal === undefined ||
        attributionCursor.latestMaterialSequence !==
          candidateAttributionTerminal ||
        attributionCursor.latestAppliedSequence !==
          candidateAttributionTerminal ||
        candidateAttributionTerminal < (originalAttributionTerminal ?? 0)
      : candidateAttributionTerminal !== undefined ||
        originalAttributionTerminal !== undefined)
  ) {
    throw new Error("Projection rebuild requires verified POS backfill lineage");
  }
  await requireAuthorizedLineageWithCtx(ctx, {
    grantId: grant._id,
    runId: sourceRun._id,
  });
  assertPosSourceReconciliationActivationReady({
    candidate: {
      organizationId: String(input.organizationId),
      storeId: String(input.storeId),
    },
    grant,
    reconciliation,
    run: {
      ...input.lineage,
      organizationId: String(input.organizationId),
      orphanPaymentCorrectionCount:
        sourceRun.orphanPaymentCorrectionCount ?? 0,
      storeId: String(input.storeId),
    },
  });
  return {
    orphanPaymentCorrectionCount:
      reconciliation!.orphanPaymentCorrectionCount ?? 0,
  } as const;
}

export async function findSkuAttributionUpdatedAfterWithCtx(
  ctx: Pick<QueryCtx, "db">,
  input: { certifiedAt: number; storeId: Id<"store"> },
) {
  const rows = await Promise.all(
    (["pending", "completed", "conflict"] as const).map((status) =>
      ctx.db
        .query("reportingSkuAttribution")
        .withIndex("by_storeId_status_updatedAt", (q) =>
          q
            .eq("storeId", input.storeId)
            .eq("status", status)
            .gt("updatedAt", input.certifiedAt),
        )
        .first(),
    ),
  );
  return rows.find((row) => row !== null) ?? null;
}

export function reportingRunRequiresPosSourceReconciliation(
  run: PosLineageRun,
) {
  const presentCount = POS_LINEAGE_FIELDS.filter(
    (field) => run[field] !== undefined,
  ).length;
  if (presentCount === 0) return false;
  if (
    presentCount !== POS_LINEAGE_FIELDS.length ||
    run.sourceScope !== "pos" ||
    !run.censusToken?.trim() ||
    !run.sourceCensusHash?.trim() ||
    !isValidConvexCreationTime(run.factSnapshotWatermark) ||
    !Number.isSafeInteger(run.financialDateContractVersion) ||
    (run.financialDateContractVersion ?? 0) < 1
  ) {
    throw new Error("POS source reconciliation lineage is incomplete");
  }
  return true;
}

export function assertPosSourceReconciliationActivationReady(input: {
  candidate: { organizationId: string; storeId: string };
  grant: PosLineageGrant | null;
  reconciliation: PosReconciliationEvidence | null;
  run: PosLineageRun;
}) {
  if (!reportingRunRequiresPosSourceReconciliation(input.run)) return;
  const { candidate, grant, reconciliation, run } = input;
  if (
    !grant ||
    !reconciliation ||
    String(grant._id) !== String(run.backfillAuthorizationGrantId) ||
    !grant.runId ||
    grant.organizationId !== candidate.organizationId ||
    grant.organizationId !== run.organizationId ||
    grant.storeId !== candidate.storeId ||
    grant.storeId !== run.storeId ||
    grant.sourceScope !== "pos" ||
    grant.migrationPurpose !== "reports_financial_truth_reset_backfill" ||
    (grant.status !== "running" && grant.status !== "completed") ||
    grant.contractVersion !== run.financialDateContractVersion ||
    String(reconciliation.grantId) !== String(grant._id) ||
    String(reconciliation.runId) !== String(grant.runId) ||
    reconciliation.organizationId !== grant.organizationId ||
    reconciliation.storeId !== grant.storeId ||
    reconciliation.censusToken !== run.censusToken ||
    reconciliation.contractVersion !== run.financialDateContractVersion
    || !run.sourceCensusHash
    || reconciliation.sourceCensusHash !== run.sourceCensusHash
    || reconciliation.factSnapshotWatermark !== run.factSnapshotWatermark
    || (reconciliation.orphanPaymentCorrectionCount ?? 0) !==
      (run.orphanPaymentCorrectionCount ?? 0)
  ) {
    throw new Error("POS source reconciliation lineage is incompatible");
  }
  if (
    reconciliation.status !== "verified" ||
    reconciliation.completedAt === undefined ||
    reconciliation.unexplainedCount !== 0 ||
    !Number.isSafeInteger(reconciliation.orphanPaymentCorrectionCount ?? 0) ||
    (reconciliation.orphanPaymentCorrectionCount ?? 0) < 0 ||
    reconciliation.sourceCount !== reconciliation.factCount ||
    reconciliation.sourceAmountMinor !== reconciliation.factAmountMinor ||
    reconciliation.sourceQuantity !== reconciliation.factQuantity
    || reconciliation.authoritativeSourceCount !== reconciliation.sourceCount
    || reconciliation.journalCount === undefined
    || reconciliation.journalMatchedCount !== reconciliation.journalCount
    || !Number.isSafeInteger(reconciliation.authoritativeSourceCount)
    || (reconciliation.authoritativeSourceCount ?? 0) < 0
    || !reconciliation.authoritativeSourceDigest
  ) {
    throw new Error("POS source reconciliation is not verified");
  }
}

export async function persistPosSourceReconciliationWithCtx(
  ctx: MutationCtx,
  input: {
    censusToken: string;
    contractVersion: number;
    factAmountMinor: number;
    factCount: number;
    factQuantity: number;
    factSnapshotWatermark?: number;
    grantId: Id<"reportingBackfillAuthorizationGrant">;
    lifecycleJournalTerminalId?: string;
    lifecycleJournalTerminalRecordedAt?: number;
    journalCount?: number;
    journalMatchedCount?: number;
    authoritativeSourceCount?: number;
    authoritativeSourceDigest?: string;
    orphanPaymentCorrectionCount: number;
    runId: Id<"reportingRun">;
    sourceAmountMinor: number;
    sourceCount: number;
    sourceQuantity: number;
    sourceManifestDigest?: string;
    sourceManifestId?: Id<"reportingBackfillApplyManifest">;
    sourceCensusHash?: string;
    skuAttributionTerminalSequence?: number;
    unexplainedCount: number;
  },
) {
  const [grant, run] = await Promise.all([
    ctx.db.get("reportingBackfillAuthorizationGrant", input.grantId),
    ctx.db.get("reportingRun", input.runId),
  ]);
  if (
    !grant ||
    !run ||
    grant.runId !== run._id ||
    grant.organizationId !== run.organizationId ||
    grant.storeId !== run.storeId ||
    grant.sourceScope !== "pos" ||
    grant.migrationPurpose !== "reports_financial_truth_reset_backfill" ||
    (grant.status !== "running" && grant.status !== "completed") ||
    run.backfillAuthorizationGrantId !== grant._id ||
    run.sourceScope !== "pos" ||
    run.censusToken !== input.censusToken ||
    run.financialDateContractVersion !== input.contractVersion ||
    grant.contractVersion !== input.contractVersion ||
    run.domain !== "reporting" ||
    run.runType !== "backfill" ||
    (run.status !== "running" && run.status !== "completed")
  ) {
    throw new Error("POS source reconciliation lineage is incompatible");
  }
  const priorRows = await ctx.db
    .query("reportingPosSourceReconciliation")
    .withIndex("by_grantId", (q) => q.eq("grantId", input.grantId))
    .take(2);
  if (priorRows.length > 1) {
    throw new Error("POS source reconciliation lineage is ambiguous");
  }
  const prior = priorRows[0];
  if (
    prior &&
    (prior.runId !== input.runId ||
      prior.organizationId !== grant.organizationId ||
      prior.storeId !== grant.storeId ||
      prior.censusToken !== input.censusToken ||
      prior.contractVersion !== input.contractVersion)
  ) {
    throw new Error("POS source reconciliation lineage is incompatible");
  }
  const verified =
    input.unexplainedCount === 0 &&
    input.sourceCount === input.factCount &&
    input.sourceAmountMinor === input.factAmountMinor &&
    input.sourceQuantity === input.factQuantity &&
    input.authoritativeSourceCount === input.sourceCount &&
    Number.isSafeInteger(input.orphanPaymentCorrectionCount) &&
    input.orphanPaymentCorrectionCount >= 0 &&
    Boolean(input.sourceCensusHash) &&
    isValidConvexCreationTime(input.factSnapshotWatermark) &&
    input.journalCount !== undefined &&
    input.journalMatchedCount === input.journalCount &&
    Number.isSafeInteger(input.authoritativeSourceCount) &&
    (input.authoritativeSourceCount ?? -1) >= 0 &&
    Boolean(input.authoritativeSourceDigest);
  const now = Date.now();
  const value = {
    censusToken: input.censusToken,
    completedAt: now,
    contractVersion: input.contractVersion,
    factAmountMinor: input.factAmountMinor,
    factCount: input.factCount,
    factQuantity: input.factQuantity,
    factSnapshotWatermark: input.factSnapshotWatermark,
    grantId: input.grantId,
    lifecycleJournalTerminalId: input.lifecycleJournalTerminalId,
    lifecycleJournalTerminalRecordedAt:
      input.lifecycleJournalTerminalRecordedAt,
    journalCount: input.journalCount,
    journalMatchedCount: input.journalMatchedCount,
    authoritativeSourceCount: input.authoritativeSourceCount,
    authoritativeSourceDigest: input.authoritativeSourceDigest,
    organizationId: grant.organizationId,
    orphanPaymentCorrectionCount: input.orphanPaymentCorrectionCount,
    runId: input.runId,
    sourceAmountMinor: input.sourceAmountMinor,
    sourceCount: input.sourceCount,
    sourceQuantity: input.sourceQuantity,
    sourceManifestDigest: input.sourceManifestDigest,
    sourceManifestId: input.sourceManifestId,
    sourceCensusHash: input.sourceCensusHash,
    skuAttributionTerminalSequence: input.skuAttributionTerminalSequence,
    status: verified ? ("verified" as const) : ("blocked" as const),
    storeId: grant.storeId,
    unexplainedCount: input.unexplainedCount,
    updatedAt: now,
  };
  if (prior) {
    if (prior.status === "verified") {
      if (
        prior.sourceCount !== input.sourceCount ||
        prior.factCount !== input.factCount ||
        prior.sourceAmountMinor !== input.sourceAmountMinor ||
        prior.factAmountMinor !== input.factAmountMinor ||
        prior.sourceQuantity !== input.sourceQuantity ||
        prior.factQuantity !== input.factQuantity ||
        prior.unexplainedCount !== input.unexplainedCount ||
        (prior.orphanPaymentCorrectionCount ?? 0) !==
          input.orphanPaymentCorrectionCount ||
        prior.lifecycleJournalTerminalId !==
          input.lifecycleJournalTerminalId ||
        prior.lifecycleJournalTerminalRecordedAt !==
          input.lifecycleJournalTerminalRecordedAt ||
        prior.sourceManifestDigest !== input.sourceManifestDigest ||
        prior.sourceManifestId !== input.sourceManifestId
        || prior.sourceCensusHash !== input.sourceCensusHash
        || prior.factSnapshotWatermark !== input.factSnapshotWatermark
        || prior.journalCount !== input.journalCount
        || prior.journalMatchedCount !== input.journalMatchedCount
        || prior.authoritativeSourceCount !== input.authoritativeSourceCount
        || prior.authoritativeSourceDigest !== input.authoritativeSourceDigest
        || prior.skuAttributionTerminalSequence !==
          input.skuAttributionTerminalSequence
      ) {
        throw new Error("POS source reconciliation result is immutable");
      }
      assertPosSourceReconciliationActivationReady({
        candidate: grant,
        grant,
        reconciliation: prior,
        run,
      });
      return prior._id;
    }
    await ctx.db.patch("reportingPosSourceReconciliation", prior._id, value);
    return prior._id;
  }
  return await ctx.db.insert("reportingPosSourceReconciliation", value);
}

export async function requirePosSourceReconciliationReadinessWithCtx(
  ctx: MutationCtx,
  input: {
    candidate: Doc<"reportingProjectionGeneration">;
    run: Doc<"reportingRun">;
  },
) {
  if (!reportingRunRequiresPosSourceReconciliation(input.run)) return null;
  const grantId = input.run.backfillAuthorizationGrantId!;
  const [grant, reconciliations] = await Promise.all([
    ctx.db.get("reportingBackfillAuthorizationGrant", grantId),
    ctx.db
      .query("reportingPosSourceReconciliation")
      .withIndex("by_grantId", (q) => q.eq("grantId", grantId))
      .take(2),
  ]);
  if (reconciliations.length !== 1) {
    throw new Error("POS source reconciliation lineage is incompatible");
  }
  if (!grant?.runId) {
    throw new Error("POS source reconciliation lineage is incompatible");
  }
  await requireAuthorizedLineageWithCtx(ctx, {
    grantId: grant._id,
    runId: grant.runId,
  });
  assertPosSourceReconciliationActivationReady({
    candidate: input.candidate,
    grant,
    reconciliation: reconciliations[0],
    run: input.run,
  });
  return reconciliations[0];
}
