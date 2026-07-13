import { v } from "convex/values";

import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../../_generated/server";
import {
  classifyHistoricalSourceSize,
  classifyPosRefundEvidence,
  HISTORICAL_SOURCE_LINE_LIMIT,
  parseHistoricalManifestCandidate,
  posAdjustmentSourceIsCoherent,
  posOriginalSaleIdentityMode,
  posOriginalSaleSourceIsCoherent,
  posSkuAttributionMatchesSourceItem,
} from "./backfill";
import { requireAuthorizedLineageWithCtx } from "./authorizedPosBackfill";
import { persistPosSourceReconciliationWithCtx } from "./posSourceReconciliationGate";
import { resolveReportingFinancialPeriodWithCtx } from "../operatingPeriods";
import { currentSkuAttributionCursorWithCtx } from "../skuAttributionSequence";
export {
  POS_CENSUS_BACKFILL_PHASES,
  advancePosCensusCursor,
  assertSealedJournalTerminal,
  sourceDerivedPosCensusHash,
} from "./posCensusContract";
import { sourceDerivedPosCensusHash } from "./posCensusContract";

type CensusLineage = {
  grant: Readonly<Record<string, unknown>>;
  run: Readonly<Record<string, unknown>>;
};

export function assertAuthorizedPosCensusStart(input: CensusLineage) {
  const { grant, run } = input;
  const checks = [
    ["organizationId", run.organizationId, grant.organizationId],
    ["storeId", run.storeId, grant.storeId],
    ["sourceScope", run.sourceScope, "pos"],
    ["grant sourceScope", grant.sourceScope, "pos"],
    ["grant runId", grant.runId, run._id],
    ["authorization grant", run.backfillAuthorizationGrantId, grant._id],
    [
      "financialDateContractVersion",
      run.financialDateContractVersion,
      grant.contractVersion,
    ],
  ] as const;
  for (const [field, actual, expected] of checks) {
    if (actual !== expected) {
      throw new Error(`Authorized POS census mismatch: ${field}`);
    }
  }
  if (
    grant.migrationPurpose !== "reports_financial_truth_reset_backfill" ||
    grant.status !== "running" ||
    run.status !== "running" ||
    typeof run.censusToken !== "string" ||
    !run.censusToken.trim()
  ) {
    throw new Error("Authorized POS census lineage is not runnable");
  }
  if (run.cursor !== "purge:verified") {
    throw new Error("Authorized POS census requires purge verification");
  }
}

export function lifecycleJournalPreviewPrefix(input: {
  adjustmentId?: string;
  eventKey: string;
  eventKind:
    | "completed"
    | "voided"
    | "refunded"
    | "adjustment_applied"
    | "payment_method_corrected";
  transactionId: string;
}) {
  switch (input.eventKind) {
    case "completed":
      return `pos:${input.transactionId}:complete`;
    case "voided":
      return `pos:${input.transactionId}:void`;
    case "refunded":
      return input.adjustmentId
        ? `pos:${input.transactionId}:adjustment:${input.adjustmentId}`
        : `pos:${input.transactionId}:refund`;
    case "adjustment_applied":
      return `pos:${input.transactionId}:adjustment:${input.adjustmentId ?? ""}`;
    case "payment_method_corrected":
      return input.eventKey.replace(":payment-correction:", ":correction:");
  }
}

export function posManifestFactSemanticsMatch(input: {
  fact: Record<string, unknown>;
  factContractVersion: number;
  metricContractVersion: number;
  resolvedPeriod: Record<string, unknown> | null;
  source: Record<string, unknown>;
}) {
  const { fact, resolvedPeriod, source } = input;
  return (
    fact.status === "canonical" &&
    fact.factContractVersion === input.factContractVersion &&
    fact.metricContractVersion === input.metricContractVersion &&
    fact.factType === source.factType &&
    fact.amountMinor === source.amountMinor &&
    fact.quantity === source.quantity &&
    (fact.currencyCode ?? null) === (source.currency ?? null) &&
    fact.operatingDate === resolvedPeriod?.operatingDate &&
    String(fact.timezoneVersionId ?? "") ===
      String(resolvedPeriod?.timezoneVersionId ?? "") &&
    fact.timezoneVersionHash === resolvedPeriod?.timezoneVersionHash &&
    fact.scheduleContext === resolvedPeriod?.scheduleContext &&
    String(fact.scheduleVersionId ?? "") ===
      String(resolvedPeriod?.scheduleVersionId ?? "") &&
    fact.linkedBusinessEventKey === source.linkedBusinessEventKey &&
    fact.sourceLineKey === source.sourceLineKey &&
    fact.revenueKind === source.revenueKind &&
    fact.recognizedNetAmountMinor === source.recognizedNetAmountMinor &&
    fact.priorSettlementMethod === source.priorSettlementMethod &&
    fact.correctedSettlementMethod === source.correctedSettlementMethod &&
    fact.attributionKind === source.attributionKind &&
    fact.attributionVersion === source.attributionVersion &&
    (fact.canonicalProductSkuId ?? null) ===
      (source.canonicalProductSkuId ?? null) &&
    (fact.productId ?? null) === (source.productId ?? null) &&
    (fact.productSkuId ?? null) === (source.productSkuId ?? null) &&
    (fact.pendingCheckoutItemId ?? null) ===
      (source.pendingCheckoutItemId ?? null) &&
    (fact.provisionalProductSkuId ?? null) ===
      (source.provisionalProductSkuId ?? null) &&
    (fact.inventoryImportProvisionalSkuId ?? null) ===
      (source.inventoryImportProvisionalSkuId ?? null) &&
    (fact.originalProductSkuId ?? null) ===
      (source.originalProductSkuId ?? null) &&
    (fact.serviceCaseId ?? null) === (source.serviceCaseId ?? null) &&
    fact.completeness === source.completeness &&
    fact.costStatus === source.costStatus &&
    fact.limitingReason === source.limitingReason
  );
}

async function latestJournalCursor(
  ctx: MutationCtx,
  storeId: Id<"store">,
) {
  const rows = await ctx.db
    .query("posLifecycleJournal")
    .withIndex("by_storeId_sequence", (q) => q.eq("storeId", storeId))
    .order("desc")
    .take(1);
  const row = rows[0];
  return row
    ? { id: String(row._id), recordedAt: row.sequence as number }
    : { id: undefined, recordedAt: undefined };
}

async function hasLatePreWatermarkJournalEvidence(
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

export function journalTerminalMatches(
  left: { id?: string; recordedAt?: number },
  right: { id?: string; recordedAt?: number },
) {
  return left.id === right.id && left.recordedAt === right.recordedAt;
}

/** Reset worker handoff. The caller supplies only durable grant/run lineage. */
export const startAuthorizedPosCensusBackfill = internalMutation({
  args: {
    grantId: v.id("reportingBackfillAuthorizationGrant"),
    runId: v.id("reportingRun"),
  },
  handler: async (ctx, args) => {
    const { grant, run } = await requireAuthorizedLineageWithCtx(ctx, args);
    assertAuthorizedPosCensusStart({ grant, run });
    const attributionCursor = await currentSkuAttributionCursorWithCtx(
      ctx,
      run.storeId,
    );
    if (
      attributionCursor &&
      attributionCursor.latestAppliedSequence !==
        attributionCursor.latestMaterialSequence
    ) {
      await ctx.scheduler.runAfter(
        100,
        internal.reporting.maintenance.posCensusBackfill
          .startAuthorizedPosCensusBackfill,
        args,
      );
      return { waitingForAttribution: true };
    }
    const frozenWatermark = Date.now();
    const terminal = await latestJournalCursor(ctx, run.storeId);
    await ctx.db.patch("reportingRun", run._id, {
      cursor: "pos_preview:queued",
      frozenWatermark,
      skuAttributionTerminalSequence:
        attributionCursor?.latestMaterialSequence,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.reporting.maintenance.backfill.startHistoricalBackfill,
      {
        authorizationGrantId: grant._id,
        automationIdentity: "authorized_pos_census",
        censusToken: run.censusToken!,
        financialDateContractVersion: run.financialDateContractVersion!,
        lifecycleJournalTerminalId: terminal.id,
        lifecycleJournalTerminalRecordedAt: terminal.recordedAt,
        mode: "preview",
        orchestratorRunId: run._id,
        periodEnd: frozenWatermark,
        requestKey: `authorized-pos-preview:${run.censusToken}:${terminal.id ?? "empty"}:${terminal.recordedAt ?? 0}`,
        sourceScope: "pos",
        skuAttributionTerminalSequence:
          attributionCursor?.latestMaterialSequence,
        storeId: run.storeId,
      },
    );
    return { queued: true };
  },
});

function childMatchesLineage(input: {
  child: Doc<"reportingRun">;
  grant: Doc<"reportingBackfillAuthorizationGrant">;
  orchestrator: Doc<"reportingRun">;
}) {
  return (
    input.child.backfillAuthorizationGrantId === input.grant._id &&
    input.child.organizationId === input.grant.organizationId &&
    input.child.storeId === input.grant.storeId &&
    input.child.sourceScope === "pos" &&
    input.child.censusToken === input.orchestrator.censusToken &&
    input.child.financialDateContractVersion ===
      input.orchestrator.financialDateContractVersion
  );
}

/** Called only by the sealed historical worker after a POS-scoped child completes. */
export const continueAuthorizedPosCensusBackfill = internalMutation({
  args: { childRunId: v.id("reportingRun") },
  handler: async (ctx, args) => {
    const child = await ctx.db.get("reportingRun", args.childRunId);
    if (!child?.backfillAuthorizationGrantId || child.status !== "completed") {
      throw new Error("Authorized POS census child is not complete");
    }
    const provisionalGrant = await ctx.db.get(
      "reportingBackfillAuthorizationGrant",
      child.backfillAuthorizationGrantId,
    );
    if (!provisionalGrant?.runId) {
      throw new Error("Authorized POS census grant run is unavailable");
    }
    const { grant, run: orchestrator } =
      await requireAuthorizedLineageWithCtx(ctx, {
        grantId: provisionalGrant._id,
        runId: provisionalGrant.runId,
      });
    if (!grant || !orchestrator || !childMatchesLineage({ child, grant, orchestrator })) {
      throw new Error("Authorized POS census child lineage is incompatible");
    }
    if (child.operation.endsWith("preview")) {
      if (orchestrator.cursor !== "pos_preview:queued") {
        return { next: "apply" as const, queued: false };
      }
      const lateEvidence = await hasLatePreWatermarkJournalEvidence(ctx, {
        frozenWatermark: child.frozenWatermark!,
        recordedAfter: child.lifecycleJournalTerminalRecordedAt,
        storeId: orchestrator.storeId,
      });
      const attributionCursor = await currentSkuAttributionCursorWithCtx(
        ctx,
        orchestrator.storeId,
      );
      if (
        attributionCursor &&
        attributionCursor.latestAppliedSequence !==
          attributionCursor.latestMaterialSequence
      ) {
        await ctx.scheduler.runAfter(
          100,
          internal.reporting.maintenance.posCensusBackfill
            .continueAuthorizedPosCensusBackfill,
          { childRunId: child._id },
        );
        return { next: "preview" as const, waitingForAttribution: true };
      }
      const attributionTerminal =
        attributionCursor?.latestMaterialSequence;
      if (
        lateEvidence ||
        attributionTerminal !== orchestrator.skuAttributionTerminalSequence
      ) {
        const currentTerminal = await latestJournalCursor(
          ctx,
          orchestrator.storeId,
        );
        await ctx.db.patch("reportingRun", orchestrator._id, {
          skuAttributionTerminalSequence: attributionTerminal,
        });
        await ctx.scheduler.runAfter(
          0,
          internal.reporting.maintenance.backfill.startHistoricalBackfill,
          {
            authorizationGrantId: grant._id,
            automationIdentity: "authorized_pos_census",
            censusToken: orchestrator.censusToken!,
            financialDateContractVersion:
              orchestrator.financialDateContractVersion!,
            lifecycleJournalTerminalId: currentTerminal.id,
            lifecycleJournalTerminalRecordedAt: currentTerminal.recordedAt,
            mode: "preview",
            orchestratorRunId: orchestrator._id,
            periodEnd: child.frozenWatermark,
            requestKey: `authorized-pos-preview:${orchestrator.censusToken}:${currentTerminal.id ?? "empty"}:${currentTerminal.recordedAt ?? 0}`,
            sourceScope: "pos",
            skuAttributionTerminalSequence: attributionTerminal,
            storeId: orchestrator.storeId,
          },
        );
        return { next: "preview" as const, stabilized: false };
      }
      await ctx.db.patch("reportingRun", orchestrator._id, {
        cursor: `pos_preview:completed:${child._id}`,
      });
      const terminal = {
        id: child.lifecycleJournalTerminalId,
        recordedAt: child.lifecycleJournalTerminalRecordedAt,
      };
      await ctx.scheduler.runAfter(
        0,
        internal.reporting.maintenance.backfill.startHistoricalBackfill,
        {
          authorizationGrantId: grant._id,
          automationIdentity: "authorized_pos_census",
          censusToken: orchestrator.censusToken!,
          financialDateContractVersion:
            orchestrator.financialDateContractVersion!,
          lifecycleJournalTerminalId: terminal.id,
          lifecycleJournalTerminalRecordedAt: terminal.recordedAt,
          mode: "apply",
          orchestratorRunId: orchestrator._id,
          previewRunId: child._id,
          requestKey: `authorized-pos-apply:${orchestrator.censusToken}`,
          sourceScope: "pos",
          skuAttributionTerminalSequence:
            orchestrator.skuAttributionTerminalSequence,
          storeId: orchestrator.storeId,
        },
      );
      return { next: "apply" as const };
    }
    if (!child.backfillApplyManifestId) {
      throw new Error("Authorized POS census apply manifest is unavailable");
    }
    if (orchestrator.cursor !== `pos_preview:completed:${child.previewRunId}`) {
      return { next: "reconciliation" as const, queued: false };
    }
    await ctx.db.patch("reportingRun", orchestrator._id, {
      cursor: `pos_reconciliation:queued:${child._id}`,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.reporting.maintenance.posCensusBackfill
        .processAuthorizedPosSourceCensusBatch,
      {
        applyRunId: child._id,
        cursor: null,
        grantId: grant._id,
        runId: orchestrator._id,
      },
    );
    return { next: "reconciliation" as const };
  },
});

const RECONCILIATION_PAGE_SIZE = 50;
const SOURCE_CENSUS_PAGE_SIZE = 1;
const SOURCE_SHAPE_LIMIT = 501;

export function classifyPosCensusSourceShape(input: {
  adjustmentCount: number;
  eventCount: number;
  itemCount: number;
  serviceCount: number;
}) {
  return {
    adjustmentBoundExceeded: input.adjustmentCount >= SOURCE_SHAPE_LIMIT,
    eventBoundExceeded: input.eventCount >= SOURCE_SHAPE_LIMIT,
    saleLineBoundExceeded:
      input.itemCount >= SOURCE_SHAPE_LIMIT ||
      input.serviceCount >= SOURCE_SHAPE_LIMIT,
  };
}

export function manifestOutcomeParticipatesInAuthoritativeSemantics(
  outcome: string,
) {
  return outcome === "created" || outcome === "existing";
}

export function classifyAuthorizedPosReconciliationCompletion(input: {
  frozenWatermark?: number;
  orphanDispositionMatchesApply: boolean;
  persistedStatus?: string;
  unexplainedCount: number;
}) {
  return input.persistedStatus === "verified" &&
    input.frozenWatermark !== undefined &&
    input.orphanDispositionMatchesApply
    ? ({
        cursor: "pos_reconciliation:verified" as const,
        failedCount: 0,
        status: "completed" as const,
        verified: true as const,
      } as const)
    : ({
        cursor: "pos_reconciliation:blocked" as const,
        failedCount: Math.max(1, input.unexplainedCount),
        status: "failed" as const,
        verified: false as const,
      } as const);
}

export function authoritativePosSourceDigestStep(
  priorDigest: string,
  value: unknown,
) {
  let hash = 0x811c9dc5;
  const serialized = `${priorDigest}\n${JSON.stringify(value)}`;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

type AuthoritativePosExpectedSemantics = {
  amountMinor?: number;
  attributionKind?: "direct" | "inventory_import" | "pending_checkout";
  attributionVersion?: number;
  canonicalProductSkuId?: string;
  correctedSettlementMethod?: string;
  currency: string | null;
  factType: "sale" | "void" | "refund" | "correction";
  key: string;
  occurredAt: number;
  originalProductSkuId?: string;
  pendingCheckoutItemId?: string;
  priorSettlementMethod?: string;
  productId?: string;
  productSkuId?: string;
  provisionalProductSkuId?: string;
  inventoryImportProvisionalSkuId?: string;
  quantity?: number;
  revenueKind?: "merchandise" | "service" | "tax";
  serviceCaseId?: string;
};

function normalizedCurrency(value: string | null | undefined) {
  return value?.trim().toUpperCase() || null;
}

export function authoritativePosSemanticsMatch(input: {
  candidate: {
    amountMinor?: number;
    attributionKind?: string;
    attributionVersion?: number;
    canonicalProductSkuId?: string;
    correctedSettlementMethod?: string;
    currency?: string | null;
    factType: string;
    occurredAt: number | null;
    originalProductSkuId?: string;
    pendingCheckoutItemId?: string;
    priorSettlementMethod?: string;
    productId?: string;
    productSkuId?: string;
    provisionalProductSkuId?: string;
    inventoryImportProvisionalSkuId?: string;
    quantity?: number;
    revenueKind?: string;
    serviceCaseId?: string;
  };
  expected: AuthoritativePosExpectedSemantics;
  expectedPeriod: {
    reportingDate: string;
    timezoneVersionHash: string;
    timezoneVersionId: string;
  };
  resolvedPeriod: Record<string, unknown> | null;
}) {
  return (
    input.candidate.amountMinor === input.expected.amountMinor &&
    input.candidate.quantity === input.expected.quantity &&
    input.candidate.factType === input.expected.factType &&
    input.candidate.occurredAt === input.expected.occurredAt &&
    normalizedCurrency(input.candidate.currency) === input.expected.currency &&
    input.candidate.revenueKind === input.expected.revenueKind &&
    input.candidate.priorSettlementMethod ===
      input.expected.priorSettlementMethod &&
    input.candidate.correctedSettlementMethod ===
      input.expected.correctedSettlementMethod &&
    input.candidate.attributionKind === input.expected.attributionKind &&
    input.candidate.attributionVersion === input.expected.attributionVersion &&
    (input.candidate.canonicalProductSkuId ?? null) ===
      (input.expected.canonicalProductSkuId ?? null) &&
    (input.candidate.originalProductSkuId ?? null) ===
      (input.expected.originalProductSkuId ?? null) &&
    (input.candidate.pendingCheckoutItemId ?? null) ===
      (input.expected.pendingCheckoutItemId ?? null) &&
    (input.candidate.provisionalProductSkuId ?? null) ===
      (input.expected.provisionalProductSkuId ?? null) &&
    (input.candidate.inventoryImportProvisionalSkuId ?? null) ===
      (input.expected.inventoryImportProvisionalSkuId ?? null) &&
    (input.candidate.productId ?? null) ===
      (input.expected.productId ?? null) &&
    (input.candidate.productSkuId ?? null) ===
      (input.expected.productSkuId ?? null) &&
    (input.candidate.serviceCaseId ?? null) ===
      (input.expected.serviceCaseId ?? null) &&
    input.resolvedPeriod?.operatingDate === input.expectedPeriod.reportingDate &&
    String(input.resolvedPeriod?.timezoneVersionId ?? "") ===
      input.expectedPeriod.timezoneVersionId &&
    input.resolvedPeriod?.timezoneVersionHash ===
      input.expectedPeriod.timezoneVersionHash
  );
}

function roundSourceAmount(value: number) {
  return Number(value.toFixed(2));
}

export function posTransactionHeaderMatchesSourceLines(input: {
  lineTotals: number[];
  subtotal: number;
  tax: number;
  total: number;
}) {
  const headerBalances =
    roundSourceAmount(input.subtotal + input.tax) ===
    roundSourceAmount(input.total);
  if (!headerBalances) return false;
  if (input.lineTotals.length === 0) return true;
  return (
    roundSourceAmount(
      input.lineTotals.reduce((sum, amount) => sum + amount, 0),
    ) === roundSourceAmount(input.subtotal)
  );
}

export function expectedAuthoritativePosPreviewKeys(input: {
  adjustmentLines: Array<{
    adjustmentId: string;
    deltaTotal: number;
    lines: Array<{
      id: string;
      correctedTotal: number;
      originalTotal: number;
      quantityDelta: number;
    }>;
  }>;
  itemAndServiceLineIds: string[];
  paymentCorrectionIds: string[];
  refundedLines: Array<{ id: string; refundedAt: number }>;
  includeVoid?: boolean;
  status: string;
  saleIdentityMode?: "line" | "transaction_summary";
  tax: number;
  total: number;
  transactionId: string;
}) {
  const transactionPrefix = `pos:${input.transactionId}`;
  const keys: string[] = [];
  const usesLineIdentity =
    input.saleIdentityMode !== "transaction_summary";
  if (usesLineIdentity && input.itemAndServiceLineIds.length > 0) {
    for (const lineId of input.itemAndServiceLineIds) {
      keys.push(`${transactionPrefix}:complete:line:${lineId}:sale`);
    }
  } else if (!usesLineIdentity || input.total !== 0) {
    keys.push(`${transactionPrefix}:complete:transaction_summary`);
  }
  if (
    usesLineIdentity &&
    input.tax !== 0 &&
    input.itemAndServiceLineIds.length > 0
  ) {
    keys.push(`${transactionPrefix}:complete:line:tax:sale`);
  }
  if (input.includeVoid ?? input.status === "void") {
    if (usesLineIdentity && input.itemAndServiceLineIds.length > 0) {
      for (const lineId of input.itemAndServiceLineIds) {
        keys.push(`${transactionPrefix}:void:line:${lineId}:void`);
      }
    } else if (input.total !== 0) {
      keys.push(`${transactionPrefix}:void:line:transaction_summary:void`);
    }
    if (
      usesLineIdentity &&
      input.tax !== 0 &&
      input.itemAndServiceLineIds.length > 0
    ) {
      keys.push(`${transactionPrefix}:void:line:tax:void`);
    }
  }
  for (const refund of usesLineIdentity ? input.refundedLines : []) {
    keys.push(
      `${transactionPrefix}:refund:${refund.id}:${refund.refundedAt}:line:${refund.id}:refund`,
    );
  }
  for (const adjustment of input.adjustmentLines) {
    for (const line of adjustment.lines.filter(
      (candidate) =>
        candidate.quantityDelta !== 0 ||
        candidate.correctedTotal - candidate.originalTotal !== 0,
    )) {
      keys.push(
        `${transactionPrefix}:adjustment:${adjustment.adjustmentId}:line:${line.id}`,
      );
    }
    const lineDelta = adjustment.lines.reduce(
      (sum, line) => sum + line.correctedTotal - line.originalTotal,
      0,
    );
    if (adjustment.deltaTotal - lineDelta !== 0) {
      keys.push(`${transactionPrefix}:adjustment:${adjustment.adjustmentId}:tax`);
    }
  }
  for (const eventId of input.paymentCorrectionIds) {
    keys.push(`${transactionPrefix}:correction:${eventId}`);
  }
  return keys;
}

export function adjustmentSourceIsTransactionBound(input: {
  adjustmentTransactionId: string;
  storeId: string;
  transaction: { id: string; storeId: string } | null;
}) {
  return Boolean(
    input.transaction &&
      input.transaction.id === input.adjustmentTransactionId &&
      input.transaction.storeId === input.storeId,
  );
}

export function classifyAppliedAdjustmentCensusTime(input: {
  appliedAt?: number;
  frozenWatermark: number;
  status: string;
}) {
  if (input.status !== "applied") return "not_applied" as const;
  if (input.appliedAt === undefined) return "malformed" as const;
  return input.appliedAt <= input.frozenWatermark
    ? ("included" as const)
    : ("after_frozen_watermark" as const);
}

export function paymentCorrectionSourceIsTransactionBound(input: {
  posTransactionId?: string;
  storeId: string;
  subjectId: string;
  subjectType: string;
  transaction: { id: string; storeId: string } | null;
}) {
  return Boolean(
    input.transaction &&
      input.transaction.storeId === input.storeId &&
      input.subjectType === "pos_transaction" &&
      input.subjectId === input.transaction.id &&
      (input.posTransactionId === undefined ||
        input.posTransactionId === input.transaction.id),
  );
}

export function classifyPaymentCorrectionAuditSource(input: {
  posTransactionId?: string;
  storeId: string;
  subjectId: string;
  subjectType: string;
  transaction: { id: string; storeId: string } | null;
}) {
  const structurallyBound =
    input.subjectType === "pos_transaction" &&
    Boolean(input.subjectId) &&
    (input.posTransactionId === undefined ||
      input.subjectId === input.posTransactionId);
  if (structurallyBound && !input.transaction) {
    return "orphan_payment_correction" as const;
  }
  return paymentCorrectionSourceIsTransactionBound(input)
    ? ("bound" as const)
    : ("unexplained" as const);
}

export function manifestItemIsKnownExcludedPosSource(input: {
  candidateExclusionReason?: string;
  candidateSourceType: string;
  itemExclusionReason?: string;
  outcome: string;
}) {
  return (
    input.outcome === "excluded" &&
    input.itemExclusionReason === "orphan_payment_correction" &&
    input.candidateExclusionReason === "orphan_payment_correction" &&
    input.candidateSourceType === "operational_event"
  );
}

export const processAuthorizedPosSourceCensusBatch = internalMutation({
  args: {
    applyRunId: v.id("reportingRun"),
    cursor: v.union(v.string(), v.null()),
    grantId: v.id("reportingBackfillAuthorizationGrant"),
    runId: v.id("reportingRun"),
  },
  handler: async (ctx, args) => {
    const [{ grant, run }, applyRun] = await Promise.all([
      requireAuthorizedLineageWithCtx(ctx, {
        grantId: args.grantId,
        runId: args.runId,
      }),
      ctx.db.get("reportingRun", args.applyRunId),
    ]);
    if (
      !applyRun?.previewRunId ||
      !applyRun.backfillApplyManifestId ||
      !childMatchesLineage({ child: applyRun, grant, orchestrator: run }) ||
      applyRun.status !== "completed" ||
      applyRun.frozenWatermark === undefined
    ) {
      throw new Error("Authorized POS source census lineage is incompatible");
    }
    const store = await ctx.db.get("store", run.storeId);
    if (!store || store.organizationId !== run.organizationId) {
      throw new Error("Authorized POS source census store is incompatible");
    }
    const priorRows = await ctx.db
      .query("reportingPosSourceReconciliation")
      .withIndex("by_grantId", (q) => q.eq("grantId", grant._id))
      .take(2);
    if (priorRows.length > 1) throw new Error("POS reconciliation is ambiguous");
    const prior = priorRows[0];
    if (prior && (prior.cursor ?? null) !== args.cursor) {
      throw new Error("POS source census cursor does not match its checkpoint");
    }
    const page = await ctx.db
      .query("posTransaction")
      .withIndex("by_storeId", (q) => q.eq("storeId", run.storeId))
      .paginate({
        cursor: args.cursor,
        numItems: SOURCE_CENSUS_PAGE_SIZE,
      });
    let authoritativeSourceCount = prior?.authoritativeSourceCount ?? 0;
    let authoritativeSourceDigest =
      prior?.authoritativeSourceDigest ?? "pos-source-v1:empty";
    let unexplainedCount = prior?.unexplainedCount ?? 0;
    for (const transaction of page.page) {
      if (transaction.completedAt === undefined) {
        if (["completed", "void", "refunded"].includes(transaction.status)) {
          authoritativeSourceCount += 1;
          authoritativeSourceDigest = authoritativePosSourceDigestStep(
            authoritativeSourceDigest,
            transaction,
          );
          unexplainedCount += 1;
        }
        continue;
      }
      if (transaction.completedAt > applyRun.frozenWatermark) continue;
      const [items, services, adjustments, events] = await Promise.all([
        ctx.db
          .query("posTransactionItem")
          .withIndex("by_transactionId", (q) =>
            q.eq("transactionId", transaction._id),
          )
          .take(SOURCE_SHAPE_LIMIT),
        ctx.db
          .query("posTransactionServiceLine")
          .withIndex("by_transactionId", (q) =>
            q.eq("transactionId", transaction._id),
          )
          .take(SOURCE_SHAPE_LIMIT),
        ctx.db
          .query("posTransactionAdjustment")
          .withIndex("by_transactionId", (q) =>
            q.eq("transactionId", transaction._id),
          )
          .take(SOURCE_SHAPE_LIMIT),
        ctx.db
          .query("operationalEvent")
          .withIndex("by_storeId_subject", (q) =>
            q
              .eq("storeId", run.storeId)
              .eq("subjectType", "pos_transaction")
              .eq("subjectId", String(transaction._id)),
          )
          .take(SOURCE_SHAPE_LIMIT),
      ]);
      const sourceShape = classifyPosCensusSourceShape({
        adjustmentCount: adjustments.length,
        eventCount: events.length,
        itemCount: items.length,
        serviceCount: services.length,
      });
      if (
        sourceShape.saleLineBoundExceeded ||
        sourceShape.adjustmentBoundExceeded ||
        sourceShape.eventBoundExceeded
      ) {
        unexplainedCount += 1;
      }
      const [itemEvidence, serviceCases] = sourceShape.saleLineBoundExceeded
        ? [[], []]
        : await Promise.all([
        Promise.all(
          items.map(async (item) => {
            const [sku, product, pending, provisional] = await Promise.all([
              ctx.db.get("productSku", item.productSkuId),
              ctx.db.get("product", item.productId),
              item.pendingCheckoutItemId
                ? ctx.db.get(
                    "posPendingCheckoutItem",
                    item.pendingCheckoutItemId,
                  )
                : Promise.resolve(null),
              item.inventoryImportProvisionalSkuId
                ? ctx.db.get(
                    "inventoryImportProvisionalSku",
                    item.inventoryImportProvisionalSkuId,
                  )
                : Promise.resolve(null),
            ]);
            return { pending, product, provisional, sku };
          }),
        ),
        Promise.all(
          services.map((line) =>
            ctx.db.get("serviceCase", line.serviceCaseId),
          ),
        ),
        ]);
      const originalSaleSourceIsCoherent =
        !sourceShape.saleLineBoundExceeded &&
        posOriginalSaleSourceIsCoherent({
          itemEvidence,
          items,
          organizationId: run.organizationId,
          serviceCases,
          services,
          storeId: run.storeId,
        });
      if (
        !originalSaleSourceIsCoherent &&
        !sourceShape.saleLineBoundExceeded
      ) {
        unexplainedCount += 1;
      }
      const originalSaleIdentityMode = posOriginalSaleIdentityMode({
        sourceLineCount: items.length + services.length,
        sourceLinesAreCoherent: originalSaleSourceIsCoherent,
        total: transaction.total,
      });
      const appliedAdjustments = (sourceShape.adjustmentBoundExceeded
        ? []
        : adjustments
      ).filter(
        (row) =>
          row.status === "applied" &&
          row.appliedAt !== undefined &&
          row.appliedAt <= applyRun.frozenWatermark!,
      );
      const paymentCorrections = (sourceShape.eventBoundExceeded
        ? []
        : events
      ).filter(
        (row) =>
          row.eventType === "pos_transaction_payment_method_corrected" &&
          row.createdAt <= applyRun.frozenWatermark!,
      );
      const adjustmentLines = await Promise.all(
        appliedAdjustments.map((adjustment) =>
          ctx.db
            .query("posTransactionAdjustmentLine")
            .withIndex("by_adjustmentId", (q) =>
              q.eq("adjustmentId", adjustment._id),
            )
            .take(HISTORICAL_SOURCE_LINE_LIMIT + 1),
        ),
      );
      const transactionSkuAttributionRows = sourceShape.saleLineBoundExceeded
        ? items.map(() => [])
        : await Promise.all(
            items.map((item) =>
              item.pendingCheckoutItemId
                ? ctx.db
                    .query("reportingSkuAttribution")
                    .withIndex("by_storeId_pendingCheckoutItemId", (q) =>
                      q
                        .eq("storeId", run.storeId)
                        .eq(
                          "pendingCheckoutItemId",
                          item.pendingCheckoutItemId!,
                        ),
                    )
                    .take(2)
                : Promise.resolve([]),
            ),
          );
      const validSkuAttributionByLineId = new Map<
        string,
        Doc<"reportingSkuAttribution">
      >();
      for (const [index, item] of (
        sourceShape.saleLineBoundExceeded ? [] : items
      ).entries()) {
        if (!item.pendingCheckoutItemId) continue;
        const rows = transactionSkuAttributionRows[index] ?? [];
        const attribution = rows.length === 1 ? rows[0] : null;
        const [canonicalProduct, canonicalSku] = attribution
          ? await Promise.all([
              attribution.canonicalProductId
                ? ctx.db.get("product", attribution.canonicalProductId)
                : Promise.resolve(null),
              ctx.db.get("productSku", attribution.canonicalProductSkuId),
            ])
          : [null, null];
        if (
          attribution &&
          attribution.status !== "conflict" &&
          posSkuAttributionMatchesSourceItem({
              attribution,
              canonicalProduct,
              canonicalSku,
              item,
              organizationId: run.organizationId,
              pendingItem: itemEvidence[index]?.pending ?? null,
              storeId: run.storeId,
          })
        ) {
          validSkuAttributionByLineId.set(String(item._id), attribution);
        } else if (rows.length > 0) {
          unexplainedCount += 1;
        }
      }
      const adjustmentOriginalItems = await Promise.all(
        adjustmentLines.map((lines) =>
          Promise.all(
            lines.map((line) =>
              line.lineType === "existing" && line.originalTransactionItemId
                ? ctx.db.get(
                    "posTransactionItem",
                    line.originalTransactionItemId,
                  )
                : Promise.resolve(null),
            ),
          ),
        ),
      );
      const adjustmentProductSkus = await Promise.all(
        adjustmentLines.map((lines) =>
          Promise.all(
            lines.map((line) =>
              line.lineType === "added"
                ? ctx.db.get("productSku", line.productSkuId)
                : Promise.resolve(null),
            ),
          ),
        ),
      );
      const adjustmentSkuAttributionRows = await Promise.all(
        adjustmentLines.map((lines) =>
          Promise.all(
            lines.map((line) =>
              line.pendingCheckoutItemId
                ? ctx.db
                    .query("reportingSkuAttribution")
                    .withIndex("by_storeId_pendingCheckoutItemId", (q) =>
                      q
                        .eq("storeId", run.storeId)
                        .eq(
                          "pendingCheckoutItemId",
                          line.pendingCheckoutItemId!,
                        ),
                    )
                    .take(2)
                : Promise.resolve([]),
            ),
          ),
        ),
      );
      const validAdjustmentAttributionByLineId = new Map<
        string,
        Doc<"reportingSkuAttribution">
      >();
      const invalidAdjustmentAttributionIds = new Set<string>();
      for (const [index, adjustment] of appliedAdjustments.entries()) {
        const lines = adjustmentLines[index] ?? [];
        for (const [lineIndex, line] of lines.entries()) {
          if (!line.pendingCheckoutItemId) continue;
          const rows = adjustmentSkuAttributionRows[index]?.[lineIndex] ?? [];
          const attribution = rows.length === 1 ? rows[0] : null;
          const [pendingItem, canonicalProduct, canonicalSku] = attribution
            ? await Promise.all([
                ctx.db.get(
                  "posPendingCheckoutItem",
                  line.pendingCheckoutItemId,
                ),
                attribution.canonicalProductId
                  ? ctx.db.get("product", attribution.canonicalProductId)
                  : Promise.resolve(null),
                ctx.db.get("productSku", attribution.canonicalProductSkuId),
              ])
            : [null, null, null];
          if (
            attribution &&
            attribution.status !== "conflict" &&
            posSkuAttributionMatchesSourceItem({
              attribution,
              canonicalProduct,
              canonicalSku,
              item: line,
              organizationId: run.organizationId,
              pendingItem,
              storeId: run.storeId,
            })
          ) {
            validAdjustmentAttributionByLineId.set(
              String(line._id),
              attribution,
            );
          } else if (rows.length > 0) {
            invalidAdjustmentAttributionIds.add(String(adjustment._id));
          }
        }
      }
      const materialAdjustmentIds = new Set<string>();
      for (const [index, adjustment] of appliedAdjustments.entries()) {
        const adjustmentIsCoherent =
          classifyHistoricalSourceSize(
            adjustmentLines[index]?.length ?? 0,
          ).status !== "quarantined" &&
          !invalidAdjustmentAttributionIds.has(String(adjustment._id)) &&
          posAdjustmentSourceIsCoherent({
            adjustment,
            lines: adjustmentLines[index] ?? [],
            originalItems: (adjustmentOriginalItems[index] ?? []).filter(
              (item) => item !== null,
            ),
            productSkus: (adjustmentProductSkus[index] ?? []).filter(
              (sku) => sku !== null,
            ),
            parentTransaction: transaction,
          });
        if (!adjustmentIsCoherent) {
          unexplainedCount += 1;
        } else {
          materialAdjustmentIds.add(String(adjustment._id));
        }
      }
      const materialAppliedAdjustments = appliedAdjustments.flatMap(
        (adjustment, index) =>
          materialAdjustmentIds.has(String(adjustment._id))
            ? [{ adjustment, index }]
            : [],
      );
      const materialPaymentCorrections = paymentCorrections.filter(
        (event) =>
          paymentCorrectionSourceIsTransactionBound({
            posTransactionId: event.posTransactionId
              ? String(event.posTransactionId)
              : undefined,
            storeId: run.storeId,
            subjectId: event.subjectId,
            subjectType: event.subjectType,
            transaction: {
              id: String(transaction._id),
              storeId: String(transaction.storeId),
            },
          }) && event.createdAt >= transaction.completedAt,
      );
      unexplainedCount +=
        paymentCorrections.length - materialPaymentCorrections.length;
      authoritativeSourceDigest = authoritativePosSourceDigestStep(
        authoritativeSourceDigest,
        {
          transaction,
          items,
          services,
          adjustments: appliedAdjustments.map((row, index) => ({
            row,
            lines: adjustmentLines[index],
          })),
          paymentCorrections,
          itemEvidence,
          serviceCases,
          adjustmentOriginalItems,
          adjustmentProductSkus,
          adjustmentSkuAttributions: adjustmentSkuAttributionRows,
          skuAttributions: transactionSkuAttributionRows,
        },
      );
      const refundedLines: Array<{ id: string; refundedAt: number }> = [];
      for (const line of
        originalSaleIdentityMode === "line" ? [...items, ...services] : []) {
        const refundEvidence = classifyPosRefundEvidence({
          completedAt: transaction.completedAt,
          frozenWatermark: applyRun.frozenWatermark,
          isRefunded: line.isRefunded,
          quantity: line.quantity,
          refundedAt: line.refundedAt,
          refundedQuantity: line.refundedQuantity,
        });
        if (refundEvidence.status === "malformed") {
          unexplainedCount += 1;
        } else if (refundEvidence.status === "included") {
          refundedLines.push({
            id: String(line._id),
            refundedAt: refundEvidence.refundedAt,
          });
        }
      }
      const prefixes = expectedAuthoritativePosPreviewKeys({
        adjustmentLines: materialAppliedAdjustments.map(
          ({ adjustment, index }) => ({
            adjustmentId: String(adjustment._id),
            deltaTotal: adjustment.deltaTotal,
            lines: (adjustmentLines[index] ?? []).map((line) => ({
              correctedTotal: line.correctedTotal,
              id: String(line._id),
              originalTotal: line.originalTotal,
              quantityDelta: line.quantityDelta,
            })),
          }),
        ),
        itemAndServiceLineIds: [...items, ...services].map((line) =>
          String(line._id),
        ),
        paymentCorrectionIds: materialPaymentCorrections.map((event) =>
          String(event._id),
        ),
        refundedLines,
        saleIdentityMode: originalSaleIdentityMode,
        includeVoid:
          transaction.status === "void" &&
          transaction.voidedAt !== undefined &&
          transaction.voidedAt >= transaction.completedAt &&
          transaction.voidedAt <= applyRun.frozenWatermark,
        status: transaction.status,
        tax: transaction.tax,
        total: transaction.total,
        transactionId: String(transaction._id),
      });
      authoritativeSourceCount += prefixes.length;
      if (!["completed", "void", "refunded"].includes(transaction.status)) {
        unexplainedCount += 1;
      }
      const expectedSemantics: AuthoritativePosExpectedSemantics[] = [];
      const transactionPrefix = `pos:${transaction._id}`;
      const sourceLines = [...items, ...services];
      if (
        originalSaleIdentityMode === "line" &&
        !posTransactionHeaderMatchesSourceLines({
          lineTotals: sourceLines.map((line) => line.totalPrice),
          subtotal: transaction.subtotal,
          tax: transaction.tax,
          total: transaction.total,
        })
      ) {
        unexplainedCount += 1;
      }
      if (
        originalSaleIdentityMode === "line" &&
        sourceLines.length > 0
      ) {
        for (const line of sourceLines) {
          const attribution = (() => {
            if ("serviceCaseId" in line) {
              return {
                attributionKind: "direct" as const,
                attributionVersion: 1,
                serviceCaseId: String(line.serviceCaseId),
              };
            }
            const sourceProductSkuId = String(line.productSkuId);
            const resolvedAttribution = validSkuAttributionByLineId.get(
              String(line._id),
            );
            return {
              attributionKind: line.pendingCheckoutItemId
                ? ("pending_checkout" as const)
                : line.inventoryImportProvisionalSkuId
                  ? ("inventory_import" as const)
                  : ("direct" as const),
              attributionVersion: 1,
              canonicalProductSkuId: line.pendingCheckoutItemId
                ? resolvedAttribution
                  ? String(resolvedAttribution.canonicalProductSkuId)
                  : undefined
                : line.inventoryImportProvisionalSkuId
                  ? undefined
                  : sourceProductSkuId,
              inventoryImportProvisionalSkuId:
                line.inventoryImportProvisionalSkuId
                  ? String(line.inventoryImportProvisionalSkuId)
                  : undefined,
              originalProductSkuId: resolvedAttribution
                ? String(resolvedAttribution.originalProductSkuId)
                : sourceProductSkuId,
              pendingCheckoutItemId: line.pendingCheckoutItemId
                ? String(line.pendingCheckoutItemId)
                : undefined,
              productId: String(line.productId),
              productSkuId: sourceProductSkuId,
              provisionalProductSkuId:
                line.pendingCheckoutItemId ||
                line.inventoryImportProvisionalSkuId
                  ? resolvedAttribution
                    ? String(resolvedAttribution.originalProductSkuId)
                    : sourceProductSkuId
                  : undefined,
            };
          })();
          expectedSemantics.push({
            ...attribution,
            amountMinor: line.totalPrice,
            currency: normalizedCurrency(store.currency),
            factType: "sale",
            key: `${transactionPrefix}:complete:line:${line._id}:sale`,
            occurredAt: transaction.completedAt,
            quantity: line.quantity,
            revenueKind:
              "serviceCaseId" in line ? "service" : "merchandise",
          });
        }
      } else if (
        originalSaleIdentityMode === "transaction_summary" ||
        transaction.total !== 0
      ) {
        expectedSemantics.push({
          amountMinor: transaction.total,
          currency: normalizedCurrency(store.currency),
          factType: "sale",
          key: `${transactionPrefix}:complete:transaction_summary`,
          occurredAt: transaction.completedAt,
          quantity: undefined,
        });
      }
      if (
        originalSaleIdentityMode === "line" &&
        transaction.tax !== 0 &&
        sourceLines.length > 0
      ) {
        expectedSemantics.push({
          amountMinor: transaction.tax,
          attributionKind: "direct",
          attributionVersion: 1,
          currency: normalizedCurrency(store.currency),
          factType: "sale",
          key: `${transactionPrefix}:complete:line:tax:sale`,
          occurredAt: transaction.completedAt,
          quantity: 0,
          revenueKind: "tax",
        });
      }
      if (transaction.status === "void") {
        if (!transaction.voidedAt) {
          unexplainedCount += 1;
        } else if (transaction.voidedAt < transaction.completedAt) {
          unexplainedCount += 1;
        } else if (transaction.voidedAt <= applyRun.frozenWatermark) {
          for (const sale of [...expectedSemantics]) {
            if (sale.factType !== "sale") continue;
            const sourceLineKey = sale.key.includes(":complete:line:")
              ? sale.key.split(":complete:line:")[1]!.replace(/:sale$/, "")
              : "transaction_summary";
            expectedSemantics.push({
              ...sale,
              amountMinor:
                sale.amountMinor === undefined
                  ? undefined
                  : -Math.abs(sale.amountMinor),
              factType: "void",
              key: `${transactionPrefix}:void:line:${sourceLineKey}:void`,
              occurredAt: transaction.voidedAt,
              quantity:
                sale.quantity === undefined
                  ? undefined
                  : -Math.abs(sale.quantity),
            });
          }
        }
      }
      for (const line of
        originalSaleIdentityMode === "line" ? sourceLines : []) {
        const refundEvidence = classifyPosRefundEvidence({
          completedAt: transaction.completedAt,
          frozenWatermark: applyRun.frozenWatermark,
          isRefunded: line.isRefunded,
          quantity: line.quantity,
          refundedAt: line.refundedAt,
          refundedQuantity: line.refundedQuantity,
        });
        if (refundEvidence.status !== "included") {
          continue;
        }
        const refundedQuantity = refundEvidence.refundedQuantity;
        const originalSale = expectedSemantics.find(
          (fact) =>
            fact.key ===
            `${transactionPrefix}:complete:line:${line._id}:sale`,
        );
        const attribution = originalSale
          ? {
              attributionKind: originalSale.attributionKind,
              attributionVersion: originalSale.attributionVersion,
              canonicalProductSkuId: originalSale.canonicalProductSkuId,
              inventoryImportProvisionalSkuId:
                originalSale.inventoryImportProvisionalSkuId,
              originalProductSkuId: originalSale.originalProductSkuId,
              pendingCheckoutItemId: originalSale.pendingCheckoutItemId,
              productId: originalSale.productId,
              productSkuId: originalSale.productSkuId,
              provisionalProductSkuId: originalSale.provisionalProductSkuId,
              serviceCaseId: originalSale.serviceCaseId,
            }
          : {};
        expectedSemantics.push({
          ...attribution,
          amountMinor: -Math.abs(
            Math.round((line.totalPrice * refundedQuantity) / line.quantity),
          ),
          currency: normalizedCurrency(store.currency),
          factType: "refund",
          key: `${transactionPrefix}:refund:${line._id}:${refundEvidence.refundedAt}:line:${line._id}:refund`,
          occurredAt: refundEvidence.refundedAt,
          quantity: -Math.abs(refundedQuantity),
          revenueKind:
            "serviceCaseId" in line ? "service" : "merchandise",
        });
      }
      for (const { adjustment, index } of materialAppliedAdjustments) {
        const lines = adjustmentLines[index] ?? [];
        let lineDelta = 0;
        for (const line of lines) {
          const amountMinor = line.correctedTotal - line.originalTotal;
          lineDelta += amountMinor;
          if (amountMinor === 0 && line.quantityDelta === 0) continue;
          const attribution = line.pendingCheckoutItemId
            ? validAdjustmentAttributionByLineId.get(String(line._id))
            : null;
          expectedSemantics.push({
            amountMinor,
            attributionKind: line.pendingCheckoutItemId
              ? "pending_checkout"
              : "direct",
            attributionVersion: 1,
            canonicalProductSkuId: line.pendingCheckoutItemId
              ? attribution
                ? String(attribution.canonicalProductSkuId)
                : undefined
              : String(line.productSkuId),
            currency: normalizedCurrency(adjustment.currency),
            factType: amountMinor < 0 ? "refund" : "correction",
            key: `${transactionPrefix}:adjustment:${adjustment._id}:line:${line._id}`,
            occurredAt: adjustment.appliedAt!,
            originalProductSkuId: String(
              attribution?.originalProductSkuId ?? line.productSkuId,
            ),
            pendingCheckoutItemId: line.pendingCheckoutItemId
              ? String(line.pendingCheckoutItemId)
              : undefined,
            productId: String(line.productId),
            productSkuId: String(line.productSkuId),
            provisionalProductSkuId: line.pendingCheckoutItemId
              ? String(attribution?.originalProductSkuId ?? line.productSkuId)
              : undefined,
            quantity: line.quantityDelta,
            revenueKind: "merchandise",
          });
        }
        const taxDelta = adjustment.deltaTotal - lineDelta;
        if (taxDelta !== 0) {
          expectedSemantics.push({
            amountMinor: taxDelta,
            currency: normalizedCurrency(adjustment.currency),
            factType: taxDelta < 0 ? "refund" : "correction",
            key: `${transactionPrefix}:adjustment:${adjustment._id}:tax`,
            occurredAt: adjustment.appliedAt!,
            quantity: 0,
            revenueKind: "tax",
          });
        }
      }
      for (const event of materialPaymentCorrections) {
        expectedSemantics.push({
          amountMinor: 0,
          correctedSettlementMethod:
            typeof event.metadata?.paymentMethod === "string"
              ? event.metadata.paymentMethod
              : undefined,
          currency: normalizedCurrency(store.currency),
          factType: "correction",
          key: `${transactionPrefix}:correction:${event._id}`,
          occurredAt: event.createdAt,
          priorSettlementMethod:
            typeof event.metadata?.previousPaymentMethod === "string"
              ? event.metadata.previousPaymentMethod
              : undefined,
          quantity: 0,
        });
      }
      if (expectedSemantics.length !== prefixes.length) {
        unexplainedCount += 1;
      }
      const manifestRows = await ctx.db
        .query("reportingBackfillApplyManifestItem")
        .withIndex("by_manifestId_sourceDomain_businessEventKey", (q) =>
          q
            .eq("manifestId", applyRun.backfillApplyManifestId!)
            .eq("sourceDomain", "pos")
            .gte("businessEventKey", `${transactionPrefix}:`)
            .lt("businessEventKey", `${transactionPrefix}:\uffff`),
        )
        .take(SOURCE_SHAPE_LIMIT);
      const materialManifestRows = manifestRows.filter((row) =>
        manifestOutcomeParticipatesInAuthoritativeSemantics(row.outcome),
      );
      const manifestByKey = new Map(
        materialManifestRows.map((row) => [row.businessEventKey, row]),
      );
      const sourceShapeExceeded =
        sourceShape.saleLineBoundExceeded ||
        sourceShape.adjustmentBoundExceeded ||
        sourceShape.eventBoundExceeded;
      if (
        (!sourceShapeExceeded &&
          (manifestRows.length >= SOURCE_SHAPE_LIMIT ||
            materialManifestRows.length !== expectedSemantics.length)) ||
        manifestByKey.size !== materialManifestRows.length
      ) {
        unexplainedCount += 1;
      }
      const periodByOccurrence = new Map<
        number,
        Awaited<ReturnType<typeof resolveReportingFinancialPeriodWithCtx>>
      >();
      for (const expected of expectedSemantics) {
        const manifestRow = manifestByKey.get(expected.key);
        let period = periodByOccurrence.get(expected.occurredAt);
        if (!period) {
          period = await resolveReportingFinancialPeriodWithCtx(ctx, {
            occurrenceAt: expected.occurredAt,
            organizationId: run.organizationId,
            storeId: run.storeId,
          });
          periodByOccurrence.set(expected.occurredAt, period);
        }
        const manifestCandidate = manifestRow
          ? parseHistoricalManifestCandidate(manifestRow.sanitizedCandidateJson)
          : null;
        if (
          !manifestCandidate ||
          period.kind !== "resolved" ||
          !authoritativePosSemanticsMatch({
            candidate: manifestCandidate.fact,
            expected,
            expectedPeriod: period,
            resolvedPeriod: manifestCandidate.resolvedPeriod,
          })
        ) {
          unexplainedCount += 1;
        }
      }
    }
    const nextCursor = page.isDone ? "adjustment-audit:" : page.continueCursor;
    const value = {
      authoritativeSourceCount,
      authoritativeSourceDigest,
      censusToken: run.censusToken!,
      contractVersion: run.financialDateContractVersion!,
      cursor: nextCursor,
      factAmountMinor: prior?.factAmountMinor ?? 0,
      factCount: prior?.factCount ?? 0,
      factQuantity: prior?.factQuantity ?? 0,
      grantId: grant._id,
      journalCount: prior?.journalCount ?? 0,
      journalMatchedCount: prior?.journalMatchedCount ?? 0,
      organizationId: run.organizationId,
      runId: run._id,
      sourceAmountMinor: prior?.sourceAmountMinor ?? 0,
      sourceCount: prior?.sourceCount ?? 0,
      sourceQuantity: prior?.sourceQuantity ?? 0,
      status: "building" as const,
      storeId: run.storeId,
      orphanPaymentCorrectionCount:
        prior?.orphanPaymentCorrectionCount ?? 0,
      unexplainedCount,
      updatedAt: Date.now(),
    };
    if (prior) await ctx.db.patch("reportingPosSourceReconciliation", prior._id, value);
    else await ctx.db.insert("reportingPosSourceReconciliation", value);
    await ctx.scheduler.runAfter(
      0,
      page.isDone
        ? internal.reporting.maintenance.posCensusBackfill
            .processAuthorizedPosAdjustmentAuditBatch
        : internal.reporting.maintenance.posCensusBackfill
            .processAuthorizedPosSourceCensusBatch,
      { ...args, cursor: page.isDone ? null : nextCursor },
    );
    return { complete: false };
  },
});

export const processAuthorizedPosAdjustmentAuditBatch = internalMutation({
  args: {
    applyRunId: v.id("reportingRun"),
    cursor: v.union(v.string(), v.null()),
    grantId: v.id("reportingBackfillAuthorizationGrant"),
    runId: v.id("reportingRun"),
  },
  handler: async (ctx, args) => {
    const [{ grant, run }, applyRun] = await Promise.all([
      requireAuthorizedLineageWithCtx(ctx, {
        grantId: args.grantId,
        runId: args.runId,
      }),
      ctx.db.get("reportingRun", args.applyRunId),
    ]);
    if (
      !applyRun?.backfillApplyManifestId ||
      !childMatchesLineage({ child: applyRun, grant, orchestrator: run }) ||
      applyRun.status !== "completed" ||
      applyRun.frozenWatermark === undefined
    ) {
      throw new Error("Authorized POS adjustment audit lineage is incompatible");
    }
    const priorRows = await ctx.db
      .query("reportingPosSourceReconciliation")
      .withIndex("by_grantId", (q) => q.eq("grantId", grant._id))
      .take(2);
    if (priorRows.length !== 1) throw new Error("POS adjustment audit is unavailable");
    const prior = priorRows[0]!;
    if ((prior.cursor ?? null) !== `adjustment-audit:${args.cursor ?? ""}`) {
      throw new Error("POS adjustment audit cursor does not match its checkpoint");
    }
    const page = await ctx.db
      .query("posTransactionAdjustment")
      .withIndex("by_storeId_status_appliedAt", (q) =>
        q
          .eq("storeId", run.storeId)
          .eq("status", "applied"),
      )
      .paginate({ cursor: args.cursor, numItems: SOURCE_CENSUS_PAGE_SIZE });
    let unexplainedCount = prior.unexplainedCount;
    for (const adjustment of page.page) {
      const timeClassification = classifyAppliedAdjustmentCensusTime({
        appliedAt: adjustment.appliedAt,
        frozenWatermark: applyRun.frozenWatermark,
        status: adjustment.status,
      });
      if (timeClassification === "malformed") {
        unexplainedCount += 1;
        continue;
      }
      if (timeClassification !== "included") continue;
      const transaction = await ctx.db.get(
        "posTransaction",
        adjustment.transactionId,
      );
      if (
        !adjustmentSourceIsTransactionBound({
          adjustmentTransactionId: String(adjustment.transactionId),
          storeId: String(run.storeId),
          transaction: transaction
            ? { id: String(transaction._id), storeId: String(transaction.storeId) }
            : null,
        })
      ) {
        unexplainedCount += 1;
      }
    }
    const nextCursor = page.isDone
      ? "correction-audit:"
      : `adjustment-audit:${page.continueCursor}`;
    await ctx.db.patch("reportingPosSourceReconciliation", prior._id, {
      cursor: nextCursor,
      unexplainedCount,
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(
      0,
      page.isDone
        ? internal.reporting.maintenance.posCensusBackfill
            .processAuthorizedPosPaymentCorrectionAuditBatch
        : internal.reporting.maintenance.posCensusBackfill
            .processAuthorizedPosAdjustmentAuditBatch,
      { ...args, cursor: page.isDone ? null : page.continueCursor },
    );
    return { complete: false };
  },
});

export const processAuthorizedPosPaymentCorrectionAuditBatch = internalMutation({
  args: {
    applyRunId: v.id("reportingRun"),
    cursor: v.union(v.string(), v.null()),
    grantId: v.id("reportingBackfillAuthorizationGrant"),
    runId: v.id("reportingRun"),
  },
  handler: async (ctx, args) => {
    const [{ grant, run }, applyRun] = await Promise.all([
      requireAuthorizedLineageWithCtx(ctx, {
        grantId: args.grantId,
        runId: args.runId,
      }),
      ctx.db.get("reportingRun", args.applyRunId),
    ]);
    if (
      !applyRun?.backfillApplyManifestId ||
      !childMatchesLineage({ child: applyRun, grant, orchestrator: run }) ||
      applyRun.status !== "completed" ||
      applyRun.frozenWatermark === undefined
    ) {
      throw new Error("Authorized POS correction audit lineage is incompatible");
    }
    const priorRows = await ctx.db
      .query("reportingPosSourceReconciliation")
      .withIndex("by_grantId", (q) => q.eq("grantId", grant._id))
      .take(2);
    if (priorRows.length !== 1) throw new Error("POS correction audit is unavailable");
    const prior = priorRows[0]!;
    if ((prior.cursor ?? null) !== `correction-audit:${args.cursor ?? ""}`) {
      throw new Error("POS correction audit cursor does not match its checkpoint");
    }
    const page = await ctx.db
      .query("operationalEvent")
      .withIndex("by_storeId_createdAt", (q) =>
        q.eq("storeId", run.storeId).lte("createdAt", applyRun.frozenWatermark!),
      )
      .paginate({ cursor: args.cursor, numItems: SOURCE_CENSUS_PAGE_SIZE });
    let unexplainedCount = prior.unexplainedCount;
    let orphanPaymentCorrectionCount =
      prior.orphanPaymentCorrectionCount ?? 0;
    for (const event of page.page) {
      if (event.eventType !== "pos_transaction_payment_method_corrected") continue;
      const transactionId =
        event.posTransactionId ??
        (event.subjectType === "pos_transaction" ? event.subjectId : null);
      const transaction = transactionId
        ? await ctx.db.get("posTransaction", transactionId as Id<"posTransaction">)
        : null;
      const classification = classifyPaymentCorrectionAuditSource({
          posTransactionId: event.posTransactionId
            ? String(event.posTransactionId)
            : undefined,
          storeId: String(run.storeId),
          subjectId: event.subjectId,
          subjectType: event.subjectType,
          transaction: transaction
            ? { id: String(transaction._id), storeId: String(transaction.storeId) }
            : null,
        });
      if (classification === "orphan_payment_correction") {
        orphanPaymentCorrectionCount += 1;
      } else if (classification === "unexplained") {
        unexplainedCount += 1;
      }
    }
    const nextCursor = page.isDone
      ? "journal:"
      : `correction-audit:${page.continueCursor}`;
    await ctx.db.patch("reportingPosSourceReconciliation", prior._id, {
      cursor: nextCursor,
      orphanPaymentCorrectionCount,
      unexplainedCount,
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(
      0,
      page.isDone
        ? internal.reporting.maintenance.posCensusBackfill
            .processAuthorizedPosJournalMembershipBatch
        : internal.reporting.maintenance.posCensusBackfill
            .processAuthorizedPosPaymentCorrectionAuditBatch,
      { ...args, cursor: page.isDone ? null : page.continueCursor },
    );
    return { complete: false };
  },
});

export const processAuthorizedPosJournalMembershipBatch = internalMutation({
  args: {
    applyRunId: v.id("reportingRun"),
    cursor: v.union(v.string(), v.null()),
    grantId: v.id("reportingBackfillAuthorizationGrant"),
    runId: v.id("reportingRun"),
  },
  handler: async (ctx, args) => {
    const [{ grant, run }, applyRun] = await Promise.all([
      requireAuthorizedLineageWithCtx(ctx, {
        grantId: args.grantId,
        runId: args.runId,
      }),
      ctx.db.get("reportingRun", args.applyRunId),
    ]);
    if (
      !applyRun ||
      !applyRun.backfillApplyManifestId ||
      !childMatchesLineage({ child: applyRun, grant, orchestrator: run }) ||
      applyRun.status !== "completed"
    ) {
      throw new Error("Authorized POS reconciliation lineage is incompatible");
    }
    const manifest = await ctx.db.get(
      "reportingBackfillApplyManifest",
      applyRun.backfillApplyManifestId,
    );
    if (
      !manifest ||
      manifest.status !== "completed" ||
      !manifest.digest ||
      manifest.runId !== applyRun._id ||
      manifest.storeId !== run.storeId ||
      manifest.organizationId !== run.organizationId
    ) {
      throw new Error("Authorized POS reconciliation manifest is incompatible");
    }
    const priorRows = await ctx.db
      .query("reportingPosSourceReconciliation")
      .withIndex("by_grantId", (q) => q.eq("grantId", grant._id))
      .take(2);
    if (priorRows.length > 1) throw new Error("POS reconciliation is ambiguous");
    const prior = priorRows[0];
    if (prior?.status === "verified") {
      return { complete: true, verified: true };
    }
    if (prior && (prior.cursor ?? null) !== `journal:${args.cursor ?? ""}`) {
      throw new Error("POS reconciliation cursor does not match its checkpoint");
    }
    const totals = {
      factAmountMinor: prior?.factAmountMinor ?? 0,
      factCount: prior?.factCount ?? 0,
      factQuantity: prior?.factQuantity ?? 0,
      sourceAmountMinor: prior?.sourceAmountMinor ?? 0,
      sourceCount: prior?.sourceCount ?? 0,
      sourceQuantity: prior?.sourceQuantity ?? 0,
      unexplainedCount: prior?.unexplainedCount ?? 0,
      journalCount: prior?.journalCount ?? 0,
      journalMatchedCount: prior?.journalMatchedCount ?? 0,
      authoritativeSourceCount: prior?.authoritativeSourceCount ?? 0,
      authoritativeSourceDigest: prior?.authoritativeSourceDigest,
      orphanPaymentCorrectionCount:
        prior?.orphanPaymentCorrectionCount ?? 0,
    };
    const terminalRecordedAt = applyRun.lifecycleJournalTerminalRecordedAt;
    const journalPage =
      terminalRecordedAt === undefined
        ? {
            continueCursor: "",
            isDone: true,
            page: [] as Array<Doc<"posLifecycleJournal">>,
          }
        : await ctx.db
            .query("posLifecycleJournal")
            .withIndex("by_storeId_sequence", (q) =>
              q
                .eq("storeId", run.storeId)
                .lte("sequence", terminalRecordedAt),
            )
            .filter((q) =>
              q.lte(q.field("occurredAt"), applyRun.frozenWatermark!),
            )
            .paginate({
              cursor: args.cursor,
              numItems: RECONCILIATION_PAGE_SIZE,
            });
    for (const journal of journalPage.page) {
      totals.journalCount += 1;
      const prefix = lifecycleJournalPreviewPrefix({
        adjustmentId: journal.adjustmentId
          ? String(journal.adjustmentId)
          : undefined,
        eventKey: journal.eventKey,
        eventKind: journal.eventKind,
        transactionId: String(journal.transactionId),
      });
      const candidates = await ctx.db
        .query("reportingBackfillPreviewItem")
        .withIndex("by_runId_sourceDomain_businessEventKey", (q) =>
          q
            .eq("runId", applyRun.previewRunId!)
            .eq("sourceDomain", "pos")
            .gte("businessEventKey", prefix)
            .lt("businessEventKey", `${prefix}\uffff`),
        )
        .take(1);
      if (candidates.length === 1) totals.journalMatchedCount += 1;
      else totals.unexplainedCount += 1;
    }
    const nextCursor = journalPage.isDone
      ? "manifest:"
      : `journal:${journalPage.continueCursor}`;
    const value = {
      censusToken: run.censusToken!,
      contractVersion: run.financialDateContractVersion!,
      grantId: grant._id,
      organizationId: run.organizationId,
      runId: run._id,
      status: "building" as const,
      storeId: run.storeId,
      ...totals,
      cursor: nextCursor,
      updatedAt: Date.now(),
    };
    if (prior)
      await ctx.db.patch("reportingPosSourceReconciliation", prior._id, value);
    else await ctx.db.insert("reportingPosSourceReconciliation", value);
    await ctx.scheduler.runAfter(
      0,
      journalPage.isDone
        ? internal.reporting.maintenance.posCensusBackfill
            .processAuthorizedPosReconciliationBatch
        : internal.reporting.maintenance.posCensusBackfill
            .processAuthorizedPosJournalMembershipBatch,
      {
        ...args,
        cursor: journalPage.isDone ? null : journalPage.continueCursor,
      },
    );
    return { complete: false };
  },
});

export const processAuthorizedPosReconciliationBatch = internalMutation({
  args: {
    applyRunId: v.id("reportingRun"),
    cursor: v.union(v.string(), v.null()),
    grantId: v.id("reportingBackfillAuthorizationGrant"),
    runId: v.id("reportingRun"),
  },
  handler: async (ctx, args) => {
    const [{ grant, run }, applyRun] = await Promise.all([
      requireAuthorizedLineageWithCtx(ctx, {
        grantId: args.grantId,
        runId: args.runId,
      }),
      ctx.db.get("reportingRun", args.applyRunId),
    ]);
    if (
      !applyRun ||
      !applyRun.backfillApplyManifestId ||
      !childMatchesLineage({ child: applyRun, grant, orchestrator: run }) ||
      applyRun.status !== "completed"
    ) {
      throw new Error("Authorized POS reconciliation lineage is incompatible");
    }
    const latestJournal = await latestJournalCursor(ctx, run.storeId);
    const manifest = await ctx.db.get(
      "reportingBackfillApplyManifest",
      applyRun.backfillApplyManifestId,
    );
    if (
      !manifest ||
      manifest.status !== "completed" ||
      !manifest.digest ||
      manifest.runId !== applyRun._id ||
      manifest.storeId !== run.storeId ||
      manifest.organizationId !== run.organizationId
    ) {
      throw new Error("Authorized POS reconciliation manifest is incompatible");
    }
    const lateJournalEvidence = await hasLatePreWatermarkJournalEvidence(ctx, {
      frozenWatermark: applyRun.frozenWatermark!,
      recordedAfter: applyRun.lifecycleJournalTerminalRecordedAt,
      storeId: run.storeId,
    });
    const priorRows = await ctx.db
      .query("reportingPosSourceReconciliation")
      .withIndex("by_grantId", (q) => q.eq("grantId", grant._id))
      .take(2);
    if (priorRows.length !== 1) throw new Error("POS reconciliation is unavailable");
    const prior = priorRows[0]!;
    if (prior.status === "verified") {
      return { complete: true, verified: true };
    }
    if ((prior.cursor ?? null) !== `manifest:${args.cursor ?? ""}`) {
      throw new Error("POS reconciliation cursor does not match its checkpoint");
    }
    const totals = {
      factAmountMinor: prior.factAmountMinor,
      factCount: prior.factCount,
      factQuantity: prior.factQuantity,
      sourceAmountMinor: prior.sourceAmountMinor,
      sourceCount: prior.sourceCount,
      sourceQuantity: prior.sourceQuantity,
      unexplainedCount: prior.unexplainedCount,
      journalCount: prior.journalCount ?? 0,
      journalMatchedCount: prior.journalMatchedCount ?? 0,
      authoritativeSourceCount: prior.authoritativeSourceCount ?? 0,
      authoritativeSourceDigest: prior.authoritativeSourceDigest,
      orphanPaymentCorrectionCount:
        prior.orphanPaymentCorrectionCount ?? 0,
    };
    const page = await ctx.db
      .query("reportingBackfillApplyManifestItem")
      .withIndex("by_manifestId_sequence", (q) =>
        q.eq("manifestId", applyRun.backfillApplyManifestId!),
      )
      .paginate({
        cursor: args.cursor,
        numItems: RECONCILIATION_PAGE_SIZE,
      });
    for (const item of page.page) {
      const candidate = parseHistoricalManifestCandidate(
        item.sanitizedCandidateJson,
      );
      const source = candidate.fact;
      if (manifestItemIsKnownExcludedPosSource({
        candidateExclusionReason: source.exclusionReason,
        candidateSourceType: source.sourceType,
        itemExclusionReason: item.exclusionReason,
        outcome: item.outcome,
      })) {
        continue;
      }
      totals.sourceCount += 1;
      totals.sourceAmountMinor += source.amountMinor ?? 0;
      totals.sourceQuantity += source.quantity ?? 0;
      const facts = await ctx.db
        .query("reportingFact")
        .withIndex("by_storeId_sourceDomain_businessEventKey", (q) =>
          q
            .eq("storeId", run.storeId)
            .eq("sourceDomain", "pos")
            .eq("businessEventKey", source.businessEventKey),
        )
        .take(2);
      const fact = facts.length === 1 ? facts[0] : null;
      if (fact) {
        totals.factCount += 1;
        totals.factAmountMinor += fact.amountMinor ?? 0;
        totals.factQuantity += fact.quantity ?? 0;
      }
      const materialMatches =
        fact !== null &&
        posManifestFactSemanticsMatch({
          fact,
          factContractVersion: applyRun.factContractVersion,
          metricContractVersion: applyRun.metricContractVersion,
          resolvedPeriod: candidate.resolvedPeriod,
          source,
        });
      if (
        item.outcome === "conflict" ||
        item.outcome === "excluded" ||
        item.outcome === "quarantined" ||
        !materialMatches
      ) {
        totals.unexplainedCount += 1;
      }
    }
    if (!page.isDone) {
      const value = {
        censusToken: run.censusToken!,
        contractVersion: run.financialDateContractVersion!,
        grantId: grant._id,
        organizationId: run.organizationId,
        runId: run._id,
        status: "building" as const,
        storeId: run.storeId,
        ...totals,
        cursor: `manifest:${page.continueCursor}`,
        updatedAt: Date.now(),
      };
      if (prior) await ctx.db.patch("reportingPosSourceReconciliation", prior._id, value);
      else await ctx.db.insert("reportingPosSourceReconciliation", value);
      await ctx.scheduler.runAfter(
        0,
        internal.reporting.maintenance.posCensusBackfill
          .processAuthorizedPosReconciliationBatch,
        {
          ...args,
          cursor: page.continueCursor,
        },
      );
      return { complete: false };
    }
    const attributionCursor = await currentSkuAttributionCursorWithCtx(
      ctx,
      run.storeId,
    );
    if (
      attributionCursor &&
      attributionCursor.latestAppliedSequence !==
        attributionCursor.latestMaterialSequence
    ) {
      await ctx.scheduler.runAfter(
        100,
        internal.reporting.maintenance.posCensusBackfill
          .processAuthorizedPosReconciliationBatch,
        args,
      );
      return { complete: false, waitingForAttribution: true };
    }
    const attributionTerminal = attributionCursor?.latestMaterialSequence;
    if (
      lateJournalEvidence ||
      attributionTerminal !== run.skuAttributionTerminalSequence
    ) {
      await ctx.db.delete("reportingPosSourceReconciliation", prior._id);
      await ctx.db.patch("reportingRun", run._id, {
        cursor: "pos_preview:queued",
        skuAttributionTerminalSequence: attributionTerminal,
      });
      await ctx.scheduler.runAfter(
        0,
        internal.reporting.maintenance.backfill.startHistoricalBackfill,
        {
          authorizationGrantId: grant._id,
          automationIdentity: "authorized_pos_census",
          censusToken: run.censusToken!,
          financialDateContractVersion: run.financialDateContractVersion!,
          lifecycleJournalTerminalId: latestJournal.id,
          lifecycleJournalTerminalRecordedAt: latestJournal.recordedAt,
          mode: "preview",
          orchestratorRunId: run._id,
          periodEnd: applyRun.frozenWatermark,
          requestKey: `authorized-pos-preview:${run.censusToken}:${latestJournal.id ?? "empty"}:${latestJournal.recordedAt ?? 0}`,
          sourceScope: "pos",
          skuAttributionTerminalSequence: attributionTerminal,
          storeId: run.storeId,
        },
      );
      return { complete: false, restarted: true };
    }
    const latestFacts = await ctx.db
      .query("reportingFact")
      .withIndex("by_storeId", (q) => q.eq("storeId", run.storeId))
      .order("desc")
      .take(1);
    const factSnapshotWatermark = latestFacts[0]?._creationTime ?? 0;
    const sourceCensusHash = sourceDerivedPosCensusHash({
      authoritativeSourceCount: totals.authoritativeSourceCount,
      authoritativeSourceDigest: totals.authoritativeSourceDigest,
      factContractVersion: applyRun.factContractVersion,
      financialDateContractVersion: run.financialDateContractVersion!,
      frozenWatermark: applyRun.frozenWatermark ?? 0,
      journalTerminalId: applyRun.lifecycleJournalTerminalId,
      journalTerminalRecordedAt:
        applyRun.lifecycleJournalTerminalRecordedAt,
      manifestDigest: manifest.digest,
      orphanPaymentCorrectionCount: totals.orphanPaymentCorrectionCount,
      skuAttributionTerminalSequence: attributionTerminal,
    });
    await ctx.db.patch("reportingRun", run._id, {
      factSnapshotWatermark,
      orphanPaymentCorrectionCount: totals.orphanPaymentCorrectionCount,
      sourceCensusHash,
      skuAttributionTerminalSequence: attributionTerminal,
    });
    const reconciliationId = await persistPosSourceReconciliationWithCtx(ctx, {
      censusToken: run.censusToken!,
      contractVersion: run.financialDateContractVersion!,
      factSnapshotWatermark,
      grantId: grant._id,
      lifecycleJournalTerminalId: applyRun.lifecycleJournalTerminalId,
      lifecycleJournalTerminalRecordedAt:
        applyRun.lifecycleJournalTerminalRecordedAt,
      runId: run._id,
      sourceManifestDigest: manifest.digest,
      sourceManifestId: manifest._id,
      sourceCensusHash,
      ...totals,
    });
    const persistedReconciliation = await ctx.db.get(
      "reportingPosSourceReconciliation",
      reconciliationId,
    );
    const completion = classifyAuthorizedPosReconciliationCompletion({
      frozenWatermark: applyRun.frozenWatermark,
      orphanDispositionMatchesApply:
        totals.orphanPaymentCorrectionCount ===
        (applyRun.orphanPaymentCorrectionCount ?? 0),
      persistedStatus: persistedReconciliation?.status,
      unexplainedCount: totals.unexplainedCount,
    });
    const completedAt = Date.now();
    if (!completion.verified) {
      await ctx.db.patch("reportingRun", run._id, {
        completedAt,
        cursor: completion.cursor,
        failedCount: completion.failedCount,
        frozenWatermark: applyRun.frozenWatermark,
        status: completion.status,
      });
      await ctx.db.patch("reportingBackfillAuthorizationGrant", grant._id, {
        status: "failed",
      });
      return { complete: true, verified: false };
    }
    await ctx.db.patch("reportingRun", run._id, {
      completedAt,
      cursor: completion.cursor,
      failedCount: completion.failedCount,
      frozenWatermark: applyRun.frozenWatermark,
      factSnapshotWatermark,
      sourceCensusHash,
      status: completion.status,
    });
    await ctx.db.patch("reportingBackfillAuthorizationGrant", grant._id, {
      completedAt,
      status: "completed",
    });
    const rebuildLineage = {
      automationIdentity: "authorized_pos_census",
      backfillAuthorizationGrantId: grant._id,
      censusToken: run.censusToken!,
      financialDateContractVersion: run.financialDateContractVersion!,
      factSnapshotWatermark,
      frozenWatermark: applyRun.frozenWatermark,
      sourceScope: "pos" as const,
      sourceCensusHash,
      skuAttributionTerminalSequence: attributionTerminal,
      storeId: run.storeId,
    };
    await Promise.all([
      ctx.scheduler.runAfter(
        0,
        internal.reporting.maintenance.rebuild.startProjectionRebuild,
        { ...rebuildLineage, projectionKind: "store_day" },
      ),
      ctx.scheduler.runAfter(
        0,
        internal.reporting.maintenance.rebuild.startProjectionRebuild,
        { ...rebuildLineage, projectionKind: "sku_day" },
      ),
      ctx.scheduler.runAfter(
        0,
        internal.reporting.maintenance.inventoryRebuild
          .startCurrentInventoryRebuild,
        rebuildLineage,
      ),
    ]);
    return { complete: true, verified: true };
  },
});
