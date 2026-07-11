import { v } from "convex/values";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../../_generated/server";
import {
  REPORTING_FACT_CONTRACT_VERSION,
  REPORTING_PROJECTION_CONTRACT_VERSION,
} from "../../../shared/reportingContract";
import { recognizeCommerceEvent } from "../facts";
import {
  canonicalReportingBusinessEventKey,
  canonicalReportingFactKey,
} from "../factIdentity";
import {
  canonicalReportingFactSemanticFingerprint,
  reportingFactKnownMaterialMatches,
  reportingPeriodLineage,
  type ReportingFactSemanticField,
  type ReportingFactSemanticInput,
} from "../factFingerprint";
import { recordFactSkuEvidenceWithCtx } from "../evidence";
import { upsertProjectionHealthWithCtx } from "../health";
import { resolveReportingOperatingPeriodWithCtx } from "../operatingPeriods";
import { adaptPosCompleted } from "../sourceAdapters/pos";
import { adaptStorefrontStatus } from "../sourceAdapters/storefront";
import type { CommerceLine } from "../sourceAdapters/types";
import {
  assertReportingRunTransition,
  createReportingRunWithCtx,
} from "./runLedger";
import {
  manifestCleanupEligibleAt,
  requireApprovedHistoricalPolicyWithCtx,
  resolveHistoricalPolicyOperatingPeriod,
} from "./legacyCompatibility";

export function classifyHistoricalCommerce(input: {
  currency: string | null;
  eventKey: string | null;
  occurredAt: number | null;
  requiresCurrency?: boolean;
  sourceId: string | null;
}) {
  const reasons: string[] = [];
  if (!input.eventKey || !input.sourceId) {
    reasons.push("missing_business_identity");
  }
  if ((input.requiresCurrency ?? true) && !input.currency) {
    reasons.push("missing_currency");
  }
  if (input.occurredAt === null) {
    reasons.push("missing_occurrence");
  }
  return {
    reasons,
    status:
      reasons.length === 0 ? ("eligible" as const) : ("quarantined" as const),
  };
}

export const HISTORICAL_SOURCE_LINE_LIMIT = 100;

export function classifyHistoricalSourceSize(
  count: number,
  limit = HISTORICAL_SOURCE_LINE_LIMIT,
) {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error(
      "Historical source size must be a non-negative safe integer",
    );
  }
  return count > limit
    ? ({
        reason: "historical_source_line_bound_exceeded",
        status: "quarantined",
      } as const)
    : ({ reason: null, status: "eligible" } as const);
}

export function reconcileHistoricalBackfillCounts(input: {
  conflict?: number;
  created: number;
  excluded: number;
  existing: number;
  planned: number;
  quarantined: number;
}) {
  const accounted =
    input.created +
    input.excluded +
    input.existing +
    input.quarantined +
    (input.conflict ?? 0);
  if (accounted !== input.planned) {
    throw new Error(
      `Historical backfill count mismatch: planned ${input.planned}, accounted ${accounted}`,
    );
  }
  return accounted;
}

export type HistoricalBackfillAuditCounts = {
  conflictCount: number;
  createdCount: number;
  duplicateCount: number;
  eligibleCount: number;
  excludedCount: number;
  existingCount: number;
  omittedCount: number;
  plannedCount: number;
  quarantinedCount: number;
  unknownCount: number;
  unknownFieldCount: number;
  inferredCount: number;
};

export const EMPTY_HISTORICAL_BACKFILL_AUDIT: HistoricalBackfillAuditCounts = {
  conflictCount: 0,
  createdCount: 0,
  duplicateCount: 0,
  eligibleCount: 0,
  excludedCount: 0,
  existingCount: 0,
  omittedCount: 0,
  plannedCount: 0,
  quarantinedCount: 0,
  unknownCount: 0,
  unknownFieldCount: 0,
  inferredCount: 0,
};

export function historicalBackfillCoverageBasisPoints(
  counts: HistoricalBackfillAuditCounts,
) {
  if (counts.plannedCount === 0) return 10_000;
  return Math.floor((counts.eligibleCount * 10_000) / counts.plannedCount);
}

export function mergeHistoricalBackfillAuditCounts(
  left: HistoricalBackfillAuditCounts,
  right: HistoricalBackfillAuditCounts,
): HistoricalBackfillAuditCounts {
  return {
    conflictCount: left.conflictCount + right.conflictCount,
    createdCount: left.createdCount + right.createdCount,
    duplicateCount: left.duplicateCount + right.duplicateCount,
    eligibleCount: left.eligibleCount + right.eligibleCount,
    excludedCount: left.excludedCount + right.excludedCount,
    existingCount: left.existingCount + right.existingCount,
    omittedCount: left.omittedCount + right.omittedCount,
    plannedCount: left.plannedCount + right.plannedCount,
    quarantinedCount: left.quarantinedCount + right.quarantinedCount,
    unknownCount: left.unknownCount + right.unknownCount,
    unknownFieldCount: left.unknownFieldCount + right.unknownFieldCount,
    inferredCount: left.inferredCount + right.inferredCount,
  };
}

export function historicalFactUnknownFields(fact: HistoricalPlannedFact) {
  const fields: string[] = [];
  const requiresCurrency =
    (fact.amountMinor !== undefined && fact.amountMinor !== 0) ||
    fact.cogsKnownMinor !== undefined;
  if (requiresCurrency && !normalizeCurrency(fact.currency)) {
    fields.push("currency");
  }
  if (fact.occurredAt === null) fields.push("occurrenceAt");
  if (fact.revenueKind === "merchandise" && !fact.productSkuId) {
    fields.push("productSkuId");
  }
  if (fact.costStatus === "unknown" || fact.costStatus === "partial") {
    fields.push("costBasis");
  }
  return fields;
}

export function historicalBackfillAuditForOutcome(input: {
  outcome: "conflict" | "created" | "excluded" | "existing" | "quarantined";
  unknownFieldCount: number;
  inferredCount?: number;
}): HistoricalBackfillAuditCounts {
  const createdCount = input.outcome === "created" ? 1 : 0;
  const existingCount = input.outcome === "existing" ? 1 : 0;
  const excludedCount = input.outcome === "excluded" ? 1 : 0;
  const conflictCount = input.outcome === "conflict" ? 1 : 0;
  const quarantinedCount = input.outcome === "quarantined" ? 1 : 0;
  return {
    conflictCount,
    createdCount,
    duplicateCount: existingCount,
    eligibleCount: createdCount + existingCount,
    excludedCount,
    existingCount,
    omittedCount: excludedCount + conflictCount + quarantinedCount,
    plannedCount: 1,
    quarantinedCount,
    unknownCount: input.unknownFieldCount > 0 ? 1 : 0,
    unknownFieldCount: input.unknownFieldCount,
    inferredCount: input.inferredCount ?? 0,
  };
}

export function historicalBackfillAuditOutcome(
  counts: HistoricalBackfillAuditCounts,
) {
  if (counts.conflictCount > 0 || counts.quarantinedCount > 0) {
    return "blocked" as const;
  }
  if (
    counts.excludedCount > 0 ||
    counts.unknownCount > 0 ||
    historicalBackfillCoverageBasisPoints(counts) < 10_000
  ) {
    return "partial" as const;
  }
  return "covered" as const;
}

function historicalBackfillAuditFromRun(
  run: Pick<
    Doc<"reportingRun">,
    | "conflictCount"
    | "createdCount"
    | "duplicateCount"
    | "eligibleCount"
    | "excludedCount"
    | "existingCount"
    | "omittedCount"
    | "plannedCount"
    | "quarantinedCount"
    | "unknownCount"
    | "unknownFieldCount"
    | "inferredCount"
  >,
): HistoricalBackfillAuditCounts {
  return {
    conflictCount: run.conflictCount ?? 0,
    createdCount: run.createdCount ?? 0,
    duplicateCount: run.duplicateCount ?? 0,
    eligibleCount: run.eligibleCount ?? 0,
    excludedCount: run.excludedCount ?? 0,
    existingCount: run.existingCount ?? 0,
    omittedCount: run.omittedCount ?? 0,
    plannedCount: run.plannedCount ?? 0,
    quarantinedCount: run.quarantinedCount ?? 0,
    unknownCount: run.unknownCount ?? 0,
    unknownFieldCount: run.unknownFieldCount ?? 0,
    inferredCount: run.inferredCount ?? 0,
  };
}

function historicalBackfillAuditPatch(counts: HistoricalBackfillAuditCounts) {
  return {
    ...counts,
    coverageBasisPoints: historicalBackfillCoverageBasisPoints(counts),
  };
}

async function upsertHistoricalBackfillSourceAudit(
  ctx: MutationCtx,
  input: {
    counts: HistoricalBackfillAuditCounts;
    now: number;
    run: Doc<"reportingRun">;
    sourceDomain: HistoricalPlannedFact["sourceDomain"];
  },
) {
  const matches = await ctx.db
    .query("reportingBackfillSourceAudit")
    .withIndex("by_runId_sourceDomain", (q) =>
      q.eq("runId", input.run._id).eq("sourceDomain", input.sourceDomain),
    )
    .take(2);
  if (matches.length > 1) {
    throw new Error("Historical backfill source audit identity is not unique");
  }
  const prior = matches[0];
  const merged = mergeHistoricalBackfillAuditCounts(
    prior
      ? { ...prior, inferredCount: prior.inferredCount ?? 0 }
      : EMPTY_HISTORICAL_BACKFILL_AUDIT,
    input.counts,
  );
  const value = {
    ...historicalBackfillAuditPatch(merged),
    mode: input.run.operation.endsWith("preview")
      ? ("preview" as const)
      : ("apply" as const),
    organizationId: input.run.organizationId,
    outcome: historicalBackfillAuditOutcome(merged),
    policyId: input.run.historicalInterpretationPolicyId,
    policyHash: input.run.historicalInterpretationPolicyHash,
    runId: input.run._id,
    sourceDomain: input.sourceDomain,
    storeId: input.run.storeId,
    updatedAt: input.now,
  };
  if (prior) {
    await ctx.db.patch("reportingBackfillSourceAudit", prior._id, value);
    return;
  }
  await ctx.db.insert("reportingBackfillSourceAudit", value);
}

export const HISTORICAL_BACKFILL_PHASES = [
  "pos",
  "pos_void",
  "pos_refund",
  "pos_adjustment",
  "pos_payment_correction",
  "storefront_delivered",
  "storefront_picked_up",
  "storefront_refund",
  "service",
  "purchase_order",
  "receiving",
  "expense",
  "payment_allocation",
  "done",
] as const;

export const HISTORICAL_BACKFILL_SCANNED_SOURCE_DOMAINS = [
  "pos",
  "storefront",
  "service",
  "inventory",
  "procurement",
  "payments",
] as const;

export type HistoricalBackfillPhase =
  (typeof HISTORICAL_BACKFILL_PHASES)[number];

export type HistoricalBackfillCursor = {
  pageCursor: string | null;
  phase: HistoricalBackfillPhase;
};

export function encodeHistoricalBackfillCursor(
  cursor: HistoricalBackfillCursor,
) {
  return JSON.stringify(cursor);
}

export function decodeHistoricalBackfillCursor(
  cursor: string | undefined,
): HistoricalBackfillCursor {
  if (!cursor) return { pageCursor: null, phase: "pos" };
  const parsed = JSON.parse(cursor) as Partial<HistoricalBackfillCursor>;
  if (
    typeof parsed.phase !== "string" ||
    !HISTORICAL_BACKFILL_PHASES.includes(
      parsed.phase as HistoricalBackfillPhase,
    ) ||
    (parsed.pageCursor !== null && typeof parsed.pageCursor !== "string")
  ) {
    throw new Error("Invalid historical backfill cursor");
  }
  return {
    pageCursor: parsed.pageCursor ?? null,
    phase: parsed.phase as HistoricalBackfillPhase,
  };
}

export function advanceHistoricalBackfillCursor(input: {
  continueCursor: string;
  isDone: boolean;
  phase: HistoricalBackfillPhase;
}): HistoricalBackfillCursor {
  if (!input.isDone) {
    return { pageCursor: input.continueCursor, phase: input.phase };
  }
  const index = HISTORICAL_BACKFILL_PHASES.indexOf(input.phase);
  return {
    pageCursor: null,
    phase:
      HISTORICAL_BACKFILL_PHASES[
        Math.min(index + 1, HISTORICAL_BACKFILL_PHASES.length - 1)
      ]!,
  };
}

export type HistoricalPlannedFact = {
  allocatedDiscountMinor?: number;
  attributionKind?: "direct" | "pending_checkout" | "inventory_import";
  attributionVersion?: number;
  amountMinor?: number;
  businessEventKey: string;
  completeness: Doc<"reportingFact">["completeness"];
  cogsKnownMinor?: number;
  cogsKnownQuantity?: number;
  cogsUncoveredQuantity?: number;
  costStatus: "known" | "partial" | "unknown" | "not_applicable";
  coveredRevenueMinor?: number;
  currency: string | null;
  factType:
    | "sale"
    | "correction"
    | "refund"
    | "return"
    | "void"
    | "inventory_issue"
    | "procurement_commitment"
    | "procurement_receipt"
    | "payment";
  limitingReason?: "source_incomplete" | "uncosted";
  linkedBusinessEventKey?: string;
  occurredAt: number | null;
  productSkuId?: string;
  quantity?: number;
  revenueKind?: "merchandise" | "service" | "delivery" | "tax";
  serviceCaseId?: string;
  sourceDomain:
    "pos" | "storefront" | "service" | "inventory" | "procurement" | "payments";
  sourceId: string;
  sourceLineKey?: string;
  sourceType: string;
  forceQuarantineReason?: string;
  expectedInboundAt?: number;
  procurementSignal?: "commitment" | "receipt" | "short_receipt";
  priorSettlementMethod?: string;
  correctedSettlementMethod?: string;
  commitmentConfirmed?: boolean;
  canonicalProductSkuId?: string;
  channel?: "pos" | "storefront" | "service";
  inventoryImportProvisionalSkuId?: string;
  originalProductSkuId?: string;
  originalQuantity?: number;
  pendingCheckoutItemId?: string;
  productId?: string;
  provisionalProductSkuId?: string;
  recognizedNetAmountMinor?: number;
  recognitionCategoryId?: string;
  recognitionProductId?: string;
  recognitionProductSkuId?: string;
  unitPriceMinor?: number;
  valuationCurrency?: string;
};

type HistoricalPolicy = Doc<"reportingHistoricalInterpretationPolicy">;

const POLICY_REVENUE_DOMAINS = new Set<HistoricalPlannedFact["sourceDomain"]>([
  "pos",
  "storefront",
  "service",
  "payments",
]);

export function normalizeHistoricalFactWithPolicy(input: {
  fact: HistoricalPlannedFact;
  policy: HistoricalPolicy | null;
}) {
  const fact = { ...input.fact };
  const inferredFields: string[] = [];
  const originallyMissingFields: string[] = [];
  const inPolicy = Boolean(
    input.policy &&
      fact.occurredAt !== null &&
      fact.occurredAt >= input.policy.intervalStart &&
      fact.occurredAt < input.policy.intervalEnd,
  );
  if (!fact.currency && POLICY_REVENUE_DOMAINS.has(fact.sourceDomain)) {
    originallyMissingFields.push("revenueCurrency");
    if (inPolicy) {
      fact.currency = input.policy!.revenueCurrencyCode;
      inferredFields.push("revenueCurrency");
    }
  }
  if (fact.cogsKnownMinor !== undefined && !fact.valuationCurrency) {
    originallyMissingFields.push("valuationCurrency");
    fact.cogsKnownMinor = undefined;
    fact.cogsKnownQuantity = undefined;
    fact.coveredRevenueMinor = undefined;
    fact.costStatus = "unknown";
    fact.completeness = "partial";
    fact.limitingReason = "uncosted";
  }
  return { fact, inferredFields, originallyMissingFields };
}

export function historicalPolicyExcludesClosedFact(input: {
  fact: Pick<HistoricalPlannedFact, "occurredAt">;
  policy: HistoricalPolicy | null;
}) {
  if (input.fact.occurredAt === null || !input.policy) return false;
  return (
    resolveHistoricalPolicyOperatingPeriod({
      occurrenceAt: input.fact.occurredAt,
      policy: input.policy,
    }).kind === "closed"
  );
}

export function planHistoricalReversalFacts(input: {
  currency: string | null;
  kind: "refund" | "void";
  occurredAt: number | null;
  originalFacts: HistoricalPlannedFact[];
  reversalBusinessEventKey: string;
}): HistoricalPlannedFact[] {
  return input.originalFacts.map((fact) => ({
    amountMinor:
      fact.amountMinor === undefined ? undefined : -Math.abs(fact.amountMinor),
    businessEventKey: canonicalReportingFactKey({
      businessEventKey: input.reversalBusinessEventKey,
      factType: input.kind,
      lineKey: fact.sourceLineKey,
    }),
    completeness: fact.completeness,
    costStatus: fact.costStatus,
    currency: input.currency,
    factType: input.kind,
    limitingReason: fact.limitingReason,
    linkedBusinessEventKey: fact.businessEventKey,
    occurredAt: input.occurredAt,
    attributionKind: fact.attributionKind,
    attributionVersion: fact.attributionVersion,
    canonicalProductSkuId: fact.canonicalProductSkuId,
    channel: fact.channel,
    inventoryImportProvisionalSkuId: fact.inventoryImportProvisionalSkuId,
    originalProductSkuId: fact.originalProductSkuId,
    originalQuantity: fact.originalQuantity,
    pendingCheckoutItemId: fact.pendingCheckoutItemId,
    productId: fact.productId,
    productSkuId: fact.productSkuId,
    provisionalProductSkuId: fact.provisionalProductSkuId,
    quantity:
      fact.quantity === undefined ? undefined : -Math.abs(fact.quantity),
    recognizedNetAmountMinor:
      fact.recognizedNetAmountMinor === undefined
        ? undefined
        : -Math.abs(fact.recognizedNetAmountMinor),
    recognitionCategoryId: fact.recognitionCategoryId,
    recognitionProductId: fact.recognitionProductId,
    recognitionProductSkuId: fact.recognitionProductSkuId,
    revenueKind: fact.revenueKind,
    serviceCaseId: fact.serviceCaseId,
    sourceDomain: fact.sourceDomain,
    sourceId: fact.sourceId,
    sourceLineKey: fact.sourceLineKey,
    sourceType: fact.sourceType,
    unitPriceMinor: fact.unitPriceMinor,
  }));
}

type ProcurementStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "ordered"
  | "partially_received"
  | "received"
  | "cancelled";

export function planHistoricalProcurementFacts(input: {
  cutoff: number;
  currency: string | null;
  expectedAt?: number;
  lines: Array<{
    id: string;
    lineTotalMinor: number;
    orderedQuantity: number;
    productSkuId: string;
    receivedQuantity: number;
    unitCostMinor: number;
  }>;
  occurredAt: number | null;
  purchaseOrderId: string;
  receipts: Array<{
    id: string;
    lines: Array<{
      confirmedCurrency?: string;
      confirmedUnitCostMinor?: number;
      productSkuId: string;
      purchaseOrderLineItemId: string;
      receivedQuantity: number;
    }>;
    receivedAt: number;
  }>;
  status: ProcurementStatus;
  statusOccurredAt: number | null;
}): HistoricalPlannedFact[] {
  const facts: HistoricalPlannedFact[] = [];
  if (input.occurredAt !== null && input.occurredAt <= input.cutoff) {
    for (const line of input.lines) {
      facts.push({
        amountMinor: line.lineTotalMinor,
        businessEventKey: canonicalReportingFactKey({
          businessEventKey: canonicalReportingBusinessEventKey({
            kind: "purchase_commitment",
            lineId: line.id,
            purchaseOrderId: input.purchaseOrderId,
          }),
          factType: "procurement_commitment",
          lineKey: line.id,
        }),
        completeness: "complete",
        costStatus: "not_applicable",
        currency: input.currency,
        factType: "procurement_commitment",
        expectedInboundAt: input.expectedAt,
        commitmentConfirmed: [
          "approved",
          "ordered",
          "partially_received",
          "received",
        ].includes(input.status),
        occurredAt: input.occurredAt,
        productSkuId: line.productSkuId,
        procurementSignal: "commitment",
        quantity: line.orderedQuantity,
        sourceDomain: "procurement",
        sourceId: input.purchaseOrderId,
        sourceLineKey: line.id,
        sourceType: "purchase_order",
      });
    }
  }
  if (
    input.expectedAt !== undefined &&
    input.occurredAt !== null &&
    input.occurredAt <= input.cutoff
  ) {
    facts.push({
      businessEventKey: `purchase_order:${input.purchaseOrderId}:expected:${input.expectedAt}`,
      completeness: "complete",
      costStatus: "not_applicable",
      currency: input.currency,
      factType: "correction",
      occurredAt: input.occurredAt,
      quantity: 0,
      sourceDomain: "procurement",
      sourceId: input.purchaseOrderId,
      sourceType: "purchase_order",
    });
  }
  const purchaseOrderLineById = new Map(
    input.lines.map((line) => [line.id, line]),
  );
  for (const receipt of input.receipts) {
    if (receipt.receivedAt > input.cutoff) continue;
    for (const line of receipt.lines) {
      const purchaseOrderLine = purchaseOrderLineById.get(
        line.purchaseOrderLineItemId,
      );
      const plannedCommitmentAmount =
        purchaseOrderLine !== undefined &&
        Number.isSafeInteger(purchaseOrderLine.unitCostMinor)
          ? purchaseOrderLine.unitCostMinor * line.receivedQuantity
          : undefined;
      const valuationCurrency = normalizeCurrency(line.confirmedCurrency);
      const knownCost =
        line.confirmedUnitCostMinor !== undefined && valuationCurrency !== null;
      facts.push({
        amountMinor: plannedCommitmentAmount,
        businessEventKey: canonicalReportingFactKey({
          businessEventKey: canonicalReportingBusinessEventKey({
            kind: "purchase_receipt",
            lineId: line.purchaseOrderLineItemId,
            purchaseOrderId: input.purchaseOrderId,
            receivingBatchId: receipt.id,
          }),
          factType: "procurement_receipt",
          lineKey: line.purchaseOrderLineItemId,
        }),
        completeness: knownCost ? "complete" : "partial",
        cogsKnownMinor: knownCost
          ? line.confirmedUnitCostMinor! * line.receivedQuantity
          : undefined,
        costStatus: knownCost ? "known" : "unknown",
        currency: input.currency,
        factType: "procurement_receipt",
        forceQuarantineReason:
          plannedCommitmentAmount === undefined
            ? "historical_receipt_purchase_order_evidence_missing"
            : undefined,
        expectedInboundAt: input.expectedAt,
        commitmentConfirmed: true,
        limitingReason: knownCost ? undefined : "uncosted",
        occurredAt: receipt.receivedAt,
        productSkuId: line.productSkuId,
        procurementSignal: "receipt",
        quantity: line.receivedQuantity,
        sourceDomain: "procurement",
        sourceId: receipt.id,
        sourceLineKey: line.purchaseOrderLineItemId,
        sourceType: "purchase_order_receiving_batch",
        valuationCurrency: valuationCurrency ?? undefined,
      });
    }
  }
  if (
    input.status === "cancelled" &&
    input.statusOccurredAt !== null &&
    input.statusOccurredAt <= input.cutoff
  ) {
    for (const line of input.lines) {
      const remainingQuantity = Math.max(
        0,
        line.orderedQuantity - line.receivedQuantity,
      );
      const commitmentKey = canonicalReportingFactKey({
        businessEventKey: canonicalReportingBusinessEventKey({
          kind: "purchase_commitment",
          lineId: line.id,
          purchaseOrderId: input.purchaseOrderId,
        }),
        factType: "procurement_commitment",
        lineKey: line.id,
      });
      facts.push({
        amountMinor: -(remainingQuantity * line.unitCostMinor),
        businessEventKey: canonicalReportingFactKey({
          businessEventKey: canonicalReportingBusinessEventKey({
            kind: "purchase_commitment_transition",
            lineId: line.id,
            purchaseOrderId: input.purchaseOrderId,
            status: "cancelled",
          }),
          factType: "procurement_commitment",
          lineKey: line.id,
        }),
        completeness: "complete",
        costStatus: "not_applicable",
        currency: input.currency,
        factType: "procurement_commitment",
        expectedInboundAt: input.expectedAt,
        commitmentConfirmed: true,
        linkedBusinessEventKey: commitmentKey,
        occurredAt: input.statusOccurredAt,
        productSkuId: line.productSkuId,
        procurementSignal: "commitment",
        quantity: -remainingQuantity,
        sourceDomain: "procurement",
        sourceId: input.purchaseOrderId,
        sourceLineKey: line.id,
        sourceType: "purchase_order",
      });
    }
  } else if (
    input.status === "received" &&
    input.statusOccurredAt !== null &&
    input.statusOccurredAt <= input.cutoff
  ) {
    for (const line of input.lines.filter(
      (candidate) => candidate.receivedQuantity < candidate.orderedQuantity,
    )) {
      facts.push({
        businessEventKey: `purchase_order:${input.purchaseOrderId}:line:${line.id}:short_receipt`,
        completeness: "partial",
        costStatus: "not_applicable",
        currency: input.currency,
        factType: "correction",
        expectedInboundAt: input.expectedAt,
        limitingReason: "source_incomplete",
        occurredAt: input.statusOccurredAt,
        productSkuId: line.productSkuId,
        procurementSignal: "short_receipt",
        quantity: line.orderedQuantity - line.receivedQuantity,
        sourceDomain: "procurement",
        sourceId: input.purchaseOrderId,
        sourceLineKey: line.id,
        sourceType: "purchase_order",
      });
    }
    facts.push({
      businessEventKey: `purchase_order:${input.purchaseOrderId}:completed:${input.statusOccurredAt}`,
      completeness: "complete",
      costStatus: "not_applicable",
      currency: input.currency,
      factType: "correction",
      occurredAt: input.statusOccurredAt,
      quantity: 0,
      sourceDomain: "procurement",
      sourceId: input.purchaseOrderId,
      sourceType: "purchase_order",
    });
  }
  return facts;
}

const historicalBackfillInternal = (internal as any).reporting.maintenance
  .backfill;
const PAGE_SIZE = 1;

function normalizeCurrency(value: string | null | undefined) {
  const normalized = value?.trim().toUpperCase();
  return normalized || null;
}

function safeFingerprintChecksum(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

type HistoricalPeriodIdentity = {
  operatingDate: string;
  scheduleVersionId?: string;
  historicalInterpretationPolicyId?: string;
  historicalInterpretationPolicyHash?: string;
};

type HistoricalFactScope = {
  organizationId: string;
  storeId: string;
};

function historicalPlannedFactSemantics(
  fact: HistoricalPlannedFact,
  period: HistoricalPeriodIdentity,
  scope: HistoricalFactScope,
): ReportingFactSemanticInput {
  if (fact.occurredAt === null) {
    throw new Error(
      "Historical fact occurrence is required for fingerprinting",
    );
  }
  return {
    allocatedDiscountMinor: fact.allocatedDiscountMinor,
    attributionKind: fact.attributionKind,
    attributionVersion: fact.attributionVersion,
    amountMinor: fact.amountMinor,
    businessEventKey: fact.businessEventKey,
    cogsKnownMinor: fact.cogsKnownMinor,
    cogsKnownQuantity: fact.cogsKnownQuantity,
    cogsUncoveredQuantity: fact.cogsUncoveredQuantity,
    commitmentConfirmed: fact.commitmentConfirmed,
    channel: fact.channel,
    completeness: fact.completeness,
    costStatus: fact.costStatus,
    coveredRevenueMinor: fact.coveredRevenueMinor,
    currencyCode: fact.currency ?? undefined,
    currencyMinorUnitScale: fact.currency ? 2 : undefined,
    expectedInboundAt: fact.expectedInboundAt,
    factType: fact.factType,
    linkedBusinessEventKey: fact.linkedBusinessEventKey,
    inventoryImportProvisionalSkuId: fact.inventoryImportProvisionalSkuId,
    occurrenceAt: fact.occurredAt,
    operatingDate: period.operatingDate,
    organizationId: scope.organizationId,
    originalProductSkuId: fact.originalProductSkuId,
    originalQuantity: fact.originalQuantity,
    pendingCheckoutItemId: fact.pendingCheckoutItemId,
    productId: fact.productId,
    procurementSignal: fact.procurementSignal,
    priorSettlementMethod: fact.priorSettlementMethod,
    correctedSettlementMethod: fact.correctedSettlementMethod,
    productSkuId: fact.productSkuId,
    provisionalProductSkuId: fact.provisionalProductSkuId,
    quantity: fact.quantity,
    revenueKind: fact.revenueKind,
    recognizedNetAmountMinor: fact.recognizedNetAmountMinor,
    recognitionCategoryId: fact.recognitionCategoryId,
    recognitionProductId: fact.recognitionProductId,
    recognitionProductSkuId: fact.recognitionProductSkuId,
    scheduleVersionId: period.scheduleVersionId,
    historicalInterpretationPolicyId:
      period.historicalInterpretationPolicyId,
    historicalInterpretationPolicyHash:
      period.historicalInterpretationPolicyHash,
    serviceCaseId: fact.serviceCaseId,
    sourceDomain: fact.sourceDomain,
    sourceLineKey: fact.sourceLineKey,
    storeId: scope.storeId,
    unitPriceMinor: fact.unitPriceMinor,
    valuationCurrencyCode: fact.valuationCurrency,
    valuationCurrencyMinorUnitScale: fact.valuationCurrency ? 2 : undefined,
  };
}

function persistedHistoricalFactSemantics(
  fact: Pick<
    Doc<"reportingFact">,
    | "amountMinor"
    | "allocatedDiscountMinor"
    | "attributionKind"
    | "attributionVersion"
    | "businessEventKey"
    | "categoryId"
    | "closeSnapshot"
    | "cogsKnownMinor"
    | "cogsKnownQuantity"
    | "cogsUncoveredQuantity"
    | "commitmentConfirmed"
    | "channel"
    | "completeness"
    | "costStatus"
    | "coveredRevenueMinor"
    | "currencyCode"
    | "currencyMinorUnitScale"
    | "expectedInboundAt"
    | "factType"
    | "inventoryEffectId"
    | "inventoryImportProvisionalSkuId"
    | "linkedBusinessEventKey"
    | "occurrenceAt"
    | "operatingDate"
    | "organizationId"
    | "originalProductSkuId"
    | "originalQuantity"
    | "pendingCheckoutItemId"
    | "productId"
    | "procurementSignal"
    | "priorSettlementMethod"
    | "correctedSettlementMethod"
    | "productSkuId"
    | "provisionalProductSkuId"
    | "quantity"
    | "revenueKind"
    | "recognizedNetAmountMinor"
    | "recognitionCategoryId"
    | "recognitionProductId"
    | "recognitionProductSkuId"
    | "scheduleVersionId"
    | "historicalInterpretationPolicyId"
    | "historicalInterpretationPolicyHash"
    | "serviceCaseId"
    | "sourceDomain"
    | "sourceLineKey"
    | "storeId"
    | "unitPriceMinor"
    | "valuationCurrencyCode"
    | "valuationCurrencyMinorUnitScale"
  >,
): ReportingFactSemanticInput {
  return {
    ...fact,
    categoryId: fact.categoryId ? String(fact.categoryId) : undefined,
    closeSnapshot: fact.closeSnapshot
      ? {
          ...fact.closeSnapshot,
          supersedesCloseId: fact.closeSnapshot.supersedesCloseId,
        }
      : undefined,
    currencyCode: fact.currencyCode,
    inventoryEffectId: fact.inventoryEffectId
      ? String(fact.inventoryEffectId)
      : undefined,
    organizationId: String(fact.organizationId),
    originalProductSkuId: fact.originalProductSkuId
      ? String(fact.originalProductSkuId)
      : undefined,
    pendingCheckoutItemId: fact.pendingCheckoutItemId
      ? String(fact.pendingCheckoutItemId)
      : undefined,
    productId: fact.productId ? String(fact.productId) : undefined,
    productSkuId: fact.productSkuId ? String(fact.productSkuId) : undefined,
    provisionalProductSkuId: fact.provisionalProductSkuId
      ? String(fact.provisionalProductSkuId)
      : undefined,
    recognitionCategoryId: fact.recognitionCategoryId
      ? String(fact.recognitionCategoryId)
      : undefined,
    recognitionProductId: fact.recognitionProductId
      ? String(fact.recognitionProductId)
      : undefined,
    recognitionProductSkuId: fact.recognitionProductSkuId
      ? String(fact.recognitionProductSkuId)
      : undefined,
    scheduleVersionId: fact.scheduleVersionId
      ? String(fact.scheduleVersionId)
      : undefined,
    historicalInterpretationPolicyId:
      fact.historicalInterpretationPolicyId
        ? String(fact.historicalInterpretationPolicyId)
        : undefined,
    historicalInterpretationPolicyHash:
      fact.historicalInterpretationPolicyHash,
    serviceCaseId: fact.serviceCaseId ? String(fact.serviceCaseId) : undefined,
    storeId: String(fact.storeId),
  };
}

export function fingerprintHistoricalPlannedFact(
  fact: HistoricalPlannedFact,
  period: HistoricalPeriodIdentity,
  scope: HistoricalFactScope,
) {
  return canonicalReportingFactSemanticFingerprint(
    historicalPlannedFactSemantics(fact, period, scope),
  );
}

export function fingerprintPersistedHistoricalFact(
  fact: Parameters<typeof persistedHistoricalFactSemantics>[0],
) {
  return canonicalReportingFactSemanticFingerprint(
    persistedHistoricalFactSemantics(fact),
  );
}

const HISTORICAL_UNAVAILABLE_SEMANTIC_FIELDS = [
  "categoryId",
  "closeSnapshot",
  "inventoryEffectId",
] as const satisfies readonly ReportingFactSemanticField[];

const HISTORICAL_OPTIONAL_SEMANTIC_FIELDS = [
  ["allocatedDiscountMinor", "allocatedDiscountMinor"],
  ["attributionKind", "attributionKind"],
  ["attributionVersion", "attributionVersion"],
  ["channel", "channel"],
  ["inventoryImportProvisionalSkuId", "inventoryImportProvisionalSkuId"],
  ["originalProductSkuId", "originalProductSkuId"],
  ["originalQuantity", "originalQuantity"],
  ["pendingCheckoutItemId", "pendingCheckoutItemId"],
  ["productId", "productId"],
  ["provisionalProductSkuId", "provisionalProductSkuId"],
  ["recognizedNetAmountMinor", "recognizedNetAmountMinor"],
  ["recognitionCategoryId", "recognitionCategoryId"],
  ["recognitionProductId", "recognitionProductId"],
  ["recognitionProductSkuId", "recognitionProductSkuId"],
  ["unitPriceMinor", "unitPriceMinor"],
  ["priorSettlementMethod", "priorSettlementMethod"],
  ["correctedSettlementMethod", "correctedSettlementMethod"],
  ["valuationCurrency", "valuationCurrencyCode"],
  ["valuationCurrency", "valuationCurrencyMinorUnitScale"],
] as const satisfies readonly [
  keyof HistoricalPlannedFact,
  ReportingFactSemanticField,
][];

export function historicalFactMatchesExistingCanonical(input: {
  existing: Parameters<typeof persistedHistoricalFactSemantics>[0];
  fact: HistoricalPlannedFact;
  period: HistoricalPeriodIdentity;
  scope: HistoricalFactScope;
}) {
  const unknownFields: ReportingFactSemanticField[] = [
    ...HISTORICAL_UNAVAILABLE_SEMANTIC_FIELDS,
  ];
  if (!normalizeCurrency(input.fact.currency)) {
    unknownFields.push("currencyCode", "currencyMinorUnitScale");
  }
  for (const [
    factField,
    semanticField,
  ] of HISTORICAL_OPTIONAL_SEMANTIC_FIELDS) {
    if (input.fact[factField] === undefined) unknownFields.push(semanticField);
  }
  if (
    input.fact.costStatus === "unknown" ||
    input.fact.costStatus === "partial"
  ) {
    unknownFields.push(
      "cogsKnownMinor",
      "cogsKnownQuantity",
      "cogsUncoveredQuantity",
      "costStatus",
      "coveredRevenueMinor",
      "completeness",
    );
  }
  return reportingFactKnownMaterialMatches({
    candidate: historicalPlannedFactSemantics(
      input.fact,
      input.period,
      input.scope,
    ),
    existing: persistedHistoricalFactSemantics(input.existing),
    unknownCandidateFields: unknownFields,
  });
}

function commerceFacts(
  event: Parameters<typeof recognizeCommerceEvent>[0],
  sourceType: string,
): HistoricalPlannedFact[] {
  return recognizeCommerceEvent(event).map((fact) => ({
    allocatedDiscountMinor: fact.allocatedDiscountMinor,
    attributionKind:
      fact.pendingCheckoutItemId !== null
        ? "pending_checkout"
        : fact.provisionalSkuId !== null
          ? "inventory_import"
          : "direct",
    attributionVersion: 1,
    amountMinor: fact.netRevenueMinor,
    businessEventKey: canonicalReportingFactKey({
      businessEventKey: fact.sourceEventKey,
      factType: "sale",
      lineKey: fact.lineId,
    }),
    cogsKnownMinor: fact.cogsKnownMinor ?? undefined,
    completeness: fact.costStatus === "unknown" ? "partial" : "complete",
    costStatus: fact.costStatus,
    canonicalProductSkuId: fact.canonicalSkuId ?? undefined,
    channel: fact.channel,
    currency: normalizeCurrency(fact.currency),
    factType: "sale",
    limitingReason: fact.costStatus === "unknown" ? "uncosted" : undefined,
    linkedBusinessEventKey: fact.linkedSourceEventKey ?? undefined,
    inventoryImportProvisionalSkuId:
      fact.inventoryImportProvisionalSkuId ?? undefined,
    originalProductSkuId: fact.originalSkuId ?? undefined,
    originalQuantity: fact.originalQuantity,
    pendingCheckoutItemId: fact.pendingCheckoutItemId ?? undefined,
    productId: fact.productId ?? undefined,
    occurredAt: fact.recognizedAt,
    productSkuId: fact.skuId ?? undefined,
    provisionalProductSkuId: fact.provisionalSkuId ?? undefined,
    quantity: fact.quantity,
    revenueKind: fact.revenueKind === "refund" ? undefined : fact.revenueKind,
    recognizedNetAmountMinor: fact.netRevenueMinor,
    recognitionProductSkuId: fact.skuId ?? undefined,
    serviceCaseId: fact.serviceCaseId ?? undefined,
    sourceDomain: fact.channel,
    sourceId: fact.sourceId,
    sourceLineKey: fact.lineId ?? undefined,
    sourceType,
    unitPriceMinor: fact.unitPriceMinor ?? undefined,
  }));
}

function oversizedSourceFact(input: {
  currency: string | null;
  eventKey: string;
  occurredAt: number | null;
  sourceDomain: HistoricalPlannedFact["sourceDomain"];
  sourceId: string;
  sourceType: string;
}): HistoricalPlannedFact {
  return {
    businessEventKey: input.eventKey,
    completeness: "partial",
    costStatus: "unknown",
    currency: input.currency,
    factType: "correction",
    forceQuarantineReason: "historical_source_line_bound_exceeded",
    limitingReason: "source_incomplete",
    occurredAt: input.occurredAt,
    sourceDomain: input.sourceDomain,
    sourceId: input.sourceId,
    sourceType: input.sourceType,
  };
}

async function quarantineHistoricalFact(
  ctx: MutationCtx,
  args: {
    apply: boolean;
    fact: HistoricalPlannedFact;
    factId?: Id<"reportingFact">;
    organizationId: Id<"organization">;
    reason: string;
    runId: Id<"reportingRun">;
    safeDiscriminator?: string;
    storeId: Id<"store">;
  },
) {
  if (!args.apply) return;
  const safeFingerprint = `historical:v2:${args.fact.sourceDomain}:${args.fact.businessEventKey}:${args.reason}${args.safeDiscriminator ? `:${args.safeDiscriminator}` : ""}`;
  const prior = await ctx.db
    .query("reportingQuarantine")
    .withIndex("by_storeId_status_detectedAt", (q) =>
      q.eq("storeId", args.storeId).eq("status", "open"),
    )
    .order("desc")
    .take(500);
  if (prior.some((row) => row.safeFingerprint === safeFingerprint)) return;
  await ctx.db.insert("reportingQuarantine", {
    detectedAt: Date.now(),
    factId: args.factId,
    organizationId: args.organizationId,
    resolutionRunId: args.runId,
    safeCode: args.reason,
    safeFingerprint,
    sourceDomain: args.fact.sourceDomain,
    status: "open",
    storeId: args.storeId,
  });
}

export async function recordHistoricalInterpretationEvidenceWithCtx(
  ctx: MutationCtx,
  input: {
    businessEventKey: string;
    factId: Id<"reportingFact">;
    inferredFields: string[];
    originallyMissingFields: string[];
    policy: HistoricalPolicy;
    run: Doc<"reportingRun">;
    sourceDomain: HistoricalPlannedFact["sourceDomain"];
  },
) {
  const existing = await ctx.db
    .query("reportingHistoricalInterpretationEvidence")
    .withIndex("by_policyId_sourceDomain_businessEventKey", (q) =>
      q
        .eq("policyId", input.policy._id)
        .eq("sourceDomain", input.sourceDomain)
        .eq("businessEventKey", input.businessEventKey),
    )
    .take(2);
  if (existing.length > 1) throw new Error("Historical interpretation evidence is not unique");
  if (existing[0]) {
    if (
      existing[0].factId !== input.factId ||
      JSON.stringify(existing[0].inferredFields) !== JSON.stringify(input.inferredFields) ||
      JSON.stringify(existing[0].originallyMissingFields) !==
        JSON.stringify(input.originallyMissingFields)
    ) {
      throw new Error("Historical interpretation evidence conflicts");
    }
    return existing[0]._id;
  }
  return ctx.db.insert("reportingHistoricalInterpretationEvidence", {
    businessEventKey: input.businessEventKey,
    createdAt: Date.now(),
    factId: input.factId,
    inferredFields: input.inferredFields,
    organizationId: input.run.organizationId,
    originallyMissingFields: input.originallyMissingFields,
    policyHash: input.policy.approvalHash!,
    policyId: input.policy._id,
    sourceDomain: input.sourceDomain,
    storeId: input.run.storeId,
  });
}

async function persistHistoricalFact(
  ctx: MutationCtx,
  args: {
    apply: boolean;
    fact: HistoricalPlannedFact;
    inferredFields: string[];
    now: number;
    originallyMissingFields: string[];
    policy: HistoricalPolicy | null;
    resolvedPeriod?: HistoricalPeriodIdentity | null;
    run: Doc<"reportingRun">;
  },
): Promise<"conflict" | "created" | "excluded" | "existing" | "quarantined"> {
  if (args.fact.forceQuarantineReason) {
    await quarantineHistoricalFact(ctx, {
      apply: args.apply,
      fact: args.fact,
      organizationId: args.run.organizationId,
      reason: args.fact.forceQuarantineReason,
      runId: args.run._id,
      storeId: args.run.storeId,
    });
    return "quarantined";
  }
  if (
    args.fact.completeness !== "complete" &&
    args.fact.completeness !== "partial"
  ) {
    await quarantineHistoricalFact(ctx, {
      apply: args.apply,
      fact: args.fact,
      organizationId: args.run.organizationId,
      reason: "historical_fact_completeness_invalid",
      runId: args.run._id,
      storeId: args.run.storeId,
    });
    return "quarantined";
  }
  const identityClassification = classifyHistoricalCommerce({
    currency: args.fact.currency,
    eventKey: args.fact.businessEventKey,
    occurredAt: args.fact.occurredAt,
    requiresCurrency: false,
    sourceId: args.fact.sourceId,
  });
  if (identityClassification.status === "quarantined") {
    await quarantineHistoricalFact(ctx, {
      apply: args.apply,
      fact: args.fact,
      organizationId: args.run.organizationId,
      reason: identityClassification.reasons.join("+"),
      runId: args.run._id,
      storeId: args.run.storeId,
    });
    return "quarantined";
  }
  if (
    args.fact.occurredAt! > args.run.frozenWatermark! ||
    (args.run.periodStart !== undefined &&
      args.fact.occurredAt! < args.run.periodStart)
  ) {
    return "excluded";
  }
  if (args.fact.productSkuId) {
    const sku = await ctx.db.get(
      "productSku",
      args.fact.productSkuId as Id<"productSku">,
    );
    if (!sku || String(sku.storeId) !== String(args.run.storeId)) {
      await quarantineHistoricalFact(ctx, {
        apply: args.apply,
        fact: args.fact,
        organizationId: args.run.organizationId,
        reason: "cross_store_reference",
        runId: args.run._id,
        storeId: args.run.storeId,
      });
      return "quarantined";
    }
  }
  const period =
    args.resolvedPeriod !== undefined
      ? args.resolvedPeriod
      : await resolveHistoricalFactPeriodWithCtx(
          ctx,
          args.fact,
          args.run,
          args.policy,
        );
  if (!period) {
    if (
      historicalPolicyExcludesClosedFact({
        fact: args.fact,
        policy: args.policy,
      })
    ) {
      return "excluded";
    }
    await quarantineHistoricalFact(ctx, {
      apply: args.apply,
      fact: args.fact,
      organizationId: args.run.organizationId,
      reason: "missing_reporting_period",
      runId: args.run._id,
      storeId: args.run.storeId,
    });
    return "quarantined";
  }
  const expectedFingerprint = fingerprintHistoricalPlannedFact(
    args.fact,
    {
      operatingDate: period.operatingDate,
      scheduleVersionId: period.scheduleVersionId,
      historicalInterpretationPolicyId: period.historicalInterpretationPolicyId,
      historicalInterpretationPolicyHash: period.historicalInterpretationPolicyHash,
    },
    {
      organizationId: String(args.run.organizationId),
      storeId: String(args.run.storeId),
    },
  );
  const existing = await ctx.db
    .query("reportingFact")
    .withIndex("by_storeId_sourceDomain_businessEventKey", (q) =>
      q
        .eq("storeId", args.run.storeId)
        .eq("sourceDomain", args.fact.sourceDomain)
        .eq("businessEventKey", args.fact.businessEventKey),
    )
    .take(2);
  if (existing.length > 1)
    throw new Error("Historical fact identity is not unique");
  if (existing[0]) {
    if (
      !historicalFactMatchesExistingCanonical({
        existing: existing[0],
        fact: args.fact,
        period: {
          operatingDate: period.operatingDate,
          scheduleVersionId: period.scheduleVersionId,
          historicalInterpretationPolicyId:
            period.historicalInterpretationPolicyId,
          historicalInterpretationPolicyHash:
            period.historicalInterpretationPolicyHash,
        },
        scope: {
          organizationId: String(args.run.organizationId),
          storeId: String(args.run.storeId),
        },
      })
    ) {
      const persistedFingerprint = fingerprintPersistedHistoricalFact(
        existing[0],
      );
      await quarantineHistoricalFact(ctx, {
        apply: args.apply,
        fact: args.fact,
        factId: existing[0]._id,
        organizationId: args.run.organizationId,
        reason: "historical_fact_conflict",
        runId: args.run._id,
        safeDiscriminator: `${safeFingerprintChecksum(expectedFingerprint)}:${safeFingerprintChecksum(persistedFingerprint)}`,
        storeId: args.run.storeId,
      });
      return "conflict";
    }
    if (args.apply) {
      await recordFactSkuEvidenceWithCtx(ctx, existing[0]);
      if (args.policy && args.originallyMissingFields.length > 0) {
        await recordHistoricalInterpretationEvidenceWithCtx(ctx, {
          businessEventKey: args.fact.businessEventKey,
          factId: existing[0]._id,
          inferredFields: args.inferredFields,
          originallyMissingFields: args.originallyMissingFields,
          policy: args.policy,
          run: args.run,
          sourceDomain: args.fact.sourceDomain,
        });
      }
    }
    return "existing";
  }
  const classification = classifyHistoricalCommerce({
    currency: args.fact.currency,
    eventKey: args.fact.businessEventKey,
    occurredAt: args.fact.occurredAt,
    requiresCurrency:
      args.fact.amountMinor !== undefined &&
      args.fact.amountMinor !== 0 &&
      POLICY_REVENUE_DOMAINS.has(args.fact.sourceDomain),
    sourceId: args.fact.sourceId,
  });
  if (classification.status === "quarantined") {
    await quarantineHistoricalFact(ctx, {
      apply: args.apply,
      fact: args.fact,
      organizationId: args.run.organizationId,
      reason: classification.reasons.join("+"),
      runId: args.run._id,
      storeId: args.run.storeId,
    });
    return "quarantined";
  }
  if (!args.apply) return "created";
  const factId = await ctx.db.insert("reportingFact", {
    acceptedAt: args.now,
    allocatedDiscountMinor: args.fact.allocatedDiscountMinor,
    amountMinor: args.fact.amountMinor,
    attributionKind: args.fact.attributionKind,
    attributionVersion: args.fact.attributionVersion,
    businessEventKey: args.fact.businessEventKey,
    canonicalProductSkuId: args.fact.canonicalProductSkuId as
      Id<"productSku"> | undefined,
    channel: args.fact.channel,
    cogsKnownMinor: args.fact.cogsKnownMinor,
    cogsKnownQuantity: args.fact.cogsKnownQuantity,
    cogsUncoveredQuantity: args.fact.cogsUncoveredQuantity,
    completeness: args.fact.completeness,
    contentFingerprint: expectedFingerprint,
    costStatus: args.fact.costStatus,
    coveredRevenueMinor: args.fact.coveredRevenueMinor,
    createdAt: args.now,
    ...(args.fact.currency
      ? {
          currencyCode: args.fact.currency,
          currencyMinorUnitScale: 2,
          revenueCurrencyCode: args.fact.currency,
          revenueCurrencyMinorUnitScale: 2,
        }
      : {}),
    ...(args.fact.valuationCurrency
      ? {
          valuationCurrencyCode: args.fact.valuationCurrency,
          valuationCurrencyMinorUnitScale: 2,
        }
      : {}),
    factContractVersion: REPORTING_FACT_CONTRACT_VERSION,
    factType: args.fact.factType,
    expectedInboundAt: args.fact.expectedInboundAt,
    commitmentConfirmed: args.fact.commitmentConfirmed,
    limitingReason: args.fact.limitingReason,
    linkedBusinessEventKey: args.fact.linkedBusinessEventKey,
    inventoryImportProvisionalSkuId: args.fact
      .inventoryImportProvisionalSkuId as
      Id<"inventoryImportProvisionalSku"> | undefined,
    metricContractVersion: 1,
    occurrenceAt: args.fact.occurredAt!,
    operatingDate: period.operatingDate,
    organizationId: args.run.organizationId,
    originalProductSkuId: args.fact.originalProductSkuId as
      Id<"productSku"> | undefined,
    originalQuantity: args.fact.originalQuantity,
    pendingCheckoutItemId: args.fact.pendingCheckoutItemId as
      Id<"posPendingCheckoutItem"> | undefined,
    productId: args.fact.productId as Id<"product"> | undefined,
    productSkuId: args.fact.productSkuId as Id<"productSku"> | undefined,
    procurementSignal: args.fact.procurementSignal,
    priorSettlementMethod: args.fact.priorSettlementMethod,
    correctedSettlementMethod: args.fact.correctedSettlementMethod,
    provisionalProductSkuId: args.fact.provisionalProductSkuId as
      Id<"productSku"> | undefined,
    quantity: args.fact.quantity,
    recognizedNetAmountMinor: args.fact.recognizedNetAmountMinor,
    recognitionAt: args.fact.occurredAt!,
    recognitionCategoryId: args.fact.recognitionCategoryId as
      Id<"category"> | undefined,
    recognitionProductId: args.fact.recognitionProductId as
      Id<"product"> | undefined,
    recognitionProductSkuId: args.fact.recognitionProductSkuId as
      Id<"productSku"> | undefined,
    revenueKind: args.fact.revenueKind,
    scheduleVersionId: period.scheduleVersionId as
      | Id<"storeSchedule">
      | undefined,
    historicalInterpretationPolicyId: period.historicalInterpretationPolicyId as
      | Id<"reportingHistoricalInterpretationPolicy">
      | undefined,
    historicalInterpretationPolicyHash:
      period.historicalInterpretationPolicyHash,
    serviceCaseId: args.fact.serviceCaseId as Id<"serviceCase"> | undefined,
    sourceDomain: args.fact.sourceDomain,
    sourceLineKey: args.fact.sourceLineKey,
    status: "canonical",
    storeId: args.run.storeId,
    unitPriceMinor: args.fact.unitPriceMinor,
  });
  if (args.policy && args.originallyMissingFields.length > 0) {
    await recordHistoricalInterpretationEvidenceWithCtx(ctx, {
      businessEventKey: args.fact.businessEventKey,
      factId,
      inferredFields: args.inferredFields,
      originallyMissingFields: args.originallyMissingFields,
      policy: args.policy,
      run: args.run,
      sourceDomain: args.fact.sourceDomain,
    });
  }
  await ctx.db.insert("reportingFactSourceReference", {
    createdAt: args.now,
    factId,
    relation:
      args.fact.factType === "refund" ||
      args.fact.factType === "return" ||
      args.fact.factType === "void"
        ? "reverses"
        : args.fact.factType === "correction"
          ? "corrects"
          : "owns",
    sourceId: args.fact.sourceId,
    sourceType: args.fact.sourceType,
    storeId: args.run.storeId,
  });
  const createdFact = await ctx.db.get("reportingFact", factId);
  if (!createdFact)
    throw new Error("Historical reporting fact was not persisted");
  await recordFactSkuEvidenceWithCtx(ctx, createdFact);
  return "created";
}

export function historicalPosCommerceLine(
  item: Pick<
    Doc<"posTransactionItem">,
    | "_id"
    | "discount"
    | "inventoryImportProvisionalSkuId"
    | "pendingCheckoutItemId"
    | "productId"
    | "productSkuId"
    | "quantity"
    | "totalPrice"
    | "unitPrice"
  >,
  attribution?: Pick<
    Doc<"reportingSkuAttribution">,
    "canonicalProductSkuId" | "pendingCheckoutItemId"
  >,
): CommerceLine {
  const isProvisional =
    item.pendingCheckoutItemId !== undefined ||
    item.inventoryImportProvisionalSkuId !== undefined;
  return {
    allocatedDiscountMinor: item.discount ?? 0,
    canonicalSkuId: item.pendingCheckoutItemId
      ? attribution
        ? String(attribution.canonicalProductSkuId)
        : undefined
      : item.inventoryImportProvisionalSkuId
        ? undefined
        : String(item.productSkuId),
    cogsKnownMinor: null,
    inventoryImportProvisionalSkuId: item.inventoryImportProvisionalSkuId
      ? String(item.inventoryImportProvisionalSkuId)
      : undefined,
    kind: "merchandise",
    lineId: String(item._id),
    netRevenueMinor: item.totalPrice,
    originalSkuId: String(item.productSkuId),
    pendingCheckoutItemId: item.pendingCheckoutItemId
      ? String(item.pendingCheckoutItemId)
      : undefined,
    productId: String(item.productId),
    provisionalSkuId: isProvisional ? String(item.productSkuId) : undefined,
    quantity: item.quantity,
    skuId: String(item.productSkuId),
    unitPriceMinor: item.unitPrice,
  };
}

async function planPosRow(
  ctx: MutationCtx,
  transaction: Doc<"posTransaction">,
  store: Doc<"store">,
  mode: "sale" | "refund" | "void" = "sale",
  cutoff = Number.MAX_SAFE_INTEGER,
) {
  const [items, services] = await Promise.all([
    ctx.db
      .query("posTransactionItem")
      .withIndex("by_transactionId", (q) =>
        q.eq("transactionId", transaction._id),
      )
      .take(HISTORICAL_SOURCE_LINE_LIMIT + 1),
    ctx.db
      .query("posTransactionServiceLine")
      .withIndex("by_transactionId", (q) =>
        q.eq("transactionId", transaction._id),
      )
      .take(HISTORICAL_SOURCE_LINE_LIMIT + 1),
  ]);
  if (
    classifyHistoricalSourceSize(items.length + services.length).status ===
    "quarantined"
  ) {
    return [
      oversizedSourceFact({
        currency: null,
        eventKey: `pos:${transaction._id}:source_incomplete`,
        occurredAt: transaction.completedAt,
        sourceDomain: "pos",
        sourceId: String(transaction._id),
        sourceType: "pos_transaction",
      }),
    ];
  }
  const attributionByPendingCheckoutItemId = new Map<
    string,
    Doc<"reportingSkuAttribution">
  >();
  for (const item of items) {
    if (!item.pendingCheckoutItemId) continue;
    const attribution = await ctx.db
      .query("reportingSkuAttribution")
      .withIndex("by_storeId_pendingCheckoutItemId", (q) =>
        q
          .eq("storeId", transaction.storeId)
          .eq("pendingCheckoutItemId", item.pendingCheckoutItemId!),
      )
      .first();
    if (attribution && attribution.status !== "conflict") {
      attributionByPendingCheckoutItemId.set(
        String(item.pendingCheckoutItemId),
        attribution,
      );
    }
  }
  const lines = [
    ...items.map((item) =>
      historicalPosCommerceLine(
        item,
        item.pendingCheckoutItemId
          ? attributionByPendingCheckoutItemId.get(
              String(item.pendingCheckoutItemId),
            )
          : undefined,
      ),
    ),
    ...services.map((line) => ({
      kind: "service" as const,
      lineId: String(line._id),
      netRevenueMinor: line.totalPrice,
      quantity: line.quantity,
      serviceCaseId: String(line.serviceCaseId),
    })),
    ...(transaction.tax === 0
      ? []
      : [
          {
            kind: "tax" as const,
            lineId: "tax",
            netRevenueMinor: transaction.tax,
            quantity: 0,
          },
        ]),
  ];
  const originalFacts = commerceFacts(
    adaptPosCompleted({
      currency: "",
      lines,
      occurredAt: transaction.completedAt,
      recordedAt: transaction._creationTime,
      storeId: String(store._id),
      transactionId: String(transaction._id),
    }),
    "pos_transaction",
  );
  if (mode === "sale") return originalFacts;
  if (mode === "void") {
    return [
      ...originalFacts,
      ...planHistoricalReversalFacts({
        currency: null,
        kind: "void",
        occurredAt: transaction.voidedAt ?? null,
        originalFacts,
        reversalBusinessEventKey: canonicalReportingBusinessEventKey({
          kind: "pos_void",
          transactionId: String(transaction._id),
        }),
      }),
    ];
  }
  const refundedFacts: HistoricalPlannedFact[] = [];
  for (const item of items) {
    const refundedQuantity =
      item.refundedQuantity ?? (item.isRefunded ? item.quantity : 0);
    if (!item.refundedAt || item.refundedAt > cutoff || refundedQuantity <= 0)
      continue;
    const original = originalFacts.find(
      (fact) => fact.sourceLineKey === String(item._id),
    );
    if (!original) continue;
    refundedFacts.push({
      ...planHistoricalReversalFacts({
        currency: null,
        kind: "refund",
        occurredAt: item.refundedAt,
        originalFacts: [
          {
            ...original,
            amountMinor: Math.round(
              (item.totalPrice * refundedQuantity) / item.quantity,
            ),
            quantity: refundedQuantity,
          },
        ],
        reversalBusinessEventKey: canonicalReportingBusinessEventKey({
          kind: "pos_refund",
          refundId: String(item.refundedAt),
          transactionId: String(transaction._id),
        }),
      })[0]!,
    });
  }
  if (refundedFacts.length === 0) {
    refundedFacts.push(
      oversizedSourceFact({
        currency: null,
        eventKey: `pos:${transaction._id}:refund:source_incomplete`,
        occurredAt: transaction.refundedAt ?? null,
        sourceDomain: "pos",
        sourceId: String(transaction._id),
        sourceType: "pos_transaction",
      }),
    );
  }
  return [...originalFacts, ...refundedFacts];
}

async function planStorefrontRow(
  ctx: MutationCtx,
  order: Doc<"onlineOrder">,
  store: Doc<"store">,
) {
  const storedItems = await ctx.db
    .query("onlineOrderItem")
    .withIndex("by_orderId", (q) => q.eq("orderId", order._id))
    .take(HISTORICAL_SOURCE_LINE_LIMIT + 1);
  if (
    classifyHistoricalSourceSize(storedItems.length).status === "quarantined"
  ) {
    return [
      oversizedSourceFact({
        currency: null,
        eventKey: `storefront:${order._id}:source_incomplete`,
        occurredAt: order.completedAt ?? null,
        sourceDomain: "storefront",
        sourceId: String(order._id),
        sourceType: "online_order",
      }),
    ];
  }
  const items = storedItems.length > 0 ? storedItems : (order.items ?? []);
  if (classifyHistoricalSourceSize(items.length).status === "quarantined") {
    return [
      oversizedSourceFact({
        currency: null,
        eventKey: `storefront:${order._id}:source_incomplete`,
        occurredAt: order.completedAt ?? null,
        sourceDomain: "storefront",
        sourceId: String(order._id),
        sourceType: "online_order",
      }),
    ];
  }
  const fulfillmentTransition = [...(order.transitions ?? [])]
    .filter((transition) => transition.date <= (order.completedAt ?? 0))
    .sort((left, right) => left.date - right.date);
  const currentIndex = fulfillmentTransition.findLastIndex(
    (transition) => transition.status === order.status,
  );
  const previousStatus =
    currentIndex > 0
      ? fulfillmentTransition[currentIndex - 1]!.status
      : "unknown";
  const lines: CommerceLine[] = items.map((item, index) => ({
    cogsKnownMinor: null,
    kind: "merchandise" as const,
    lineId: String("_id" in item ? item._id : `${item.productSkuId}:${index}`),
    netRevenueMinor: item.price * item.quantity,
    quantity: item.quantity,
    skuId: String(item.productSkuId),
  }));
  if ((order.deliveryFee ?? 0) !== 0) {
    lines.push({
      kind: "delivery",
      lineId: "delivery",
      netRevenueMinor: order.deliveryFee!,
      quantity: 0,
    });
  }
  return commerceFacts(
    adaptStorefrontStatus({
      currency: "",
      lines,
      occurredAt: order.completedAt!,
      orderId: String(order._id),
      previousStatus,
      recordedAt: order.updatedAt ?? order._creationTime,
      status: order.status,
      storeId: String(store._id),
    }),
    "online_order",
  );
}

async function planStorefrontRefundRow(
  ctx: MutationCtx,
  order: Doc<"onlineOrder">,
  store: Doc<"store">,
  cutoff: number,
) {
  const refunds = (order.refunds ?? []).filter(
    (refund) => refund.date <= cutoff,
  );
  if (refunds.length === 0) return [];
  const items = await ctx.db
    .query("onlineOrderItem")
    .withIndex("by_orderId", (q) => q.eq("orderId", order._id))
    .take(HISTORICAL_SOURCE_LINE_LIMIT + 1);
  if (
    classifyHistoricalSourceSize(items.length + refunds.length).status ===
    "quarantined"
  ) {
    return [
      oversizedSourceFact({
        currency: null,
        eventKey: `storefront:${order._id}:refund:source_incomplete`,
        occurredAt: refunds.at(-1)?.date ?? null,
        sourceDomain: "storefront",
        sourceId: String(order._id),
        sourceType: "online_order",
      }),
    ];
  }
  const fulfillmentEventKey = canonicalReportingBusinessEventKey({
    kind: "storefront_fulfillment",
    orderId: String(order._id),
  });
  const facts: HistoricalPlannedFact[] = refunds.map((refund) => ({
    amountMinor: -Math.abs(refund.amount),
    businessEventKey: canonicalReportingFactKey({
      businessEventKey: canonicalReportingBusinessEventKey({
        kind: "storefront_refund",
        orderId: String(order._id),
        refundId: refund.id,
      }),
      factType: "refund",
    }),
    completeness: "partial",
    costStatus: "unknown",
    currency: null,
    factType: "refund",
    limitingReason: "uncosted",
    linkedBusinessEventKey: fulfillmentEventKey,
    occurredAt: refund.date,
    quantity: 0,
    sourceDomain: "storefront",
    sourceId: String(order._id),
    sourceType: "online_order",
  }));
  const refundedItems = items.filter((item) => item.isRefunded);
  if (refundedItems.length > 0 && refunds.length !== 1) {
    facts.push(
      oversizedSourceFact({
        currency: null,
        eventKey: `storefront:${order._id}:return_mapping:source_incomplete`,
        occurredAt: refunds.at(-1)?.date ?? null,
        sourceDomain: "storefront",
        sourceId: String(order._id),
        sourceType: "online_order",
      }),
    );
  } else if (refunds[0]) {
    for (const item of refundedItems) {
      facts.push({
        amountMinor: 0,
        businessEventKey: `storefront:${order._id}:return:${item._id}:${refunds[0].id}`,
        completeness: "partial",
        costStatus: "unknown",
        currency: null,
        factType: "return",
        limitingReason: "uncosted",
        linkedBusinessEventKey: canonicalReportingFactKey({
          businessEventKey: canonicalReportingBusinessEventKey({
            kind: "storefront_refund",
            orderId: String(order._id),
            refundId: refunds[0].id,
          }),
          factType: "refund",
        }),
        occurredAt: refunds[0].date,
        productSkuId: String(item.productSkuId),
        quantity: -Math.abs(item.quantity),
        sourceDomain: "storefront",
        sourceId: String(order._id),
        sourceLineKey: String(item._id),
        sourceType: "online_order",
      });
    }
  }
  return facts;
}

async function planPosAdjustmentRow(
  ctx: MutationCtx,
  adjustment: Doc<"posTransactionAdjustment">,
  _store: Doc<"store">,
) {
  const lines = await ctx.db
    .query("posTransactionAdjustmentLine")
    .withIndex("by_adjustmentId", (q) => q.eq("adjustmentId", adjustment._id))
    .take(HISTORICAL_SOURCE_LINE_LIMIT + 1);
  if (classifyHistoricalSourceSize(lines.length).status === "quarantined") {
    return [
      oversizedSourceFact({
        currency: normalizeCurrency(adjustment.currency),
        eventKey: `pos:${adjustment.transactionId}:adjustment:${adjustment._id}:source_incomplete`,
        occurredAt: adjustment.appliedAt ?? null,
        sourceDomain: "pos",
        sourceId: String(adjustment._id),
        sourceType: "pos_transaction_adjustment",
      }),
    ];
  }
  const facts: HistoricalPlannedFact[] = lines.map((line) => ({
    amountMinor: line.correctedTotal - line.originalTotal,
    businessEventKey: `pos:${adjustment.transactionId}:adjustment:${adjustment._id}:line:${line._id}`,
    completeness: "partial",
    costStatus: "unknown",
    currency: normalizeCurrency(adjustment.currency),
    factType: "correction",
    limitingReason: "uncosted",
    linkedBusinessEventKey: `pos:${adjustment.transactionId}:complete:${line.originalTransactionItemId ?? line._id}`,
    occurredAt: adjustment.appliedAt ?? null,
    productSkuId: String(line.productSkuId),
    quantity: line.quantityDelta,
    revenueKind: "merchandise",
    sourceDomain: "pos",
    sourceId: String(adjustment._id),
    sourceLineKey: String(line._id),
    sourceType: "pos_transaction_adjustment",
  }));
  const lineDelta = lines.reduce(
    (sum, line) => sum + line.correctedTotal - line.originalTotal,
    0,
  );
  const taxDelta = adjustment.deltaTotal - lineDelta;
  if (taxDelta !== 0) {
    facts.push({
      amountMinor: taxDelta,
      businessEventKey: `pos:${adjustment.transactionId}:adjustment:${adjustment._id}:tax`,
      completeness: "complete",
      costStatus: "not_applicable",
      currency: normalizeCurrency(adjustment.currency),
      factType: "correction",
      linkedBusinessEventKey: `pos:${adjustment.transactionId}:complete:tax`,
      occurredAt: adjustment.appliedAt ?? null,
      quantity: 0,
      revenueKind: "tax",
      sourceDomain: "pos",
      sourceId: String(adjustment._id),
      sourceLineKey: "tax",
      sourceType: "pos_transaction_adjustment",
    });
  }
  return facts;
}

function planPosPaymentCorrectionRow(
  event: Doc<"operationalEvent">,
): HistoricalPlannedFact[] {
  if (event.eventType !== "pos_transaction_payment_method_corrected") return [];
  const transactionId =
    event.posTransactionId ??
    (event.subjectType === "pos_transaction" ? event.subjectId : null);
  const priorSettlementMethod =
    typeof event.metadata?.previousPaymentMethod === "string"
      ? event.metadata.previousPaymentMethod
      : undefined;
  const correctedSettlementMethod =
    typeof event.metadata?.paymentMethod === "string"
      ? event.metadata.paymentMethod
      : undefined;
  return [
    {
      amountMinor: 0,
      businessEventKey: transactionId
        ? `pos:${transactionId}:correction:${event._id}`
        : "",
      completeness: "complete",
      costStatus: "not_applicable",
      correctedSettlementMethod,
      currency: null,
      factType: "correction",
      linkedBusinessEventKey: transactionId
        ? `pos:${transactionId}:complete`
        : undefined,
      occurredAt: event.createdAt,
      priorSettlementMethod,
      quantity: 0,
      sourceDomain: "pos",
      sourceId: String(event._id),
      sourceType: "operational_event",
    },
  ];
}

async function planServiceRow(
  ctx: MutationCtx,
  serviceCase: Doc<"serviceCase">,
  _store: Doc<"store">,
) {
  const [posLine, lineItems] = await Promise.all([
    ctx.db
      .query("posTransactionServiceLine")
      .withIndex("by_serviceCaseId", (q) =>
        q.eq("serviceCaseId", serviceCase._id),
      )
      .first(),
    ctx.db
      .query("serviceCaseLineItem")
      .withIndex("by_serviceCaseId", (q) =>
        q.eq("serviceCaseId", serviceCase._id),
      )
      .take(HISTORICAL_SOURCE_LINE_LIMIT + 1),
  ]);
  if (posLine) return [];
  if (classifyHistoricalSourceSize(lineItems.length).status === "quarantined") {
    return [
      oversizedSourceFact({
        currency: null,
        eventKey: `service:${serviceCase._id}:source_incomplete`,
        occurredAt: serviceCase.completedAt ?? null,
        sourceDomain: "service",
        sourceId: String(serviceCase._id),
        sourceType: "service_case",
      }),
    ];
  }
  const serviceLines =
    lineItems.length > 0
      ? lineItems.map((line) => ({
          amountMinor: line.amount,
          lineKey: String(line._id),
          quantity: line.quantity,
        }))
      : [
          {
            amountMinor: serviceCase.totalAmount,
            lineKey: "service",
            quantity: 1,
          },
        ];
  const sourceEventKey = canonicalReportingBusinessEventKey({
    kind: "service_completion",
    serviceCaseId: String(serviceCase._id),
  });
  return serviceLines.map((line): HistoricalPlannedFact => ({
    amountMinor: line.amountMinor,
    businessEventKey: canonicalReportingFactKey({
      businessEventKey: sourceEventKey,
      factType: "sale",
      lineKey: line.lineKey,
    }),
    completeness: "complete",
    costStatus: "not_applicable",
    currency: null,
    factType: "sale",
    occurredAt: serviceCase.completedAt ?? null,
    quantity: line.quantity,
    revenueKind: "service",
    serviceCaseId: String(serviceCase._id),
    sourceDomain: "service",
    sourceId: String(serviceCase._id),
    sourceLineKey: line.lineKey,
    sourceType: "service_case",
  }));
}

async function planPurchaseOrderRow(
  ctx: MutationCtx,
  purchaseOrder: Doc<"purchaseOrder">,
  cutoff: number,
) {
  const lines = await ctx.db
    .query("purchaseOrderLineItem")
    .withIndex("by_purchaseOrderId", (q) =>
      q.eq("purchaseOrderId", purchaseOrder._id),
    )
    .take(HISTORICAL_SOURCE_LINE_LIMIT + 1);
  if (classifyHistoricalSourceSize(lines.length).status === "quarantined") {
    return [
      oversizedSourceFact({
        currency: normalizeCurrency(purchaseOrder.currency),
        eventKey: `purchase_order:${purchaseOrder._id}:source_incomplete`,
        occurredAt: purchaseOrder.createdAt,
        sourceDomain: "procurement",
        sourceId: String(purchaseOrder._id),
        sourceType: "purchase_order",
      }),
    ];
  }
  const statusOccurredAt =
    purchaseOrder.cancelledAt ??
    purchaseOrder.receivedAt ??
    purchaseOrder.orderedAt ??
    purchaseOrder.approvedAt ??
    purchaseOrder.submittedAt ??
    purchaseOrder.createdAt;
  return planHistoricalProcurementFacts({
    cutoff,
    currency: normalizeCurrency(purchaseOrder.currency),
    expectedAt: purchaseOrder.expectedAt,
    lines: lines.map((line) => ({
      id: String(line._id),
      lineTotalMinor: line.lineTotal,
      orderedQuantity: line.orderedQuantity,
      productSkuId: String(line.productSkuId),
      receivedQuantity: line.receivedQuantity,
      unitCostMinor: line.unitCost,
    })),
    occurredAt: purchaseOrder.createdAt,
    purchaseOrderId: String(purchaseOrder._id),
    receipts: [],
    status: purchaseOrder.status,
    statusOccurredAt,
  });
}

function unavailableReceivingEvidenceFact(
  batch: Doc<"receivingBatch">,
  reason: string,
): HistoricalPlannedFact {
  return {
    businessEventKey: `purchase_order:${batch.purchaseOrderId}:receipt:${batch._id}:source_incomplete`,
    completeness: "partial",
    costStatus: "unknown",
    currency: null,
    factType: "correction",
    forceQuarantineReason: reason,
    limitingReason: "source_incomplete",
    occurredAt: batch.receivedAt,
    sourceDomain: "procurement",
    sourceId: String(batch._id),
    sourceType: "purchase_order_receiving_batch",
  };
}

async function planReceivingRow(
  ctx: MutationCtx,
  batch: Doc<"receivingBatch">,
  cutoff: number,
  store: Doc<"store">,
) {
  if (
    classifyHistoricalSourceSize(batch.lineItems.length).status ===
    "quarantined"
  ) {
    return [
      oversizedSourceFact({
        currency: null,
        eventKey: `purchase_order:${batch.purchaseOrderId}:receipt:${batch._id}:source_incomplete`,
        occurredAt: batch.receivedAt,
        sourceDomain: "procurement",
        sourceId: String(batch._id),
        sourceType: "purchase_order_receiving_batch",
      }),
    ];
  }
  const purchaseOrder = await ctx.db.get(
    "purchaseOrder",
    batch.purchaseOrderId,
  );
  if (
    !purchaseOrder ||
    batch.storeId !== store._id ||
    purchaseOrder.storeId !== store._id ||
    (batch.organizationId !== undefined &&
      batch.organizationId !== store.organizationId) ||
    (purchaseOrder.organizationId !== undefined &&
      purchaseOrder.organizationId !== store.organizationId)
  ) {
    return [
      unavailableReceivingEvidenceFact(
        batch,
        "historical_receipt_purchase_order_evidence_missing",
      ),
    ];
  }
  const purchaseOrderLines = await ctx.db
    .query("purchaseOrderLineItem")
    .withIndex("by_purchaseOrderId", (q) =>
      q.eq("purchaseOrderId", purchaseOrder._id),
    )
    .take(HISTORICAL_SOURCE_LINE_LIMIT + 1);
  if (
    classifyHistoricalSourceSize(purchaseOrderLines.length).status ===
    "quarantined"
  ) {
    return [
      oversizedSourceFact({
        currency: normalizeCurrency(purchaseOrder.currency),
        eventKey: `purchase_order:${batch.purchaseOrderId}:receipt:${batch._id}:source_incomplete`,
        occurredAt: batch.receivedAt,
        sourceDomain: "procurement",
        sourceId: String(batch._id),
        sourceType: "purchase_order_receiving_batch",
      }),
    ];
  }
  const purchaseOrderLineById = new Map(
    purchaseOrderLines.map((line) => [String(line._id), line]),
  );
  const hasInvalidLineEvidence = batch.lineItems.some((line) => {
    const purchaseOrderLine = purchaseOrderLineById.get(
      String(line.purchaseOrderLineItemId),
    );
    return (
      !purchaseOrderLine ||
      purchaseOrderLine.storeId !== store._id ||
      purchaseOrderLine.purchaseOrderId !== purchaseOrder._id ||
      purchaseOrderLine.productSkuId !== line.productSkuId
    );
  });
  if (hasInvalidLineEvidence) {
    return [
      unavailableReceivingEvidenceFact(
        batch,
        "historical_receipt_purchase_order_line_evidence_missing",
      ),
    ];
  }
  return planHistoricalProcurementFacts({
    cutoff,
    currency: normalizeCurrency(purchaseOrder.currency),
    lines: purchaseOrderLines.map((line) => ({
      id: String(line._id),
      lineTotalMinor: line.lineTotal,
      orderedQuantity: line.orderedQuantity,
      productSkuId: String(line.productSkuId),
      receivedQuantity: line.receivedQuantity,
      unitCostMinor: line.unitCost,
    })),
    occurredAt: null,
    purchaseOrderId: String(batch.purchaseOrderId),
    receipts: [
      {
        id: String(batch._id),
        lines: batch.lineItems.map((line) => ({
          confirmedCurrency:
            normalizeCurrency(line.confirmedCurrency) ?? undefined,
          confirmedUnitCostMinor: line.confirmedUnitCost,
          productSkuId: String(line.productSkuId),
          purchaseOrderLineItemId: String(line.purchaseOrderLineItemId),
          receivedQuantity: line.receivedQuantity,
        })),
        receivedAt: batch.receivedAt,
      },
    ],
    status: "partially_received",
    statusOccurredAt: batch.receivedAt,
  });
}

async function planExpenseRow(
  ctx: MutationCtx,
  expense: Doc<"expenseTransaction">,
  _store: Doc<"store">,
) {
  const items = await ctx.db
    .query("expenseTransactionItem")
    .withIndex("by_transactionId", (q) => q.eq("transactionId", expense._id))
    .take(HISTORICAL_SOURCE_LINE_LIMIT + 1);
  if (classifyHistoricalSourceSize(items.length).status === "quarantined") {
    return [
      oversizedSourceFact({
        currency: null,
        eventKey: `expense:${expense._id}:source_incomplete`,
        occurredAt: expense.completedAt,
        sourceDomain: "inventory",
        sourceId: String(expense._id),
        sourceType: "expense_transaction",
      }),
    ];
  }
  return items.map((item): HistoricalPlannedFact => ({
    businessEventKey: `expense:${expense._id}:line:${item._id}:completed`,
    cogsKnownMinor: item.costPrice * item.quantity,
    completeness: "complete",
    costStatus: "known",
    currency: null,
    factType: "inventory_issue",
    occurredAt: expense.completedAt,
    productSkuId: String(item.productSkuId),
    quantity: item.quantity,
    sourceDomain: "inventory",
    sourceId: String(expense._id),
    sourceLineKey: String(item._id),
    sourceType: "expense_transaction",
  }));
}

export function planPaymentAllocationFact(
  allocation: Doc<"paymentAllocation">,
): HistoricalPlannedFact[] {
  const eventKey = `payment_allocation:${String(allocation._id)}:${allocation.status}`;
  const reversed = allocation.status === "voided";
  const outbound = allocation.direction === "out";
  return [
    {
      amountMinor:
        reversed || outbound
          ? -Math.abs(allocation.amount)
          : Math.abs(allocation.amount),
      businessEventKey: canonicalReportingFactKey({
        businessEventKey: eventKey,
        factType: "payment",
      }),
      completeness: "complete",
      costStatus: "not_applicable",
      currency: normalizeCurrency(allocation.currency),
      factType: "payment",
      linkedBusinessEventKey: reversed
        ? `payment_allocation:${String(allocation._id)}:recorded`
        : undefined,
      occurredAt: allocation.recordedAt,
      sourceDomain: "payments",
      sourceId: String(allocation._id),
      sourceType: "payment_allocation",
    },
  ];
}

function loadPosPage(
  ctx: MutationCtx,
  args: {
    cursor: string | null;
    cutoff: number;
    status: string;
    storeId: Id<"store">;
  },
) {
  return ctx.db
    .query("posTransaction")
    .withIndex("by_storeId_status_completedAt", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("status", args.status)
        .lte("completedAt", args.cutoff),
    )
    .paginate({ cursor: args.cursor, numItems: PAGE_SIZE });
}

function loadPosAdjustmentPage(
  ctx: MutationCtx,
  args: { cursor: string | null; cutoff: number; storeId: Id<"store"> },
) {
  return ctx.db
    .query("posTransactionAdjustment")
    .withIndex("by_storeId_status_appliedAt", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("status", "applied")
        .lte("appliedAt", args.cutoff),
    )
    .paginate({ cursor: args.cursor, numItems: PAGE_SIZE });
}

function loadPosPaymentCorrectionPage(
  ctx: MutationCtx,
  args: { cursor: string | null; cutoff: number; storeId: Id<"store"> },
) {
  return ctx.db
    .query("operationalEvent")
    .withIndex("by_storeId_createdAt", (q) =>
      q.eq("storeId", args.storeId).lte("createdAt", args.cutoff),
    )
    .paginate({ cursor: args.cursor, numItems: PAGE_SIZE });
}

function loadStorefrontPage(
  ctx: MutationCtx,
  args: {
    cursor: string | null;
    cutoff: number;
    status: string;
    storeId: Id<"store">;
  },
) {
  return ctx.db
    .query("onlineOrder")
    .withIndex("by_storeId_status_completedAt", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("status", args.status)
        .lte("completedAt", args.cutoff),
    )
    .paginate({ cursor: args.cursor, numItems: PAGE_SIZE });
}

function loadStorefrontRefundPage(
  ctx: MutationCtx,
  args: { cursor: string | null; storeId: Id<"store"> },
) {
  return ctx.db
    .query("onlineOrder")
    .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
    .paginate({ cursor: args.cursor, numItems: PAGE_SIZE });
}

function loadServicePage(
  ctx: MutationCtx,
  args: { cursor: string | null; cutoff: number; storeId: Id<"store"> },
) {
  return ctx.db
    .query("serviceCase")
    .withIndex("by_storeId_status_completedAt", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("status", "completed")
        .lte("completedAt", args.cutoff),
    )
    .paginate({ cursor: args.cursor, numItems: PAGE_SIZE });
}

function loadPurchaseOrderPage(
  ctx: MutationCtx,
  args: { cursor: string | null; cutoff: number; storeId: Id<"store"> },
) {
  return ctx.db
    .query("purchaseOrder")
    .withIndex("by_storeId_createdAt", (q) =>
      q.eq("storeId", args.storeId).lte("createdAt", args.cutoff),
    )
    .paginate({ cursor: args.cursor, numItems: PAGE_SIZE });
}

function loadReceivingPage(
  ctx: MutationCtx,
  args: { cursor: string | null; cutoff: number; storeId: Id<"store"> },
) {
  return ctx.db
    .query("receivingBatch")
    .withIndex("by_storeId_receivedAt", (q) =>
      q.eq("storeId", args.storeId).lte("receivedAt", args.cutoff),
    )
    .paginate({ cursor: args.cursor, numItems: PAGE_SIZE });
}

function loadExpensePage(
  ctx: MutationCtx,
  args: { cursor: string | null; cutoff: number; storeId: Id<"store"> },
) {
  return ctx.db
    .query("expenseTransaction")
    .withIndex("by_storeId_status_completedAt", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("status", "completed")
        .lte("completedAt", args.cutoff),
    )
    .paginate({ cursor: args.cursor, numItems: PAGE_SIZE });
}

function loadPaymentAllocationPage(
  ctx: MutationCtx,
  args: { cursor: string | null; cutoff: number; storeId: Id<"store"> },
) {
  return ctx.db
    .query("paymentAllocation")
    .withIndex("by_storeId_recordedAt", (q) =>
      q.eq("storeId", args.storeId).lte("recordedAt", args.cutoff),
    )
    .paginate({ cursor: args.cursor, numItems: PAGE_SIZE });
}

export function assertHistoricalBackfillPreviewCompatible(input: {
  organizationId: Id<"organization">;
  periodEnd?: number;
  periodStart?: number;
  preview: Pick<
    Doc<"reportingRun">,
    | "factContractVersion"
    | "frozenWatermark"
    | "metricContractVersion"
    | "operation"
    | "organizationId"
    | "periodEnd"
    | "periodStart"
    | "projectionContractVersion"
    | "runType"
    | "status"
    | "storeId"
  >;
  storeId: Id<"store">;
}) {
  const preview = input.preview;
  if (
    preview.runType !== "backfill" ||
    preview.operation !== "historical_backfill_preview" ||
    preview.status !== "completed" ||
    preview.organizationId !== input.organizationId ||
    preview.storeId !== input.storeId ||
    preview.factContractVersion !== REPORTING_FACT_CONTRACT_VERSION ||
    preview.metricContractVersion !== 1 ||
    preview.projectionContractVersion !==
      REPORTING_PROJECTION_CONTRACT_VERSION ||
    preview.frozenWatermark === undefined ||
    preview.periodEnd !== preview.frozenWatermark ||
    (input.periodStart !== undefined &&
      input.periodStart !== preview.periodStart) ||
    (input.periodEnd !== undefined && input.periodEnd !== preview.periodEnd)
  ) {
    throw new Error(
      "Historical backfill apply requires a compatible completed preview",
    );
  }
  return preview;
}

function historicalBackfillAuditCountsMatch(
  preview: HistoricalBackfillAuditCounts,
  apply: HistoricalBackfillAuditCounts,
) {
  return (
    Object.keys(preview) as Array<keyof HistoricalBackfillAuditCounts>
  ).every((field) => preview[field] === apply[field]);
}

async function resolveHistoricalFactPeriodWithCtx(
  ctx: MutationCtx,
  fact: HistoricalPlannedFact,
  run: Doc<"reportingRun">,
  policy: HistoricalPolicy | null,
): Promise<HistoricalPeriodIdentity | null> {
  if (fact.occurredAt !== null) {
    const period = await resolveReportingOperatingPeriodWithCtx(ctx, {
      occurrenceAt: fact.occurredAt,
      storeId: run.storeId,
    });
    if (period.kind === "resolved") {
      return {
        operatingDate: period.operatingDate,
        scheduleVersionId: String(period.scheduleVersionId),
      };
    }
    if (policy) {
      const policyPeriod = resolveHistoricalPolicyOperatingPeriod({
        occurrenceAt: fact.occurredAt,
        policy,
      });
      if (policyPeriod.kind === "resolved") {
        return {
          operatingDate: policyPeriod.operatingDate,
          historicalInterpretationPolicyId:
            policyPeriod.historicalInterpretationPolicyId,
          historicalInterpretationPolicyHash:
            policyPeriod.historicalInterpretationPolicyHash,
        };
      }
    }
  }
  return null;
}

async function fingerprintHistoricalCandidateWithCtx(
  ctx: MutationCtx,
  fact: HistoricalPlannedFact,
  run: Doc<"reportingRun">,
  policy: HistoricalPolicy | null,
  resolvedPeriod?: HistoricalPeriodIdentity | null,
) {
  const period =
    resolvedPeriod !== undefined
      ? resolvedPeriod
      : await resolveHistoricalFactPeriodWithCtx(ctx, fact, run, policy);
  if (period) {
    return fingerprintHistoricalPlannedFact(fact, period, {
      organizationId: String(run.organizationId),
      storeId: String(run.storeId),
    });
  }
  return JSON.stringify(["historical-backfill-candidate-v1", fact]);
}

async function findHistoricalPreviewItem(
  ctx: MutationCtx,
  input: {
    businessEventKey: string;
    runId: Id<"reportingRun">;
    sourceDomain: HistoricalPlannedFact["sourceDomain"];
  },
) {
  const matches = await ctx.db
    .query("reportingBackfillPreviewItem")
    .withIndex("by_runId_sourceDomain_businessEventKey", (q) =>
      q
        .eq("runId", input.runId)
        .eq("sourceDomain", input.sourceDomain)
        .eq("businessEventKey", input.businessEventKey),
    )
    .take(2);
  if (matches.length > 1) {
    throw new Error(
      "Historical backfill preview candidate identity is not unique",
    );
  }
  return matches[0] ?? null;
}

function historicalPreviewBusinessEventKey(fact: HistoricalPlannedFact) {
  return (
    fact.businessEventKey ||
    `invalid:${fact.sourceType}:${fact.sourceId}:${safeFingerprintChecksum(JSON.stringify(fact))}`
  );
}

async function recordHistoricalPreviewItem(
  ctx: MutationCtx,
  input: {
    candidateFingerprint: string;
    fact: HistoricalPlannedFact;
    inferredFields: string[];
    originallyMissingFields: string[];
    outcome: Doc<"reportingBackfillPreviewItem">["outcome"];
    policy: HistoricalPolicy | null;
    run: Doc<"reportingRun">;
  },
) {
  const existing = await findHistoricalPreviewItem(ctx, {
    businessEventKey: historicalPreviewBusinessEventKey(input.fact),
    runId: input.run._id,
    sourceDomain: input.fact.sourceDomain,
  });
  if (existing) {
    if (
      existing.candidateFingerprint !== input.candidateFingerprint ||
      existing.outcome !== input.outcome
    ) {
      throw new Error(
        "Historical backfill preview candidate changed within the run",
      );
    }
    return existing._id;
  }
  return ctx.db.insert("reportingBackfillPreviewItem", {
    businessEventKey: historicalPreviewBusinessEventKey(input.fact),
    candidateFingerprint: input.candidateFingerprint,
    createdAt: Date.now(),
    organizationId: input.run.organizationId,
    outcome: input.outcome,
    runId: input.run._id,
    sourceDomain: input.fact.sourceDomain,
    storeId: input.run.storeId,
    policyId: input.policy?._id,
    policyHash: input.policy?.approvalHash,
    inferredFields: input.inferredFields,
    originallyMissingFields: input.originallyMissingFields,
  });
}

type HistoricalManifestItemInput = {
  businessEventKey: string;
  candidateFingerprint: string;
  inferredFields: string[];
  originallyMissingFields: string[];
  outcome: Doc<"reportingBackfillApplyManifestItem">["outcome"];
  sanitizedCandidateJson: string;
  sequence: number;
  sourceDomain: HistoricalPlannedFact["sourceDomain"];
};

export function historicalManifestEntryDigest(
  priorDigest: string,
  item: HistoricalManifestItemInput,
) {
  return `historical-manifest-v1:${safeFingerprintChecksum(
    JSON.stringify([
      priorDigest,
      item.sequence,
      item.sourceDomain,
      item.businessEventKey,
      item.candidateFingerprint,
      item.outcome,
      item.inferredFields,
      item.originallyMissingFields,
      item.sanitizedCandidateJson,
    ]),
  )}`;
}

type HistoricalManifestCandidate = {
  fact: HistoricalPlannedFact;
  resolvedPeriod: HistoricalPeriodIdentity | null;
};

export function historicalManifestCandidateJson(
  fact: HistoricalPlannedFact,
  resolvedPeriod: HistoricalPeriodIdentity | null,
) {
  return JSON.stringify({ fact, resolvedPeriod });
}

export function parseHistoricalManifestCandidate(value: string) {
  const parsed = JSON.parse(value) as HistoricalManifestCandidate;
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !parsed.fact ||
    typeof parsed.fact.sourceDomain !== "string" ||
    typeof parsed.fact.sourceType !== "string" ||
    typeof parsed.fact.sourceId !== "string" ||
    (parsed.resolvedPeriod !== null &&
      (typeof parsed.resolvedPeriod !== "object" ||
        typeof parsed.resolvedPeriod.operatingDate !== "string"))
  ) {
    throw new Error("Historical backfill manifest candidate is invalid");
  }
  if (parsed.resolvedPeriod) {
    reportingPeriodLineage(parsed.resolvedPeriod);
  }
  return parsed;
}

async function requireBackfillManifestWithCtx(
  ctx: MutationCtx,
  run: Doc<"reportingRun">,
) {
  if (!run.backfillApplyManifestId) {
    throw new Error("Historical backfill apply manifest is unavailable");
  }
  const manifest = await ctx.db.get(
    "reportingBackfillApplyManifest",
    run.backfillApplyManifestId,
  );
  if (
    !manifest ||
    manifest.runId !== run._id ||
    manifest.storeId !== run.storeId ||
    manifest.organizationId !== run.organizationId ||
    manifest.previewRunId !== run.previewRunId ||
    manifest.policyId !== run.historicalInterpretationPolicyId ||
    manifest.policyHash !== run.historicalInterpretationPolicyHash
  ) {
    throw new Error("Historical backfill apply manifest lineage is incompatible");
  }
  return manifest;
}

export const startHistoricalBackfill = internalMutation({
  args: {
    automationIdentity: v.string(),
    mode: v.union(v.literal("preview"), v.literal("apply")),
    periodEnd: v.optional(v.number()),
    periodStart: v.optional(v.number()),
    policyId: v.optional(v.id("reportingHistoricalInterpretationPolicy")),
    policyHash: v.optional(v.string()),
    previewRunId: v.optional(v.id("reportingRun")),
    requestKey: v.string(),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    const store = await ctx.db.get("store", args.storeId);
    if (!store) throw new Error("Store not found");
    const now = Date.now();
    if (args.mode === "preview" && args.previewRunId !== undefined) {
      throw new Error(
        "Historical backfill previews cannot reference another preview",
      );
    }
    const preview =
      args.mode === "apply"
        ? args.previewRunId
          ? await ctx.db.get("reportingRun", args.previewRunId)
          : null
        : null;
    if (args.mode === "apply" && !preview) {
      throw new Error("Historical backfill apply requires a completed preview");
    }
    if (preview) {
      assertHistoricalBackfillPreviewCompatible({
        organizationId: store.organizationId,
        periodEnd: args.periodEnd,
        periodStart: args.periodStart,
        preview,
        storeId: store._id,
      });
    }
    const policyId = preview?.historicalInterpretationPolicyId ?? args.policyId;
    const policyHash = preview?.historicalInterpretationPolicyHash ?? args.policyHash;
    if ((policyId === undefined) !== (policyHash === undefined)) {
      throw new Error("Historical backfill policy identity is incomplete");
    }
    if (
      preview &&
      (args.policyId !== undefined || args.policyHash !== undefined) &&
      (args.policyId !== policyId || args.policyHash !== policyHash)
    ) {
      throw new Error("Historical backfill apply policy differs from preview");
    }
    if (policyId && policyHash) {
      await requireApprovedHistoricalPolicyWithCtx(ctx, {
        policyId,
        policyHash,
        storeId: store._id,
      });
    }
    const periodStart = preview?.periodStart ?? args.periodStart ?? 0;
    const periodEnd = preview?.frozenWatermark ?? args.periodEnd ?? now;
    if (
      !Number.isSafeInteger(periodStart) ||
      !Number.isSafeInteger(periodEnd) ||
      periodStart < 0 ||
      periodEnd < periodStart ||
      periodEnd > now
    ) {
      throw new Error("Historical backfill period is invalid");
    }
    const result = await createReportingRunWithCtx(ctx, {
      actorKind: "automation",
      automationIdentity: args.automationIdentity,
      createdAt: now,
      domain: "reporting",
      factContractVersion: REPORTING_FACT_CONTRACT_VERSION,
      metricContractVersion: 1,
      operation: `historical_backfill_${args.mode}`,
      organizationId: store.organizationId,
      projectionContractVersion: REPORTING_PROJECTION_CONTRACT_VERSION,
      requestKey:
        args.mode === "apply"
          ? `apply:${String(preview!._id)}:${args.requestKey}`
          : `preview:${args.requestKey}`,
      runType: "backfill",
      storeId: store._id,
    });
    if (!result.created) return { created: false, runId: result.run._id };
    const manifestId = preview
      ? await ctx.db.insert("reportingBackfillApplyManifest", {
          createdAt: now,
          entryCount: 0,
          organizationId: store.organizationId,
          policyHash,
          policyId,
          previewRunId: preview._id,
          runId: result.run._id,
          status: "building",
          storeId: store._id,
          updatedAt: now,
        })
      : undefined;
    await ctx.db.patch("reportingRun", result.run._id, {
      backfillApplyManifestId: manifestId,
      conflictCount: 0,
      coverageBasisPoints: 10_000,
      createdCount: 0,
      cursor: encodeHistoricalBackfillCursor({
        pageCursor: null,
        phase: "pos",
      }),
      duplicateCount: 0,
      eligibleCount: 0,
      excludedCount: 0,
      existingCount: 0,
      frozenWatermark: periodEnd,
      historicalInterpretationPolicyId: policyId,
      historicalInterpretationPolicyHash: policyHash,
      inferredCount: 0,
      omittedCount: 0,
      periodEnd,
      periodStart,
      previewRunId: preview?._id,
      plannedCount: 0,
      quarantinedCount: 0,
      startedAt: now,
      status: "running",
      unknownCount: 0,
      unknownFieldCount: 0,
    });
    await ctx.db.insert("reportingRunEvent", {
      eventType: "historical_backfill_started",
      occurredAt: now,
      outcome: args.mode,
      runId: result.run._id,
      sequence: 2,
      storeId: store._id,
    });
    await ctx.scheduler.runAfter(
      0,
      historicalBackfillInternal.processHistoricalBackfillBatch,
      {
        runId: result.run._id,
      },
    );
    return { created: true, runId: result.run._id };
  },
});

export const processHistoricalBackfillBatch = internalMutation({
  args: { runId: v.id("reportingRun") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get("reportingRun", args.runId);
    if (!run || run.runType !== "backfill" || run.frozenWatermark === undefined)
      return;
    if (run.status !== "running") return;
    const store = await ctx.db.get("store", run.storeId);
    if (!store || store.organizationId !== run.organizationId) {
      throw new Error("Backfill store ownership changed");
    }
    const policy = run.historicalInterpretationPolicyId
      ? await requireApprovedHistoricalPolicyWithCtx(ctx, {
          policyId: run.historicalInterpretationPolicyId,
          policyHash: run.historicalInterpretationPolicyHash!,
          storeId: run.storeId,
        })
      : null;
    if (run.operation === "historical_backfill_manifest_apply") {
      try {
      const manifest = await requireBackfillManifestWithCtx(ctx, run);
      if (
        (manifest.status !== "sealed" && manifest.status !== "consuming") ||
        !manifest.digest ||
        manifest.entryCount !== (run.plannedCount ?? 0)
      ) {
        throw new Error("Historical backfill manifest is not sealed");
      }
      const page = await ctx.db
        .query("reportingBackfillApplyManifestItem")
        .withIndex("by_manifestId_sequence", (q) =>
          q.eq("manifestId", manifest._id),
        )
        .paginate({ cursor: run.cursor ?? null, numItems: PAGE_SIZE });
      for (const item of page.page) {
        if (
          item.storeId !== run.storeId ||
          item.organizationId !== run.organizationId
        ) {
          throw new Error("Historical backfill manifest item scope changed");
        }
        const candidate = parseHistoricalManifestCandidate(
          item.sanitizedCandidateJson,
        );
        const fact = candidate.fact;
        const fingerprint = await fingerprintHistoricalCandidateWithCtx(
          ctx,
          fact,
          run,
          policy,
          candidate.resolvedPeriod,
        );
        if (fingerprint !== item.candidateFingerprint) {
          throw new Error("Historical backfill manifest item changed");
        }
        const outcome = await persistHistoricalFact(ctx, {
          apply: true,
          fact,
          inferredFields: item.inferredFields,
          now: Date.now(),
          originallyMissingFields: item.originallyMissingFields,
          policy,
          resolvedPeriod: candidate.resolvedPeriod,
          run,
        });
        if (outcome !== item.outcome) {
          throw new Error("Historical backfill manifest outcome changed");
        }
      }
      const now = Date.now();
      if (!page.isDone) {
        await ctx.db.patch("reportingBackfillApplyManifest", manifest._id, {
          status: "consuming",
          updatedAt: now,
        });
        await ctx.db.patch("reportingRun", run._id, {
          cursor: page.continueCursor,
          processedCount: run.processedCount + page.page.length,
        });
      } else {
        await ctx.db.patch("reportingBackfillApplyManifest", manifest._id, {
          cleanupEligibleAt: manifestCleanupEligibleAt({
            completedAt: now,
            status: "completed",
          }),
          completedAt: now,
          status: "completed",
          updatedAt: now,
        });
        await ctx.db.patch("reportingRun", run._id, {
          cursor: encodeHistoricalBackfillCursor({
            pageCursor: null,
            phase: "done",
          }),
          operation: "historical_backfill_apply",
          processedCount: run.processedCount + page.page.length,
        });
      }
      await ctx.scheduler.runAfter(
        0,
        historicalBackfillInternal.processHistoricalBackfillBatch,
        { runId: run._id },
      );
      return;
      } catch (error) {
        const failedAt = Date.now();
        if (run.backfillApplyManifestId) {
          const manifest = await ctx.db.get(
            "reportingBackfillApplyManifest",
            run.backfillApplyManifestId,
          );
          if (
            manifest &&
            !["completed", "failed", "cancelled"].includes(manifest.status)
          ) {
            await ctx.db.patch("reportingBackfillApplyManifest", manifest._id, {
              cleanupEligibleAt: manifestCleanupEligibleAt({
                completedAt: failedAt,
                status: "failed",
              }),
              completedAt: failedAt,
              status: "failed",
              updatedAt: failedAt,
            });
          }
        }
        await ctx.db.patch("reportingRun", run._id, {
          completedAt: failedAt,
          failedCount: run.failedCount + 1,
          status: "failed",
        });
        await ctx.db.insert("reportingRunEvent", {
          cursor: run.cursor,
          eventType: "historical_backfill_manifest_apply_failed",
          failedCount: run.failedCount + 1,
          occurredAt: failedAt,
          outcome: "failed",
          processedCount: run.processedCount,
          runId: run._id,
          safeReason:
            error instanceof Error
              ? error.message.slice(0, 200)
              : "unknown_failure",
          sequence: run.processedCount + run.failedCount + 3,
          storeId: run.storeId,
        });
        return;
      }
    }
    const cursor = decodeHistoricalBackfillCursor(run.cursor);
    if (cursor.phase === "done") {
      const now = Date.now();
      for (const sourceDomain of HISTORICAL_BACKFILL_SCANNED_SOURCE_DOMAINS) {
        await upsertHistoricalBackfillSourceAudit(ctx, {
          counts: EMPTY_HISTORICAL_BACKFILL_AUDIT,
          now,
          run,
          sourceDomain,
        });
      }
      const finalAudit = historicalBackfillAuditFromRun(run);
      if (run.operation.endsWith("apply")) {
        const preview = run.previewRunId
          ? await ctx.db.get("reportingRun", run.previewRunId)
          : null;
        if (
          !preview ||
          !historicalBackfillAuditCountsMatch(
            historicalBackfillAuditFromRun(preview),
            finalAudit,
          )
        ) {
          await ctx.db.patch("reportingRun", run._id, {
            completedAt: now,
            failedCount: run.failedCount + 1,
            status: "failed",
          });
          await ctx.db.insert("reportingRunEvent", {
            ...historicalBackfillAuditPatch(finalAudit),
            eventType: "historical_backfill_preview_parity_failed",
            failedCount: run.failedCount + 1,
            occurredAt: now,
            outcome: "failed",
            processedCount: run.processedCount,
            runId: run._id,
            safeReason: "historical_backfill_preview_counts_changed",
            sequence: finalAudit.plannedCount + 100,
            storeId: run.storeId,
          });
          if (run.backfillApplyManifestId) {
            const manifest = await ctx.db.get(
              "reportingBackfillApplyManifest",
              run.backfillApplyManifestId,
            );
            if (manifest && manifest.status === "building") {
              await ctx.db.patch(
                "reportingBackfillApplyManifest",
                manifest._id,
                {
                  cleanupEligibleAt: manifestCleanupEligibleAt({
                    completedAt: now,
                    status: "failed",
                  }),
                  completedAt: now,
                  status: "failed",
                  updatedAt: now,
                },
              );
            }
          }
          return;
        }
        for (const sourceDomain of HISTORICAL_BACKFILL_SCANNED_SOURCE_DOMAINS) {
          const [previewAudits, preflightAudits] = await Promise.all([
            ctx.db
              .query("reportingBackfillSourceAudit")
              .withIndex("by_runId_sourceDomain", (q) =>
                q.eq("runId", preview._id).eq("sourceDomain", sourceDomain),
              )
              .take(2),
            ctx.db
              .query("reportingBackfillSourceAudit")
              .withIndex("by_runId_sourceDomain", (q) =>
                q.eq("runId", run._id).eq("sourceDomain", sourceDomain),
              )
              .take(2),
          ]);
          if (
            previewAudits.length !== 1 ||
            preflightAudits.length !== 1 ||
            !historicalBackfillAuditCountsMatch(
              historicalBackfillAuditFromRun(previewAudits[0]!),
              historicalBackfillAuditFromRun(preflightAudits[0]!),
            )
          ) {
            const manifest = await requireBackfillManifestWithCtx(ctx, run);
            await ctx.db.patch("reportingBackfillApplyManifest", manifest._id, {
              cleanupEligibleAt: manifestCleanupEligibleAt({
                completedAt: now,
                status: "failed",
              }),
              completedAt: now,
              status: "failed",
              updatedAt: now,
            });
            await ctx.db.patch("reportingRun", run._id, {
              completedAt: now,
              failedCount: run.failedCount + 1,
              status: "failed",
            });
            await ctx.db.insert("reportingRunEvent", {
              eventType: "historical_backfill_source_audit_parity_failed",
              failedCount: run.failedCount + 1,
              occurredAt: now,
              outcome: "failed",
              processedCount: run.processedCount,
              runId: run._id,
              safeReason: `source_audit_changed:${sourceDomain}`,
              sequence: finalAudit.plannedCount + 100,
              sourceDomain,
              storeId: run.storeId,
            });
            return;
          }
        }
        const manifest = await requireBackfillManifestWithCtx(ctx, run);
        if (manifest.status === "building") {
          if (
            manifest.entryCount !== finalAudit.plannedCount ||
            !manifest.digest
          ) {
            throw new Error("Historical backfill manifest audit is incomplete");
          }
          await ctx.db.patch("reportingBackfillApplyManifest", manifest._id, {
            sealedAt: now,
            status: "sealed",
            updatedAt: now,
          });
          await ctx.db.patch("reportingRun", run._id, {
            cursor: undefined,
            operation: "historical_backfill_manifest_apply",
            processedCount: 0,
          });
          await ctx.db.insert("reportingRunEvent", {
            ...historicalBackfillAuditPatch(finalAudit),
            eventType: "historical_backfill_manifest_sealed",
            occurredAt: now,
            outcome: "sealed",
            processedCount: 0,
            runId: run._id,
            sequence: finalAudit.plannedCount + 99,
            storeId: run.storeId,
          });
          await ctx.scheduler.runAfter(
            0,
            historicalBackfillInternal.processHistoricalBackfillBatch,
            { runId: run._id },
          );
          return;
        }
        if (manifest.status !== "completed") {
          throw new Error("Historical backfill manifest lifecycle is invalid");
        }
      }
      const quarantines = await ctx.db
        .query("reportingQuarantine")
        .withIndex("by_storeId_status_detectedAt", (q) =>
          q.eq("storeId", run.storeId).eq("status", "open"),
        )
        .take(100);
      await ctx.db.patch("reportingRun", run._id, {
        completedAt: now,
        coverageBasisPoints: historicalBackfillCoverageBasisPoints(finalAudit),
        status: "completed",
      });
      await ctx.db.insert("reportingRunEvent", {
        ...historicalBackfillAuditPatch(finalAudit),
        eventType: "historical_backfill_completed",
        failedCount: run.failedCount,
        occurredAt: now,
        outcome: run.operation.endsWith("preview") ? "preview" : "applied",
        processedCount: run.processedCount,
        runId: run._id,
        sequence: finalAudit.plannedCount + 100,
        storeId: run.storeId,
      });
      if (!run.operation.endsWith("preview")) {
        for (const sourceDomain of HISTORICAL_BACKFILL_SCANNED_SOURCE_DOMAINS) {
          const quarantinedCount = quarantines.filter(
            (row) => row.sourceDomain === sourceDomain,
          ).length;
          for (const projectionKind of ["store_day", "sku_day"] as const) {
            await upsertProjectionHealthWithCtx(ctx, {
              backfillState:
                quarantinedCount > 0
                  ? "completed_with_quarantine"
                  : "completed",
              factContractVersion: run.factContractVersion,
              limitingReason:
                quarantinedCount > 0 ? "source_incomplete" : undefined,
              metricContractVersion: run.metricContractVersion,
              organizationId: run.organizationId,
              processingWatermark: run.frozenWatermark,
              projectionContractVersion: run.projectionContractVersion,
              projectionKind,
              quarantinedCount,
              sourceDomain,
              storeId: run.storeId,
              updatedAt: now,
            });
          }
        }
      }
      return;
    }
    const preflight = run.operation === "historical_backfill_apply";
    const apply = false;
    try {
      const manifest = preflight
        ? await requireBackfillManifestWithCtx(ctx, run)
        : null;
      if (manifest && manifest.status !== "building") {
        throw new Error("Historical backfill manifest is not building");
      }
      let manifestDigest = manifest?.digest ?? "historical-manifest-v1:empty";
      let manifestEntryCount = manifest?.entryCount ?? 0;
      let page: { continueCursor: string; isDone: boolean; page: unknown[] };
      if (cursor.phase === "pos") {
        page = await loadPosPage(ctx, {
          cursor: cursor.pageCursor,
          cutoff: run.frozenWatermark,
          status: "completed",
          storeId: run.storeId,
        });
      } else if (cursor.phase === "pos_void" || cursor.phase === "pos_refund") {
        page = await loadPosPage(ctx, {
          cursor: cursor.pageCursor,
          cutoff: run.frozenWatermark,
          status: cursor.phase === "pos_void" ? "void" : "refunded",
          storeId: run.storeId,
        });
      } else if (cursor.phase === "pos_adjustment") {
        page = await loadPosAdjustmentPage(ctx, {
          cursor: cursor.pageCursor,
          cutoff: run.frozenWatermark,
          storeId: run.storeId,
        });
      } else if (cursor.phase === "pos_payment_correction") {
        page = await loadPosPaymentCorrectionPage(ctx, {
          cursor: cursor.pageCursor,
          cutoff: run.frozenWatermark,
          storeId: run.storeId,
        });
      } else if (
        cursor.phase === "storefront_delivered" ||
        cursor.phase === "storefront_picked_up"
      ) {
        const status =
          cursor.phase === "storefront_delivered" ? "delivered" : "picked-up";
        page = await loadStorefrontPage(ctx, {
          cursor: cursor.pageCursor,
          cutoff: run.frozenWatermark,
          status,
          storeId: run.storeId,
        });
      } else if (cursor.phase === "storefront_refund") {
        page = await loadStorefrontRefundPage(ctx, {
          cursor: cursor.pageCursor,
          storeId: run.storeId,
        });
      } else if (cursor.phase === "service") {
        page = await loadServicePage(ctx, {
          cursor: cursor.pageCursor,
          cutoff: run.frozenWatermark,
          storeId: run.storeId,
        });
      } else if (cursor.phase === "purchase_order") {
        page = await loadPurchaseOrderPage(ctx, {
          cursor: cursor.pageCursor,
          cutoff: run.frozenWatermark,
          storeId: run.storeId,
        });
      } else if (cursor.phase === "receiving") {
        page = await loadReceivingPage(ctx, {
          cursor: cursor.pageCursor,
          cutoff: run.frozenWatermark,
          storeId: run.storeId,
        });
      } else if (cursor.phase === "expense") {
        page = await loadExpensePage(ctx, {
          cursor: cursor.pageCursor,
          cutoff: run.frozenWatermark,
          storeId: run.storeId,
        });
      } else {
        page = await loadPaymentAllocationPage(ctx, {
          cursor: cursor.pageCursor,
          cutoff: run.frozenWatermark,
          storeId: run.storeId,
        });
      }
      let batchAudit = { ...EMPTY_HISTORICAL_BACKFILL_AUDIT };
      const auditBySource = new Map<
        HistoricalPlannedFact["sourceDomain"],
        HistoricalBackfillAuditCounts
      >();
      for (const row of page.page) {
        let facts: HistoricalPlannedFact[];
        if (cursor.phase === "pos") {
          facts = await planPosRow(ctx, row as Doc<"posTransaction">, store);
        } else if (
          cursor.phase === "pos_void" ||
          cursor.phase === "pos_refund"
        ) {
          facts = await planPosRow(
            ctx,
            row as Doc<"posTransaction">,
            store,
            cursor.phase === "pos_void" ? "void" : "refund",
            run.frozenWatermark,
          );
        } else if (cursor.phase === "pos_adjustment") {
          facts = await planPosAdjustmentRow(
            ctx,
            row as Doc<"posTransactionAdjustment">,
            store,
          );
        } else if (cursor.phase === "pos_payment_correction") {
          facts = planPosPaymentCorrectionRow(row as Doc<"operationalEvent">);
        } else if (
          cursor.phase === "storefront_delivered" ||
          cursor.phase === "storefront_picked_up"
        ) {
          facts = await planStorefrontRow(
            ctx,
            row as Doc<"onlineOrder">,
            store,
          );
        } else if (cursor.phase === "storefront_refund") {
          facts = await planStorefrontRefundRow(
            ctx,
            row as Doc<"onlineOrder">,
            store,
            run.frozenWatermark,
          );
        } else if (cursor.phase === "service") {
          facts = await planServiceRow(ctx, row as Doc<"serviceCase">, store);
        } else if (cursor.phase === "purchase_order") {
          facts = await planPurchaseOrderRow(
            ctx,
            row as Doc<"purchaseOrder">,
            run.frozenWatermark,
          );
        } else if (cursor.phase === "receiving") {
          facts = await planReceivingRow(
            ctx,
            row as Doc<"receivingBatch">,
            run.frozenWatermark,
            store,
          );
        } else if (cursor.phase === "expense") {
          facts = await planExpenseRow(
            ctx,
            row as Doc<"expenseTransaction">,
            store,
          );
        } else {
          facts = planPaymentAllocationFact(row as Doc<"paymentAllocation">);
        }
        for (const sourceFact of facts) {
          const normalized = normalizeHistoricalFactWithPolicy({
            fact: sourceFact,
            policy,
          });
          const fact = normalized.fact;
          const resolvedPeriod = await resolveHistoricalFactPeriodWithCtx(
            ctx,
            fact,
            run,
            policy,
          );
          const candidateFingerprint =
            await fingerprintHistoricalCandidateWithCtx(
              ctx,
              fact,
              run,
              policy,
              resolvedPeriod,
            );
          const previewItem = preflight
            ? await findHistoricalPreviewItem(ctx, {
                businessEventKey: historicalPreviewBusinessEventKey(fact),
                runId: run.previewRunId!,
                sourceDomain: fact.sourceDomain,
              })
            : null;
          if (
            preflight &&
            (!previewItem ||
              previewItem.candidateFingerprint !== candidateFingerprint ||
              previewItem.policyId !== policy?._id ||
              previewItem.policyHash !== policy?.approvalHash ||
              JSON.stringify(previewItem.inferredFields ?? []) !==
                JSON.stringify(normalized.inferredFields) ||
              JSON.stringify(previewItem.originallyMissingFields ?? []) !==
                JSON.stringify(normalized.originallyMissingFields))
          ) {
            throw new Error(
              "Historical backfill candidate does not match the completed preview",
            );
          }
          const outcome = await persistHistoricalFact(ctx, {
            apply,
            fact,
            inferredFields: normalized.inferredFields,
            now: Date.now(),
            originallyMissingFields: normalized.originallyMissingFields,
            policy,
            resolvedPeriod,
            run,
          });
          if (preflight) {
            if (previewItem!.outcome !== outcome) {
              throw new Error(
                "Historical backfill candidate outcome changed after preview",
              );
            }
            const manifestItem = {
              businessEventKey: historicalPreviewBusinessEventKey(fact),
              candidateFingerprint,
              inferredFields: normalized.inferredFields,
              originallyMissingFields: normalized.originallyMissingFields,
              outcome,
              sanitizedCandidateJson: historicalManifestCandidateJson(
                fact,
                resolvedPeriod,
              ),
              sequence: manifestEntryCount + 1,
              sourceDomain: fact.sourceDomain,
            };
            await ctx.db.insert("reportingBackfillApplyManifestItem", {
              ...manifestItem,
              createdAt: Date.now(),
              manifestId: manifest!._id,
              organizationId: run.organizationId,
              storeId: run.storeId,
            });
            manifestDigest = historicalManifestEntryDigest(
              manifestDigest,
              manifestItem,
            );
            manifestEntryCount += 1;
          } else {
            await recordHistoricalPreviewItem(ctx, {
              candidateFingerprint,
              fact,
              inferredFields: normalized.inferredFields,
              originallyMissingFields: normalized.originallyMissingFields,
              outcome,
              policy,
              run,
            });
          }
          const delta = historicalBackfillAuditForOutcome({
            outcome,
            unknownFieldCount: historicalFactUnknownFields(fact).length,
            inferredCount: normalized.inferredFields.length,
          });
          batchAudit = mergeHistoricalBackfillAuditCounts(batchAudit, delta);
          auditBySource.set(
            fact.sourceDomain,
            mergeHistoricalBackfillAuditCounts(
              auditBySource.get(fact.sourceDomain) ??
                EMPTY_HISTORICAL_BACKFILL_AUDIT,
              delta,
            ),
          );
        }
      }
      reconcileHistoricalBackfillCounts({
        conflict: batchAudit.conflictCount,
        created: batchAudit.createdCount,
        excluded: batchAudit.excludedCount,
        existing: batchAudit.existingCount,
        planned: batchAudit.plannedCount,
        quarantined: batchAudit.quarantinedCount,
      });
      const now = Date.now();
      if (manifest) {
        await ctx.db.patch("reportingBackfillApplyManifest", manifest._id, {
          digest: manifestDigest,
          entryCount: manifestEntryCount,
          updatedAt: now,
        });
      }
      for (const [sourceDomain, counts] of auditBySource) {
        await upsertHistoricalBackfillSourceAudit(ctx, {
          counts,
          now,
          run,
          sourceDomain,
        });
      }
      const cumulativeAudit = mergeHistoricalBackfillAuditCounts(
        historicalBackfillAuditFromRun(run),
        batchAudit,
      );
      const next = advanceHistoricalBackfillCursor({
        continueCursor: page.continueCursor,
        isDone: page.isDone,
        phase: cursor.phase,
      });
      await ctx.db.patch("reportingRun", run._id, {
        ...historicalBackfillAuditPatch(cumulativeAudit),
        cursor: encodeHistoricalBackfillCursor(next),
        failedCount:
          run.failedCount +
          batchAudit.conflictCount +
          batchAudit.quarantinedCount,
        processedCount: run.processedCount + batchAudit.eligibleCount,
      });
      await ctx.db.insert("reportingRunEvent", {
        ...historicalBackfillAuditPatch(batchAudit),
        cursor: encodeHistoricalBackfillCursor(next),
        eventType: "historical_backfill_batch_audited",
        failedCount: batchAudit.conflictCount + batchAudit.quarantinedCount,
        occurredAt: now,
        outcome: preflight ? "preflighted" : "previewed",
        processedCount: batchAudit.eligibleCount,
        runId: run._id,
        sequence:
          (run.plannedCount ?? 0) +
          batchAudit.plannedCount +
          HISTORICAL_BACKFILL_PHASES.indexOf(cursor.phase) +
          3,
        storeId: run.storeId,
      });
      await ctx.scheduler.runAfter(
        0,
        historicalBackfillInternal.processHistoricalBackfillBatch,
        { runId: run._id },
      );
    } catch (error) {
      const now = Date.now();
      if (run.backfillApplyManifestId) {
        const manifest = await ctx.db.get(
          "reportingBackfillApplyManifest",
          run.backfillApplyManifestId,
        );
        if (
          manifest &&
          !["completed", "failed", "cancelled"].includes(manifest.status)
        ) {
          await ctx.db.patch("reportingBackfillApplyManifest", manifest._id, {
            cleanupEligibleAt: manifestCleanupEligibleAt({
              completedAt: now,
              status: "failed",
            }),
            completedAt: now,
            status: "failed",
            updatedAt: now,
          });
        }
      }
      await ctx.db.patch("reportingRun", run._id, {
        completedAt: now,
        failedCount: run.failedCount + 1,
        status: "failed",
      });
      await ctx.db.insert("reportingRunEvent", {
        cursor: run.cursor,
        eventType: "historical_backfill_failed",
        failedCount: run.failedCount + 1,
        occurredAt: now,
        outcome: "failed",
        processedCount: run.processedCount,
        runId: run._id,
        safeReason:
          error instanceof Error
            ? error.message.slice(0, 200)
            : "unknown_failure",
        sequence: run.processedCount + run.failedCount + 3,
        storeId: run.storeId,
      });
    }
  },
});

export const controlHistoricalBackfill = internalMutation({
  args: {
    action: v.union(
      v.literal("pause"),
      v.literal("resume"),
      v.literal("cancel"),
    ),
    runId: v.id("reportingRun"),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get("reportingRun", args.runId);
    if (!run || run.runType !== "backfill")
      throw new Error("Backfill run not found");
    if (run.status === "expired")
      throw new Error("Expired backfills cannot be controlled");
    const nextStatus =
      args.action === "pause"
        ? "paused"
        : args.action === "cancel"
          ? "cancelled"
          : "running";
    assertReportingRunTransition(run.status, nextStatus);
    const now = Date.now();
    await ctx.db.patch("reportingRun", run._id, {
      completedAt: nextStatus === "cancelled" ? now : undefined,
      status: nextStatus,
    });
    if (nextStatus === "cancelled" && run.backfillApplyManifestId) {
      const manifest = await ctx.db.get(
        "reportingBackfillApplyManifest",
        run.backfillApplyManifestId,
      );
      if (
        manifest &&
        !["completed", "failed", "cancelled"].includes(manifest.status)
      ) {
        await ctx.db.patch("reportingBackfillApplyManifest", manifest._id, {
          cleanupEligibleAt: manifestCleanupEligibleAt({
            completedAt: now,
            status: "cancelled",
          }),
          completedAt: now,
          status: "cancelled",
          updatedAt: now,
        });
      }
    }
    await ctx.db.insert("reportingRunEvent", {
      cursor: run.cursor,
      eventType: `historical_backfill_${args.action}`,
      occurredAt: now,
      outcome: nextStatus,
      processedCount: run.processedCount,
      runId: run._id,
      sequence: run.processedCount + run.failedCount + 3,
      storeId: run.storeId,
    });
    if (nextStatus === "running") {
      await ctx.scheduler.runAfter(
        0,
        historicalBackfillInternal.processHistoricalBackfillBatch,
        { runId: run._id },
      );
    }
  },
});
