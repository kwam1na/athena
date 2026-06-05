import {
  canUploadPosLocalEventType,
  type PosLocalEventRecord,
} from "./posLocalStore";
import type {
  PosLocalSyncPaymentPayload,
  PosLocalSyncServiceLinePayload,
  PosLocalSyncUploadEvent,
} from "../../../../../shared/posLocalSyncContract";

export type PosLocalUploadEvent = PosLocalSyncUploadEvent;
export type PosLocalSyncUploadSupport = {
  appSessionValidation?: "supported" | "unverified";
};
type PosLocalUploadEventWithoutSequence = {
  [EventType in PosLocalUploadEvent["eventType"]]: Omit<
    Extract<PosLocalUploadEvent, { eventType: EventType }>,
    "sequence"
  >;
}[PosLocalUploadEvent["eventType"]];

export function buildPosLocalSyncUploadEvents(
  eventsToUpload: PosLocalEventRecord[],
  allEvents: PosLocalEventRecord[],
  uploadSupport: PosLocalSyncUploadSupport = {},
): PosLocalUploadEvent[] {
  const orderedEvents = [...allEvents].sort(
    (left, right) => left.sequence - right.sequence,
  );
  const uploadEvents: PosLocalUploadEvent[] = [];

  for (const event of [...eventsToUpload].sort(
    (left, right) => left.sequence - right.sequence,
  )) {
    if (!isSyncablePosLocalEvent(event, uploadSupport)) continue;
    const uploadEvent = toUploadEvent(event, orderedEvents);
    if (!uploadEvent) continue;
    const sequence = event.uploadSequence;
    if (typeof sequence !== "number") continue;
    uploadEvents.push({ ...uploadEvent, sequence });
  }

  return uploadEvents;
}

export function isSyncablePosLocalEvent(
  event: PosLocalEventRecord,
  uploadSupport: PosLocalSyncUploadSupport | number = {},
): boolean {
  const support = typeof uploadSupport === "number" ? {} : uploadSupport;

  return (
    Boolean(
      event.localRegisterSessionId &&
        event.staffProfileId &&
        typeof event.uploadSequence === "number",
    ) &&
    canUploadPosLocalEventType(event.type) &&
    !isUploadDeferredByValidation(event, support)
  );
}

export function isUploadDeferredByValidation(
  event: PosLocalEventRecord,
  uploadSupport: PosLocalSyncUploadSupport = {},
): boolean {
  return (
    event.validationMetadata?.uploadDeferredUntil ===
      "app-session-validated" &&
    uploadSupport.appSessionValidation !== "supported"
  );
}

function toUploadEvent(
  event: PosLocalEventRecord,
  orderedEvents: PosLocalEventRecord[],
): PosLocalUploadEventWithoutSequence | null {
  if (
    !event.localRegisterSessionId ||
    typeof event.uploadSequence !== "number" ||
    !event.staffProfileId
  ) {
    return null;
  }

  if (event.type === "register.opened") {
    const payload = asRecord(event.payload);
    return {
      localEventId: event.localEventId,
      localRegisterSessionId: event.localRegisterSessionId,
      eventType: "register_opened",
      occurredAt: event.createdAt,
      staffProfileId: event.staffProfileId,
      ...(event.staffProofToken ? { staffProofToken: event.staffProofToken } : {}),
      payload: {
        openingFloat: numberOrZero(payload.openingFloat),
        registerNumber: event.registerNumber,
        notes: nullableStringToOptional(payload.notes),
      },
    };
  }

  if (event.type === "transaction.completed") {
    const payload = asRecord(event.payload);
    const localPosSessionId =
      event.localPosSessionId ?? stringOrEmpty(payload.localPosSessionId);
    return {
      localEventId: event.localEventId,
      localRegisterSessionId: event.localRegisterSessionId,
      eventType: "sale_completed",
      occurredAt: event.createdAt,
      staffProfileId: event.staffProfileId,
      ...(event.staffProofToken ? { staffProofToken: event.staffProofToken } : {}),
      payload: {
        localPosSessionId,
        localTransactionId:
          event.localTransactionId ?? stringOrEmpty(payload.localTransactionId),
        localReceiptNumber:
          stringOrEmpty(payload.localReceiptNumber) ||
          stringOrEmpty(payload.receiptNumber),
        receiptNumber:
          stringOrEmpty(payload.receiptNumber) ||
          stringOrEmpty(payload.localReceiptNumber),
        registerNumber: event.registerNumber,
        customerProfileId: nullableStringToOptional(payload.customerProfileId),
        customerInfo: customerInfoFromPayload(payload),
        totals: {
          subtotal: numberOrZero(payload.subtotal),
          tax: numberOrZero(payload.tax),
          total: numberOrZero(payload.total),
        },
        items: getCompletedSaleItems(payload, event, orderedEvents),
        serviceLines: getCompletedServiceLines(payload),
        payments: Array.isArray(payload.payments)
          ? payload.payments.map(toPaymentPayload)
          : [],
      },
    };
  }

  if (event.type === "cart.cleared") {
    const payload = asRecord(event.payload);
    const localPosSessionId =
      event.localPosSessionId ?? stringOrEmpty(payload.localPosSessionId);
    if (hasLaterCompletedSale(event, orderedEvents, localPosSessionId)) {
      return null;
    }

    return {
      localEventId: event.localEventId,
      localRegisterSessionId: event.localRegisterSessionId,
      eventType: "sale_cleared",
      occurredAt: event.createdAt,
      staffProfileId: event.staffProfileId,
      ...(event.staffProofToken ? { staffProofToken: event.staffProofToken } : {}),
      payload: {
        localPosSessionId,
        reason: nullableStringToOptional(payload.reason),
      },
    };
  }

  if (event.type === "register.closeout_started") {
    const payload = asRecord(event.payload);
    return {
      localEventId: event.localEventId,
      localRegisterSessionId: event.localRegisterSessionId,
      eventType: "register_closed",
      occurredAt: event.createdAt,
      staffProfileId: event.staffProfileId,
      ...(event.staffProofToken ? { staffProofToken: event.staffProofToken } : {}),
      payload: {
        countedCash:
          typeof payload.countedCash === "number" ? payload.countedCash : undefined,
        notes: nullableStringToOptional(payload.notes),
      },
    };
  }

  if (event.type === "register.reopened") {
    const payload = asRecord(event.payload);
    return {
      localEventId: event.localEventId,
      localRegisterSessionId: event.localRegisterSessionId,
      eventType: "register_reopened",
      occurredAt: event.createdAt,
      staffProfileId: event.staffProfileId,
      ...(event.staffProofToken ? { staffProofToken: event.staffProofToken } : {}),
      payload: {
        reason: nullableStringToOptional(payload.reason),
      },
    };
  }

  return null;
}

function hasLaterCompletedSale(
  event: PosLocalEventRecord,
  orderedEvents: PosLocalEventRecord[],
  localPosSessionId: string,
) {
  return orderedEvents.some(
    (candidate) =>
      candidate.sequence > event.sequence &&
      candidate.type === "transaction.completed" &&
      (candidate.localPosSessionId ??
        stringOrEmpty(asRecord(candidate.payload).localPosSessionId)) ===
        localPosSessionId,
  );
}

function customerInfoFromPayload(payload: Record<string, unknown>) {
  const customerInfo = {
    name: nullableStringToOptional(payload.customerName),
    email: nullableStringToOptional(payload.customerEmail),
    phone: nullableStringToOptional(payload.customerPhone),
  };

  return customerInfo.name || customerInfo.email || customerInfo.phone
    ? customerInfo
    : undefined;
}

function getCompletedSaleItems(
  payload: Record<string, unknown>,
  event: PosLocalEventRecord,
  orderedEvents: PosLocalEventRecord[],
) {
  if (Array.isArray(payload.items)) {
    return payload.items.map(toSaleItemPayload);
  }

  return orderedEvents
    .filter(
      (candidate) =>
        candidate.type === "cart.item_added" &&
        candidate.localRegisterSessionId === event.localRegisterSessionId &&
        candidate.localPosSessionId ===
          (event.localPosSessionId ?? stringOrEmpty(payload.localPosSessionId)) &&
        candidate.sequence < event.sequence,
    )
    .map((candidate) => toSaleItemPayload(candidate.payload));
}

function toSaleItemPayload(value: unknown) {
  const payload = asRecord(value);
  return {
    localTransactionItemId: stringOrEmpty(payload.localItemId),
    productId: stringOrEmpty(payload.productId),
    productSkuId: stringOrEmpty(payload.productSkuId),
    productName: stringOrEmpty(payload.productName),
    productSku: stringOrEmpty(payload.productSku),
    barcode: nullableStringToOptional(payload.barcode),
    quantity: numberOrZero(payload.quantity),
    unitPrice: numberOrZero(payload.price),
    image: nullableStringToOptional(payload.image),
  };
}

function getCompletedServiceLines(payload: Record<string, unknown>) {
  if (!Array.isArray(payload.serviceLines)) return undefined;
  return payload.serviceLines.map(toServiceLinePayload);
}

function toServiceLinePayload(value: unknown): PosLocalSyncServiceLinePayload {
  const payload = asRecord(value);
  return {
    ...(nullableStringToOptional(payload.localServiceLineId)
      ? { localServiceLineId: nullableStringToOptional(payload.localServiceLineId) }
      : {}),
    ...(nullableStringToOptional(payload.localServiceCaseId)
      ? { localServiceCaseId: nullableStringToOptional(payload.localServiceCaseId) }
      : {}),
    ...(nullableStringToOptional(payload.existingServiceCaseId)
      ? {
          existingServiceCaseId: nullableStringToOptional(
            payload.existingServiceCaseId,
          ),
        }
      : {}),
    serviceCatalogId: stringOrEmpty(payload.serviceCatalogId),
    serviceCatalogName: stringOrEmpty(payload.serviceCatalogName),
    serviceMode: serviceModeOrDefault(payload.serviceMode),
    pricingModel: pricingModelOrDefault(payload.pricingModel),
    quantity: numberOrZero(payload.quantity),
    unitPrice: numberOrZero(payload.unitPrice),
    totalPrice: numberOrZero(payload.totalPrice),
    ...(typeof payload.catalogUpdatedAt === "number"
      ? { catalogUpdatedAt: payload.catalogUpdatedAt }
      : {}),
    ...(nullableStringToOptional(payload.customerProfileId)
      ? { customerProfileId: nullableStringToOptional(payload.customerProfileId) }
      : {}),
  };
}

function toPaymentPayload(value: unknown): PosLocalSyncPaymentPayload {
  const payload = asRecord(value);
  return {
    localPaymentId: nullableStringToOptional(payload.localPaymentId),
    method: stringOrEmpty(payload.method),
    amount: numberOrZero(payload.amount),
    timestamp: numberOrZero(payload.timestamp),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableStringToOptional(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function serviceModeOrDefault(
  value: unknown,
): PosLocalSyncServiceLinePayload["serviceMode"] {
  return value === "same_day" ||
    value === "consultation" ||
    value === "repair" ||
    value === "revamp"
    ? value
    : "same_day";
}

function pricingModelOrDefault(
  value: unknown,
): PosLocalSyncServiceLinePayload["pricingModel"] {
  return value === "fixed" ||
    value === "starting_at" ||
    value === "quote_after_consultation"
    ? value
    : "fixed";
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
