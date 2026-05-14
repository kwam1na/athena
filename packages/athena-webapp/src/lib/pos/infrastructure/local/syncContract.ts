import type { PosLocalEventRecord } from "./posLocalStore";
import type {
  PosLocalSyncPaymentPayload,
  PosLocalSyncUploadEvent,
} from "../../../../../shared/posLocalSyncContract";

export type PosLocalUploadEvent = PosLocalSyncUploadEvent;
type PosLocalUploadEventWithoutSequence = {
  [EventType in PosLocalUploadEvent["eventType"]]: Omit<
    Extract<PosLocalUploadEvent, { eventType: EventType }>,
    "sequence"
  >;
}[PosLocalUploadEvent["eventType"]];

export function buildPosLocalSyncUploadEvents(
  eventsToUpload: PosLocalEventRecord[],
  allEvents: PosLocalEventRecord[],
): PosLocalUploadEvent[] {
  const orderedEvents = [...allEvents].sort(
    (left, right) => left.sequence - right.sequence,
  );
  const uploadEvents: PosLocalUploadEvent[] = [];

  for (const event of [...eventsToUpload].sort(
    (left, right) => left.sequence - right.sequence,
  )) {
    const uploadEvent = toUploadEvent(event, orderedEvents);
    if (!uploadEvent) continue;
    const sequence = getSyncableUploadSequence(event, orderedEvents);
    uploadEvents.push({ ...uploadEvent, sequence });
  }

  return uploadEvents;
}

export function isSyncablePosLocalEvent(event: PosLocalEventRecord): boolean {
  return (
    Boolean(
      event.localRegisterSessionId &&
        event.staffProfileId &&
        event.staffProofToken,
    ) &&
    (event.type === "register.opened" ||
      event.type === "transaction.completed" ||
      event.type === "register.closeout_started" ||
      event.type === "register.reopened")
  );
}

function toUploadEvent(
  event: PosLocalEventRecord,
  orderedEvents: PosLocalEventRecord[],
): PosLocalUploadEventWithoutSequence | null {
  if (
    !event.localRegisterSessionId ||
    !event.staffProfileId ||
    !event.staffProofToken
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
      staffProofToken: event.staffProofToken,
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
      staffProofToken: event.staffProofToken,
      payload: {
        localPosSessionId,
        localTransactionId:
          event.localTransactionId ?? stringOrEmpty(payload.localTransactionId),
        localReceiptNumber: stringOrEmpty(payload.receiptNumber),
        registerNumber: event.registerNumber,
        customerProfileId: nullableStringToOptional(payload.customerProfileId),
        totals: {
          subtotal: numberOrZero(payload.subtotal),
          tax: numberOrZero(payload.tax),
          total: numberOrZero(payload.total),
        },
        items: getCompletedSaleItems(payload, event, orderedEvents),
        payments: Array.isArray(payload.payments)
          ? payload.payments.map(toPaymentPayload)
          : [],
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
      staffProofToken: event.staffProofToken,
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
      staffProofToken: event.staffProofToken,
      payload: {
        reason: nullableStringToOptional(payload.reason),
      },
    };
  }

  return null;
}

function getSyncableUploadSequence(
  event: PosLocalEventRecord,
  orderedEvents: PosLocalEventRecord[],
): number {
  return orderedEvents.filter(
    (candidate) =>
      candidate.sequence <= event.sequence &&
      candidate.localRegisterSessionId === event.localRegisterSessionId &&
      isPendingSyncUploadEvent(candidate),
  ).length;
}

function isPendingSyncUploadEvent(event: PosLocalEventRecord): boolean {
  if (event.sync.uploaded === true && isUploadSequenceEventType(event)) {
    return true;
  }

  return (
    isSyncablePosLocalEvent(event) &&
    (event.sync.status === "pending" ||
      event.sync.status === "syncing" ||
      event.sync.status === "failed")
  );
}

function isUploadSequenceEventType(event: PosLocalEventRecord): boolean {
  return (
    event.type === "register.opened" ||
    event.type === "transaction.completed" ||
    event.type === "register.closeout_started" ||
    event.type === "register.reopened"
  );
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

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
