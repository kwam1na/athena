import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import { REPORTING_LINE_ATTRIBUTION_VERSION } from "../../shared/reportingContract";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "../_generated/server";
import { requireAuthenticatedAthenaUserWithCtx } from "../lib/athenaUserAuth";
import { requireReportingStoreAccess } from "./access";
import { upsertProjectionHealthWithCtx } from "./health";
import { scheduleReportingWorkBestEffort } from "./scheduling";
import { reattributeFactInActiveSkuProjectionWithCtx } from "./projections/processor";

export type EvidenceCursor = {
  factId: string;
  factVersion: number;
  filterKey: string;
  metricVersion: number;
  recognizedAt: number;
  storeId: string;
};

export function encodeEvidenceCursor(cursor: EvidenceCursor) {
  return encodeURIComponent(JSON.stringify(cursor));
}

export function decodeEvidenceCursor(
  encoded: string,
  binding: Pick<
    EvidenceCursor,
    "factVersion" | "filterKey" | "metricVersion" | "storeId"
  >,
) {
  let cursor: EvidenceCursor;
  try {
    cursor = JSON.parse(decodeURIComponent(encoded)) as EvidenceCursor;
  } catch {
    throw new Error("invalid evidence cursor");
  }
  if (
    cursor.storeId !== binding.storeId ||
    cursor.filterKey !== binding.filterKey ||
    cursor.factVersion !== binding.factVersion ||
    cursor.metricVersion !== binding.metricVersion
  ) {
    throw new Error("evidence cursor does not match request");
  }
  if (
    typeof cursor.factId !== "string" ||
    !Number.isSafeInteger(cursor.recognizedAt)
  ) {
    throw new Error("invalid evidence cursor");
  }
  return cursor;
}

const REPORTABLE_SOURCE_TYPES = new Set([
  "daily_close",
  "expense_transaction",
  "inventory_movement",
  "online_order",
  "operational_event",
  "payment_allocation",
  "pos_transaction",
  "pos_transaction_adjustment",
  "purchase_order",
  "purchase_order_receiving_batch",
  "receiving_batch",
  "reporting_cutover_baseline",
  "reporting_inventory_effect",
  "reportingInventoryBusinessEvent",
  "service_case",
  "stock_adjustment_batch",
]);

export function sanitizeSourceReference(input: {
  label?: string;
  relation?: string;
  sourceId: string;
  sourceType: string;
  storeId: string;
}) {
  if (!REPORTABLE_SOURCE_TYPES.has(input.sourceType)) {
    throw new Error("source type is not reportable");
  }
  return {
    ...(input.label === undefined ? {} : { label: input.label }),
    ...(input.relation === undefined ? {} : { relation: input.relation }),
    sourceId: input.sourceId,
    sourceType: input.sourceType,
    storeId: input.storeId,
  };
}

type SourceRoute = {
  relation: string;
  sourceId: string;
  sourceType: string;
};

type SkuEvidenceInput = Omit<
  Doc<"reportingSkuEvidence">,
  "_creationTime" | "_id" | "createdAt"
> & { createdAt?: number };

const SKU_EVIDENCE_MAX_PAGE_SIZE = 100;
const SKU_EVIDENCE_MAX_PERIOD_MS = 366 * 24 * 60 * 60 * 1_000;
const SKU_EVIDENCE_ACCESS_UNAVAILABLE = "Reports access unavailable.";

type SkuEvidenceCursorEnvelope = {
  databaseCursor: string;
  factVersion: number;
  filterKey: string;
  metricVersion: number;
  storeId: string;
};

function skuEvidenceFilterKey(input: {
  periodEnd?: number;
  periodStart?: number;
  productSkuId: Id<"productSku">;
}) {
  return [
    `sku:${String(input.productSkuId)}`,
    `start:${input.periodStart ?? "all"}`,
    `end:${input.periodEnd ?? "all"}`,
  ].join("|");
}

export function encodeSkuEvidencePageCursor(cursor: SkuEvidenceCursorEnvelope) {
  return encodeURIComponent(JSON.stringify(cursor));
}

export function decodeSkuEvidencePageCursor(
  encoded: string,
  binding: Pick<
    SkuEvidenceCursorEnvelope,
    "factVersion" | "filterKey" | "metricVersion" | "storeId"
  >,
) {
  let cursor: SkuEvidenceCursorEnvelope;
  try {
    cursor = JSON.parse(
      decodeURIComponent(encoded),
    ) as SkuEvidenceCursorEnvelope;
  } catch {
    throw new Error("invalid SKU evidence cursor");
  }
  if (
    cursor.storeId !== binding.storeId ||
    cursor.filterKey !== binding.filterKey ||
    cursor.factVersion !== binding.factVersion ||
    cursor.metricVersion !== binding.metricVersion ||
    typeof cursor.databaseCursor !== "string" ||
    cursor.databaseCursor.length === 0
  ) {
    throw new Error("SKU evidence cursor does not match request");
  }
  return cursor.databaseCursor;
}

function refundAdjustmentState(
  fact: Pick<Doc<"reportingFact">, "adjustmentKind" | "factType">,
) {
  if (fact.adjustmentKind === "deficit_cogs_revaluation")
    return "revalued" as const;
  switch (fact.factType) {
    case "refund":
      return "refunded" as const;
    case "void":
      return "voided" as const;
    case "correction":
      return "corrected" as const;
    case "return":
      return "returned" as const;
    default:
      return "none" as const;
  }
}

function snapshottedGrossProfit(fact: Doc<"reportingFact">) {
  if (fact.cogsKnownMinor === undefined) return undefined;
  if (fact.inventoryContributionKind === "sellable_return_cogs_reversal") {
    return -fact.cogsKnownMinor;
  }
  if (fact.inventoryContributionKind === "exchange_replacement_cogs") {
    return -Math.abs(fact.cogsKnownMinor);
  }
  if (fact.revenueKind !== "merchandise") return undefined;
  const revenueCurrency = fact.revenueCurrencyCode ?? fact.currencyCode;
  if (
    !revenueCurrency ||
    !fact.valuationCurrencyCode ||
    revenueCurrency !== fact.valuationCurrencyCode
  ) {
    return undefined;
  }
  return (fact.amountMinor ?? 0) - fact.cogsKnownMinor;
}

function safeRoutes(storeId: Id<"store">, routes: SourceRoute[]) {
  return routes.flatMap((route) => {
    try {
      const safe = sanitizeSourceReference({ ...route, storeId });
      return [
        {
          relation: safe.relation ?? "supports",
          sourceId: safe.sourceId,
          sourceType: safe.sourceType,
        },
      ];
    } catch {
      return [];
    }
  });
}

export async function upsertReportingSkuEvidenceWithCtx(
  ctx: MutationCtx,
  input: SkuEvidenceInput,
) {
  const existing = await ctx.db
    .query("reportingSkuEvidence")
    .withIndex("by_storeId_identityKey", (q) =>
      q.eq("storeId", input.storeId).eq("identityKey", input.identityKey),
    )
    .take(2);
  if (existing.length > 1)
    throw new Error("SKU evidence identity is not unique");
  if (existing[0]) {
    if (
      existing[0].productSkuId !== input.productSkuId ||
      existing[0].businessEventKey !== input.businessEventKey ||
      existing[0].evidenceKind !== input.evidenceKind
    ) {
      throw new Error(
        "SKU evidence identity conflicts with canonical evidence",
      );
    }
    return existing[0]._id;
  }
  return ctx.db.insert("reportingSkuEvidence", {
    ...input,
    sourceRoutes: safeRoutes(input.storeId, input.sourceRoutes),
    createdAt: input.createdAt ?? Date.now(),
  });
}

export async function recordFactSkuEvidenceWithCtx(
  ctx: MutationCtx,
  fact: Doc<"reportingFact">,
) {
  const attributedProductSkuId =
    fact.canonicalProductSkuId ?? fact.productSkuId;
  if (!attributedProductSkuId) return null;
  const references = await ctx.db
    .query("reportingFactSourceReference")
    .withIndex("by_factId", (q) => q.eq("factId", fact._id))
    .take(100);
  return upsertReportingSkuEvidenceWithCtx(ctx, {
    amountMinor: fact.amountMinor,
    allocatedDiscountMinor: fact.allocatedDiscountMinor,
    attributionKind: fact.attributionKind ?? "direct",
    attributionVersion:
      fact.attributionVersion ?? REPORTING_LINE_ATTRIBUTION_VERSION,
    businessEventKey: fact.businessEventKey,
    cogsKnownMinor: fact.cogsKnownMinor,
    completeness: fact.completeness,
    contributionState:
      fact.status === "canonical" ? "contributing" : "excluded",
    costStatus: fact.costStatus,
    currencyCode: fact.currencyCode,
    channel: fact.channel,
    evidenceKind: "fact",
    evidenceStatus: fact.status,
    factId: fact._id,
    factType: fact.factType,
    identityKey: `fact:${String(fact._id)}`,
    limitingReason: fact.limitingReason,
    linkedBusinessEventKey: fact.linkedBusinessEventKey,
    knownGrossProfitMinor: snapshottedGrossProfit(fact),
    occurrenceAt: fact.occurrenceAt,
    originalProductSkuId:
      fact.originalProductSkuId ??
      fact.recognitionProductSkuId ??
      fact.productSkuId,
    originalQuantity: fact.originalQuantity ?? fact.quantity,
    organizationId: fact.organizationId,
    pendingCheckoutItemId: fact.pendingCheckoutItemId,
    productSkuId: attributedProductSkuId,
    provisionalProductSkuId: fact.provisionalProductSkuId,
    quantity: fact.quantity,
    recognizedNetAmountMinor: fact.recognizedNetAmountMinor ?? fact.amountMinor,
    recognitionAt: fact.recognitionAt,
    recognitionCategoryId: fact.recognitionCategoryId ?? fact.categoryId,
    recognitionProductId: fact.recognitionProductId ?? fact.productId,
    recognitionProductSkuId: fact.recognitionProductSkuId ?? fact.productSkuId,
    refundAdjustmentState: refundAdjustmentState(fact),
    revenueCurrencyCode: fact.revenueCurrencyCode ?? fact.currencyCode,
    sourceDomain: fact.sourceDomain,
    sourceRoutes: references,
    storeId: fact.storeId,
    unitPriceMinor: fact.unitPriceMinor,
    valuationCurrencyCode: fact.valuationCurrencyCode,
    inventoryImportProvisionalSkuId: fact.inventoryImportProvisionalSkuId,
  });
}

export async function recordInventoryEffectSkuEvidenceWithCtx(
  ctx: MutationCtx,
  effect: Doc<"reportingInventoryEffect">,
) {
  const references = await ctx.db
    .query("reportingInventoryEffectSourceReference")
    .withIndex("by_effectId", (q) => q.eq("effectId", effect._id))
    .take(100);
  const hasKnownInboundBasis =
    effect.physicalQuantityDelta > 0 &&
    effect.currencyCode !== undefined &&
    effect.valuationStatus !== "rebuild_required";
  const hasKnownCostEvidence =
    effect.outboundBasisMinor !== undefined ||
    effect.cogsReversalKnownMinor !== undefined ||
    hasKnownInboundBasis ||
    (effect.costLane === "inventory_adjustment" &&
      effect.currencyCode !== undefined);
  const isMerchandiseCostLane =
    effect.costLane === "merchandise_cogs" ||
    effect.costLane === "exchange_merchandise_cogs";
  return upsertReportingSkuEvidenceWithCtx(ctx, {
    amountMinor: effect.outboundBasisMinor ?? effect.knownCostPoolDeltaMinor,
    businessEventKey: effect.businessEventKey,
    cogsKnownMinor: isMerchandiseCostLane
      ? effect.cogsReversalKnownMinor !== undefined
        ? -Math.abs(effect.cogsReversalKnownMinor)
        : effect.outboundBasisMinor
      : undefined,
    completeness: effect.completeness,
    costStatus: hasKnownCostEvidence
      ? effect.uncostedQuantityDelta !== 0 || effect.unresolvedDeficitDelta > 0
        ? "partial"
        : "known"
      : effect.physicalQuantityDelta > 0 || effect.costedQuantityDelta !== 0
        ? "unknown"
        : "not_applicable",
    currencyCode: effect.currencyCode,
    effectType: effect.effectType,
    evidenceKind: "inventory_effect",
    evidenceStatus: effect.valuationStatus ?? "current",
    identityKey: `inventory_effect:${String(effect._id)}`,
    inventoryEffectId: effect._id,
    knownGrossProfitMinor:
      effect.costLane === "exchange_merchandise_cogs" &&
      effect.outboundBasisMinor !== undefined
        ? -Math.abs(effect.outboundBasisMinor)
        : isMerchandiseCostLane && effect.cogsReversalKnownMinor !== undefined
          ? Math.abs(effect.cogsReversalKnownMinor)
          : undefined,
    occurrenceAt: effect.occurrenceAt,
    organizationId: effect.organizationId,
    productSkuId: effect.productSkuId,
    quantity: effect.physicalQuantityDelta,
    returnedQuantity: effect.returnedQuantity,
    returnDisposition: effect.returnDisposition,
    recognitionAt: effect.occurrenceAt,
    refundAdjustmentState:
      effect.effectType === "return"
        ? "returned"
        : effect.effectType === "deficit_resolution"
          ? "revalued"
          : "none",
    sourceDomain: effect.sourceDomain,
    sourceRoutes: references,
    storeId: effect.storeId,
    valuationCurrencyCode: effect.currencyCode,
  });
}

async function quarantinePaymentSkuEvidenceWithCtx(
  ctx: MutationCtx,
  input: {
    allocation: Doc<"paymentAllocation">;
    limitingReason: "cross_store_reference" | "evidence_truncated";
    organizationId: Id<"organization">;
    safeCode: "cross_store_reference" | "sku_evidence_truncated";
  },
) {
  const safeFingerprint = `payment-sku-evidence:v1:${String(input.allocation._id)}:${input.allocation.status}:${input.safeCode}`;
  const openQuarantines = await ctx.db
    .query("reportingQuarantine")
    .withIndex("by_storeId_status_detectedAt", (q) =>
      q.eq("storeId", input.allocation.storeId).eq("status", "open"),
    )
    .take(100);
  const alreadyRecorded = openQuarantines.some(
    (row) => row.safeFingerprint === safeFingerprint,
  );
  const now = Date.now();
  if (!alreadyRecorded) {
    await ctx.db.insert("reportingQuarantine", {
      detectedAt: now,
      organizationId: input.organizationId,
      safeCode: input.safeCode,
      safeFingerprint,
      sourceDomain: "payments",
      status: "open",
      storeId: input.allocation.storeId,
    });
  }
  const quarantinedCount =
    openQuarantines.filter((row) => row.sourceDomain === "payments").length +
    (alreadyRecorded ? 0 : 1);
  for (const projectionKind of ["store_day", "sku_day"] as const) {
    await upsertProjectionHealthWithCtx(ctx, {
      factContractVersion: 1,
      limitingReason: input.limitingReason,
      metricContractVersion: 1,
      organizationId: input.organizationId,
      projectionContractVersion: 1,
      projectionKind,
      quarantinedCount,
      sourceDomain: "payments",
      storeId: input.allocation.storeId,
      updatedAt: now,
    });
  }
}

export async function recordPaymentAllocationSkuEvidenceWithCtx(
  ctx: MutationCtx,
  allocation: Doc<"paymentAllocation">,
  organizationId: Id<"organization">,
) {
  const itemRows =
    allocation.evidenceProductSkuIds !== undefined ||
    allocation.direction === "out"
      ? []
      : allocation.posTransactionId
        ? await ctx.db
            .query("posTransactionItem")
            .withIndex("by_transactionId", (q) =>
              q.eq("transactionId", allocation.posTransactionId!),
            )
            .take(101)
        : allocation.onlineOrderId
          ? await ctx.db
              .query("onlineOrderItem")
              .withIndex("by_orderId", (q) =>
                q.eq("orderId", allocation.onlineOrderId!),
              )
              .take(101)
          : [];
  const candidateCount =
    allocation.evidenceProductSkuIds?.length ?? itemRows.length;
  if (candidateCount > 100) {
    await quarantinePaymentSkuEvidenceWithCtx(ctx, {
      allocation,
      limitingReason: "evidence_truncated",
      organizationId,
      safeCode: "sku_evidence_truncated",
    });
    return { kind: "truncated" as const, itemCount: candidateCount };
  }
  const candidateSkuIds = [
    ...new Set(
      allocation.evidenceProductSkuIds ??
        itemRows.map((row) => row.productSkuId),
    ),
  ];
  let skuIds = candidateSkuIds;
  if (allocation.evidenceProductSkuIds !== undefined) {
    const skuRows = await Promise.all(
      candidateSkuIds.map((productSkuId) =>
        ctx.db.get("productSku", productSkuId),
      ),
    );
    skuIds = candidateSkuIds.filter(
      (_productSkuId, index) => skuRows[index]?.storeId === allocation.storeId,
    );
    if (skuIds.length !== candidateSkuIds.length) {
      await quarantinePaymentSkuEvidenceWithCtx(ctx, {
        allocation,
        limitingReason: "cross_store_reference",
        organizationId,
        safeCode: "cross_store_reference",
      });
    }
  }
  const amountMinor =
    allocation.direction === "out" || allocation.status === "voided"
      ? -Math.abs(allocation.amount)
      : Math.abs(allocation.amount);
  const sourceRoutes: SourceRoute[] = [
    {
      relation: allocation.status === "voided" ? "reverses" : "owns",
      sourceId: String(allocation._id),
      sourceType: "payment_allocation",
    },
    ...(allocation.posTransactionId
      ? [
          {
            relation: "supports",
            sourceId: String(allocation.posTransactionId),
            sourceType: "pos_transaction",
          },
        ]
      : []),
    ...(allocation.onlineOrderId
      ? [
          {
            relation: "supports",
            sourceId: String(allocation.onlineOrderId),
            sourceType: "online_order",
          },
        ]
      : []),
  ];
  for (const productSkuId of skuIds) {
    await upsertReportingSkuEvidenceWithCtx(ctx, {
      amountMinor,
      businessEventKey: `payment_allocation:${String(allocation._id)}:${allocation.status}`,
      completeness: "complete",
      currencyCode: allocation.currency,
      evidenceKind: "payment",
      evidenceStatus: allocation.status,
      identityKey: `payment:${String(allocation._id)}:${String(productSkuId)}:${allocation.status}`,
      occurrenceAt: allocation.recordedAt,
      organizationId,
      paymentAllocationId: allocation._id,
      productSkuId,
      recognitionAt: allocation.recordedAt,
      refundAdjustmentState:
        allocation.status === "voided"
          ? "voided"
          : allocation.direction === "out"
            ? "refunded"
            : "none",
      revenueCurrencyCode: allocation.currency,
      sourceDomain: "payments",
      sourceRoutes,
      storeId: allocation.storeId,
    });
  }
  return { kind: "recorded" as const, skuCount: skuIds.length };
}

const reportingEvidenceInternal = (internal as any).reporting.evidence;
const SKU_ATTRIBUTION_PAGE_SIZE = 20;

async function recordSkuAttributionFailureWithCtx(
  ctx: MutationCtx,
  attribution: Doc<"reportingSkuAttribution">,
  safeCode: string,
) {
  const now = Date.now();
  await ctx.db.patch("reportingSkuAttribution", attribution._id, {
    attemptCount: attribution.attemptCount + 1,
    firstFailureAt: attribution.firstFailureAt ?? now,
    latestFailureAt: now,
    latestFailureCode: safeCode,
    recoveryDisposition: "retry_pending",
    status: "pending",
    updatedAt: now,
  });
}

export async function recordPendingCheckoutSkuAttributionWithCtx(
  ctx: MutationCtx,
  input: {
    canonicalProductId?: Id<"product">;
    canonicalProductSkuId: Id<"productSku">;
    organizationId: Id<"organization">;
    originalProductId?: Id<"product">;
    originalProductSkuId: Id<"productSku">;
    pendingCheckoutItemId: Id<"posPendingCheckoutItem">;
    storeId: Id<"store">;
  },
) {
  const existing = await ctx.db
    .query("reportingSkuAttribution")
    .withIndex("by_storeId_pendingCheckoutItemId", (q) =>
      q
        .eq("storeId", input.storeId)
        .eq("pendingCheckoutItemId", input.pendingCheckoutItemId),
    )
    .take(2);
  if (existing.length > 1)
    throw new Error("SKU attribution identity is not unique");
  if (
    existing[0] &&
    (existing[0].canonicalProductSkuId !== input.canonicalProductSkuId ||
      existing[0].originalProductSkuId !== input.originalProductSkuId)
  ) {
    await ctx.db.patch("reportingSkuAttribution", existing[0]._id, {
      latestFailureAt: Date.now(),
      latestFailureCode: "sku_attribution_conflict",
      status: "conflict",
      updatedAt: Date.now(),
    });
    return { attributionId: existing[0]._id, kind: "conflict" as const };
  }

  const now = Date.now();
  const attributionId =
    existing[0]?._id ??
    (await ctx.db.insert("reportingSkuAttribution", {
      attributionKind: "pending_checkout",
      attributionVersion: REPORTING_LINE_ATTRIBUTION_VERSION,
      canonicalProductId: input.canonicalProductId,
      canonicalProductSkuId: input.canonicalProductSkuId,
      createdAt: now,
      attemptCount: 0,
      organizationId: input.organizationId,
      originalProductId: input.originalProductId,
      originalProductSkuId: input.originalProductSkuId,
      pendingCheckoutItemId: input.pendingCheckoutItemId,
      recoveryDisposition: "retry_pending",
      status: "pending",
      storeId: input.storeId,
      updatedAt: now,
    }));
  const attribution =
    existing[0] ??
    ({
      _id: attributionId,
      attributionKind: "pending_checkout",
      attributionVersion: REPORTING_LINE_ATTRIBUTION_VERSION,
      canonicalProductId: input.canonicalProductId,
      canonicalProductSkuId: input.canonicalProductSkuId,
      createdAt: now,
      attemptCount: 0,
      organizationId: input.organizationId,
      originalProductId: input.originalProductId,
      originalProductSkuId: input.originalProductSkuId,
      pendingCheckoutItemId: input.pendingCheckoutItemId,
      recoveryDisposition: "retry_pending",
      status: "pending",
      storeId: input.storeId,
      updatedAt: now,
    } as Doc<"reportingSkuAttribution">);
  const scheduled = await scheduleReportingWorkBestEffort(
    ctx,
    reportingEvidenceInternal.materializePendingCheckoutSkuAttribution,
    { attributionId, cursor: null },
  );
  if (!scheduled) {
    await recordSkuAttributionFailureWithCtx(
      ctx,
      attribution,
      "sku_attribution_schedule_failed",
    );
  } else {
    await ctx.db.patch("reportingSkuAttribution", attributionId, {
      recoveryDisposition: "retry_scheduled",
      status: "pending",
      updatedAt: now,
    });
  }
  return {
    attributionId,
    kind: existing[0] ? ("replayed" as const) : ("recorded" as const),
    scheduled,
  };
}

export const materializePendingCheckoutSkuAttribution = internalMutation({
  args: {
    attributionId: v.id("reportingSkuAttribution"),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const attribution = await ctx.db.get(
      "reportingSkuAttribution",
      args.attributionId,
    );
    if (!attribution || attribution.status === "conflict") return null;
    const page = await ctx.db
      .query("reportingFact")
      .withIndex("by_storeId_pendingCheckoutItemId_recognitionAt", (q) =>
        q
          .eq("storeId", attribution.storeId)
          .eq("pendingCheckoutItemId", attribution.pendingCheckoutItemId),
      )
      .order("asc")
      .paginate({ cursor: args.cursor, numItems: SKU_ATTRIBUTION_PAGE_SIZE });
    for (const fact of page.page) {
      await reattributeFactInActiveSkuProjectionWithCtx(ctx, {
        attributionKind: "pending_checkout",
        attributionVersion: attribution.attributionVersion,
        canonicalProductSkuId: attribution.canonicalProductSkuId,
        fact,
        originalProductSkuId: attribution.originalProductSkuId,
      });
      await ctx.db.patch("reportingFact", fact._id, {
        canonicalProductSkuId: attribution.canonicalProductSkuId,
      });
      const evidenceRows = await ctx.db
        .query("reportingSkuEvidence")
        .withIndex("by_storeId_identityKey", (q) =>
          q
            .eq("storeId", attribution.storeId)
            .eq("identityKey", `fact:${String(fact._id)}`),
        )
        .take(2);
      if (evidenceRows.length > 1)
        throw new Error("SKU evidence identity is not unique");
      if (evidenceRows[0]) {
        await ctx.db.patch("reportingSkuEvidence", evidenceRows[0]._id, {
          attributionKind: "pending_checkout",
          attributionVersion: attribution.attributionVersion,
          originalProductSkuId: attribution.originalProductSkuId,
          pendingCheckoutItemId: attribution.pendingCheckoutItemId,
          productSkuId: attribution.canonicalProductSkuId,
          provisionalProductSkuId: attribution.originalProductSkuId,
          recognitionProductSkuId:
            evidenceRows[0].recognitionProductSkuId ?? fact.productSkuId,
        });
      }
    }
    const now = Date.now();
    if (page.isDone) {
      await ctx.db.patch("reportingSkuAttribution", attribution._id, {
        attemptCount: attribution.attemptCount + 1,
        completedAt: now,
        cursor: undefined,
        recoveryDisposition: "recovered",
        status: "completed",
        updatedAt: now,
      });
      return { completed: true, processedCount: page.page.length };
    }
    const scheduled = await scheduleReportingWorkBestEffort(
      ctx,
      reportingEvidenceInternal.materializePendingCheckoutSkuAttribution,
      { attributionId: attribution._id, cursor: page.continueCursor },
    );
    if (!scheduled) {
      await recordSkuAttributionFailureWithCtx(
        ctx,
        attribution,
        "sku_attribution_continuation_schedule_failed",
      );
    } else {
      await ctx.db.patch("reportingSkuAttribution", attribution._id, {
        attemptCount: attribution.attemptCount + 1,
        cursor: page.continueCursor,
        recoveryDisposition: "retry_scheduled",
        updatedAt: now,
      });
    }
    return {
      completed: false,
      continueCursor: page.continueCursor,
      processedCount: page.page.length,
      scheduled,
    };
  },
});

type SkuEvidencePreflightArgs = {
  paginationOpts: { cursor: string | null; numItems: number };
  periodEnd?: number;
  periodStart?: number;
  productSkuId: Id<"productSku">;
  storeId: Id<"store">;
};

async function recordSkuEvidenceDenialWithCtx(
  ctx: MutationCtx,
  input: {
    actorRef?: string;
    safeReason: string;
    storeId?: Id<"store">;
    requestedStoreRef: string;
  },
) {
  await ctx.db.insert("reportingIntegrityAttempt", {
    ...(input.actorRef ? { actorRef: input.actorRef } : {}),
    operation: "list_sku_evidence",
    outcome: "denied",
    occurredAt: Date.now(),
    requestedStoreRef: input.requestedStoreRef,
    safeReason: input.safeReason,
    ...(input.storeId ? { storeId: input.storeId } : {}),
  });
}

export async function preflightListSkuEvidenceWithCtx(
  ctx: MutationCtx,
  args: SkuEvidencePreflightArgs,
) {
  let actorRef: string | undefined;
  try {
    actorRef = String((await requireAuthenticatedAthenaUserWithCtx(ctx))._id);
  } catch {
    // The denial evidence intentionally remains anonymous.
  }
  try {
    await requireReportingStoreAccess(ctx, args.storeId);
  } catch {
    await recordSkuEvidenceDenialWithCtx(ctx, {
      actorRef,
      requestedStoreRef: String(args.storeId),
      safeReason: "reporting_store_access_denied",
    });
    return { allowed: false as const };
  }
  const deny = async (safeReason: string) => {
    await recordSkuEvidenceDenialWithCtx(ctx, {
      actorRef,
      requestedStoreRef: String(args.storeId),
      safeReason,
      storeId: args.storeId,
    });
    return { allowed: false as const };
  };
  if (
    !Number.isSafeInteger(args.paginationOpts.numItems) ||
    args.paginationOpts.numItems < 1 ||
    args.paginationOpts.numItems > SKU_EVIDENCE_MAX_PAGE_SIZE
  ) {
    return deny("sku_evidence_page_size_invalid");
  }
  if ((args.periodStart === undefined) !== (args.periodEnd === undefined)) {
    return deny("sku_evidence_period_invalid");
  }
  if (
    args.periodStart !== undefined &&
    args.periodEnd !== undefined &&
    (!Number.isSafeInteger(args.periodStart) ||
      !Number.isSafeInteger(args.periodEnd) ||
      args.periodEnd < args.periodStart ||
      args.periodEnd - args.periodStart > SKU_EVIDENCE_MAX_PERIOD_MS)
  ) {
    return deny("sku_evidence_period_invalid");
  }
  const sku = await ctx.db.get("productSku", args.productSkuId);
  if (!sku || sku.storeId !== args.storeId) {
    return deny("sku_evidence_scope_mismatch");
  }
  let databaseCursor: string | null = null;
  if (args.paginationOpts.cursor) {
    try {
      databaseCursor = decodeSkuEvidencePageCursor(args.paginationOpts.cursor, {
        factVersion: 1,
        filterKey: skuEvidenceFilterKey(args),
        metricVersion: 1,
        storeId: String(args.storeId),
      });
    } catch {
      return deny("sku_evidence_cursor_scope_mismatch");
    }
  }
  return { allowed: true as const, databaseCursor };
}

export const preflightListSkuEvidence = internalMutation({
  args: {
    paginationOpts: paginationOptsValidator,
    periodEnd: v.optional(v.number()),
    periodStart: v.optional(v.number()),
    productSkuId: v.id("productSku"),
    storeId: v.id("store"),
  },
  handler: preflightListSkuEvidenceWithCtx,
});

export const readSkuEvidencePage = internalQuery({
  args: {
    databaseCursor: v.union(v.string(), v.null()),
    numItems: v.number(),
    periodEnd: v.optional(v.number()),
    periodStart: v.optional(v.number()),
    productSkuId: v.id("productSku"),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    await requireReportingStoreAccess(ctx, args.storeId);
    const sku = await ctx.db.get("productSku", args.productSkuId);
    if (!sku || sku.storeId !== args.storeId) {
      throw new Error(SKU_EVIDENCE_ACCESS_UNAVAILABLE);
    }
    return ctx.db
      .query("reportingSkuEvidence")
      .withIndex("by_storeId_productSkuId_recognitionAt_identityKey", (q) => {
        const scoped = q
          .eq("storeId", args.storeId)
          .eq("productSkuId", args.productSkuId);
        return args.periodStart !== undefined && args.periodEnd !== undefined
          ? scoped
              .gte("recognitionAt", args.periodStart)
              .lte("recognitionAt", args.periodEnd)
          : scoped;
      })
      .order("desc")
      .paginate({ cursor: args.databaseCursor, numItems: args.numItems });
  },
});

export const listSkuEvidence = action({
  args: {
    paginationOpts: paginationOptsValidator,
    periodEnd: v.optional(v.number()),
    periodStart: v.optional(v.number()),
    productSkuId: v.id("productSku"),
    storeId: v.id("store"),
  },
  handler: async (ctx, args): Promise<any> => {
    const evidenceInternal: any = (internal as any).reporting.evidence;
    const preflight:
      | { allowed: false }
      | {
          allowed: true;
          databaseCursor: string | null;
        } = await ctx.runMutation(
      evidenceInternal.preflightListSkuEvidence,
      args,
    );
    if (!preflight.allowed) {
      throw new Error(SKU_EVIDENCE_ACCESS_UNAVAILABLE);
    }
    try {
      const result: any = await ctx.runQuery(
        evidenceInternal.readSkuEvidencePage,
        {
          databaseCursor: preflight.databaseCursor,
          numItems: args.paginationOpts.numItems,
          periodEnd: args.periodEnd,
          periodStart: args.periodStart,
          productSkuId: args.productSkuId,
          storeId: args.storeId,
        },
      );
      return {
        ...result,
        continueCursor: result.isDone
          ? ""
          : encodeSkuEvidencePageCursor({
              databaseCursor: result.continueCursor,
              factVersion: 1,
              filterKey: skuEvidenceFilterKey(args),
              metricVersion: 1,
              storeId: String(args.storeId),
            }),
      };
    } catch {
      await ctx.runMutation(evidenceInternal.recordSkuEvidenceReadRaceDenial, {
        requestedStoreRef: String(args.storeId),
        storeId: args.storeId,
      });
      throw new Error(SKU_EVIDENCE_ACCESS_UNAVAILABLE);
    }
  },
});

export const recordSkuEvidenceReadRaceDenial = internalMutation({
  args: {
    requestedStoreRef: v.string(),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    let actorRef: string | undefined;
    try {
      actorRef = String((await requireAuthenticatedAthenaUserWithCtx(ctx))._id);
    } catch {
      // The denial evidence intentionally remains anonymous.
    }
    await recordSkuEvidenceDenialWithCtx(ctx, {
      actorRef,
      requestedStoreRef: args.requestedStoreRef,
      safeReason: "sku_evidence_read_authority_changed",
      storeId: args.storeId,
    });
  },
});
