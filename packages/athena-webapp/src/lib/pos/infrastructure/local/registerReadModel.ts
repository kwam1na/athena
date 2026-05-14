import type {
  PosPaymentDto,
  PosRegisterStateDto,
  PosTerminalDto,
} from "@/lib/pos/application/dto";

import { derivePosLocalSyncStatus } from "./syncStatus";
import type {
  PosLocalCloudMapping,
  PosLocalEventRecord,
  PosProvisionedTerminalSeed,
} from "./posLocalStore";

export type PosLocalRegisterReadModelErrorCode =
  | "malformed_payload"
  | "missing_register_session"
  | "register_closed"
  | "unsupported_event_type";

export interface PosLocalRegisterReadModelError {
  code: PosLocalRegisterReadModelErrorCode;
  localEventId: string;
  message: string;
  sequence: number;
  type: PosLocalEventRecord["type"];
}

export interface PosLocalCartItemReadModel {
  localItemId: string;
  productId: string;
  productSkuId: string;
  productSku: string;
  barcode?: string;
  productName: string;
  price: number;
  quantity: number;
  image?: string;
  size?: string;
  length?: number;
  color?: string;
  areProcessingFeesAbsorbed: boolean;
}

export interface PosLocalActiveSaleReadModel {
  localPosSessionId: string;
  localRegisterSessionId: string;
  cloudPosSessionId?: string;
  sessionNumber: string;
  status: "active";
  terminalId: string;
  staffProfileId?: string;
  registerNumber?: string;
  updatedAt: number;
  items: PosLocalCartItemReadModel[];
  payments: PosPaymentDto[];
  startedAt: number;
  subtotal: number;
  tax: number;
  total: number;
}

export interface PosLocalCompletedSaleReadModel {
  localPosSessionId: string;
  localRegisterSessionId: string;
  localTransactionId: string;
  cloudTransactionId?: string;
  receiptNumber: string;
  completedAt: number;
  items: PosLocalCartItemReadModel[];
  payments: PosPaymentDto[];
  subtotal: number;
  tax: number;
  total: number;
  customerProfileId?: string;
}

export interface PosLocalCashDrawerReadModel {
  localRegisterSessionId: string;
  cloudRegisterSessionId?: string;
  status: "open" | "active" | "closing" | "closed";
  terminalId?: string;
  registerNumber?: string;
  openingFloat: number;
  expectedCash: number;
  countedCash?: number;
  openedAt: number;
  notes?: string;
}

export type PosLocalCloseoutState =
  | {
      status: "open";
      localRegisterSessionId: string;
      updatedAt: number;
    }
  | {
      status: "closed_locally";
      localRegisterSessionId: string;
      countedCash?: number;
      notes?: string;
      updatedAt: number;
    }
  | {
      status: "reopened";
      localRegisterSessionId: string;
      reason?: string;
      updatedAt: number;
    }
  | null;

export interface PosLocalRegisterReadModel {
  activeRegisterSession: PosLocalCashDrawerReadModel | null;
  activeSale: PosLocalActiveSaleReadModel | null;
  canSell: boolean;
  clearedSaleIds: string[];
  closeoutState: PosLocalCloseoutState;
  completedSales: PosLocalCompletedSaleReadModel[];
  errors: PosLocalRegisterReadModelError[];
  registerState: PosRegisterStateDto;
  sourceEvents: PosLocalEventRecord[];
  syncStatus: ReturnType<typeof derivePosLocalSyncStatus>;
}

export function projectLocalRegisterReadModel(input: {
  events: PosLocalEventRecord[];
  terminalSeed?: PosProvisionedTerminalSeed | null;
  mappings?: PosLocalCloudMapping[];
  isOnline?: boolean;
  lastSyncedSequence?: number;
}): PosLocalRegisterReadModel {
  const orderedEvents = [...input.events].sort(
    (left, right) => left.sequence - right.sequence,
  );
  const mappings = createMappingIndex(input.mappings ?? []);
  const errors: PosLocalRegisterReadModelError[] = [];
  const sales = new Map<string, PosLocalActiveSaleReadModel>();
  const clearedSaleIds = new Set<string>();
  const completedSales: PosLocalCompletedSaleReadModel[] = [];
  let activeRegisterSession: PosLocalCashDrawerReadModel | null = null;
  let closeoutState: PosLocalCloseoutState = null;
  let terminal = terminalFromSeed(input.terminalSeed ?? null);

  for (const event of orderedEvents) {
    terminal ??= terminalFromEvent(event);

    if (event.type === "terminal.seeded") continue;

    if (event.type === "cash.movement_recorded") {
      errors.push(errorFor(event, "unsupported_event_type"));
      continue;
    }

    if (event.type === "register.opened") {
      const localRegisterSessionId =
        event.localRegisterSessionId ?? stringField(event.payload, "localRegisterSessionId");
      if (!localRegisterSessionId) {
        errors.push(errorFor(event, "missing_register_session"));
        continue;
      }

      const payload = asRecord(event.payload);
      const openingFloat = numberField(payload, "openingFloat") ?? 0;
      const expectedCash = numberField(payload, "expectedCash") ?? openingFloat;
      activeRegisterSession = {
        localRegisterSessionId,
        ...(mappings.registerSession.get(localRegisterSessionId)
          ? {
              cloudRegisterSessionId:
                mappings.registerSession.get(localRegisterSessionId),
            }
          : {}),
        status: registerStatus(payload.status) ?? "open",
        terminalId: event.terminalId,
        registerNumber: event.registerNumber,
        openingFloat,
        expectedCash,
        openedAt: event.createdAt,
        notes: optionalString(payload.notes),
      };
      closeoutState = {
        status: "open",
        localRegisterSessionId,
        updatedAt: event.createdAt,
      };
      continue;
    }

    if (!activeRegisterSession) {
      errors.push(errorFor(event, "missing_register_session"));
      continue;
    }

    if (event.type === "register.closeout_started") {
      const payload = asRecord(event.payload);
      activeRegisterSession = {
        ...activeRegisterSession,
        status: "closing",
        countedCash: numberField(payload, "countedCash"),
      };
      closeoutState = {
        status: "closed_locally",
        localRegisterSessionId: activeRegisterSession.localRegisterSessionId,
        countedCash: numberField(payload, "countedCash"),
        notes: optionalString(payload.notes),
        updatedAt: event.createdAt,
      };
      sales.clear();
      continue;
    }

    if (event.type === "register.reopened") {
      const payload = asRecord(event.payload);
      activeRegisterSession = {
        ...activeRegisterSession,
        status: "active",
      };
      closeoutState = {
        status: "reopened",
        localRegisterSessionId: activeRegisterSession.localRegisterSessionId,
        reason: optionalString(payload.reason),
        updatedAt: event.createdAt,
      };
      continue;
    }

    if (activeRegisterSession.status === "closing") {
      errors.push(errorFor(event, "register_closed"));
      continue;
    }

    if (event.type === "session.started") {
      const localPosSessionId =
        event.localPosSessionId ?? stringField(event.payload, "localPosSessionId");
      if (!localPosSessionId) {
        errors.push(errorFor(event, "malformed_payload"));
        continue;
      }

      activeRegisterSession = { ...activeRegisterSession, status: "active" };
      clearedSaleIds.delete(localPosSessionId);
      sales.set(localPosSessionId, {
        localPosSessionId,
        localRegisterSessionId: activeRegisterSession.localRegisterSessionId,
        ...(mappings.posSession.get(localPosSessionId)
          ? { cloudPosSessionId: mappings.posSession.get(localPosSessionId) }
          : {}),
        sessionNumber: localPosSessionId,
        status: "active",
        terminalId: event.terminalId,
        staffProfileId: event.staffProfileId,
        registerNumber: event.registerNumber,
        updatedAt: event.createdAt,
        items: [],
        payments: [],
        startedAt: event.createdAt,
        subtotal: 0,
        tax: 0,
        total: 0,
      });
      continue;
    }

    if (event.type === "cart.item_added") {
      const item = parseCartItem(event);
      if (!item) {
        errors.push(errorFor(event, "malformed_payload"));
        continue;
      }

      const sale = getOrCreateSale({
        activeRegisterSession,
        event,
        sales,
        mappings,
      });
      const nextItems = upsertCartItem(sale.items, item);
      sales.set(sale.localPosSessionId, {
        ...sale,
        items: nextItems,
        updatedAt: event.createdAt,
        ...totalsFromItems(nextItems),
      });
      activeRegisterSession = { ...activeRegisterSession, status: "active" };
      continue;
    }

    if (event.type === "session.payments_updated") {
      const payments = parsePayments(asRecord(event.payload).payments);
      if (!payments) {
        errors.push(errorFor(event, "malformed_payload"));
        continue;
      }

      const sale = getOrCreateSale({
        activeRegisterSession,
        event,
        sales,
        mappings,
      });
      sales.set(sale.localPosSessionId, {
        ...sale,
        payments,
        updatedAt: event.createdAt,
      });
      activeRegisterSession = { ...activeRegisterSession, status: "active" };
      continue;
    }

    if (event.type === "cart.cleared") {
      const sale = getOrCreateSale({
        activeRegisterSession,
        event,
        sales,
        mappings,
      });
      clearedSaleIds.add(sale.localPosSessionId);
      sales.delete(sale.localPosSessionId);
      activeRegisterSession = { ...activeRegisterSession, status: "active" };
      continue;
    }

    if (event.type === "transaction.completed") {
      const sale = getCompletedSale({
        activeRegisterSession,
        event,
        sales,
        mappings,
      });
      if (!sale) {
        errors.push(errorFor(event, "malformed_payload"));
        continue;
      }

      completedSales.push(sale);
      sales.delete(sale.localPosSessionId);
      activeRegisterSession = {
        ...activeRegisterSession,
        status: "active",
        expectedCash:
          activeRegisterSession.expectedCash +
          getExpectedCashDelta(sale.payments, sale.total),
      };
    }
  }

  const activeSale = [...sales.values()].at(-1) ?? null;
  const canSell =
    Boolean(activeRegisterSession) && activeRegisterSession?.status !== "closing";

  return {
    activeRegisterSession,
    activeSale,
    canSell,
    clearedSaleIds: [...clearedSaleIds],
    closeoutState,
    completedSales,
    errors,
    registerState: {
      phase: getPhase({ activeSale, canSell, terminal }),
      terminal,
      cashier: null,
      activeRegisterSession: toRegisterStateDrawer(activeRegisterSession),
      activeSession: toRegisterStateSession(activeSale),
      activeSessionConflict: null,
      resumableSession: null,
    },
    sourceEvents: orderedEvents,
    syncStatus: derivePosLocalSyncStatus({
      events: orderedEvents,
      isOnline: input.isOnline ?? false,
      lastSyncedSequence: input.lastSyncedSequence,
    }),
  };
}

function createMappingIndex(mappings: PosLocalCloudMapping[]) {
  const registerSession = new Map<string, string>();
  const posSession = new Map<string, string>();
  const posTransaction = new Map<string, string>();

  for (const mapping of mappings) {
    if (mapping.entity === "registerSession") {
      registerSession.set(mapping.localId, mapping.cloudId);
    } else if (mapping.entity === "posSession") {
      posSession.set(mapping.localId, mapping.cloudId);
    } else if (mapping.entity === "posTransaction") {
      posTransaction.set(mapping.localId, mapping.cloudId);
    }
  }

  return { posSession, posTransaction, registerSession };
}

function toRegisterStateDrawer(
  session: PosLocalCashDrawerReadModel | null,
): PosRegisterStateDto["activeRegisterSession"] {
  if (!session) return null;

  return {
    _id: session.localRegisterSessionId,
    status: session.status,
    terminalId: session.terminalId,
    registerNumber: session.registerNumber,
    openingFloat: session.openingFloat,
    expectedCash: session.expectedCash,
    countedCash: session.countedCash,
    openedAt: session.openedAt,
    notes: session.notes,
  } as PosRegisterStateDto["activeRegisterSession"];
}

function toRegisterStateSession(
  sale: PosLocalActiveSaleReadModel | null,
): PosRegisterStateDto["activeSession"] {
  if (!sale) return null;

  return {
    _id: sale.localPosSessionId,
    sessionNumber: sale.sessionNumber,
    status: sale.status,
    terminalId: sale.terminalId,
    staffProfileId: sale.staffProfileId,
    registerNumber: sale.registerNumber,
    updatedAt: sale.updatedAt,
  };
}

function terminalFromSeed(seed: PosProvisionedTerminalSeed | null): PosTerminalDto | null {
  if (!seed) return null;
  return {
    _id: seed.cloudTerminalId,
    cloudTerminalId: seed.cloudTerminalId,
    displayName: seed.displayName,
    localTerminalId: seed.terminalId,
    registerNumber: seed.registerNumber,
    status: "local",
    registeredAt: seed.provisionedAt,
  };
}

function terminalFromEvent(event: PosLocalEventRecord): PosTerminalDto {
  return {
    _id: event.terminalId,
    displayName: event.registerNumber
      ? `Register ${event.registerNumber}`
      : "Local register",
    registerNumber: event.registerNumber,
    status: "local",
    registeredAt: event.createdAt,
  };
}

function getPhase(input: {
  activeSale: PosLocalActiveSaleReadModel | null;
  canSell: boolean;
  terminal: PosTerminalDto | null;
}): PosRegisterStateDto["phase"] {
  if (!input.terminal) return "requiresTerminal";
  if (input.activeSale) return "active";
  if (input.canSell) return "readyToStart";
  return "requiresCashier";
}

function getOrCreateSale(input: {
  activeRegisterSession: PosLocalCashDrawerReadModel;
  event: PosLocalEventRecord;
  sales: Map<string, PosLocalActiveSaleReadModel>;
  mappings: ReturnType<typeof createMappingIndex>;
}) {
  const localPosSessionId =
    input.event.localPosSessionId ?? stringField(input.event.payload, "localPosSessionId");
  const existing = localPosSessionId ? input.sales.get(localPosSessionId) : null;
  if (existing) return existing;

  const fallbackLocalPosSessionId =
    localPosSessionId ?? `local-pos-session-${input.event.sequence}`;
  return {
    localPosSessionId: fallbackLocalPosSessionId,
    localRegisterSessionId: input.activeRegisterSession.localRegisterSessionId,
    ...(input.mappings.posSession.get(fallbackLocalPosSessionId)
      ? {
          cloudPosSessionId: input.mappings.posSession.get(
            fallbackLocalPosSessionId,
          ),
        }
      : {}),
    sessionNumber: fallbackLocalPosSessionId,
    status: "active",
    terminalId: input.event.terminalId,
    staffProfileId: input.event.staffProfileId,
    registerNumber: input.event.registerNumber,
    updatedAt: input.event.createdAt,
    items: [],
    payments: [],
    startedAt: input.event.createdAt,
    subtotal: 0,
    tax: 0,
    total: 0,
  } satisfies PosLocalActiveSaleReadModel;
}

function getCompletedSale(input: {
  activeRegisterSession: PosLocalCashDrawerReadModel;
  event: PosLocalEventRecord;
  sales: Map<string, PosLocalActiveSaleReadModel>;
  mappings: ReturnType<typeof createMappingIndex>;
}): PosLocalCompletedSaleReadModel | null {
  const payload = asRecord(input.event.payload);
  const localPosSessionId =
    input.event.localPosSessionId ??
    stringField(payload, "localPosSessionId");
  const localTransactionId =
    input.event.localTransactionId ??
    stringField(payload, "localTransactionId");
  if (!localPosSessionId || !localTransactionId) return null;

  const activeSale = input.sales.get(localPosSessionId);
  const payloadItems = Array.isArray(payload.items)
    ? payload.items.map((item, index) =>
        parseCartItemPayload(item, `${localTransactionId}-item-${index}`),
      )
    : [];
  if (payloadItems.some((item) => !item)) return null;

  const items = payloadItems.length
    ? (payloadItems as PosLocalCartItemReadModel[])
    : (activeSale?.items ?? []);
  const fallbackTotals = totalsFromItems(items);
  const payments = parsePayments(payload.payments);
  if (!payments) return null;

  return {
    localPosSessionId,
    localRegisterSessionId: input.activeRegisterSession.localRegisterSessionId,
    localTransactionId,
    ...(input.mappings.posTransaction.get(localTransactionId)
      ? {
          cloudTransactionId:
            input.mappings.posTransaction.get(localTransactionId),
        }
      : {}),
    receiptNumber: stringField(payload, "receiptNumber") ?? localTransactionId,
    completedAt: input.event.createdAt,
    items,
    payments,
    subtotal: numberField(payload, "subtotal") ?? fallbackTotals.subtotal,
    tax: numberField(payload, "tax") ?? fallbackTotals.tax,
    total: numberField(payload, "total") ?? fallbackTotals.total,
    customerProfileId: optionalString(payload.customerProfileId),
  };
}

function parseCartItem(event: PosLocalEventRecord) {
  return parseCartItemPayload(event.payload, `local-item-${event.sequence}`);
}

function parseCartItemPayload(
  value: unknown,
  fallbackLocalItemId: string,
): PosLocalCartItemReadModel | null {
  const payload = asRecord(value);
  const productSkuId = stringField(payload, "productSkuId");
  const quantity = numberField(payload, "quantity");
  const price = numberField(payload, "price");
  if (!productSkuId || quantity === undefined || price === undefined) {
    return null;
  }

  return {
    localItemId: stringField(payload, "localItemId") ?? fallbackLocalItemId,
    productId: stringField(payload, "productId") ?? "",
    productSkuId,
    productSku: stringField(payload, "productSku") ?? "",
    barcode: optionalString(payload.barcode),
    productName: stringField(payload, "productName") ?? "",
    price,
    quantity,
    image: optionalString(payload.image),
    size: optionalString(payload.size),
    length: numberField(payload, "length"),
    color: optionalString(payload.color),
    areProcessingFeesAbsorbed:
      typeof payload.areProcessingFeesAbsorbed === "boolean"
        ? payload.areProcessingFeesAbsorbed
        : false,
  };
}

function parsePayments(value: unknown): PosPaymentDto[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;

  const payments: PosPaymentDto[] = [];
  for (const paymentValue of value) {
    const payment = asRecord(paymentValue);
    const method = stringField(payment, "method");
    const amount = numberField(payment, "amount");
    const timestamp = numberField(payment, "timestamp");
    if (!method || amount === undefined || timestamp === undefined) {
      return null;
    }
    payments.push({
      ...(stringField(payment, "localPaymentId") ?? stringField(payment, "id")
        ? {
            id:
              stringField(payment, "localPaymentId") ??
              stringField(payment, "id"),
          }
        : {}),
      method,
      amount,
      timestamp,
    });
  }
  return payments;
}

function getExpectedCashDelta(payments: PosPaymentDto[], total: number) {
  const totalPaid = payments.reduce(
    (sum, payment) => sum + Math.max(0, payment.amount),
    0,
  );
  const cashCollected = payments
    .filter((payment) => payment.method === "cash")
    .reduce((sum, payment) => sum + Math.max(0, payment.amount), 0);
  const changeGiven = totalPaid > total ? totalPaid - total : 0;
  return Math.max(0, cashCollected - changeGiven);
}

function upsertCartItem(
  items: PosLocalCartItemReadModel[],
  item: PosLocalCartItemReadModel,
) {
  if (item.quantity <= 0) {
    return items.filter(
      (candidate) => candidate.productSkuId !== item.productSkuId,
    );
  }

  const index = items.findIndex(
    (candidate) => candidate.productSkuId === item.productSkuId,
  );
  if (index === -1) return [...items, item];

  const next = [...items];
  next[index] = item;
  return next;
}

function totalsFromItems(items: PosLocalCartItemReadModel[]) {
  const subtotal = items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0,
  );
  return { subtotal, tax: 0, total: subtotal };
}

function errorFor(
  event: PosLocalEventRecord,
  code: PosLocalRegisterReadModelErrorCode,
): PosLocalRegisterReadModelError {
  return {
    code,
    localEventId: event.localEventId,
    message: errorMessage(code),
    sequence: event.sequence,
    type: event.type,
  };
}

function errorMessage(code: PosLocalRegisterReadModelErrorCode) {
  if (code === "malformed_payload") {
    return "POS local event payload could not be projected.";
  }
  if (code === "missing_register_session") {
    return "POS local event is missing an open register session.";
  }
  if (code === "register_closed") {
    return "POS local event cannot be applied while the register is closed.";
  }
  return "POS local event type is not supported by the register read model.";
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringField(value: unknown, key: string): string | undefined {
  const record = asRecord(value);
  return optionalString(record[key]);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function numberField(value: unknown, key: string): number | undefined {
  const record = asRecord(value);
  const candidate = record[key];
  return typeof candidate === "number" && Number.isFinite(candidate)
    ? candidate
    : undefined;
}

function registerStatus(
  value: unknown,
): PosLocalCashDrawerReadModel["status"] | undefined {
  return value === "open" ||
    value === "active" ||
    value === "closing" ||
    value === "closed"
    ? value
    : undefined;
}
