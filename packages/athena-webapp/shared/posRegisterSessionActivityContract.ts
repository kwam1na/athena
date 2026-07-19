export const POS_REGISTER_SESSION_ACTIVITY_CATEGORIES = [
  "register",
  "session",
  "cart",
  "payment",
  "service",
  "sale",
  "cash",
  "expense",
  "closeout",
  "reopen",
  "review",
  "sync",
] as const;

export const POS_REGISTER_SESSION_ACTIVITY_STATUSES = [
  "terminal_reported",
  "mapping_pending",
  "accepted",
  "projected",
  "held",
  "conflicted",
  "manager_applied",
  "manager_rejected",
  "rejected",
  "repaired",
] as const;

export const POS_REGISTER_SESSION_ACTIVITY_SOURCES = [
  "terminal_local",
  "core_sync",
  "cloud_projection",
  "manager_review",
  "cash_controls",
  "workflow_trace",
  "system",
] as const;

export type PosRegisterSessionActivityCategory =
  (typeof POS_REGISTER_SESSION_ACTIVITY_CATEGORIES)[number];

export type PosRegisterSessionActivityStatus =
  (typeof POS_REGISTER_SESSION_ACTIVITY_STATUSES)[number];

export type PosRegisterSessionActivitySource =
  (typeof POS_REGISTER_SESSION_ACTIVITY_SOURCES)[number];

export type PosRegisterSessionActivitySkipReasonCode =
  | "unsupported_event_type"
  | "missing_register_session"
  | "missing_expense_session"
  | "metadata_rejected";

export type PosRegisterSessionActivityMetadata = {
  amount?: number;
  cashMovementType?: string;
  countedCash?: number;
  direction?: "in" | "out" | "neutral";
  expectedCash?: number;
  itemCount?: number;
  itemLabel?: string;
  localReceiptNumber?: string;
  openingFloat?: number;
  paymentCount?: number;
  paymentMethodLabel?: string;
  paymentMethods?: string;
  previousAmount?: number;
  productSku?: string;
  quantity?: number;
  receiptNumber?: string;
  serviceLineCount?: number;
  serviceMode?: string;
  stage?: string;
  subtotal?: number;
  tax?: number;
  total?: number;
  totalPaid?: number;
  unitPrice?: number;
};

export type PosRegisterSessionLocalActivityInput = {
  localEventId: string;
  sequence: number;
  uploadSequence?: number;
  type: string;
  terminalId: string;
  storeId: string;
  registerNumber?: string;
  localRegisterSessionId?: string;
  localExpenseSessionId?: string;
  localPosSessionId?: string;
  localTransactionId?: string;
  staffProfileId?: string;
  payload: unknown;
  createdAt: number;
};

export type PosRegisterSessionLocalActivityClassification = {
  category: PosRegisterSessionActivityCategory;
  label: string;
};

export type PosRegisterSessionLocalActivitySummary = {
  category: PosRegisterSessionActivityCategory;
  createdAt: number;
  label: string;
  localEventId: string;
  localEventType: string;
  localExpenseSessionId?: string;
  localPosSessionId?: string;
  localRegisterSessionId: string;
  localTransactionId?: string;
  metadata: PosRegisterSessionActivityMetadata;
  registerNumber?: string;
  sequence: number;
  source: Extract<PosRegisterSessionActivitySource, "terminal_local">;
  staffProfileId?: string;
  status: Extract<PosRegisterSessionActivityStatus, "terminal_reported">;
  storeId: string;
  terminalId: string;
  uploadSequence?: number;
};

export type PosRegisterSessionLocalActivitySanitizationResult =
  | { ok: true; value: PosRegisterSessionLocalActivitySummary }
  | { ok: false; reasonCode: PosRegisterSessionActivitySkipReasonCode };

const LOCAL_EVENT_CLASSIFICATIONS = {
  "register.opened": {
    category: "register",
    label: "Register opened",
  },
  "session.started": {
    category: "session",
    label: "POS session started",
  },
  "session.payments_updated": {
    category: "payment",
    label: "Payment updated",
  },
  "cart.cleared": {
    category: "cart",
    label: "Cart cleared",
  },
  "cart.item_added": {
    category: "cart",
    label: "Cart item added",
  },
  "pending_checkout_item.defined": {
    category: "cart",
    label: "Checkout item defined",
  },
  "cart.service_added": {
    category: "service",
    label: "Service added",
  },
  "cart.service_removed": {
    category: "service",
    label: "Service removed",
  },
  "transaction.completed": {
    category: "sale",
    label: "Sale completed",
  },
  "expense.session_started": {
    category: "expense",
    label: "Expense session started",
  },
  "expense.item_added": {
    category: "expense",
    label: "Expense item added",
  },
  "expense.item_updated": {
    category: "expense",
    label: "Expense item updated",
  },
  "expense.item_removed": {
    category: "expense",
    label: "Expense item removed",
  },
  "expense.cart_cleared": {
    category: "expense",
    label: "Expense cart cleared",
  },
  "expense.held": {
    category: "expense",
    label: "Expense held",
  },
  "expense.resumed": {
    category: "expense",
    label: "Expense resumed",
  },
  "expense.voided": {
    category: "expense",
    label: "Expense voided",
  },
  "expense.canceled": {
    category: "expense",
    label: "Expense canceled",
  },
  "expense.completed": {
    category: "expense",
    label: "Expense recorded",
  },
  "register.closeout_started": {
    category: "closeout",
    label: "Closeout started",
  },
  "register.reopened": {
    category: "reopen",
    label: "Register reopened",
  },
  "cash.movement_recorded": {
    category: "cash",
    label: "Cash movement recorded",
  },
} as const satisfies Record<
  string,
  PosRegisterSessionLocalActivityClassification
>;

const STATUS_LABELS = {
  terminal_reported: "Reported by terminal",
  mapping_pending: "Waiting for session mapping",
  accepted: "Accepted",
  projected: "Projected",
  held: "Waiting for earlier POS history",
  conflicted: "Needs manager review",
  manager_applied: "Manager review applied",
  manager_rejected: "Manager review rejected",
  rejected: "Rejected",
  repaired: "Repaired",
} as const satisfies Record<PosRegisterSessionActivityStatus, string>;

const LOCAL_EVENT_CLASSIFICATIONS_BY_TYPE: Record<
  string,
  PosRegisterSessionLocalActivityClassification
> = LOCAL_EVENT_CLASSIFICATIONS;

export function classifyPosRegisterSessionLocalEventType(
  type: string,
): PosRegisterSessionLocalActivityClassification | null {
  return LOCAL_EVENT_CLASSIFICATIONS_BY_TYPE[type] ?? null;
}

export function canReportPosRegisterSessionLocalActivityType(type: string) {
  return classifyPosRegisterSessionLocalEventType(type) !== null;
}

export function isPosRegisterSessionActivityStatus(
  value: unknown,
): value is PosRegisterSessionActivityStatus {
  return (
    typeof value === "string" &&
    POS_REGISTER_SESSION_ACTIVITY_STATUSES.includes(
      value as PosRegisterSessionActivityStatus,
    )
  );
}

export function toPosRegisterSessionActivityStatusLabel(
  status: PosRegisterSessionActivityStatus,
) {
  return STATUS_LABELS[status];
}

export function sanitizePosRegisterSessionLocalActivity(
  input: PosRegisterSessionLocalActivityInput,
): PosRegisterSessionLocalActivitySanitizationResult {
  const classification = classifyPosRegisterSessionLocalEventType(input.type);
  if (!classification) {
    return { ok: false, reasonCode: "unsupported_event_type" };
  }

  if (!input.localRegisterSessionId) {
    return { ok: false, reasonCode: "missing_register_session" };
  }

  if (input.type.startsWith("expense.") && !input.localExpenseSessionId) {
    return { ok: false, reasonCode: "missing_expense_session" };
  }

  return {
    ok: true,
    value: {
      category: classification.category,
      createdAt: input.createdAt,
      label: classification.label,
      localEventId: input.localEventId,
      localEventType: input.type,
      ...(input.localExpenseSessionId
        ? { localExpenseSessionId: input.localExpenseSessionId }
        : {}),
      ...(input.localPosSessionId
        ? { localPosSessionId: input.localPosSessionId }
        : {}),
      localRegisterSessionId: input.localRegisterSessionId,
      ...(input.localTransactionId
        ? { localTransactionId: input.localTransactionId }
        : {}),
      metadata: sanitizeMetadataForLocalEvent(input),
      ...(input.registerNumber ? { registerNumber: input.registerNumber } : {}),
      sequence: input.sequence,
      source: "terminal_local",
      ...(input.staffProfileId ? { staffProfileId: input.staffProfileId } : {}),
      status: "terminal_reported",
      storeId: input.storeId,
      terminalId: input.terminalId,
      ...(input.uploadSequence ? { uploadSequence: input.uploadSequence } : {}),
    },
  };
}

function sanitizeMetadataForLocalEvent(
  input: PosRegisterSessionLocalActivityInput,
): PosRegisterSessionActivityMetadata {
  const payload = asRecord(input.payload);

  switch (input.type) {
    case "register.opened":
      return compactMetadata({
        expectedCash: finiteNumber(payload.expectedCash),
        openingFloat: finiteNumber(payload.openingFloat),
      });
    case "session.payments_updated":
      return compactMetadata({
        amount: finiteNumber(payload.amount),
        paymentCount: arrayLength(payload.payments),
        paymentMethodLabel: labelFromToken(payload.paymentMethod),
        paymentMethods: paymentMethodsSummary(payload.payments),
        previousAmount: finiteNumber(payload.previousAmount),
        stage: safeToken(payload.stage),
        totalPaid: sumAmountArray(payload.payments),
      });
    case "cart.item_added":
    case "pending_checkout_item.defined":
    case "expense.item_added":
    case "expense.item_updated":
      return compactMetadata({
        itemLabel: safeLabel(payload.productName ?? payload.name),
        productSku: safeLabel(payload.productSku),
        quantity: finiteNumber(payload.quantity ?? payload.quantitySold),
        unitPrice: finiteNumber(payload.price ?? payload.unitPrice),
      });
    case "cart.service_added":
      return compactMetadata({
        itemLabel: safeLabel(payload.serviceCatalogName),
        quantity: finiteNumber(payload.quantity),
        serviceMode: safeToken(payload.serviceMode),
        total: finiteNumber(payload.totalPrice),
        unitPrice: finiteNumber(payload.unitPrice),
      });
    case "transaction.completed": {
      const totals = asRecord(payload.totals);
      return compactMetadata({
        itemCount: arrayLength(payload.items),
        localReceiptNumber: safeLabel(payload.localReceiptNumber),
        paymentCount: arrayLength(payload.payments),
        paymentMethods: paymentMethodsSummary(payload.payments),
        receiptNumber: safeLabel(payload.receiptNumber),
        serviceLineCount: arrayLength(payload.serviceLines),
        subtotal: finiteNumber(totals.subtotal),
        tax: finiteNumber(totals.tax),
        total: finiteNumber(totals.total),
      });
    }
    case "expense.completed":
      return compactMetadata({
        itemCount: arrayLength(payload.items),
        subtotal: finiteNumber(payload.subtotal),
        tax: finiteNumber(payload.tax),
        total: finiteNumber(payload.total),
      });
    case "register.closeout_started":
      return compactMetadata({
        countedCash: finiteNumber(payload.countedCash),
      });
    case "cash.movement_recorded":
      return compactMetadata({
        amount: finiteNumber(payload.amount),
        cashMovementType: safeToken(payload.type ?? payload.movementType),
        direction: cashDirection(payload.direction),
      });
    default:
      return {};
  }
}

function compactMetadata(
  metadata: PosRegisterSessionActivityMetadata,
): PosRegisterSessionActivityMetadata {
  return Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => value !== undefined),
  ) as PosRegisterSessionActivityMetadata;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function arrayLength(value: unknown) {
  return Array.isArray(value) ? value.length : undefined;
}

function sumAmountArray(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  let total = 0;
  let sawAmount = false;
  for (const entry of value) {
    const amount = finiteNumber(asRecord(entry).amount);
    if (amount === undefined) continue;
    total += amount;
    sawAmount = true;
  }
  return sawAmount ? total : undefined;
}

function safeLabel(value: unknown) {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, 80) : undefined;
}

function safeToken(value: unknown) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  return normalized ? normalized.slice(0, 48) : undefined;
}

function labelFromToken(value: unknown) {
  const token = safeToken(value);
  if (!token) return undefined;
  return token
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function paymentMethodsSummary(value: unknown) {
  if (!Array.isArray(value)) return undefined;

  const labels = Array.from(
    new Set(
      value
        .map((payment) => labelFromToken(asRecord(payment).method))
        .filter((label): label is string => Boolean(label)),
    ),
  );

  return labels.length ? safeLabel(labels.join(", ")) : undefined;
}

function cashDirection(value: unknown) {
  return value === "in" || value === "out" || value === "neutral"
    ? value
    : undefined;
}
