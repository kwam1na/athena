import { derivePosLocalSyncStatus } from "./syncStatus";
import type { PosLocalEventRecord } from "./posLocalStore";

export type ExpenseLocalSessionStatus =
  | "active"
  | "held"
  | "voided"
  | "canceled"
  | "completed_pending_sync"
  | "synced"
  | "needs_review";

export type ExpenseLocalItemSource =
  | "trusted_inventory"
  | "pending_checkout"
  | "provisional_import";

export interface ExpenseLocalCartItemReadModel {
  localItemId: string;
  productId: string;
  productSkuId: string;
  pendingCheckoutItemId?: string;
  inventoryImportProvisionalSkuId?: string;
  source: ExpenseLocalItemSource;
  sourceKey: string;
  productSku: string;
  barcode?: string;
  productName: string;
  price: number;
  quantity: number;
  image?: string;
  size?: string;
  length?: number;
  color?: string;
}

export interface ExpenseLocalSessionReadModel {
  localExpenseSessionId: string;
  status: ExpenseLocalSessionStatus;
  terminalId: string;
  storeId: string;
  staffProfileId?: string;
  registerNumber?: string;
  items: ExpenseLocalCartItemReadModel[];
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  reason?: string;
  notes?: string;
  subtotal: number;
  tax: number;
  total: number;
  sync?: PosLocalEventRecord["sync"];
}

export interface ExpenseLocalReadModelError {
  code: "malformed_payload" | "missing_expense_session";
  localEventId: string;
  message: string;
  sequence: number;
  type: PosLocalEventRecord["type"];
}

export interface ExpenseLocalReadModel {
  activeSession: ExpenseLocalSessionReadModel | null;
  heldSessions: ExpenseLocalSessionReadModel[];
  preCompletionCanceledSessions: ExpenseLocalSessionReadModel[];
  preCompletionVoidedSessions: ExpenseLocalSessionReadModel[];
  completedSessions: ExpenseLocalSessionReadModel[];
  errors: ExpenseLocalReadModelError[];
  sessions: ExpenseLocalSessionReadModel[];
  sourceEvents: PosLocalEventRecord[];
  syncStatus: ReturnType<typeof derivePosLocalSyncStatus>;
}

export function projectExpenseLocalReadModel(input: {
  events: PosLocalEventRecord[];
  isOnline?: boolean;
  lastSyncedSequence?: number;
}): ExpenseLocalReadModel {
  const orderedEvents = [...input.events].sort(
    (left, right) => left.sequence - right.sequence,
  );
  const errors: ExpenseLocalReadModelError[] = [];
  const sessions = new Map<string, ExpenseLocalSessionReadModel>();

  for (const event of orderedEvents) {
    if (!isExpenseEvent(event)) continue;

    if (event.type === "expense.session_started") {
      const localExpenseSessionId = getLocalExpenseSessionId(event);
      if (!localExpenseSessionId) {
        errors.push(errorFor(event, "missing_expense_session"));
        continue;
      }

      sessions.set(localExpenseSessionId, {
        localExpenseSessionId,
        status: "active",
        terminalId: event.terminalId,
        storeId: event.storeId,
        staffProfileId: event.staffProfileId,
        registerNumber: event.registerNumber,
        items: [],
        startedAt: event.createdAt,
        updatedAt: event.createdAt,
        subtotal: 0,
        tax: 0,
        total: 0,
      });
      continue;
    }

    const session = getOrCreateSession(event, sessions);
    if (!session) {
      errors.push(errorFor(event, "missing_expense_session"));
      continue;
    }

    if (
      session.status === "completed_pending_sync" ||
      session.status === "synced" ||
      session.status === "needs_review" ||
      session.status === "voided" ||
      session.status === "canceled"
    ) {
      continue;
    }

    if (
      event.type === "expense.item_added" ||
      event.type === "expense.item_updated"
    ) {
      const item = parseCartItem(event);
      if (!item) {
        errors.push(errorFor(event, "malformed_payload"));
        continue;
      }

      setSession(sessions, {
        ...session,
        items: upsertCartItem(session.items, item),
        status: "active",
        updatedAt: event.createdAt,
      });
      continue;
    }

    if (event.type === "expense.item_removed") {
      const item = parseCartItem(event);
      const nextItems = item
        ? removeCartItem(session.items, item)
        : removeCartItemByPayload(session.items, event.payload);
      setSession(sessions, {
        ...session,
        items: nextItems,
        status: "active",
        updatedAt: event.createdAt,
      });
      continue;
    }

    if (event.type === "expense.cart_cleared") {
      setSession(sessions, {
        ...session,
        items: [],
        status: "active",
        updatedAt: event.createdAt,
      });
      continue;
    }

    if (event.type === "expense.held") {
      const payload = asRecord(event.payload);
      setSession(sessions, {
        ...session,
        status: "held",
        reason: optionalString(payload.reason),
        notes: optionalString(payload.notes),
        updatedAt: event.createdAt,
      });
      continue;
    }

    if (event.type === "expense.resumed") {
      setSession(sessions, {
        ...session,
        status: "active",
        updatedAt: event.createdAt,
      });
      continue;
    }

    if (event.type === "expense.voided" || event.type === "expense.canceled") {
      const payload = asRecord(event.payload);
      setSession(sessions, {
        ...session,
        status: event.type === "expense.voided" ? "voided" : "canceled",
        reason: optionalString(payload.reason),
        notes: optionalString(payload.notes),
        updatedAt: event.createdAt,
      });
      continue;
    }

    if (event.type === "expense.completed") {
      const payload = asRecord(event.payload);
      const payloadItems = Array.isArray(payload.items)
        ? payload.items.map((item, index) =>
            parseCartItemPayload(item, `${session.localExpenseSessionId}-item-${index}`),
          )
        : [];
      if (payloadItems.some((item) => !item)) {
        errors.push(errorFor(event, "malformed_payload"));
        continue;
      }
      const items = payloadItems.length
        ? (payloadItems as ExpenseLocalCartItemReadModel[])
        : session.items;
      setSession(sessions, {
        ...session,
        items,
        status: statusFromCompletedEvent(event),
        completedAt: event.createdAt,
        updatedAt: event.createdAt,
        reason: optionalString(payload.reason),
        notes: optionalString(payload.notes),
        sync: event.sync,
        ...totalsFromPayload(payload, items),
      });
    }
  }

  const projectedSessions = [...sessions.values()].map(withTotals);

  return {
    activeSession:
      projectedSessions.find((session) => session.status === "active") ?? null,
    heldSessions: projectedSessions.filter(
      (session) => session.status === "held",
    ),
    preCompletionCanceledSessions: projectedSessions.filter(
      (session) => session.status === "canceled",
    ),
    preCompletionVoidedSessions: projectedSessions.filter(
      (session) => session.status === "voided",
    ),
    completedSessions: projectedSessions.filter(
      (session) =>
        session.status === "completed_pending_sync" ||
        session.status === "synced" ||
        session.status === "needs_review",
    ),
    errors,
    sessions: projectedSessions,
    sourceEvents: orderedEvents,
    syncStatus: derivePosLocalSyncStatus({
      events: orderedEvents,
      isOnline: input.isOnline ?? false,
      lastSyncedSequence: input.lastSyncedSequence,
    }),
  };
}

function isExpenseEvent(event: PosLocalEventRecord) {
  return event.type.startsWith("expense.");
}

function getOrCreateSession(
  event: PosLocalEventRecord,
  sessions: Map<string, ExpenseLocalSessionReadModel>,
) {
  const localExpenseSessionId = getLocalExpenseSessionId(event);
  if (!localExpenseSessionId) return null;
  const existing = sessions.get(localExpenseSessionId);
  if (existing) return existing;

  const session: ExpenseLocalSessionReadModel = {
    localExpenseSessionId,
    status: "active",
    terminalId: event.terminalId,
    storeId: event.storeId,
    staffProfileId: event.staffProfileId,
    registerNumber: event.registerNumber,
    items: [],
    startedAt: event.createdAt,
    updatedAt: event.createdAt,
    subtotal: 0,
    tax: 0,
    total: 0,
  };
  sessions.set(localExpenseSessionId, session);
  return session;
}

function setSession(
  sessions: Map<string, ExpenseLocalSessionReadModel>,
  session: ExpenseLocalSessionReadModel,
) {
  sessions.set(session.localExpenseSessionId, withTotals(session));
}

function getLocalExpenseSessionId(event: PosLocalEventRecord) {
  return (
    event.localExpenseSessionId ??
    stringField(event.payload, "localExpenseSessionId")
  );
}

function statusFromCompletedEvent(event: PosLocalEventRecord) {
  if (event.sync.status === "synced") return "synced";
  if (event.sync.status === "needs_review") return "needs_review";
  return "completed_pending_sync";
}

function parseCartItem(event: PosLocalEventRecord) {
  return parseCartItemPayload(event.payload, `expense-item-${event.sequence}`);
}

function parseCartItemPayload(
  value: unknown,
  fallbackLocalItemId: string,
): ExpenseLocalCartItemReadModel | null {
  const payload = asRecord(value);
  const productSkuId = stringField(payload, "productSkuId");
  const quantity = numberField(payload, "quantity");
  const price =
    numberField(payload, "price") ?? numberField(payload, "unitPrice");
  if (!productSkuId || quantity === undefined || price === undefined) {
    return null;
  }

  const source = itemSource(payload);
  const item = {
    localItemId:
      stringField(payload, "localExpenseItemId") ??
      stringField(payload, "localItemId") ??
      fallbackLocalItemId,
    productId: stringField(payload, "productId") ?? "",
    productSkuId,
    pendingCheckoutItemId: optionalString(payload.pendingCheckoutItemId),
    inventoryImportProvisionalSkuId: optionalString(
      payload.inventoryImportProvisionalSkuId,
    ),
    source,
    sourceKey: itemSourceKey(payload),
    productSku: stringField(payload, "productSku") ?? "",
    barcode: optionalString(payload.barcode),
    productName: stringField(payload, "productName") ?? "",
    price,
    quantity,
    image: optionalString(payload.image),
    size: optionalString(payload.size),
    length: numberField(payload, "length"),
    color: optionalString(payload.color),
  };

  return item;
}

function upsertCartItem(
  items: ExpenseLocalCartItemReadModel[],
  item: ExpenseLocalCartItemReadModel,
) {
  if (item.quantity <= 0) return removeCartItem(items, item);

  const index = items.findIndex(
    (candidate) =>
      candidate.productSkuId === item.productSkuId &&
      candidate.sourceKey === item.sourceKey,
  );
  if (index === -1) return [...items, item];

  const next = [...items];
  next[index] = item;
  return next;
}

function removeCartItem(
  items: ExpenseLocalCartItemReadModel[],
  item: ExpenseLocalCartItemReadModel,
) {
  return items.filter(
    (candidate) =>
      candidate.productSkuId !== item.productSkuId ||
      candidate.sourceKey !== item.sourceKey,
  );
}

function removeCartItemByPayload(
  items: ExpenseLocalCartItemReadModel[],
  value: unknown,
) {
  const payload = asRecord(value);
  const localItemId =
    stringField(payload, "localExpenseItemId") ??
    stringField(payload, "localItemId");
  if (localItemId) {
    return items.filter((candidate) => candidate.localItemId !== localItemId);
  }

  const productSkuId = stringField(payload, "productSkuId");
  if (!productSkuId) return items;
  const sourceKey = itemSourceKey(payload);
  return items.filter(
    (candidate) =>
      candidate.productSkuId !== productSkuId ||
      candidate.sourceKey !== sourceKey,
  );
}

function itemSource(payload: Record<string, unknown>): ExpenseLocalItemSource {
  if (optionalString(payload.inventoryImportProvisionalSkuId)) {
    return "provisional_import";
  }
  if (optionalString(payload.pendingCheckoutItemId)) {
    return "pending_checkout";
  }
  return "trusted_inventory";
}

function itemSourceKey(payload: Record<string, unknown>) {
  const provisionalId = optionalString(payload.inventoryImportProvisionalSkuId);
  if (provisionalId) return `provisional_import:${provisionalId}`;
  const pendingCheckoutItemId = optionalString(payload.pendingCheckoutItemId);
  if (pendingCheckoutItemId) return `pending_checkout:${pendingCheckoutItemId}`;
  return "trusted_inventory";
}

function withTotals(session: ExpenseLocalSessionReadModel) {
  if (session.completedAt) return session;
  return { ...session, ...totalsFromItems(session.items) };
}

function totalsFromPayload(
  payload: Record<string, unknown>,
  items: ExpenseLocalCartItemReadModel[],
) {
  const totals = asRecord(payload.totals);
  const itemTotals = totalsFromItems(items);
  return {
    subtotal:
      numberField(payload, "subtotal") ??
      numberField(totals, "subtotal") ??
      itemTotals.subtotal,
    tax:
      numberField(payload, "tax") ??
      numberField(totals, "tax") ??
      itemTotals.tax,
    total:
      numberField(payload, "total") ??
      numberField(totals, "total") ??
      itemTotals.total,
  };
}

function totalsFromItems(items: ExpenseLocalCartItemReadModel[]) {
  const subtotal = items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0,
  );
  return { subtotal, tax: 0, total: subtotal };
}

function errorFor(
  event: PosLocalEventRecord,
  code: ExpenseLocalReadModelError["code"],
): ExpenseLocalReadModelError {
  return {
    code,
    localEventId: event.localEventId,
    message:
      code === "missing_expense_session"
        ? "Expense local event is missing an expense session."
        : "Expense local event payload could not be projected.",
    sequence: event.sequence,
    type: event.type,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringField(value: unknown, key: string): string | undefined {
  return optionalString(asRecord(value)[key]);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function numberField(value: unknown, key: string): number | undefined {
  const candidate = asRecord(value)[key];
  return typeof candidate === "number" && Number.isFinite(candidate)
    ? candidate
    : undefined;
}
