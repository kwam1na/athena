import { v } from "convex/values";

import {
  REPORTING_FACT_CONTRACT_VERSION,
  REPORTING_LINE_ATTRIBUTION_VERSION,
  REPORTING_PROJECTION_CONTRACT_VERSION,
  type ReportingRecognitionChannel,
  type ReportingSkuAttributionKind,
  type ReportingSourceDomain,
  type SafeReportingSourceReference,
} from "../../shared/reportingContract";
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { validateFactContractVersion } from "./metricContracts";
import { sanitizeConflictEvidence } from "./integrity";
import { resolveReportingFinancialPeriodWithCtx } from "./operatingPeriods";
import { upsertProjectionHealthWithCtx } from "./health";
import { canonicalReportingFactKey } from "./factIdentity";
import { canonicalReportingFactSemanticFingerprint } from "./factFingerprint";
import { recordFactSkuEvidenceWithCtx } from "./evidence";
import { scheduleFactProjectionBatchWithCtx } from "./projectionWork";
import { scheduleReportingWorkBestEffort } from "./scheduling";

const SAFE_SOURCE_TYPES = new Set([
  "daily_close",
  "inventory_movement",
  "online_order",
  "operational_event",
  "payment_allocation",
  "pos_transaction_adjustment",
  "pos_transaction",
  "purchase_order",
  "purchase_order_line",
  "purchase_order_receiving_batch",
  "receiving_batch",
  "service_case",
]);

const reportingIngressInternal = (internal as any).reporting.ingress;
const reportingEvidenceInternal = (internal as any).reporting.evidence;

export const REPORTING_INGRESS_LINE_LIMIT = 500;
export const REPORTING_INGRESS_SOURCE_REFERENCE_LIMIT = 100;
export const REPORTING_INGRESS_PROCESSING_WRITE_LIMIT = 1_000;
export const REPORTING_PENDING_RECOVERY_BATCH_LIMIT = 20;

export function classifyIngressChildCounts(input: {
  lineCount: number;
  sourceReferenceCount: number;
}) {
  if (input.lineCount > REPORTING_INGRESS_LINE_LIMIT) {
    return {
      reason: "ingress_line_limit_exceeded" as const,
      status: "quarantined" as const,
    };
  }
  if (input.sourceReferenceCount > REPORTING_INGRESS_SOURCE_REFERENCE_LIMIT) {
    return {
      reason: "ingress_source_reference_limit_exceeded" as const,
      status: "quarantined" as const,
    };
  }
  const maximumFactCount = Math.max(1, input.lineCount * 2);
  const processingWriteCount =
    2 + maximumFactCount * (2 + input.sourceReferenceCount);
  if (processingWriteCount > REPORTING_INGRESS_PROCESSING_WRITE_LIMIT) {
    return {
      reason: "ingress_processing_write_limit_exceeded" as const,
      status: "quarantined" as const,
    };
  }
  return { reason: null, status: "eligible" as const };
}

export type ReportingIngressLineInput = {
  allocatedDiscountMinor?: number;
  attributionKind?: ReportingSkuAttributionKind;
  canonicalProductSkuId?: Id<"productSku">;
  categoryId?: Id<"category">;
  channel?: ReportingRecognitionChannel;
  cogsKnownMinor?: number;
  cogsKnownQuantity?: number;
  cogsUncoveredQuantity?: number;
  costStatus: "known" | "partial" | "unknown" | "not_applicable";
  coveredRevenueMinor?: number;
  discountAmountMinor?: number;
  grossAmountMinor?: number;
  lineKey: string;
  lineKind: "merchandise" | "service" | "delivery" | "tax";
  netAmountMinor?: number;
  productSkuId?: Id<"productSku">;
  quantity: number;
  serviceCaseId?: Id<"serviceCase">;
  sourceLabel?: string;
  inventoryEffectId?: Id<"reportingInventoryEffect">;
  inventoryImportProvisionalSkuId?: Id<"inventoryImportProvisionalSku">;
  originalProductSkuId?: Id<"productSku">;
  originalQuantity?: number;
  pendingCheckoutItemId?: Id<"posPendingCheckoutItem">;
  productId?: Id<"product">;
  provisionalProductSkuId?: Id<"productSku">;
  recognizedNetAmountMinor?: number;
  recognitionCategoryId?: Id<"category">;
  recognitionProductId?: Id<"product">;
  recognitionProductSkuId?: Id<"productSku">;
  valuationCurrencyCode?: string;
  valuationCurrencyMinorUnitScale?: number;
  expectedInboundAt?: number;
  procurementSignal?: "commitment" | "receipt" | "short_receipt";
  commitmentConfirmed?: boolean;
  taxAmountMinor?: number;
  unitPriceMinor?: number;
};

export type ReportingIngressArgs = {
  organizationId: Id<"organization">;
  storeId: Id<"store">;
  sourceDomain: ReportingSourceDomain;
  sourceEventType: string;
  businessEventKey: string;
  linkedBusinessEventKey?: string;
  adapterVersion: number;
  factContractVersion?: number;
  occurredAt: number;
  acceptedAt: number;
  synchronizedAt?: number;
  currencyCode?: string;
  currencyMinorUnitScale?: number;
  grossAmountMinor?: number;
  discountAmountMinor?: number;
  netAmountMinor?: number;
  taxAmountMinor?: number;
  settlementAmountMinor?: number;
  priorSettlementMethod?: string;
  correctedSettlementMethod?: string;
  quantity?: number;
  closeSnapshot?: {
    acceptedDeficitAdjustmentMinor: number;
    acceptedNetSalesMinor: number;
    acceptedRefundsMinor: number;
    completeness: "complete" | "partial";
    snapshotVersion: number;
    supersedesCloseId?: string;
  };
  contentFingerprint: string;
  materialFields: string[];
  sourceReferences: SafeReportingSourceReference[];
  lines?: ReportingIngressLineInput[];
};

function validateIngress(args: ReportingIngressArgs) {
  validateFactContractVersion(
    args.factContractVersion ?? REPORTING_FACT_CONTRACT_VERSION,
  );
  if (!Number.isInteger(args.adapterVersion) || args.adapterVersion < 1) {
    throw new Error("Unsupported reporting source adapter version.");
  }
  if (!args.businessEventKey.trim() || !args.contentFingerprint.trim()) {
    throw new Error("Reporting ingress identity is incomplete.");
  }
  if (
    (args.currencyCode === undefined) !==
    (args.currencyMinorUnitScale === undefined)
  ) {
    throw new Error("Reporting currency convention is incomplete.");
  }
  if (args.sourceDomain === "daily_close" && !args.closeSnapshot) {
    throw new Error(
      "Daily Close reporting requires an immutable close snapshot.",
    );
  }
  if (args.closeSnapshot) {
    for (const value of [
      args.closeSnapshot.acceptedDeficitAdjustmentMinor,
      args.closeSnapshot.acceptedNetSalesMinor,
      args.closeSnapshot.acceptedRefundsMinor,
      args.closeSnapshot.snapshotVersion,
    ]) {
      if (!Number.isSafeInteger(value)) {
        throw new Error("Daily Close snapshot values must use safe integers.");
      }
    }
    if (args.closeSnapshot.snapshotVersion < 1) {
      throw new Error("Daily Close snapshot version must be positive.");
    }
  }
  for (const reference of args.sourceReferences) {
    if (!SAFE_SOURCE_TYPES.has(reference.sourceType)) {
      throw new Error("Unsupported reporting source reference.");
    }
  }
  const lineKeys = new Set<string>();
  for (const line of args.lines ?? []) {
    if (!line.lineKey.trim() || lineKeys.has(line.lineKey)) {
      throw new Error("Reporting ingress line identity is invalid.");
    }
    lineKeys.add(line.lineKey);
    for (const [name, value] of Object.entries({
      cogsKnownMinor: line.cogsKnownMinor,
      cogsKnownQuantity: line.cogsKnownQuantity,
      cogsUncoveredQuantity: line.cogsUncoveredQuantity,
      allocatedDiscountMinor: line.allocatedDiscountMinor,
      coveredRevenueMinor: line.coveredRevenueMinor,
      discountAmountMinor: line.discountAmountMinor,
      grossAmountMinor: line.grossAmountMinor,
      netAmountMinor: line.netAmountMinor,
      originalQuantity: line.originalQuantity,
      quantity: line.quantity,
      recognizedNetAmountMinor: line.recognizedNetAmountMinor,
      taxAmountMinor: line.taxAmountMinor,
      unitPriceMinor: line.unitPriceMinor,
    })) {
      if (value !== undefined && !Number.isSafeInteger(value)) {
        throw new Error(
          `Reporting ingress line ${name} must be a safe integer.`,
        );
      }
    }
    const hasKnownCogs = line.cogsKnownMinor !== undefined;
    if (line.costStatus === "known" && !hasKnownCogs) {
      throw new Error(
        "Reporting ingress line known cost evidence is incomplete.",
      );
    }
    if (
      (line.costStatus === "unknown" || line.costStatus === "not_applicable") &&
      hasKnownCogs
    ) {
      throw new Error("Reporting ingress line cost evidence is inconsistent.");
    }
    if (line.costStatus === "partial") {
      if (
        line.lineKind !== "merchandise" ||
        !hasKnownCogs ||
        line.cogsKnownQuantity === undefined ||
        line.cogsUncoveredQuantity === undefined ||
        line.cogsKnownQuantity <= 0 ||
        line.cogsUncoveredQuantity <= 0 ||
        line.cogsKnownQuantity + line.cogsUncoveredQuantity !==
          Math.abs(line.quantity)
      ) {
        throw new Error(
          "Reporting ingress partial cost evidence is incomplete.",
        );
      }
    }
    if (
      args.sourceDomain !== "procurement" &&
      (line.grossAmountMinor === undefined || line.netAmountMinor === undefined)
    ) {
      throw new Error("Commerce reporting ingress requires line amounts.");
    }
    if (
      (line.valuationCurrencyCode === undefined) !==
      (line.valuationCurrencyMinorUnitScale === undefined)
    ) {
      throw new Error("Reporting line valuation currency is incomplete.");
    }
    if (
      line.cogsKnownMinor !== undefined &&
      line.valuationCurrencyCode === undefined
    ) {
      throw new Error("Known reporting line cost requires valuation currency.");
    }
  }
}

function coveredRevenueForLine(
  line: Pick<
    ReportingIngressLineInput,
    | "cogsKnownQuantity"
    | "cogsUncoveredQuantity"
    | "costStatus"
    | "coveredRevenueMinor"
  >,
  amountMinor: number | undefined,
) {
  if (line.coveredRevenueMinor !== undefined) {
    return line.coveredRevenueMinor;
  }
  if (
    line.costStatus !== "partial" ||
    amountMinor === undefined ||
    line.cogsKnownQuantity === undefined ||
    line.cogsUncoveredQuantity === undefined
  ) {
    return undefined;
  }
  const totalQuantity = line.cogsKnownQuantity + line.cogsUncoveredQuantity;
  const coveredRevenueMinor = Math.round(
    (amountMinor / totalQuantity) * line.cogsKnownQuantity,
  );
  if (!Number.isSafeInteger(coveredRevenueMinor)) {
    throw new Error("Reporting covered revenue must be a safe integer.");
  }
  return coveredRevenueMinor;
}

type IngressRecoveryDisposition =
  "retry_pending" | "retry_scheduled" | "recovered" | "quarantined";

export async function recordIngressFailureWithCtx(
  ctx: MutationCtx,
  input: {
    ingress: Doc<"reportingIngress">;
    now: number;
    recoveryDisposition: IngressRecoveryDisposition;
    safeCode: string;
  },
) {
  const attempt = (input.ingress.attemptCount ?? 0) + 1;
  const firstFailureAt = input.ingress.firstFailureAt ?? input.now;
  await ctx.db.patch("reportingIngress", input.ingress._id, {
    attemptCount: attempt,
    firstFailureAt,
    lastRecoveryAttemptAt: input.now,
    latestFailureAt: input.now,
    latestFailureCode: input.safeCode,
    recoveryDisposition: input.recoveryDisposition,
  });
  await ctx.db.insert("reportingFactProcessingAttempt", {
    adapterVersion: input.ingress.adapterVersion,
    attempt,
    completedAt: input.now,
    factContractVersion: input.ingress.factContractVersion,
    firstFailureAt,
    ingressId: input.ingress._id,
    latestFailureAt: input.now,
    metricContractVersion: 1,
    outcome:
      input.recoveryDisposition === "quarantined" ? "deferred" : "failed",
    recoveryDisposition: input.recoveryDisposition,
    projectionContractVersion: REPORTING_PROJECTION_CONTRACT_VERSION,
    safeCode: input.safeCode,
    safeReason: input.safeCode,
    startedAt: input.now,
    storeId: input.ingress.storeId,
  });
  return attempt;
}

async function quarantineIngressWithCtx(
  ctx: MutationCtx,
  input: {
    attempt?: number;
    ingress: Doc<"reportingIngress">;
    now: number;
    safeCode: string;
  },
) {
  const safeFingerprint = [
    "ingress-quarantine-v1",
    input.ingress.sourceDomain,
    input.ingress.businessEventKey,
    input.safeCode,
    input.ingress.contentFingerprint,
  ].join(":");
  const prior = await ctx.db
    .query("reportingQuarantine")
    .withIndex("by_ingressId", (q) => q.eq("ingressId", input.ingress._id))
    .take(20);
  if (
    !prior.some(
      (row) => row.status === "open" && row.safeFingerprint === safeFingerprint,
    )
  ) {
    await ctx.db.insert("reportingQuarantine", {
      detectedAt: input.now,
      ingressId: input.ingress._id,
      organizationId: input.ingress.organizationId,
      safeCode: input.safeCode,
      safeFingerprint,
      sourceDomain: input.ingress.sourceDomain,
      status: "open",
      storeId: input.ingress.storeId,
    });
  }
  await ctx.db.patch("reportingIngress", input.ingress._id, {
    recoveryDisposition: "quarantined",
    status: "quarantined",
  });
  await recordIngressFailureWithCtx(ctx, {
    ingress: input.ingress,
    now: input.now,
    recoveryDisposition: "quarantined",
    safeCode: input.safeCode,
  });
  const openQuarantines = await ctx.db
    .query("reportingQuarantine")
    .withIndex("by_storeId_status_detectedAt", (q) =>
      q.eq("storeId", input.ingress.storeId).eq("status", "open"),
    )
    .take(101);
  for (const projectionKind of ["store_day", "sku_day"] as const) {
    await upsertProjectionHealthWithCtx(ctx, {
      factContractVersion: input.ingress.factContractVersion,
      limitingReason: "source_incomplete",
      metricContractVersion: 1,
      organizationId: input.ingress.organizationId,
      processingWatermark: input.ingress.acceptedAt,
      projectionContractVersion: REPORTING_PROJECTION_CONTRACT_VERSION,
      projectionKind,
      quarantinedCount: openQuarantines.filter(
        (row) => row.sourceDomain === input.ingress.sourceDomain,
      ).length,
      sourceDomain: input.ingress.sourceDomain,
      storeId: input.ingress.storeId,
      updatedAt: input.now,
    });
  }
}

export async function appendReportingIngressWithCtx(
  ctx: MutationCtx,
  args: ReportingIngressArgs,
) {
  validateIngress(args);
  const factContractVersion =
    args.factContractVersion ?? REPORTING_FACT_CONTRACT_VERSION;
  const existingRows = await ctx.db
    .query("reportingIngress")
    .withIndex("by_storeId_sourceDomain_businessEventKey", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("sourceDomain", args.sourceDomain)
        .eq("businessEventKey", args.businessEventKey),
    )
    .take(2);

  if (existingRows.length > 1) {
    throw new Error("Reporting ingress identity is not unique.");
  }

  const existing = existingRows[0];
  if (existing) {
    if (existing.contentFingerprint === args.contentFingerprint) {
      return { kind: "replay" as const, ingressId: existing._id };
    }

    const conflict = sanitizeConflictEvidence({
      expectedFingerprint: existing.contentFingerprint,
      receivedFingerprint: args.contentFingerprint,
      materialFields: args.materialFields,
    });
    const detectedAt = Date.now();
    const priorConflicts = await ctx.db
      .query("reportingIngressConflict")
      .withIndex("by_ingressId", (q) => q.eq("ingressId", existing._id))
      .take(100);
    const priorConflict = priorConflicts.find(
      (row) =>
        row.status === "open" &&
        row.receivedFingerprint === conflict.receivedFingerprint,
    );
    const conflictId =
      priorConflict?._id ??
      (await ctx.db.insert("reportingIngressConflict", {
        ingressId: existing._id,
        storeId: args.storeId,
        sourceDomain: args.sourceDomain,
        businessEventKey: args.businessEventKey,
        ...conflict,
        detectedAt,
        status: "open",
      }));
    const safeFingerprint = [
      "ingress-conflict-v1",
      args.sourceDomain,
      args.businessEventKey,
      conflict.expectedFingerprint,
      conflict.receivedFingerprint,
    ].join(":");
    const openQuarantines = await ctx.db
      .query("reportingQuarantine")
      .withIndex("by_storeId_status_detectedAt", (q) =>
        q.eq("storeId", args.storeId).eq("status", "open"),
      )
      .take(100);
    if (
      !openQuarantines.some((row) => row.safeFingerprint === safeFingerprint)
    ) {
      await ctx.db.insert("reportingQuarantine", {
        detectedAt,
        ingressId: existing._id,
        organizationId: args.organizationId,
        safeCode: "duplicate_conflict",
        safeFingerprint,
        sourceDomain: args.sourceDomain,
        status: "open",
        storeId: args.storeId,
      });
    }
    await ctx.db.patch("reportingIngress", existing._id, {
      status: "conflict",
      conflictAt: detectedAt,
    });
    await recordIngressFailureWithCtx(ctx, {
      ingress: existing,
      now: detectedAt,
      recoveryDisposition: "quarantined",
      safeCode: "duplicate_conflict",
    });
    const quarantinedCount =
      openQuarantines.filter((row) => row.sourceDomain === args.sourceDomain)
        .length +
      (openQuarantines.some((row) => row.safeFingerprint === safeFingerprint)
        ? 0
        : 1);
    for (const projectionKind of ["store_day", "sku_day"] as const) {
      await upsertProjectionHealthWithCtx(ctx, {
        factContractVersion,
        limitingReason: "duplicate_conflict",
        metricContractVersion: 1,
        organizationId: args.organizationId,
        processingWatermark: args.acceptedAt,
        projectionContractVersion: REPORTING_PROJECTION_CONTRACT_VERSION,
        projectionKind,
        quarantinedCount,
        sourceDomain: args.sourceDomain,
        storeId: args.storeId,
        updatedAt: detectedAt,
      });
    }
    return {
      kind: "conflict" as const,
      ingressId: existing._id,
      conflictId,
    };
  }

  const scheduledAt = Date.now();
  const ingressId = await ctx.db.insert("reportingIngress", {
    organizationId: args.organizationId,
    storeId: args.storeId,
    sourceDomain: args.sourceDomain,
    sourceEventType: args.sourceEventType,
    businessEventKey: args.businessEventKey,
    linkedBusinessEventKey: args.linkedBusinessEventKey,
    adapterVersion: args.adapterVersion,
    factContractVersion,
    occurredAt: args.occurredAt,
    acceptedAt: args.acceptedAt,
    synchronizedAt: args.synchronizedAt,
    currencyCode: args.currencyCode,
    currencyMinorUnitScale: args.currencyMinorUnitScale,
    grossAmountMinor: args.grossAmountMinor,
    discountAmountMinor: args.discountAmountMinor,
    netAmountMinor: args.netAmountMinor,
    taxAmountMinor: args.taxAmountMinor,
    settlementAmountMinor: args.settlementAmountMinor,
    priorSettlementMethod: args.priorSettlementMethod,
    correctedSettlementMethod: args.correctedSettlementMethod,
    quantity: args.quantity,
    closeSnapshot: args.closeSnapshot,
    contentFingerprint: args.contentFingerprint,
    attemptCount: 0,
    status: "pending",
    scheduledAt,
  });

  const childCounts = classifyIngressChildCounts({
    lineCount: args.lines?.length ?? 0,
    sourceReferenceCount: args.sourceReferences.length,
  });
  if (childCounts.status === "quarantined") {
    const ingress = await ctx.db.get("reportingIngress", ingressId);
    if (!ingress) throw new Error("Reporting ingress was not persisted.");
    await quarantineIngressWithCtx(ctx, {
      ingress,
      now: scheduledAt,
      safeCode: childCounts.reason,
    });
    return {
      kind: "quarantined" as const,
      ingressId,
      reason: childCounts.reason,
    };
  }

  for (const reference of args.sourceReferences) {
    await ctx.db.insert("reportingIngressSourceReference", {
      ingressId,
      storeId: args.storeId,
      ...reference,
      createdAt: scheduledAt,
    });
  }
  for (const line of args.lines ?? []) {
    const attributionKind =
      line.attributionKind ??
      (line.pendingCheckoutItemId
        ? "pending_checkout"
        : line.inventoryImportProvisionalSkuId
          ? "inventory_import"
          : "direct");
    const recognitionProductSkuId =
      line.recognitionProductSkuId ?? line.productSkuId;
    const originalProductSkuId =
      line.originalProductSkuId ?? recognitionProductSkuId;
    const canonicalProductSkuId =
      line.canonicalProductSkuId ??
      (attributionKind === "pending_checkout" &&
      line.provisionalProductSkuId === line.productSkuId
        ? undefined
        : line.productSkuId);
    await ctx.db.insert("reportingIngressLine", {
      ...line,
      allocatedDiscountMinor:
        line.allocatedDiscountMinor ?? line.discountAmountMinor,
      attributionKind,
      attributionVersion: REPORTING_LINE_ATTRIBUTION_VERSION,
      canonicalProductSkuId,
      channel:
        line.channel ??
        (args.sourceDomain === "pos" || args.sourceDomain === "storefront"
          ? args.sourceDomain
          : args.sourceDomain === "service"
            ? "service"
            : undefined),
      createdAt: scheduledAt,
      ingressId,
      originalProductSkuId,
      originalQuantity: line.originalQuantity ?? line.quantity,
      recognizedNetAmountMinor:
        line.recognizedNetAmountMinor ?? line.netAmountMinor,
      recognitionCategoryId: line.recognitionCategoryId ?? line.categoryId,
      recognitionProductId: line.recognitionProductId ?? line.productId,
      recognitionProductSkuId,
      storeId: args.storeId,
    });
  }

  const scheduled = await scheduleReportingWorkBestEffort(
    ctx,
    reportingIngressInternal.processPendingIngress,
    { ingressId },
  );
  if (!scheduled) {
    const ingress = await ctx.db.get("reportingIngress", ingressId);
    if (!ingress) throw new Error("Reporting ingress was not persisted.");
    await recordIngressFailureWithCtx(ctx, {
      ingress,
      now: scheduledAt,
      recoveryDisposition: "retry_pending",
      safeCode: "initial_processing_schedule_failed",
    });
    await scheduleReportingWorkBestEffort(
      ctx,
      reportingIngressInternal.resumePendingIngressForStore,
      { limit: REPORTING_PENDING_RECOVERY_BATCH_LIMIT, storeId: args.storeId },
    );
  }
  return { kind: "appended" as const, ingressId };
}

export const processPendingIngress = internalMutation({
  args: { ingressId: v.id("reportingIngress") },
  handler: async (ctx, args) => {
    const ingress = await ctx.db.get("reportingIngress", args.ingressId);
    if (!ingress || ingress.status !== "pending") {
      return null;
    }

    const previousAttempts = await ctx.db
      .query("reportingFactProcessingAttempt")
      .withIndex("by_ingressId_attempt", (q) =>
        q.eq("ingressId", args.ingressId),
      )
      .order("desc")
      .first();
    const attempt =
      Math.max(previousAttempts?.attempt ?? 0, ingress.attemptCount ?? 0) + 1;
    const now = Date.now();
    const period = await resolveReportingFinancialPeriodWithCtx(ctx, {
      occurrenceAt: ingress.occurredAt,
      organizationId: ingress.organizationId,
      storeId: ingress.storeId,
    });
    if (period.kind !== "resolved") {
      await ctx.db.insert("reportingQuarantine", {
        detectedAt: now,
        ingressId: ingress._id,
        organizationId: ingress.organizationId,
        safeCode: "missing_reporting_period",
        safeFingerprint: ingress.contentFingerprint,
        sourceDomain: ingress.sourceDomain,
        status: "open",
        storeId: ingress.storeId,
      });
      await ctx.db.patch("reportingIngress", ingress._id, {
        status: "quarantined",
      });
      await recordIngressFailureWithCtx(ctx, {
        ingress,
        now,
        recoveryDisposition: "quarantined",
        safeCode: "missing_reporting_period",
      });
      const openQuarantines = await ctx.db
        .query("reportingQuarantine")
        .withIndex("by_storeId_status_detectedAt", (q) =>
          q.eq("storeId", ingress.storeId).eq("status", "open"),
        )
        .take(100);
      for (const projectionKind of ["store_day", "sku_day"] as const) {
        await upsertProjectionHealthWithCtx(ctx, {
          factContractVersion: ingress.factContractVersion,
          limitingReason: "source_incomplete",
          metricContractVersion: 1,
          organizationId: ingress.organizationId,
          processingWatermark: ingress.acceptedAt,
          projectionContractVersion: REPORTING_PROJECTION_CONTRACT_VERSION,
          projectionKind,
          quarantinedCount: openQuarantines.filter(
            (row) => row.sourceDomain === ingress.sourceDomain,
          ).length,
          sourceDomain: ingress.sourceDomain,
          storeId: ingress.storeId,
          updatedAt: now,
        });
      }
      return null;
    }
    const [lines, references] = await Promise.all([
      ctx.db
        .query("reportingIngressLine")
        .withIndex("by_ingressId_lineKey", (q) =>
          q.eq("ingressId", ingress._id),
        )
        .take(REPORTING_INGRESS_LINE_LIMIT + 1),
      ctx.db
        .query("reportingIngressSourceReference")
        .withIndex("by_ingressId", (q) => q.eq("ingressId", ingress._id))
        .take(REPORTING_INGRESS_SOURCE_REFERENCE_LIMIT + 1),
    ]);
    const childCounts = classifyIngressChildCounts({
      lineCount: lines.length,
      sourceReferenceCount: references.length,
    });
    if (childCounts.status === "quarantined") {
      await quarantineIngressWithCtx(ctx, {
        attempt,
        ingress,
        now,
        safeCode: childCounts.reason,
      });
      return null;
    }
    const factInputs: Array<{
      amountMinor?: number;
      allocatedDiscountMinor?: number;
      attributionKind?: ReportingSkuAttributionKind;
      attributionVersion?: number;
      businessEventKey: string;
      categoryId?: Id<"category">;
      canonicalProductSkuId?: Id<"productSku">;
      channel?: ReportingRecognitionChannel;
      cogsKnownMinor?: number;
      cogsKnownQuantity?: number;
      cogsUncoveredQuantity?: number;
      completeness: "complete" | "partial";
      costStatus?: "known" | "partial" | "unknown" | "not_applicable";
      coveredRevenueMinor?: number;
      factType:
        | "sale"
        | "discount"
        | "refund"
        | "void"
        | "correction"
        | "payment"
        | "procurement_commitment"
        | "procurement_receipt"
        | "close_snapshot";
      limitingReason?: "uncosted" | "source_incomplete";
      linkedBusinessEventKey?: string;
      productSkuId?: Id<"productSku">;
      quantity?: number;
      revenueKind?: "merchandise" | "service" | "delivery" | "tax" | "refund";
      serviceCaseId?: Id<"serviceCase">;
      sourceLineKey?: string;
      expectedInboundAt?: number;
      procurementSignal?: "commitment" | "receipt" | "short_receipt";
      priorSettlementMethod?: string;
      correctedSettlementMethod?: string;
      commitmentConfirmed?: boolean;
      inventoryEffectId?: Id<"reportingInventoryEffect">;
      inventoryImportProvisionalSkuId?: Id<"inventoryImportProvisionalSku">;
      valuationCurrencyCode?: string;
      valuationCurrencyMinorUnitScale?: number;
      originalProductSkuId?: Id<"productSku">;
      originalQuantity?: number;
      pendingCheckoutItemId?: Id<"posPendingCheckoutItem">;
      productId?: Id<"product">;
      provisionalProductSkuId?: Id<"productSku">;
      recognizedNetAmountMinor?: number;
      recognitionCategoryId?: Id<"category">;
      recognitionProductId?: Id<"product">;
      recognitionProductSkuId?: Id<"productSku">;
      unitPriceMinor?: number;
    }> = [];
    const isRefund = ingress.sourceEventType.includes("refund");
    const isVoid = ingress.sourceEventType.includes("void");
    const isCorrection = ingress.sourceEventType.includes("correction");
    const isProcurementCommitment =
      ingress.sourceEventType === "purchase_order_line_created" ||
      ingress.sourceEventType.includes("purchase_order_commitment");
    const isProcurementReceipt = ingress.sourceEventType.includes(
      "purchase_order_receipt",
    );
    const pendingCheckoutAttributions = new Map<
      string,
      Doc<"reportingSkuAttribution">
    >();
    const pendingCheckoutItemIds = [
      ...new Set(
        lines.flatMap((line) =>
          line.pendingCheckoutItemId
            ? [String(line.pendingCheckoutItemId)]
            : [],
        ),
      ),
    ];
    for (const pendingCheckoutItemId of pendingCheckoutItemIds) {
      const attribution = await ctx.db
        .query("reportingSkuAttribution")
        .withIndex("by_storeId_pendingCheckoutItemId", (q) =>
          q
            .eq("storeId", ingress.storeId)
            .eq(
              "pendingCheckoutItemId",
              pendingCheckoutItemId as Id<"posPendingCheckoutItem">,
            ),
        )
        .first();
      if (attribution)
        pendingCheckoutAttributions.set(pendingCheckoutItemId, attribution);
    }
    for (const line of lines) {
      const factType = isRefund
        ? "refund"
        : isVoid
          ? "void"
          : isCorrection
            ? "correction"
            : isProcurementCommitment
              ? "procurement_commitment"
              : isProcurementReceipt
                ? "procurement_receipt"
                : "sale";
      const lineAmount = line.netAmountMinor ?? line.grossAmountMinor;
      const signedLineAmount =
        (isRefund || isVoid) && lineAmount !== undefined
          ? -Math.abs(lineAmount)
          : lineAmount;
      const resolvedAttribution = line.pendingCheckoutItemId
        ? pendingCheckoutAttributions.get(String(line.pendingCheckoutItemId))
        : undefined;
      factInputs.push({
        allocatedDiscountMinor:
          line.allocatedDiscountMinor ?? line.discountAmountMinor,
        attributionKind: line.attributionKind,
        attributionVersion: line.attributionVersion,
        amountMinor: isRefund
          ? lineAmount === undefined
            ? undefined
            : -Math.abs(lineAmount)
          : isVoid
            ? lineAmount === undefined
              ? undefined
              : -Math.abs(lineAmount)
            : isProcurementCommitment || isProcurementReceipt
              ? line.netAmountMinor
              : isCorrection
                ? lineAmount
                : line.grossAmountMinor,
        businessEventKey: canonicalReportingFactKey({
          businessEventKey: ingress.businessEventKey,
          factType,
          lineKey: line.lineKey,
        }),
        categoryId: line.categoryId,
        canonicalProductSkuId:
          resolvedAttribution?.canonicalProductSkuId ??
          line.canonicalProductSkuId,
        channel: line.channel,
        cogsKnownMinor:
          (isRefund || isVoid) && line.cogsKnownMinor !== undefined
            ? -Math.abs(line.cogsKnownMinor)
            : line.cogsKnownMinor,
        cogsKnownQuantity: line.cogsKnownQuantity,
        cogsUncoveredQuantity: line.cogsUncoveredQuantity,
        completeness:
          line.costStatus === "unknown" || line.costStatus === "partial"
            ? "partial"
            : "complete",
        costStatus: line.costStatus,
        coveredRevenueMinor: coveredRevenueForLine(line, signedLineAmount),
        factType,
        limitingReason:
          line.costStatus === "unknown" || line.costStatus === "partial"
            ? "uncosted"
            : undefined,
        productSkuId: line.productSkuId,
        quantity: isRefund || isVoid ? -Math.abs(line.quantity) : line.quantity,
        revenueKind: isRefund ? "refund" : line.lineKind,
        serviceCaseId: line.serviceCaseId,
        sourceLineKey: line.lineKey,
        expectedInboundAt: line.expectedInboundAt,
        procurementSignal: line.procurementSignal,
        commitmentConfirmed: line.commitmentConfirmed,
        inventoryEffectId: line.inventoryEffectId,
        linkedBusinessEventKey: ingress.linkedBusinessEventKey,
        inventoryImportProvisionalSkuId: line.inventoryImportProvisionalSkuId,
        originalProductSkuId: line.originalProductSkuId,
        originalQuantity: line.originalQuantity,
        pendingCheckoutItemId: line.pendingCheckoutItemId,
        productId: line.productId,
        provisionalProductSkuId: line.provisionalProductSkuId,
        recognizedNetAmountMinor:
          isRefund || isVoid
            ? signedLineAmount
            : (line.recognizedNetAmountMinor ?? signedLineAmount),
        recognitionCategoryId: line.recognitionCategoryId,
        recognitionProductId: line.recognitionProductId,
        recognitionProductSkuId: line.recognitionProductSkuId,
        valuationCurrencyCode: line.valuationCurrencyCode,
        valuationCurrencyMinorUnitScale: line.valuationCurrencyMinorUnitScale,
        unitPriceMinor: line.unitPriceMinor,
      });
      if (
        !isRefund &&
        !isVoid &&
        !isCorrection &&
        (line.discountAmountMinor ?? 0) !== 0
      ) {
        factInputs.push({
          amountMinor: Math.abs(line.discountAmountMinor!),
          allocatedDiscountMinor:
            line.allocatedDiscountMinor ?? line.discountAmountMinor,
          attributionKind: line.attributionKind,
          attributionVersion: line.attributionVersion,
          businessEventKey: `${ingress.businessEventKey}:line:${line.lineKey}:discount`,
          categoryId: line.categoryId,
          canonicalProductSkuId:
            resolvedAttribution?.canonicalProductSkuId ??
            line.canonicalProductSkuId,
          channel: line.channel,
          completeness: "complete",
          factType: "discount",
          productSkuId: line.productSkuId,
          inventoryImportProvisionalSkuId: line.inventoryImportProvisionalSkuId,
          originalProductSkuId: line.originalProductSkuId,
          originalQuantity: 0,
          pendingCheckoutItemId: line.pendingCheckoutItemId,
          productId: line.productId,
          provisionalProductSkuId: line.provisionalProductSkuId,
          quantity: 0,
          recognizedNetAmountMinor: 0,
          recognitionCategoryId: line.recognitionCategoryId,
          recognitionProductId: line.recognitionProductId,
          recognitionProductSkuId: line.recognitionProductSkuId,
          revenueKind: line.lineKind,
          serviceCaseId: line.serviceCaseId,
          sourceLineKey: line.lineKey,
          unitPriceMinor: line.unitPriceMinor,
        });
      }
    }
    if (factInputs.length === 0) {
      const factType = ingress.sourceEventType.includes("payment")
        ? "payment"
        : ingress.sourceEventType.includes("refund")
          ? "refund"
          : ingress.sourceEventType.includes("void")
            ? "void"
            : ingress.sourceEventType.includes("daily_close")
              ? "close_snapshot"
              : "correction";
      const rawAmount =
        ingress.settlementAmountMinor ??
        ingress.netAmountMinor ??
        ingress.grossAmountMinor;
      factInputs.push({
        amountMinor:
          factType === "refund" && rawAmount !== undefined
            ? -Math.abs(rawAmount)
            : rawAmount,
        businessEventKey: canonicalReportingFactKey({
          businessEventKey: ingress.businessEventKey,
          factType,
        }),
        completeness:
          factType === "close_snapshot"
            ? (ingress.closeSnapshot?.completeness ?? "partial")
            : "complete",
        factType,
        linkedBusinessEventKey: ingress.linkedBusinessEventKey,
        priorSettlementMethod: ingress.priorSettlementMethod,
        correctedSettlementMethod: ingress.correctedSettlementMethod,
        quantity: ingress.quantity,
        revenueKind: factType === "refund" ? "refund" : undefined,
      });
    }
    const existingFactsByBusinessEventKey = new Map<
      string,
      Doc<"reportingFact">
    >();
    const fingerprintsByBusinessEventKey = new Map<string, string>();
    for (const fact of factInputs) {
      const semanticFingerprint = canonicalReportingFactSemanticFingerprint({
        amountMinor: fact.amountMinor,
        allocatedDiscountMinor: fact.allocatedDiscountMinor,
        attributionKind: fact.attributionKind,
        attributionVersion: fact.attributionVersion,
        businessEventKey: fact.businessEventKey,
        categoryId: fact.categoryId,
        channel: fact.channel,
        closeSnapshot:
          fact.factType === "close_snapshot"
            ? ingress.closeSnapshot
            : undefined,
        cogsKnownMinor: fact.cogsKnownMinor,
        cogsKnownQuantity: fact.cogsKnownQuantity,
        cogsUncoveredQuantity: fact.cogsUncoveredQuantity,
        commitmentConfirmed: fact.commitmentConfirmed,
        completeness: fact.completeness,
        costStatus: fact.costStatus,
        coveredRevenueMinor: fact.coveredRevenueMinor,
        currencyCode: ingress.currencyCode,
        currencyMinorUnitScale: ingress.currencyMinorUnitScale,
        expectedInboundAt: fact.expectedInboundAt,
        factType: fact.factType,
        inventoryEffectId: fact.inventoryEffectId,
        inventoryImportProvisionalSkuId: fact.inventoryImportProvisionalSkuId,
        linkedBusinessEventKey: fact.linkedBusinessEventKey,
        occurrenceAt: ingress.occurredAt,
        operatingDate: period.reportingDate,
        organizationId: ingress.organizationId,
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
        recognizedNetAmountMinor: fact.recognizedNetAmountMinor,
        recognitionCategoryId: fact.recognitionCategoryId,
        recognitionProductId: fact.recognitionProductId,
        recognitionProductSkuId: fact.recognitionProductSkuId,
        revenueKind: fact.revenueKind,
        scheduleVersionId:
          period.scheduleContext.kind === "unavailable"
            ? undefined
            : (period.scheduleContext.scheduleVersionId ?? undefined),
        timezoneVersionHash: period.timezoneVersionHash,
        timezoneVersionId: period.timezoneVersionId,
        serviceCaseId: fact.serviceCaseId,
        sourceDomain: ingress.sourceDomain,
        sourceLineKey: fact.sourceLineKey,
        storeId: ingress.storeId,
        unitPriceMinor: fact.unitPriceMinor,
        valuationCurrencyCode: fact.valuationCurrencyCode,
        valuationCurrencyMinorUnitScale: fact.valuationCurrencyMinorUnitScale,
      });
      fingerprintsByBusinessEventKey.set(
        fact.businessEventKey,
        semanticFingerprint,
      );
      const existingFacts = await ctx.db
        .query("reportingFact")
        .withIndex("by_storeId_sourceDomain_businessEventKey", (q) =>
          q
            .eq("storeId", ingress.storeId)
            .eq("sourceDomain", ingress.sourceDomain)
            .eq("businessEventKey", fact.businessEventKey),
        )
        .take(2);
      if (existingFacts.length > 1) {
        await quarantineIngressWithCtx(ctx, {
          attempt,
          ingress,
          now,
          safeCode: "canonical_fact_identity_not_unique",
        });
        return null;
      }
      if (
        existingFacts[0] &&
        existingFacts[0].contentFingerprint !== semanticFingerprint
      ) {
        await quarantineIngressWithCtx(ctx, {
          attempt,
          ingress,
          now,
          safeCode: "canonical_fact_conflict",
        });
        return null;
      }
      if (existingFacts[0]) {
        existingFactsByBusinessEventKey.set(
          fact.businessEventKey,
          existingFacts[0],
        );
      }
    }

    const createdFactIds: Id<"reportingFact">[] = [];
    for (const fact of factInputs) {
      const existingFact = existingFactsByBusinessEventKey.get(
        fact.businessEventKey,
      );
      if (existingFact) {
        await recordFactSkuEvidenceWithCtx(ctx, existingFact);
        createdFactIds.push(existingFact._id);
        continue;
      }
      const factId = await ctx.db.insert("reportingFact", {
        acceptedAt: ingress.acceptedAt,
        allocatedDiscountMinor: fact.allocatedDiscountMinor,
        amountMinor: fact.amountMinor,
        attributionKind: fact.attributionKind,
        attributionVersion: fact.attributionVersion,
        businessEventKey: fact.businessEventKey,
        categoryId: fact.categoryId,
        canonicalProductSkuId:
          fact.canonicalProductSkuId ??
          (fact.attributionKind === "pending_checkout"
            ? undefined
            : fact.productSkuId),
        channel: fact.channel,
        ...(fact.cogsKnownMinor === undefined
          ? {}
          : { cogsKnownMinor: fact.cogsKnownMinor }),
        cogsKnownQuantity: fact.cogsKnownQuantity,
        cogsUncoveredQuantity: fact.cogsUncoveredQuantity,
        completeness: fact.completeness,
        contentFingerprint: fingerprintsByBusinessEventKey.get(
          fact.businessEventKey,
        )!,
        costStatus: fact.costStatus,
        coveredRevenueMinor: fact.coveredRevenueMinor,
        createdAt: now,
        currencyCode: ingress.currencyCode,
        currencyMinorUnitScale: ingress.currencyMinorUnitScale,
        revenueCurrencyCode: ingress.currencyCode,
        revenueCurrencyMinorUnitScale: ingress.currencyMinorUnitScale,
        valuationCurrencyCode: fact.valuationCurrencyCode,
        valuationCurrencyMinorUnitScale: fact.valuationCurrencyMinorUnitScale,
        factContractVersion: ingress.factContractVersion,
        factType: fact.factType,
        closeSnapshot:
          fact.factType === "close_snapshot"
            ? ingress.closeSnapshot
            : undefined,
        expectedInboundAt: fact.expectedInboundAt,
        commitmentConfirmed: fact.commitmentConfirmed,
        ingressId: ingress._id,
        inventoryEffectId: fact.inventoryEffectId,
        inventoryImportProvisionalSkuId: fact.inventoryImportProvisionalSkuId,
        limitingReason: fact.limitingReason,
        linkedBusinessEventKey: fact.linkedBusinessEventKey,
        metricContractVersion: 1,
        occurrenceAt: ingress.occurredAt,
        operatingDate: period.reportingDate,
        organizationId: ingress.organizationId,
        originalProductSkuId: fact.originalProductSkuId,
        originalQuantity: fact.originalQuantity,
        pendingCheckoutItemId: fact.pendingCheckoutItemId,
        productId: fact.productId,
        productSkuId: fact.productSkuId,
        provisionalProductSkuId: fact.provisionalProductSkuId,
        procurementSignal: fact.procurementSignal,
        priorSettlementMethod: fact.priorSettlementMethod,
        correctedSettlementMethod: fact.correctedSettlementMethod,
        quantity: fact.quantity,
        recognizedNetAmountMinor: fact.recognizedNetAmountMinor,
        recognitionAt: ingress.occurredAt,
        recognitionCategoryId: fact.recognitionCategoryId,
        recognitionProductId: fact.recognitionProductId,
        recognitionProductSkuId: fact.recognitionProductSkuId,
        revenueKind: fact.revenueKind,
        scheduleContext: period.scheduleContext.kind,
        scheduleVersionId:
          period.scheduleContext.kind === "unavailable"
            ? undefined
            : (period.scheduleContext.scheduleVersionId as Id<"storeSchedule">),
        timezoneVersionHash: period.timezoneVersionHash,
        timezoneVersionId:
          period.timezoneVersionId as Id<"storeTimezoneVersion">,
        serviceCaseId: fact.serviceCaseId,
        sourceDomain: ingress.sourceDomain,
        sourceLineKey: fact.sourceLineKey,
        status: "canonical",
        storeId: ingress.storeId,
        synchronizedAt: ingress.synchronizedAt,
        unitPriceMinor: fact.unitPriceMinor,
      });
      for (const reference of references) {
        await ctx.db.insert("reportingFactSourceReference", {
          createdAt: now,
          factId,
          relation: reference.relation,
          sourceId: reference.sourceId,
          sourceType: reference.sourceType,
          storeId: ingress.storeId,
        });
      }
      const createdFact = await ctx.db.get("reportingFact", factId);
      if (!createdFact)
        throw new Error("Canonical reporting fact was not persisted.");
      await recordFactSkuEvidenceWithCtx(ctx, createdFact);
      createdFactIds.push(factId);
    }
    let projectionSchedulingSucceeded = true;
    for (let index = 0; index < createdFactIds.length; index += 20) {
      projectionSchedulingSucceeded =
        (await scheduleFactProjectionBatchWithCtx(
          ctx,
          createdFactIds.slice(index, index + 20),
        )) && projectionSchedulingSucceeded;
    }
    if (!projectionSchedulingSucceeded) {
      await recordIngressFailureWithCtx(ctx, {
        ingress: { ...ingress, attemptCount: attempt - 1 },
        now,
        recoveryDisposition: "retry_pending",
        safeCode: "projection_schedule_failed",
      });
      await scheduleReportingWorkBestEffort(
        ctx,
        reportingIngressInternal.resumePendingIngressForStore,
        {
          limit: REPORTING_PENDING_RECOVERY_BATCH_LIMIT,
          storeId: ingress.storeId,
        },
      );
      return createdFactIds;
    }
    await ctx.db.patch("reportingIngress", ingress._id, {
      attemptCount: attempt,
      lastRecoveryAttemptAt: now,
      processedAt: now,
      projectionScheduledAt: now,
      recoveryDisposition:
        ingress.firstFailureAt === undefined ? undefined : "recovered",
      status: "processed",
    });
    await ctx.db.insert("reportingFactProcessingAttempt", {
      adapterVersion: ingress.adapterVersion,
      attempt,
      completedAt: now,
      factContractVersion: ingress.factContractVersion,
      ingressId: args.ingressId,
      metricContractVersion: 1,
      outcome: "succeeded",
      projectionContractVersion: REPORTING_PROJECTION_CONTRACT_VERSION,
      recoveryDisposition:
        ingress.firstFailureAt === undefined ? undefined : "recovered",
      startedAt: now,
      storeId: ingress.storeId,
    });
    return createdFactIds;
  },
});

export const resumePendingIngressForStore = internalMutation({
  args: {
    limit: v.optional(v.number()),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    const requestedLimit = args.limit ?? REPORTING_PENDING_RECOVERY_BATCH_LIMIT;
    if (
      !Number.isSafeInteger(requestedLimit) ||
      requestedLimit < 1 ||
      requestedLimit > REPORTING_PENDING_RECOVERY_BATCH_LIMIT
    ) {
      throw new Error("Pending reporting recovery batch size is invalid.");
    }
    const pending = await ctx.db
      .query("reportingIngress")
      .withIndex("by_storeId_status_acceptedAt", (q) =>
        q.eq("storeId", args.storeId).eq("status", "pending"),
      )
      .order("asc")
      .take(requestedLimit);
    let scheduledCount = 0;
    let failedCount = 0;
    const now = Date.now();
    for (const ingress of pending) {
      const scheduled = await scheduleReportingWorkBestEffort(
        ctx,
        reportingIngressInternal.processPendingIngress,
        { ingressId: ingress._id },
      );
      if (scheduled) {
        scheduledCount += 1;
        await ctx.db.patch("reportingIngress", ingress._id, {
          lastRecoveryAttemptAt: now,
          recoveryDisposition: "retry_scheduled",
        });
      } else {
        failedCount += 1;
        await recordIngressFailureWithCtx(ctx, {
          ingress,
          now,
          recoveryDisposition: "retry_pending",
          safeCode: "recovery_schedule_failed",
        });
      }
    }
    const attributionLimit = Math.max(0, requestedLimit - pending.length);
    const [pendingAttributions, retryPendingConflicts] =
      attributionLimit === 0
        ? [[], []]
        : await Promise.all([
          ctx.db
              .query("reportingSkuAttribution")
              .withIndex("by_storeId_status_updatedAt", (q) =>
                q.eq("storeId", args.storeId).eq("status", "pending"),
              )
              .order("asc")
              .take(attributionLimit),
          ctx.db
              .query("reportingSkuAttribution")
              .withIndex(
                "by_storeId_status_recoveryDisposition_updatedAt",
                (q) =>
                  q
                    .eq("storeId", args.storeId)
                    .eq("status", "conflict")
                    .eq("recoveryDisposition", "retry_pending"),
              )
              .order("asc")
              .take(attributionLimit),
        ]);
    const recoverableAttributions = [
      ...pendingAttributions,
      ...retryPendingConflicts,
    ]
      .sort((left, right) => left.updatedAt - right.updatedAt)
      .slice(0, attributionLimit);
    let attributionScheduledCount = 0;
    let attributionFailedCount = 0;
    for (const attribution of recoverableAttributions) {
      const scheduled = await scheduleReportingWorkBestEffort(
        ctx,
        reportingEvidenceInternal.materializePendingCheckoutSkuAttribution,
        { attributionId: attribution._id, cursor: attribution.cursor ?? null },
      );
      if (scheduled) {
        attributionScheduledCount += 1;
        await ctx.db.patch("reportingSkuAttribution", attribution._id, {
          recoveryDisposition: "retry_scheduled",
          updatedAt: now,
        });
      } else {
        attributionFailedCount += 1;
        await ctx.db.patch("reportingSkuAttribution", attribution._id, {
          attemptCount: attribution.attemptCount + 1,
          firstFailureAt: attribution.firstFailureAt ?? now,
          latestFailureAt: now,
          latestFailureCode: "sku_attribution_recovery_schedule_failed",
          recoveryDisposition: "retry_pending",
          updatedAt: now,
        });
      }
    }
    return {
      attributionFailedCount,
      attributionScheduledCount,
      failedCount,
      inspectedCount: pending.length + recoverableAttributions.length,
      scheduledCount,
      storeId: args.storeId,
    };
  },
});
