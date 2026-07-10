import type { CommerceLine, CommerceSourceEvent } from "./sourceAdapters/types";

export type CanonicalCommerceFact = {
  allocatedDiscountMinor: number;
  canonicalSkuId: string | null;
  categoryId: string | null;
  channel: "pos" | "storefront" | "service";
  costStatus: "known" | "unknown" | "not_applicable";
  cogsKnownMinor: number | null;
  currency: string;
  factId: string;
  factVersion: 1;
  lineId: string | null;
  linkedSourceEventKey: string | null;
  netRevenueMinor: number;
  inventoryImportProvisionalSkuId: string | null;
  originalQuantity: number;
  originalSkuId: string | null;
  pendingCheckoutItemId: string | null;
  productId: string | null;
  provisionalSkuId: string | null;
  quantity: number;
  recognizedAt: number;
  recordedAt: number;
  revenueKind: "merchandise" | "service" | "delivery" | "tax" | "refund";
  serviceCaseId: string | null;
  skuId: string | null;
  sourceEventKey: string;
  sourceId: string;
  storeId: string;
  unitPriceMinor: number | null;
};

function assertMinor(value: number, name: string) {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${name} must be a safe integer in minor units`);
  }
}

function lineFact(
  event: Extract<
    CommerceSourceEvent,
    { kind: "pos_completed" | "storefront_status_changed" }
  >,
  line: CommerceLine,
  channel: CanonicalCommerceFact["channel"],
): CanonicalCommerceFact {
  assertMinor(line.netRevenueMinor, "net revenue");
  if (line.cogsKnownMinor !== undefined && line.cogsKnownMinor !== null) {
    assertMinor(line.cogsKnownMinor, "COGS");
  }

  return {
    allocatedDiscountMinor: line.allocatedDiscountMinor ?? 0,
    canonicalSkuId:
      line.canonicalSkuId ??
      (line.pendingCheckoutItemId || line.provisionalSkuId
        ? null
        : (line.skuId ?? null)),
    categoryId: line.categoryId ?? null,
    channel,
    cogsKnownMinor:
      line.kind === "merchandise" ? (line.cogsKnownMinor ?? null) : null,
    costStatus:
      line.kind !== "merchandise"
        ? "not_applicable"
        : line.cogsKnownMinor === null || line.cogsKnownMinor === undefined
          ? "unknown"
          : "known",
    currency: event.currency,
    factId: `${event.eventKey}:${line.lineId}`,
    factVersion: 1,
    lineId: line.lineId,
    linkedSourceEventKey: null,
    netRevenueMinor: line.netRevenueMinor,
    inventoryImportProvisionalSkuId:
      line.inventoryImportProvisionalSkuId ?? null,
    originalQuantity: line.quantity,
    originalSkuId: line.originalSkuId ?? line.skuId ?? null,
    pendingCheckoutItemId: line.pendingCheckoutItemId ?? null,
    productId: line.productId ?? null,
    provisionalSkuId: line.provisionalSkuId ?? null,
    quantity: line.quantity,
    recognizedAt: event.occurredAt,
    recordedAt: event.recordedAt,
    revenueKind: line.kind,
    serviceCaseId: line.serviceCaseId ?? null,
    skuId: line.skuId ?? null,
    sourceEventKey: event.eventKey,
    sourceId: event.sourceId,
    storeId: event.storeId,
    unitPriceMinor: line.unitPriceMinor ?? null,
  };
}

const FULFILLED_STATUSES = new Set(["delivered", "picked_up"]);

export function recognizeCommerceEvent(
  event: CommerceSourceEvent,
): CanonicalCommerceFact[] {
  if (event.kind === "pos_completed") {
    return event.lines.map((line) => lineFact(event, line, "pos"));
  }

  if (event.kind === "storefront_status_changed") {
    if (
      !FULFILLED_STATUSES.has(event.status) ||
      FULFILLED_STATUSES.has(event.previousStatus)
    ) {
      return [];
    }
    return event.lines.map((line) => lineFact(event, line, "storefront"));
  }

  if (event.kind === "service_completed") {
    if (event.posTransactionId) {
      return [];
    }
    assertMinor(event.netRevenueMinor, "service revenue");
    return [
      {
        allocatedDiscountMinor: 0,
        canonicalSkuId: null,
        categoryId: null,
        channel: "service",
        cogsKnownMinor: null,
        costStatus: "not_applicable",
        currency: event.currency,
        factId: event.eventKey,
        factVersion: 1,
        lineId: null,
        linkedSourceEventKey: null,
        netRevenueMinor: event.netRevenueMinor,
        inventoryImportProvisionalSkuId: null,
        originalQuantity: 1,
        originalSkuId: null,
        pendingCheckoutItemId: null,
        productId: null,
        provisionalSkuId: null,
        quantity: 1,
        recognizedAt: event.occurredAt,
        recordedAt: event.recordedAt,
        revenueKind: "service",
        serviceCaseId: event.serviceCaseId,
        skuId: null,
        sourceEventKey: event.eventKey,
        sourceId: event.serviceCaseId,
        storeId: event.storeId,
        unitPriceMinor: null,
      },
    ];
  }

  assertMinor(event.netRevenueMinor, "refund value");
  return [
    {
      allocatedDiscountMinor: 0,
      canonicalSkuId: null,
      categoryId: null,
      channel: event.originalEventKey.startsWith("storefront:")
        ? "storefront"
        : "pos",
      cogsKnownMinor: null,
      costStatus: "unknown",
      currency: event.currency,
      factId: event.eventKey,
      factVersion: 1,
      lineId: event.lineId ?? null,
      linkedSourceEventKey: event.originalEventKey,
      netRevenueMinor: -Math.abs(event.netRevenueMinor),
      inventoryImportProvisionalSkuId: null,
      originalQuantity: -Math.abs(event.quantity),
      originalSkuId: null,
      pendingCheckoutItemId: null,
      productId: null,
      provisionalSkuId: null,
      quantity: -Math.abs(event.quantity),
      recognizedAt: event.occurredAt,
      recordedAt: event.recordedAt,
      revenueKind: "refund",
      serviceCaseId: null,
      skuId: null,
      sourceEventKey: event.eventKey,
      sourceId: event.sourceId,
      storeId: event.storeId,
      unitPriceMinor: null,
    },
  ];
}
