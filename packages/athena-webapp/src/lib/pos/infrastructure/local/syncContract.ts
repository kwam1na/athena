import {
  canUploadPosLocalEventType,
  type PosLocalEventRecord,
} from "./posLocalStore";
import type {
  PosLocalSyncPaymentPayload,
  PosLocalSyncExpenseRecordedPayload,
  PosLocalSyncPendingCheckoutItemDefinedPayload,
  PosLocalSyncPendingCheckoutItemLocalMetadata,
  PosLocalSyncPendingCheckoutItemSearchContext,
  PosLocalSyncSaleItemPayload,
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

  for (const event of [...eventsToUpload].sort(compareUploadEvents)) {
    if (!isSyncablePosLocalEvent(event, uploadSupport)) continue;
    const uploadEvent = toUploadEvent(event, orderedEvents);
    if (!uploadEvent) continue;
    const sequence = event.uploadSequence;
    if (typeof sequence !== "number") continue;
    uploadEvents.push({ ...uploadEvent, sequence });
  }

  return uploadEvents;
}

function compareUploadEvents(
  left: PosLocalEventRecord,
  right: PosLocalEventRecord,
): number {
  const leftUploadSequence =
    typeof left.uploadSequence === "number"
      ? left.uploadSequence
      : left.sequence;
  const rightUploadSequence =
    typeof right.uploadSequence === "number"
      ? right.uploadSequence
      : right.sequence;
  if (leftUploadSequence !== rightUploadSequence) {
    return leftUploadSequence - rightUploadSequence;
  }

  return left.sequence - right.sequence;
}

export function isSyncablePosLocalEvent(
  event: PosLocalEventRecord,
  uploadSupport: PosLocalSyncUploadSupport | number = {},
): boolean {
  const support = typeof uploadSupport === "number" ? {} : uploadSupport;
  if (isExpenseLocalSyncEvent(event)) {
    const payload = asRecord(event.payload);
    return Boolean(
      event.staffProfileId &&
        typeof event.uploadSequence === "number" &&
        stringOrEmpty(payload.localExpenseSessionId),
    );
  }

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
  if (isExpenseLocalSyncEvent(event)) {
    return toExpenseUploadEvent(event);
  }

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

  if (event.type === "pending_checkout_item.defined") {
    return {
      localEventId: event.localEventId,
      localRegisterSessionId: event.localRegisterSessionId,
      eventType: "pending_checkout_item_defined",
      occurredAt: event.createdAt,
      staffProfileId: event.staffProfileId,
      ...(event.staffProofToken ? { staffProofToken: event.staffProofToken } : {}),
      payload: toPendingCheckoutItemDefinedPayload(event.payload),
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

  return null;
}

function isExpenseLocalSyncEvent(event: PosLocalEventRecord): boolean {
  return event.type === ("expense.completed" as PosLocalEventRecord["type"]);
}

function toExpenseUploadEvent(
  event: PosLocalEventRecord,
): PosLocalUploadEventWithoutSequence | null {
  const payload = asRecord(event.payload);
  const localExpenseSessionId = stringOrEmpty(payload.localExpenseSessionId);
  if (
    !localExpenseSessionId ||
    typeof event.uploadSequence !== "number" ||
    !event.staffProfileId
  ) {
    return null;
  }

  const expensePayload: PosLocalSyncExpenseRecordedPayload = {
    localExpenseSessionId,
    localExpenseEventId:
      stringOrEmpty(payload.localExpenseEventId) || event.localEventId,
    ...(nullableStringToOptional(payload.reason)
      ? { reason: nullableStringToOptional(payload.reason) }
      : {}),
    ...(nullableStringToOptional(payload.notes)
      ? { notes: nullableStringToOptional(payload.notes) }
      : {}),
    totals: {
      subtotal: numberOrZero(payload.subtotal),
      tax: numberOrZero(payload.tax),
      total: numberOrZero(payload.total),
    },
    items: Array.isArray(payload.items)
      ? payload.items.map(toSaleItemPayload)
      : [],
  };

  return {
    syncScope: "expense",
    localEventId: event.localEventId,
    localExpenseSessionId,
    eventType: "expense_recorded",
    occurredAt: event.createdAt,
    staffProfileId: event.staffProfileId,
    ...(event.staffProofToken ? { staffProofToken: event.staffProofToken } : {}),
    payload: expensePayload,
  };
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

function toSaleItemPayload(value: unknown): PosLocalSyncSaleItemPayload {
  const payload = asRecord(value);
  return {
    localTransactionItemId: stringOrEmpty(payload.localItemId),
    productId: stringOrEmpty(payload.productId),
    productSkuId: stringOrEmpty(payload.productSkuId),
    pendingCheckoutItemId: nullableStringToOptional(
      payload.pendingCheckoutItemId,
    ),
    pendingCheckoutAliasState:
      payload.pendingCheckoutAliasState === "linked_to_catalog"
        ? "linked_to_catalog"
        : undefined,
    inventoryImportProvisionalSkuId: nullableStringToOptional(
      payload.inventoryImportProvisionalSkuId,
    ),
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

function toPendingCheckoutItemDefinedPayload(
  value: unknown,
): PosLocalSyncPendingCheckoutItemDefinedPayload {
  const payload = asRecord(value);
  const lookupCode = trimmedStringToOptional(payload.lookupCode);
  const searchContext = toPendingCheckoutItemSearchContext(payload.searchContext);
  const localMetadata = toPendingCheckoutItemLocalMetadata(payload.localMetadata);

  return {
    localPendingCheckoutItemId: stringOrEmpty(
      payload.localPendingCheckoutItemId,
    ),
    name: stringOrEmpty(payload.name),
    ...(lookupCode ? { lookupCode } : {}),
    ...(searchContext ? { searchContext } : {}),
    price: numberOrZero(payload.price),
    quantitySold: numberOrZero(payload.quantitySold),
    ...(localMetadata ? { localMetadata } : {}),
  };
}

function toPendingCheckoutItemSearchContext(
  value: unknown,
): PosLocalSyncPendingCheckoutItemSearchContext | undefined {
  const context = asRecord(value);
  const query = trimmedStringToOptional(context.query);
  const source = pendingCheckoutSearchSourceOrUndefined(context.source);
  const matched = pendingCheckoutSearchMatchOrUndefined(context.matched);

  if (!query && !source && !matched) return undefined;

  return {
    ...(query ? { query } : {}),
    ...(source ? { source } : {}),
    ...(matched ? { matched } : {}),
  };
}

function toPendingCheckoutItemLocalMetadata(
  value: unknown,
): PosLocalSyncPendingCheckoutItemLocalMetadata | undefined {
  const metadata = asRecord(value);
  const source = pendingCheckoutMetadataSourceOrUndefined(metadata.source);
  const appSessionValidation = pendingCheckoutAppSessionValidationOrUndefined(
    metadata.appSessionValidation,
  );
  const cloudValidation =
    metadata.cloudValidation === "uncertain" ? metadata.cloudValidation : undefined;
  const reusedExistingPendingItem =
    typeof metadata.reusedExistingPendingItem === "boolean"
      ? metadata.reusedExistingPendingItem
      : undefined;
  const createdOffline =
    typeof metadata.createdOffline === "boolean"
      ? metadata.createdOffline
      : undefined;

  if (
    !source &&
    reusedExistingPendingItem === undefined &&
    createdOffline === undefined &&
    !appSessionValidation &&
    !cloudValidation
  ) {
    return undefined;
  }

  return {
    schema: "pos_pending_checkout_item_local_metadata_v1",
    ...(source ? { source } : {}),
    ...(reusedExistingPendingItem !== undefined
      ? { reusedExistingPendingItem }
      : {}),
    ...(createdOffline !== undefined ? { createdOffline } : {}),
    ...(appSessionValidation ? { appSessionValidation } : {}),
    ...(cloudValidation ? { cloudValidation } : {}),
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

function trimmedStringToOptional(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function pendingCheckoutSearchSourceOrUndefined(value: unknown) {
  return value === "barcode" ||
    value === "lookup_code" ||
    value === "manual" ||
    value === "catalog_search" ||
    value === "unknown"
    ? value
    : undefined;
}

function pendingCheckoutSearchMatchOrUndefined(value: unknown) {
  return value === "existing_product" ||
    value === "pending_checkout_item" ||
    value === "none" ||
    value === "unknown"
    ? value
    : undefined;
}

function pendingCheckoutMetadataSourceOrUndefined(value: unknown) {
  return value === "offline_search" ||
    value === "online_search" ||
    value === "manual_entry" ||
    value === "unknown"
    ? value
    : undefined;
}

function pendingCheckoutAppSessionValidationOrUndefined(value: unknown) {
  return value === "supported" || value === "unverified" ? value : undefined;
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
