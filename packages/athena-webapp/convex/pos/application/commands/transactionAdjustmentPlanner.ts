import type { Id } from "../../../_generated/dataModel";
import {
  ok,
  userError,
  type CommandResult,
} from "../../../../shared/commandResult";

export type TransactionAdjustmentStatus =
  | "pending_approval"
  | "applied"
  | "rejected"
  | "cancelled"
  | "stale";

export type TransactionAdjustmentSettlementDirection =
  | "collect"
  | "refund"
  | "none";

export type TransactionAdjustmentPlannerTransaction = {
  _id: Id<"posTransaction">;
  storeId: Id<"store">;
  registerSessionId?: Id<"registerSession">;
  staffProfileId?: Id<"staffProfile">;
  status: string;
  subtotal: number;
  tax: number;
  total: number;
  transactionNumber?: string;
};

export type TransactionAdjustmentPlannerItem = {
  _id: Id<"posTransactionItem">;
  transactionId: Id<"posTransaction">;
  productId: Id<"product">;
  productSkuId: Id<"productSku">;
  pendingCheckoutItemId?: Id<"posPendingCheckoutItem">;
  productName: string;
  productSku: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
};

export type TransactionAdjustmentSkuSnapshot = {
  _id: Id<"productSku">;
  storeId: Id<"store">;
  productId: Id<"product">;
  productName?: string;
  sku?: string;
  price: number;
  netPrice?: number;
  quantityAvailable: number;
  isVisible?: boolean;
  productAvailability?: "archived" | "draft" | "live";
  productIsVisible?: boolean;
};

export type TransactionAdjustmentDraft = {
  existingLines?: Array<{
    transactionItemId: Id<"posTransactionItem">;
    correctedQuantity: number;
    unitPrice?: number;
    discount?: number;
    totalPrice?: number;
  }>;
  addedLines?: Array<{
    productSkuId: Id<"productSku">;
    quantity: number;
    unitPrice?: number;
    discount?: number;
    totalPrice?: number;
  }>;
  manualSubtotal?: number;
  manualTax?: number;
  manualTotal?: number;
  cashierStaffProfileId?: Id<"staffProfile"> | string;
};

export type TransactionAdjustmentPlannerInput = {
  transaction: TransactionAdjustmentPlannerTransaction;
  originalItems: TransactionAdjustmentPlannerItem[];
  skuSnapshots: TransactionAdjustmentSkuSnapshot[];
  draft: TransactionAdjustmentDraft;
  activeAdjustment?: {
    _id: string;
    status: TransactionAdjustmentStatus;
  } | null;
};

export type TransactionAdjustmentCorrectedLine = {
  lineType: "existing" | "added";
  originalTransactionItemId?: Id<"posTransactionItem">;
  productId: Id<"product">;
  productSkuId: Id<"productSku">;
  pendingCheckoutItemId?: Id<"posPendingCheckoutItem">;
  productName: string;
  productSku: string;
  originalQuantity: number;
  correctedQuantity: number;
  quantityDelta: number;
  unitPrice: number;
  originalTotal: number;
  correctedTotal: number;
  inventoryDelta: number;
};

export type TransactionAdjustmentInventoryDelta = {
  productId: Id<"product">;
  productSkuId: Id<"productSku">;
  productName: string;
  productSku: string;
  quantityDelta: number;
  reasonCode:
    | "pos_transaction_adjustment_issue"
    | "pos_transaction_adjustment_restock";
};

export type TransactionAdjustmentPlan = {
  correctedLines: TransactionAdjustmentCorrectedLine[];
  inventoryDeltas: TransactionAdjustmentInventoryDelta[];
  originalTotals: {
    subtotal: number;
    tax: number;
    total: number;
  };
  correctedTotals: {
    subtotal: number;
    tax: number;
    total: number;
  };
  deltaTotal: number;
  settlement: {
    direction: TransactionAdjustmentSettlementDirection;
    amount: number;
  };
  payloadFingerprint: string;
  payloadSubject: string;
};

const ACTIVE_ADJUSTMENT_STATUSES: TransactionAdjustmentStatus[] = [
  "pending_approval",
];

function roundStoredAmount(amount: number) {
  return Number(amount.toFixed(2));
}

function isWholeQuantity(quantity: number) {
  return Number.isFinite(quantity) && Number.isInteger(quantity);
}

function hasOwnValue(object: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function hasUnsupportedManualFields(draft: TransactionAdjustmentDraft) {
  if (
    hasOwnValue(draft as Record<string, unknown>, "manualSubtotal") ||
    hasOwnValue(draft as Record<string, unknown>, "manualTax") ||
    hasOwnValue(draft as Record<string, unknown>, "manualTotal") ||
    hasOwnValue(draft as Record<string, unknown>, "cashierStaffProfileId")
  ) {
    return true;
  }

  const lines = [...(draft.existingLines ?? []), ...(draft.addedLines ?? [])];
  return lines.some((line) => {
    const candidate = line as Record<string, unknown>;
    return (
      hasOwnValue(candidate, "unitPrice") ||
      hasOwnValue(candidate, "discount") ||
      hasOwnValue(candidate, "totalPrice")
    );
  });
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value) ?? "undefined";
}

function getSkuDisplaySku(sku: TransactionAdjustmentSkuSnapshot) {
  return sku.sku ?? String(sku._id);
}

function getSkuDisplayName(sku: TransactionAdjustmentSkuSnapshot) {
  return sku.productName ?? getSkuDisplaySku(sku);
}

function getSkuPrice(sku: TransactionAdjustmentSkuSnapshot) {
  return sku.netPrice ?? sku.price;
}

function isSkuAvailableForAddition(
  sku: TransactionAdjustmentSkuSnapshot,
  storeId: Id<"store">,
) {
  return (
    sku.storeId === storeId &&
    sku.productAvailability === "live" &&
    sku.isVisible !== false &&
    sku.productIsVisible !== false
  );
}

function buildFingerprintPayload(args: {
  transaction: TransactionAdjustmentPlannerTransaction;
  correctedLines: TransactionAdjustmentCorrectedLine[];
  originalTotals: TransactionAdjustmentPlan["originalTotals"];
  correctedTotals: TransactionAdjustmentPlan["correctedTotals"];
  deltaTotal: number;
  settlement: TransactionAdjustmentPlan["settlement"];
}) {
  return {
    transactionId: args.transaction._id,
    storeId: args.transaction.storeId,
    originalTotals: args.originalTotals,
    correctedTotals: args.correctedTotals,
    deltaTotal: args.deltaTotal,
    settlement: args.settlement,
    lines: args.correctedLines.map((line) => ({
      lineType: line.lineType,
      originalTransactionItemId: line.originalTransactionItemId,
      productId: line.productId,
      productSkuId: line.productSkuId,
      originalQuantity: line.originalQuantity,
      correctedQuantity: line.correctedQuantity,
      unitPrice: line.unitPrice,
    })),
  };
}

export function planTransactionAdjustment(
  input: TransactionAdjustmentPlannerInput,
): CommandResult<TransactionAdjustmentPlan> {
  if (
    input.activeAdjustment &&
    ACTIVE_ADJUSTMENT_STATUSES.includes(input.activeAdjustment.status)
  ) {
    return userError({
      code: "conflict",
      title: "Adjustment already pending",
      message:
        "This transaction already has an item adjustment waiting for approval.",
      retryable: false,
      metadata: {
        activeAdjustmentId: input.activeAdjustment._id,
      },
    });
  }

  if (input.transaction.status !== "completed") {
    return userError({
      code: "precondition_failed",
      title: "Transaction not completed",
      message: "Only completed POS transactions can be adjusted.",
      retryable: false,
    });
  }

  if (hasUnsupportedManualFields(input.draft)) {
    return userError({
      code: "precondition_failed",
      title: "Adjustment field unavailable",
      message:
        "Item adjustments can change SKU quantities only. Price, discount, tax, total, and cashier edits are not supported.",
      retryable: false,
      metadata: {
        unsupportedFieldsPresent: true,
      },
    });
  }

  const originalItemsById = new Map(
    input.originalItems.map((item) => [item._id, item]),
  );
  const correctedQuantitiesByItemId = new Map<
    Id<"posTransactionItem">,
    number
  >();

  for (const change of input.draft.existingLines ?? []) {
    if (!isWholeQuantity(change.correctedQuantity) || change.correctedQuantity < 0) {
      return userError({
        code: "validation_failed",
        title: "Invalid quantity",
        message: "Use whole-number quantities for POS item adjustments.",
        retryable: false,
      });
    }

    if (!originalItemsById.has(change.transactionItemId)) {
      return userError({
        code: "not_found",
        title: "Transaction line not found",
        message: "One of the original transaction lines could not be found.",
        retryable: false,
        metadata: {
          transactionItemId: change.transactionItemId,
        },
      });
    }

    if (correctedQuantitiesByItemId.has(change.transactionItemId)) {
      return userError({
        code: "validation_failed",
        title: "Duplicate transaction line",
        message: "Each transaction line can only appear once in an adjustment.",
        retryable: false,
      });
    }

    correctedQuantitiesByItemId.set(
      change.transactionItemId,
      change.correctedQuantity,
    );
  }

  const skuSnapshotsById = new Map(
    input.skuSnapshots.map((sku) => [sku._id, sku]),
  );
  const addedQuantityBySkuId = new Map<Id<"productSku">, number>();

  for (const addition of input.draft.addedLines ?? []) {
    if (!isWholeQuantity(addition.quantity) || addition.quantity <= 0) {
      return userError({
        code: "validation_failed",
        title: "Invalid quantity",
        message: "Use whole-number quantities for POS item adjustments.",
        retryable: false,
      });
    }

    const sku = skuSnapshotsById.get(addition.productSkuId);
    if (!sku) {
      return userError({
        code: "not_found",
        title: "SKU not found",
        message: "The added SKU could not be found. Refresh the transaction and try again.",
        retryable: false,
        metadata: {
          productSkuId: addition.productSkuId,
        },
      });
    }

    if (!isSkuAvailableForAddition(sku, input.transaction.storeId)) {
      return userError({
        code: "precondition_failed",
        title: "SKU unavailable",
        message:
          "The added SKU is not active for this store. Choose a live SKU before submitting the adjustment.",
        retryable: false,
        metadata: {
          productSkuId: addition.productSkuId,
          storeId: sku.storeId,
          productAvailability: sku.productAvailability,
        },
      });
    }

    addedQuantityBySkuId.set(
      addition.productSkuId,
      (addedQuantityBySkuId.get(addition.productSkuId) ?? 0) + addition.quantity,
    );
  }

  for (const [productSkuId, requested] of addedQuantityBySkuId) {
    const sku = skuSnapshotsById.get(productSkuId);

    if (sku && sku.quantityAvailable < requested) {
      return userError({
        code: "conflict",
        title: "Not enough inventory",
        message: `Only ${sku.quantityAvailable} unit${sku.quantityAvailable === 1 ? "" : "s"} available for ${getSkuDisplayName(sku)}.`,
        retryable: false,
        metadata: {
          productSkuId,
          requested,
          available: sku.quantityAvailable,
        },
      });
    }
  }

  const correctedLines: TransactionAdjustmentCorrectedLine[] = input.originalItems.map(
    (item) => {
      const correctedQuantity =
        correctedQuantitiesByItemId.get(item._id) ?? item.quantity;
      const correctedTotal = roundStoredAmount(item.unitPrice * correctedQuantity);
      return {
        lineType: "existing",
        originalTransactionItemId: item._id,
        productId: item.productId,
        productSkuId: item.productSkuId,
        pendingCheckoutItemId: item.pendingCheckoutItemId,
        productName: item.productName,
        productSku: item.productSku,
        originalQuantity: item.quantity,
        correctedQuantity,
        quantityDelta: correctedQuantity - item.quantity,
        unitPrice: item.unitPrice,
        originalTotal: item.totalPrice,
        correctedTotal,
        inventoryDelta: item.quantity - correctedQuantity,
      };
    },
  );

  for (const [productSkuId, quantity] of addedQuantityBySkuId) {
    const sku = skuSnapshotsById.get(productSkuId);
    if (!sku) {
      continue;
    }

    const unitPrice = getSkuPrice(sku);
    correctedLines.push({
      lineType: "added",
      productId: sku.productId,
      productSkuId: sku._id,
      productName: getSkuDisplayName(sku),
      productSku: getSkuDisplaySku(sku),
      originalQuantity: 0,
      correctedQuantity: quantity,
      quantityDelta: quantity,
      unitPrice,
      originalTotal: 0,
      correctedTotal: roundStoredAmount(unitPrice * quantity),
      inventoryDelta: -quantity,
    });
  }

  const changedLines = correctedLines.filter(
    (line) => line.quantityDelta !== 0,
  );
  if (changedLines.length === 0) {
    return userError({
      code: "validation_failed",
      title: "No adjustment to submit",
      message: "Change at least one item quantity before submitting an adjustment.",
      retryable: false,
    });
  }

  const correctedSubtotal = roundStoredAmount(
    correctedLines.reduce((sum, line) => sum + line.correctedTotal, 0),
  );
  const correctedTax = roundStoredAmount(input.transaction.tax);
  const correctedTotal = roundStoredAmount(correctedSubtotal + correctedTax);
  const originalTotals = {
    subtotal: roundStoredAmount(input.transaction.subtotal),
    tax: roundStoredAmount(input.transaction.tax),
    total: roundStoredAmount(input.transaction.total),
  };
  const correctedTotals = {
    subtotal: correctedSubtotal,
    tax: correctedTax,
    total: correctedTotal,
  };
  const deltaTotal = roundStoredAmount(correctedTotal - originalTotals.total);
  const settlement =
    deltaTotal > 0
      ? {
          direction: "collect" as const,
          amount: deltaTotal,
        }
      : deltaTotal < 0
        ? {
            direction: "refund" as const,
            amount: Math.abs(deltaTotal),
          }
        : {
            direction: "none" as const,
            amount: 0,
          };
  const inventoryDeltas = changedLines
    .filter((line) => line.inventoryDelta !== 0)
    .map((line) => ({
      productId: line.productId,
      productSkuId: line.productSkuId,
      productName: line.productName,
      productSku: line.productSku,
      quantityDelta: line.inventoryDelta,
      reasonCode:
        line.inventoryDelta > 0
          ? ("pos_transaction_adjustment_restock" as const)
          : ("pos_transaction_adjustment_issue" as const),
    }));
  const orderedCorrectedLines = [...correctedLines].sort((left, right) => {
    const leftKey = `${left.lineType}:${left.originalTransactionItemId ?? ""}:${left.productSkuId}`;
    const rightKey = `${right.lineType}:${right.originalTransactionItemId ?? ""}:${right.productSkuId}`;
    return leftKey.localeCompare(rightKey);
  });
  const payloadFingerprint = `pos-adjustment:${stableStringify(
    buildFingerprintPayload({
      transaction: input.transaction,
      correctedLines: orderedCorrectedLines,
      originalTotals,
      correctedTotals,
      deltaTotal,
      settlement,
    }),
  )}`;

  return ok({
    correctedLines: orderedCorrectedLines,
    inventoryDeltas,
    originalTotals,
    correctedTotals,
    deltaTotal,
    settlement,
    payloadFingerprint,
    payloadSubject: `pos_transaction_item_adjustment:${input.transaction._id}:${payloadFingerprint}`,
  });
}
