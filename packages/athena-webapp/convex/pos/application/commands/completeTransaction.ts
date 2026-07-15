import { internal } from "../../../_generated/api";
import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";
import type { ApprovalRequirement } from "../../../../shared/approvalPolicy";
import {
  capitalizeWords,
  currencyFormatter,
  generateTransactionNumber,
} from "../../../utils";
import { toDisplayAmount } from "../../../lib/currency";
import { buildApprovalRequest } from "../../../operations/approvalRequestHelpers";
import { createApprovalRequesterChallengeWithCtx } from "../../../operations/approvalRequesterChallenges";
import {
  APPROVAL_ACTIONS,
  consumeCommandApprovalProofWithCtx,
} from "../../../operations/approvalActions";
import { recordOperationalEventWithCtx } from "../../../operations/operationalEvents";
import { calculateRegisterSessionCashDelta } from "../../../operations/registerSessions";
import {
  recordRetailSalePaymentAllocations,
  recordRetailVoidPaymentAllocations,
} from "../../infrastructure/integrations/paymentAllocationService";
import {
  createPosTransaction,
  createPosTransactionItem,
  getPosSessionById,
  getRegisterSessionById,
  getPosTransactionById,
  getPosTransactionByIdempotencyKey,
  getProductSkuById,
  getStoreById,
  listTransactionAdjustments,
  listSessionItems,
  listTransactionItems,
  patchPosSession,
  patchPosTransaction,
} from "../../infrastructure/repositories/transactionRepository";
import {
  ok,
  approvalRequired,
  userError,
  type ApprovalCommandResult,
  type CommandResult,
} from "../../../../shared/commandResult";
import { isPosUsableRegisterSessionStatus } from "../../../../shared/registerSessionStatus";
import { getRegisterSessionVoidApplicationStatus } from "../../../../shared/registerSessionLifecyclePolicy";
import {
  consumeInventoryHoldsForSession,
  readActiveInventoryHoldQuantitiesForSession,
  type SkuActivityRecorder,
  validateInventoryAvailability,
} from "../../../inventory/helpers/inventoryHolds";
import { markCatalogSummaryNeedsRefresh } from "../../../inventory/catalogSummary";
import { recordSkuActivityEventWithCtx } from "../../../operations/skuActivity";
import {
  recordPendingCheckoutItemEvidenceCorrection,
  recordPendingCheckoutItemSaleEvidence,
} from "./createOrReusePendingCheckoutItem";
import { readActiveProvisionalImportSkuForStoreSku } from "../queries/listRegisterCatalog";
import {
  appendReportingIngressWithCtx,
  type ReportingIngressLineInput,
} from "../../../reporting/ingress";
import { canonicalReportingBusinessEventKey } from "../../../reporting/factIdentity";
import {
  applyCommerceInventoryEffectWithCtx,
  outboundBasisFromEffect,
  reportingLineCostFromEffect,
  uncostedOutboundBasis,
} from "../../../reporting/inventory/commerceEffects";
import { appendPosLifecycleJournalWithCtx } from "../../infrastructure/posLifecycleJournal";

type InventoryImportProvisionalSkuId = Id<"inventoryImportProvisionalSku">;

type PosPaymentInput = {
  method: string;
  amount: number;
  timestamp: number;
};

type DirectTransactionItemInput = {
  skuId: Id<"productSku">;
  inventoryImportProvisionalSkuId?: InventoryImportProvisionalSkuId;
  quantity: number;
  price: number;
  name: string;
  barcode?: string;
  sku: string;
  image?: string;
};

type ActiveProvisionalImportSaleLine = {
  _id: InventoryImportProvisionalSkuId;
  productId: Id<"product">;
  productSkuId: Id<"productSku">;
  // Server-authoritative catalog price for a provisional-import line (U7 basis).
  importedPrice: number;
  saleEvidence?: {
    saleCount?: number;
    totalQuantitySold?: number;
    lastSoldAt?: number;
    lastPosTransactionId?: Id<"posTransaction">;
    lastRegisterSessionId?: Id<"registerSession">;
  };
};

type TransactionTotals = {
  subtotal: number;
  tax: number;
  total: number;
};

async function appendCompletedPosLifecycleJournal(
  ctx: MutationCtx,
  args: {
    completedAt: number;
    organizationId?: Id<"organization">;
    storeId: Id<"store">;
    totals: TransactionTotals;
    transactionId: Id<"posTransaction">;
  },
) {
  if (!args.organizationId) {
    throw new Error("Completed POS sale organization could not be resolved.");
  }
  return appendPosLifecycleJournalWithCtx(ctx, {
    organizationId: args.organizationId,
    storeId: args.storeId,
    transactionId: args.transactionId,
    eventKind: "completed",
    eventKey: `pos:${args.transactionId}:completed`,
    contentFingerprint: [
      "pos-lifecycle-completed-v1",
      args.transactionId,
      args.completedAt,
      args.totals.subtotal,
      args.totals.tax,
      args.totals.total,
    ].join(":"),
    occurredAt: args.completedAt,
    origin: "cloud",
  });
}

function reportingCurrency(currency: string | undefined) {
  const currencyCode = currency?.trim().toUpperCase();
  return currencyCode
    ? { currencyCode, currencyMinorUnitScale: 2 }
    : {};
}

async function appendCompletedPosSaleIngress(
  ctx: MutationCtx,
  args: {
    acceptedAt: number;
    items: Array<{
      inventoryImportProvisionalSkuId?: Id<"inventoryImportProvisionalSku">;
      lineKey: string;
      pendingCheckoutItemId?: Id<"posPendingCheckoutItem">;
      productId: Id<"product">;
      productSkuId: Id<"productSku">;
      quantity: number;
      totalAmountMinor: number;
      unitPriceMinor: number;
    }>;
    organizationId?: Id<"organization">;
    storeCurrency?: string;
    storeId: Id<"store">;
    synchronizedAt?: number;
    totals: TransactionTotals;
    transactionId: Id<"posTransaction">;
  },
) {
  if (!args.organizationId) return null;
  const inventoryEffects =
    ctx.db && typeof ctx.db.query === "function"
      ? await Promise.all(
          args.items.map((item) =>
            ctx.db
        .query("reportingInventoryEffect")
        .withIndex("by_storeId_sourceDomain_businessEventKey", (q) =>
          q
            .eq("storeId", args.storeId)
            .eq("sourceDomain", "pos")
            .eq(
              "businessEventKey",
              `pos:${args.transactionId}:line:${item.lineKey}:sale`,
            ),
        )
              .first(),
          ),
        )
      : args.items.map(() => null);
  const [products, pendingCheckoutItems] =
    ctx.db && typeof ctx.db.get === "function"
      ? await Promise.all([
          Promise.all(
            args.items.map((item) => ctx.db.get("product", item.productId)),
          ),
          Promise.all(
            args.items.map((item) =>
              item.pendingCheckoutItemId
                ? ctx.db.get("posPendingCheckoutItem", item.pendingCheckoutItemId)
                : null,
            ),
          ),
        ])
      : [args.items.map(() => null), args.items.map(() => null)];
  const lines: ReportingIngressLineInput[] = args.items.map((item, index) => {
    const inventoryEffect = inventoryEffects[index];
    const product = products[index];
    const pendingCheckoutItem = pendingCheckoutItems[index];
    const pendingCheckoutIsResolved =
      pendingCheckoutItem &&
      (pendingCheckoutItem.status === "approved" ||
        pendingCheckoutItem.status === "linked_to_catalog") &&
      pendingCheckoutItem.approvedProductSkuId;
    return {
      allocatedDiscountMinor: 0,
      attributionKind: item.pendingCheckoutItemId
        ? "pending_checkout"
        : item.inventoryImportProvisionalSkuId
          ? "inventory_import"
          : "direct",
      canonicalProductSkuId: pendingCheckoutIsResolved
        ? pendingCheckoutItem.approvedProductSkuId
        : item.pendingCheckoutItemId
          ? undefined
          : item.productSkuId,
      categoryId: product?.categoryId,
      channel: "pos",
      ...reportingLineCostFromEffect(inventoryEffect, item.quantity),
      discountAmountMinor: 0,
      grossAmountMinor: item.totalAmountMinor,
      ...(inventoryEffect ? { inventoryEffectId: inventoryEffect._id } : {}),
      inventoryImportProvisionalSkuId:
        item.inventoryImportProvisionalSkuId,
      lineKey: item.lineKey,
      lineKind: "merchandise",
      netAmountMinor: item.totalAmountMinor,
      originalProductSkuId:
        pendingCheckoutItem?.provisionalProductSkuId ?? item.productSkuId,
      originalQuantity: item.quantity,
      pendingCheckoutItemId: item.pendingCheckoutItemId,
      productId: item.productId,
      productSkuId: item.productSkuId,
      provisionalProductSkuId:
        pendingCheckoutItem?.provisionalProductSkuId ??
        (item.pendingCheckoutItemId ? item.productSkuId : undefined),
      quantity: item.quantity,
      recognizedNetAmountMinor: item.totalAmountMinor,
      recognitionCategoryId: product?.categoryId,
      recognitionProductId: item.productId,
      recognitionProductSkuId: item.productSkuId,
      unitPriceMinor: item.unitPriceMinor,
    };
  });
  if (args.totals.tax !== 0) {
    lines.push({
      costStatus: "not_applicable",
      discountAmountMinor: 0,
      grossAmountMinor: args.totals.tax,
      lineKey: "tax",
      lineKind: "tax",
      netAmountMinor: args.totals.tax,
      quantity: 0,
      taxAmountMinor: args.totals.tax,
    });
  }
  const contentFingerprint = [
    "pos-complete-v1",
    args.transactionId,
    args.totals.subtotal,
    args.totals.tax,
    args.totals.total,
    ...args.items.flatMap((item) => [
      item.lineKey,
      item.productSkuId,
      item.pendingCheckoutItemId,
      item.inventoryImportProvisionalSkuId,
      item.quantity,
      item.unitPriceMinor,
      item.totalAmountMinor,
    ]),
    ...lines.flatMap((line) => [
      line.canonicalProductSkuId,
      line.originalProductSkuId,
      line.recognitionProductId,
      line.recognitionCategoryId,
      line.recognitionProductSkuId,
      line.provisionalProductSkuId,
      line.attributionKind,
    ]),
  ].join(":");

  return appendReportingIngressWithCtx(ctx, {
    acceptedAt: args.acceptedAt,
    adapterVersion: 1,
    businessEventKey: canonicalReportingBusinessEventKey({
      kind: "pos_sale",
      transactionId: String(args.transactionId),
    }),
    contentFingerprint,
    discountAmountMinor: 0,
    grossAmountMinor: args.totals.subtotal,
    lines,
    materialFields: ["amountMinor", "occurrenceAt", "quantity", "storeId"],
    netAmountMinor: args.totals.total,
    occurredAt: args.acceptedAt,
    organizationId: args.organizationId,
    quantity: args.items.reduce((sum, item) => sum + item.quantity, 0),
    sourceDomain: "pos",
    sourceEventType: args.synchronizedAt
      ? "pos_completed_offline"
      : "pos_completed",
    sourceReferences: [
      {
        relation: "owns",
        sourceId: String(args.transactionId),
        sourceType: "pos_transaction",
      },
    ],
    storeId: args.storeId,
    synchronizedAt: args.synchronizedAt,
    taxAmountMinor: args.totals.tax,
    ...reportingCurrency(args.storeCurrency),
  });
}

async function appendPosVoidIngress(
  ctx: MutationCtx,
  args: {
    acceptedAt: number;
    items: Array<{
      item: Awaited<ReturnType<typeof listTransactionItems>>[number];
    }>;
    organizationId?: Id<"organization">;
    storeCurrency?: string;
    transaction: NonNullable<Awaited<ReturnType<typeof getPosTransactionById>>>;
  },
) {
  if (!args.organizationId) return null;
  const lines: ReportingIngressLineInput[] = args.items.map(({ item }) => ({
    allocatedDiscountMinor: item.discount ?? 0,
    attributionKind: item.pendingCheckoutItemId
      ? "pending_checkout"
      : item.inventoryImportProvisionalSkuId
        ? "inventory_import"
        : "direct",
    canonicalProductSkuId: item.pendingCheckoutItemId
      ? undefined
      : item.productSkuId,
    channel: "pos",
    costStatus: "not_applicable",
    discountAmountMinor: item.discount ?? 0,
    grossAmountMinor: item.totalPrice,
    inventoryImportProvisionalSkuId: item.inventoryImportProvisionalSkuId,
    lineKey: String(item._id),
    lineKind: "merchandise",
    netAmountMinor: item.totalPrice,
    originalProductSkuId: item.productSkuId,
    originalQuantity: item.quantity,
    pendingCheckoutItemId: item.pendingCheckoutItemId,
    productId: item.productId,
    productSkuId: item.productSkuId,
    provisionalProductSkuId: item.pendingCheckoutItemId
      ? item.productSkuId
      : undefined,
    // The inventory return effect owns the unit reversal. This line owns only
    // the voided revenue so units sold are not decremented twice.
    quantity: 0,
    recognizedNetAmountMinor: item.totalPrice,
    recognitionProductId: item.productId,
    recognitionProductSkuId: item.productSkuId,
    unitPriceMinor: item.unitPrice,
  }));
  return appendReportingIngressWithCtx(ctx, {
    acceptedAt: args.acceptedAt,
    adapterVersion: 1,
    businessEventKey: canonicalReportingBusinessEventKey({
      kind: "pos_void",
      transactionId: String(args.transaction._id),
    }),
    contentFingerprint: [
      "pos-void-v1",
      args.transaction._id,
      args.transaction.total,
      ...lines.flatMap((line) => [line.lineKey, line.quantity, line.netAmountMinor]),
    ].join(":"),
    grossAmountMinor: args.transaction.subtotal,
    lines,
    materialFields: ["amountMinor", "occurrenceAt", "quantity", "storeId"],
    netAmountMinor: args.transaction.total,
    occurredAt: args.acceptedAt,
    organizationId: args.organizationId,
    quantity: 0,
    sourceDomain: "pos",
    sourceEventType: "pos_transaction_voided",
    sourceReferences: [
      {
        relation: "reverses",
        sourceId: String(args.transaction._id),
        sourceType: "pos_transaction",
      },
    ],
    storeId: args.transaction.storeId,
    taxAmountMinor: args.transaction.tax,
    ...reportingCurrency(args.storeCurrency),
  });
}

function hasReadableDb(ctx: MutationCtx): ctx is MutationCtx & {
  db: { get: MutationCtx["db"]["get"] };
} {
  return typeof (ctx as { db?: { get?: unknown } }).db?.get === "function";
}

async function validateDirectTransactionStoreReferences(
  ctx: MutationCtx,
  args: {
    storeId: Id<"store">;
    customerProfileId?: Id<"customerProfile">;
    registerSessionId?: Id<"registerSession">;
    staffProfileId?: Id<"staffProfile">;
    terminalId?: Id<"posTerminal">;
    skus: Array<NonNullable<Awaited<ReturnType<typeof getProductSkuById>>>>;
  },
): Promise<CommandResult<never> | null> {
  for (const sku of args.skus) {
    if ("storeId" in sku && sku.storeId && sku.storeId !== args.storeId) {
      return userError({
        code: "precondition_failed",
        message: "Product SKU is not available for this store.",
      });
    }
  }

  if (!hasReadableDb(ctx)) {
    return null;
  }

  for (const sku of args.skus) {
    const product = await ctx.db.get("product", sku.productId);
    if (!product || product.storeId !== args.storeId) {
      return userError({
        code: "precondition_failed",
        message: "Product SKU is not available for this store.",
      });
    }
  }

  if (args.staffProfileId) {
    const staffProfile = await ctx.db.get("staffProfile", args.staffProfileId);
    if (
      !staffProfile ||
      staffProfile.storeId !== args.storeId ||
      staffProfile.status !== "active"
    ) {
      return userError({
        code: "precondition_failed",
        message: "Staff profile is not active for this store.",
      });
    }
  }

  if (args.customerProfileId) {
    const customerProfile = await ctx.db.get(
      "customerProfile",
      args.customerProfileId,
    );
    if (!customerProfile || customerProfile.storeId !== args.storeId) {
      return userError({
        code: "precondition_failed",
        message: "Customer profile is not available for this store.",
      });
    }
  }

  if (args.terminalId) {
    const terminal = await ctx.db.get("posTerminal", args.terminalId);
    if (
      !terminal ||
      terminal.storeId !== args.storeId ||
      terminal.status !== "active"
    ) {
      return userError({
        code: "precondition_failed",
        message: "POS terminal is not active for this store.",
      });
    }
  }

  if (args.registerSessionId) {
    const registerSession = await ctx.db.get(
      "registerSession",
      args.registerSessionId,
    );
    if (
      !registerSession ||
      registerSession.storeId !== args.storeId ||
      !isPosUsableRegisterSessionStatus(registerSession.status)
    ) {
      return userError({
        code: "precondition_failed",
        message: "Register session is not open for this store.",
      });
    }
    if (args.terminalId && registerSession.terminalId !== args.terminalId) {
      return userError({
        code: "precondition_failed",
        message: "Register session does not match this terminal.",
      });
    }
    if (
      args.staffProfileId &&
      registerSession.openedByStaffProfileId &&
      registerSession.openedByStaffProfileId !== args.staffProfileId
    ) {
      return userError({
        code: "precondition_failed",
        message: "Register session does not match this staff member.",
      });
    }
  }

  return null;
}

export function buildCompleteTransactionResult(input: {
  transactionId: Id<"posTransaction"> | null;
  transactionNumber: string | null;
  paymentAllocated: boolean;
}) {
  if (!input.transactionId || !input.transactionNumber) {
    return {
      status: "validationFailed" as const,
      message: "Transaction completion did not finish cleanly",
    };
  }

  return {
    status: "ok" as const,
    data: {
      transactionId: input.transactionId,
      transactionNumber: input.transactionNumber,
    },
  };
}

function calculateTotalPaid(payments: PosPaymentInput[]) {
  return payments.reduce((sum, payment) => sum + payment.amount, 0);
}

function formatPaymentMethodLabel(method: string) {
  return method.trim().toLowerCase().replaceAll("_", " ");
}

function paymentMethodLabels(payments: PosPaymentInput[]) {
  return Array.from(
    new Set(
      payments
        .map((payment) => formatPaymentMethodLabel(payment.method))
        .filter(Boolean),
    ),
  );
}

function formatSaleAmount(currency: string | undefined, amount: number) {
  const storeCurrency = currency?.trim() || "GHS";

  try {
    return currencyFormatter(storeCurrency).format(toDisplayAmount(amount));
  } catch {
    return currencyFormatter("GHS").format(toDisplayAmount(amount));
  }
}

async function recordCompletedSaleOperationalEvent(
  ctx: MutationCtx,
  args: {
    completedAt: number;
    changeGiven?: number;
    customerProfileId?: Id<"customerProfile">;
    lineCount: number;
    organizationId?: Id<"organization">;
    payments: PosPaymentInput[];
    posTransactionId: Id<"posTransaction">;
    registerSessionId?: Id<"registerSession">;
    staffProfileId?: Id<"staffProfile">;
    storeCurrency?: string;
    storeId: Id<"store">;
    total: number;
    transactionNumber: string;
  },
) {
  const labels = paymentMethodLabels(args.payments);
  const paymentSummary =
    labels.length === 0
      ? "payment needs review"
      : labels.length === 1
        ? labels[0]
        : labels.length === 2
          ? `${labels[0]} and ${labels[1]}`
          : `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;

  await recordOperationalEventWithCtx(ctx, {
    storeId: args.storeId,
    organizationId: args.organizationId,
    eventType: "pos_transaction_completed",
    subjectType: "posTransaction",
    subjectId: args.posTransactionId,
    message: `POS sale #${args.transactionNumber} completed: ${formatSaleAmount(args.storeCurrency, args.total)}, ${paymentSummary}.`,
    metadata: {
      cashDelta: calculateRegisterSessionCashDelta({
        changeGiven: args.changeGiven,
        payments: args.payments,
      }),
      completedAt: args.completedAt,
      lineCount: args.lineCount,
      paymentCount: args.payments.length,
      paymentMethods: labels,
      receiptNumber: args.transactionNumber,
      saleTotal: args.total,
      syncOrigin: "online",
      total: args.total,
      transactionNumber: args.transactionNumber,
    },
    actorStaffProfileId: args.staffProfileId,
    customerProfileId: args.customerProfileId,
    registerSessionId: args.registerSessionId,
    posTransactionId: args.posTransactionId,
  });
}

async function recordPosSaleInventoryMovement(
  ctx: MutationCtx,
  args: {
    storeId: Id<"store">;
    organizationId?: Id<"organization">;
    productId: Id<"product">;
    productSkuId: Id<"productSku">;
    quantity: number;
    posTransactionId: Id<"posTransaction">;
    registerSessionId?: Id<"registerSession">;
    staffProfileId?: Id<"staffProfile">;
    customerProfileId?: Id<"customerProfile">;
    occurrenceAt: number;
    sourceLineId: Id<"posTransactionItem">;
    sellableQuantityDelta: number;
    transactionNumber: string;
  },
) {
  if (!args.organizationId) {
    throw new Error("POS sale organization could not be resolved.");
  }
  return applyCommerceInventoryEffectWithCtx(ctx, {
    activityType: "stock_sale",
    businessEventKey: `pos:${args.posTransactionId}:line:${args.sourceLineId}:sale`,
    completeness: "partial",
    contentFingerprint: [
      "pos-sale-inventory-v1",
      String(args.posTransactionId),
      String(args.sourceLineId),
      String(args.productSkuId),
      String(args.quantity),
      String(args.sellableQuantityDelta),
    ].join(":"),
    disposition: "merchandise_sale",
    effectType: "sale",
    kind: "outbound",
    quantity: args.quantity,
    storeId: args.storeId,
    organizationId: args.organizationId,
    movementType: "sale",
    sourceType: "posTransaction",
    sourceId: args.posTransactionId,
    occurrenceAt: args.occurrenceAt,
    productId: args.productId,
    productSkuId: args.productSkuId,
    actorStaffProfileId: args.staffProfileId,
    customerProfileId: args.customerProfileId,
    registerSessionId: args.registerSessionId,
    posTransactionId: args.posTransactionId,
    reasonCode: "pos_sale",
    sellableQuantityDelta: args.sellableQuantityDelta,
    sourceDomain: "pos",
    sourceLineId: String(args.sourceLineId),
    notes: `POS sale ${args.transactionNumber}`,
  });
}

async function recordProvisionalImportSkuSaleEvidence(
  ctx: MutationCtx,
  args: {
    provisionalSku: ActiveProvisionalImportSaleLine;
    posTransactionId: Id<"posTransaction">;
    registerSessionId?: Id<"registerSession">;
    quantitySold: number;
    timestamp: number;
  },
) {
  const db = ctx.db as unknown as {
    patch(
      table: "inventoryImportProvisionalSku",
      id: InventoryImportProvisionalSkuId,
      patch: {
        saleEvidence: {
          saleCount: number;
          totalQuantitySold: number;
          lastSoldAt: number;
          lastPosTransactionId: Id<"posTransaction">;
          lastRegisterSessionId?: Id<"registerSession">;
        };
        updatedAt: number;
      },
    ): Promise<void>;
  };
  const previousEvidence = args.provisionalSku.saleEvidence ?? {};
  const saleEvidence = {
    saleCount: (previousEvidence.saleCount ?? 0) + 1,
    totalQuantitySold:
      (previousEvidence.totalQuantitySold ?? 0) + args.quantitySold,
    lastSoldAt: args.timestamp,
    lastPosTransactionId: args.posTransactionId,
    ...(args.registerSessionId
      ? { lastRegisterSessionId: args.registerSessionId }
      : {}),
  };

  await db.patch("inventoryImportProvisionalSku", args.provisionalSku._id, {
    saleEvidence,
    updatedAt: args.timestamp,
  });
}

function roundStoredAmount(amount: number) {
  return Number(amount.toFixed(2));
}

function calculateCanonicalTransactionTotals(
  items: Array<{
    price: number;
    quantity: number;
  }>,
): TransactionTotals {
  const subtotal = roundStoredAmount(
    items.reduce((sum, item) => sum + item.price * item.quantity, 0),
  );
  const tax = 0;

  return {
    subtotal,
    tax,
    total: roundStoredAmount(subtotal + tax),
  };
}

function totalsMatch(
  submittedTotals: TransactionTotals,
  canonicalTotals: TransactionTotals,
) {
  return (
    roundStoredAmount(submittedTotals.subtotal) === canonicalTotals.subtotal &&
    roundStoredAmount(submittedTotals.tax) === canonicalTotals.tax &&
    roundStoredAmount(submittedTotals.total) === canonicalTotals.total
  );
}

function staleSaleTotalError() {
  return userError({
    code: "conflict" as const,
    message: "Sale total changed. Review the cart and take payment again.",
  });
}

// ---------------------------------------------------------------------------
// U7: server-side re-pricing + manager-override audit
//
// Both online completion paths previously recomputed totals from the
// client-supplied `item.price` and only checked internal arithmetic; the
// authoritative catalog price was never compared, so a stale-catalog or
// tampered terminal could sell at an arbitrary price with no attribution. The
// offline projection path already re-prices (`projectLocalEvents.ts`); U7 makes
// the online paths inherit the same basis, hard-rejecting an unauthorized
// deviation and requiring a manager override (with an append-only audit) for an
// authorized one.
// ---------------------------------------------------------------------------

const PRICE_OVERRIDE_ACTION = APPROVAL_ACTIONS.posPriceOverride;
const PRICE_OVERRIDE_SUBJECT_TYPE = "pos_price_override";

type RepricingLine = {
  skuId: Id<"productSku">;
  clientUnitPrice: number;
  provisionalImportedPrice?: number;
  displayName?: string;
  // Lines with no trusted catalog basis — an UNRESOLVED pending-checkout item
  // (pending_review/flagged) awaiting its own review workflow — carry an
  // operator-entered price with validated provenance and are recorded as-is.
  // Lines that resolve to a trusted catalog SKU (linked_to_catalog) are NOT
  // exempt: they must be re-priced against the approved SKU, matching the offline
  // authoritative path which also re-prices resolved pending lines.
  exemptFromReprice?: boolean;
};

type RepricingDeviation = {
  skuId: Id<"productSku">;
  basis: number;
  charged: number;
  delta: number;
};

type RepricingResult =
  | {
      kind: "priced";
      unitPrices: number[];
      deviations: RepricingDeviation[];
      approvedByStaffProfileId?: Id<"staffProfile">;
    }
  | { kind: "approval_required"; requirement: ApprovalRequirement }
  | { kind: "rejected"; error: ReturnType<typeof userError> };

/**
 * Derive the server-authoritative unit price for a sale line, matching the
 * offline projection basis exactly (`projectLocalEvents.ts` ~:3926):
 * `provisional.importedPrice ?? (netPrice if number else price)`.
 *
 * Unit note: the catalog `price`/`netPrice` and the client-supplied price are in
 * the same currency unit today (cedis, pre-U10). U7 compares like-for-like; when
 * U10 flips POS money storage to integer pesewas, both the catalog and the client
 * inputs move together, so this comparison stays consistent. Do not mix units.
 */
function deriveCatalogUnitPrice(
  sku: { price?: number; netPrice?: number } | null | undefined,
  provisionalImportedPrice: number | undefined,
): number | null {
  const basis =
    provisionalImportedPrice ??
    (typeof sku?.netPrice === "number" ? sku.netPrice : sku?.price);
  return typeof basis === "number" && Number.isFinite(basis) ? basis : null;
}

function buildPosPriceOverrideApprovalRequirement(args: {
  storeId: Id<"store">;
  deviations: RepricingDeviation[];
}): ApprovalRequirement {
  const totalDelta = roundStoredAmount(
    args.deviations.reduce((sum, deviation) => sum + deviation.delta, 0),
  );
  return {
    action: PRICE_OVERRIDE_ACTION,
    reason:
      "Manager approval is required to sell at a price that differs from the catalog.",
    requiredRole: "manager",
    selfApproval: "allowed",
    subject: {
      id: args.storeId,
      label: "POS sale price override",
      type: PRICE_OVERRIDE_SUBJECT_TYPE,
    },
    copy: {
      title: "Manager approval required",
      message:
        "A manager needs to approve selling at a price that differs from the catalog price.",
      primaryActionLabel: "Request approval",
      secondaryActionLabel: "Cancel",
    },
    resolutionModes: [{ kind: "inline_manager_proof" }],
    metadata: {
      deviationCount: args.deviations.length,
      totalDelta,
    },
  };
}

/**
 * Re-price every sale line against catalog authority. Returns the server-derived
 * unit price per line (basis for matched lines, the charged price for lines an
 * authorized manager explicitly overrode). An unauthorized deviation either
 * requests approval (no proof) or is hard-rejected (invalid proof). A line whose
 * catalog basis cannot be resolved is rejected rather than silently trusting the
 * client.
 */
async function resolveRepricedLines(
  ctx: MutationCtx,
  args: {
    storeId: Id<"store">;
    actorStaffProfileId?: Id<"staffProfile">;
    priceOverrideApprovalProofId?: Id<"approvalProof">;
    lines: RepricingLine[];
    getSku: (
      skuId: Id<"productSku">,
    ) => { price?: number; netPrice?: number } | null | undefined;
  },
): Promise<RepricingResult> {
  const unitPrices: number[] = [];
  const deviations: RepricingDeviation[] = [];

  for (const line of args.lines) {
    if (line.exemptFromReprice) {
      unitPrices.push(line.clientUnitPrice);
      continue;
    }
    const basis = deriveCatalogUnitPrice(
      args.getSku(line.skuId),
      line.provisionalImportedPrice,
    );
    if (basis === null) {
      return {
        kind: "rejected",
        error: userError({
          code: "precondition_failed",
          message: `Catalog price for ${line.displayName ?? "this item"} is unavailable. Refresh the register catalog before completing this sale.`,
        }),
      };
    }

    if (roundStoredAmount(line.clientUnitPrice) === roundStoredAmount(basis)) {
      // Record the server-derived basis (not the client echo) so a value that is
      // merely equal-after-rounding cannot slip a fractional cent into storage.
      unitPrices.push(basis);
    } else {
      deviations.push({
        skuId: line.skuId,
        basis,
        charged: line.clientUnitPrice,
        delta: roundStoredAmount(line.clientUnitPrice - basis),
      });
      unitPrices.push(line.clientUnitPrice);
    }
  }

  if (deviations.length === 0) {
    return { kind: "priced", unitPrices, deviations };
  }

  if (!args.priceOverrideApprovalProofId) {
    return {
      kind: "approval_required",
      requirement: buildPosPriceOverrideApprovalRequirement({
        storeId: args.storeId,
        deviations,
      }),
    };
  }

  const approvalProof = await consumeCommandApprovalProofWithCtx(ctx, {
    action: PRICE_OVERRIDE_ACTION,
    approvalProofId: args.priceOverrideApprovalProofId,
    requestedByStaffProfileId: args.actorStaffProfileId,
    requiredRole: "manager",
    storeId: args.storeId,
    subject: {
      type: PRICE_OVERRIDE_SUBJECT_TYPE,
      id: args.storeId,
    },
  });

  if (approvalProof.kind !== "ok") {
    return {
      kind: "rejected",
      error: userError({
        code: "precondition_failed",
        message: approvalProof.error.message,
      }),
    };
  }

  return {
    kind: "priced",
    unitPrices,
    deviations,
    approvedByStaffProfileId: approvalProof.data.approvedByStaffProfileId,
  };
}

/**
 * Append-only audit for an authorized price override (reuses the operational
 * event rail; no new table). Records the approver, each SKU's catalog basis, the
 * charged price, and the delta so a manager-authorized deviation is attributable.
 */
async function recordPriceOverrideAudit(
  ctx: MutationCtx,
  args: {
    storeId: Id<"store">;
    organizationId?: Id<"organization">;
    posTransactionId: Id<"posTransaction">;
    transactionNumber: string;
    registerSessionId?: Id<"registerSession">;
    requesterStaffProfileId?: Id<"staffProfile">;
    approvedByStaffProfileId?: Id<"staffProfile">;
    deviations: RepricingDeviation[];
  },
) {
  const totalDelta = roundStoredAmount(
    args.deviations.reduce((sum, deviation) => sum + deviation.delta, 0),
  );
  await recordOperationalEventWithCtx(ctx, {
    storeId: args.storeId,
    organizationId: args.organizationId,
    eventType: "pos_transaction_price_override",
    subjectType: "posTransaction",
    subjectId: args.posTransactionId,
    message: `POS sale #${args.transactionNumber} completed with a manager-approved price override (${args.deviations.length} line(s), net delta ${totalDelta}).`,
    metadata: {
      transactionNumber: args.transactionNumber,
      approvedByStaffProfileId: args.approvedByStaffProfileId,
      requesterStaffProfileId: args.requesterStaffProfileId,
      totalDelta,
      lines: args.deviations.map((deviation) => ({
        productSkuId: deviation.skuId,
        catalogBasis: deviation.basis,
        chargedPrice: deviation.charged,
        delta: deviation.delta,
      })),
    },
    actorStaffProfileId: args.approvedByStaffProfileId ?? args.requesterStaffProfileId,
    registerSessionId: args.registerSessionId,
    posTransactionId: args.posTransactionId,
  });
}

function registerSessionMatchesIdentity(
  registerSession: {
    terminalId?: Id<"posTerminal">;
  },
  identity: {
    terminalId?: Id<"posTerminal">;
  },
) {
  if (!identity.terminalId || !registerSession.terminalId) {
    return false;
  }

  return identity.terminalId === registerSession.terminalId;
}

function isUsableRegisterSession(registerSession: { status: string }) {
  return isPosUsableRegisterSessionStatus(registerSession.status);
}

async function listLinkedServicePaymentAllocationsForTransaction(
  ctx: MutationCtx,
  transaction: {
    _id: Id<"posTransaction">;
  },
) {
  // eslint-disable-next-line @convex-dev/no-collect-in-query -- Transaction-scoped service payment allocations are bounded by checkout payments and service lines; void preflight must inspect all linked allocations before mutating.
  const allocations = await ctx.db
    .query("paymentAllocation")
    .withIndex("by_posTransactionId", (q) =>
      q.eq("posTransactionId", transaction._id),
    )
    .collect();

  return allocations.filter(
    (allocation) =>
      allocation.targetType === "service_case" &&
      allocation.status === "recorded",
  );
}

async function resolveSessionRegisterSessionId(
  ctx: MutationCtx,
  args: {
    session: NonNullable<Awaited<ReturnType<typeof getPosSessionById>>>;
    providedRegisterSessionId?: Id<"registerSession">;
  },
): Promise<CommandResult<Id<"registerSession">>> {
  const resolvedRegisterSessionId =
    args.session.registerSessionId ?? args.providedRegisterSessionId;

  if (!resolvedRegisterSessionId) {
    return userError({
      code: "precondition_failed",
      message: "Open the cash drawer before completing this sale.",
    });
  }

  if (
    args.session.registerSessionId &&
    args.providedRegisterSessionId &&
    args.session.registerSessionId !== args.providedRegisterSessionId
  ) {
    return userError({
      code: "precondition_failed",
      message: "Open the cash drawer before completing this sale.",
    });
  }

  const registerSession = await getRegisterSessionById(
    ctx,
    resolvedRegisterSessionId,
  );

  if (
    !registerSession ||
    registerSession.storeId !== args.session.storeId ||
    !isUsableRegisterSession(registerSession) ||
    !registerSessionMatchesIdentity(registerSession, {
      terminalId: args.session.terminalId,
    })
  ) {
    return userError({
      code: "precondition_failed",
      message: "Open the cash drawer before completing this sale.",
    });
  }

  return ok(resolvedRegisterSessionId);
}

export async function recordRegisterSessionSale(
  ctx: MutationCtx,
  args: {
    changeGiven?: number;
    idempotencyKey?: string;
    payments: PosPaymentInput[];
    registerSessionId: Id<"registerSession">;
    registerNumber?: string;
    saleTotal?: number;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
    transactionId?: Id<"posTransaction">;
    transactionNumber?: string;
  },
) {
  await ctx.runMutation(
    internal.operations.registerSessions.recordRegisterSessionTransaction,
    {
      adjustmentKind: "sale",
      changeGiven: args.changeGiven,
      // U8: guard the drawer-cash increment with the same client-stable token so a
      // retried sale cannot double-count `expectedCash`, exactly as the void path
      // already does via `recordedTransactionKeys`.
      idempotencyKey: args.idempotencyKey,
      payments: args.payments,
      paymentCount: args.payments.length,
      paymentMethodLabels: paymentMethodLabels(args.payments),
      registerSessionId: args.registerSessionId,
      registerNumber: args.registerNumber,
      saleTotal: args.saleTotal,
      storeId: args.storeId,
      terminalId: args.terminalId,
      transactionId: args.transactionId,
      transactionNumber: args.transactionNumber,
    },
  );
}

/**
 * U8: namespace a client-supplied idempotency token for the online completion
 * paths. The `online:` prefix guarantees the token cannot collide with the
 * offline sync `localTransactionId` mapping namespace, so a sale can never be
 * double-recorded across the online and offline rails.
 */
export function onlineCompletionIdempotencyKey(rawToken: string): string {
  return rawToken.startsWith("online:") ? rawToken : `online:${rawToken}`;
}

/**
 * U8: dedup the transaction mint. If a completed sale already exists for this
 * store + idempotency token, return its identifiers (mirroring the offline
 * `resolveExistingSaleProjection` replay behaviour) so a retried submission does
 * not mint a second transaction, decrement stock again, or double the drawer cash.
 */
async function resolveExistingOnlineCompletion(
  ctx: MutationCtx,
  args: {
    storeId: Id<"store">;
    idempotencyKey: string;
  },
): Promise<{
  transactionId: Id<"posTransaction">;
  transactionNumber: string;
  transactionItems: Array<Id<"posTransactionItem">>;
} | null> {
  const existing = await getPosTransactionByIdempotencyKey(ctx, {
    storeId: args.storeId,
    idempotencyKey: args.idempotencyKey,
  });
  if (!existing) {
    return null;
  }
  const items = await listTransactionItems(ctx, existing._id);
  return {
    transactionId: existing._id,
    transactionNumber: existing.transactionNumber,
    transactionItems: items.map((item) => item._id),
  };
}

async function recordRegisterSessionVoid(
  ctx: MutationCtx,
  args: {
    changeGiven?: number;
    idempotencyKey: string;
    payments: PosPaymentInput[];
    registerSessionId: Id<"registerSession">;
    registerNumber?: string;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  },
) {
  await ctx.runMutation(
    internal.operations.registerSessions.recordRegisterSessionTransaction,
    {
      adjustmentKind: "void",
      changeGiven: args.changeGiven,
      idempotencyKey: args.idempotencyKey,
      payments: args.payments,
      registerSessionId: args.registerSessionId,
      registerNumber: args.registerNumber,
      storeId: args.storeId,
      terminalId: args.terminalId,
    },
  );
}

export async function updateInventory(
  ctx: MutationCtx,
  args: {
    skuId: Id<"productSku">;
    businessEventKey: string;
    quantityToSubtract: number;
  },
) {
  const sku = await getProductSkuById(ctx, args.skuId);
  if (!sku) {
    throw new Error("Product SKU not found");
  }

  if (sku.quantityAvailable < args.quantityToSubtract) {
    throw new Error("Insufficient inventory");
  }

  const store = await getStoreById(ctx, sku.storeId);
  if (!store?.organizationId) {
    throw new Error("POS inventory update organization could not be resolved.");
  }
  const now = Date.now();
  const effect = await applyCommerceInventoryEffectWithCtx(ctx, {
    activityType: "stock_pos_inventory_update",
    businessEventKey: args.businessEventKey,
    completeness: "partial",
    contentFingerprint: `pos-inventory-update-v1:${args.skuId}:${args.quantityToSubtract}`,
    disposition: "stock_correction",
    effectType: "adjustment",
    kind: "outbound",
    movementType: "pos_inventory_update",
    occurrenceAt: now,
    organizationId: store.organizationId,
    productId: sku.productId,
    productSkuId: args.skuId,
    quantity: args.quantityToSubtract,
    reasonCode: "pos_inventory_update",
    sellableQuantityDelta: -args.quantityToSubtract,
    sourceDomain: "pos",
    sourceId: args.businessEventKey,
    sourceType: "pos_inventory_update",
    storeId: sku.storeId,
  });

  return { success: true, newQuantity: effect.position.sellableQuantity };
}

export async function completeTransaction(
  ctx: MutationCtx,
  args: {
    storeId: Id<"store">;
    items: DirectTransactionItemInput[];
    payments: PosPaymentInput[];
    subtotal: number;
    tax: number;
    total: number;
    customerProfileId?: Id<"customerProfile">;
    customerInfo?: {
      name?: string;
      email?: string;
      phone?: string;
    };
    registerNumber?: string;
    terminalId?: Id<"posTerminal">;
    staffProfileId?: Id<"staffProfile">;
    registerSessionId?: Id<"registerSession">;
    idempotencyKey?: string;
    priceOverrideApprovalProofId?: Id<"approvalProof">;
  },
): Promise<
  ApprovalCommandResult<{
    transactionId: Id<"posTransaction">;
    transactionNumber: string;
    transactionItems: Array<Id<"posTransactionItem">>;
  }>
> {
  const idempotencyKey = args.idempotencyKey
    ? onlineCompletionIdempotencyKey(args.idempotencyKey)
    : undefined;
  if (idempotencyKey) {
    const existing = await resolveExistingOnlineCompletion(ctx, {
      storeId: args.storeId,
      idempotencyKey,
    });
    if (existing) {
      return ok(existing);
    }
  }
  // Client-arithmetic consistency: the submitted subtotal/tax/total must agree
  // with the client's own line prices. Server-authoritative re-pricing (U7)
  // happens below once catalog SKUs are loaded.
  const submittedTotals = calculateCanonicalTransactionTotals(args.items);
  if (
    !totalsMatch(
      {
        subtotal: args.subtotal,
        tax: args.tax,
        total: args.total,
      },
      submittedTotals,
    )
  ) {
    return staleSaleTotalError();
  }

  const skuQuantityMap = new Map<Id<"productSku">, number>();
  const skusById = new Map<
    Id<"productSku">,
    NonNullable<Awaited<ReturnType<typeof getProductSkuById>>>
  >();
  const provisionalImportLinesById = new Map<
    InventoryImportProvisionalSkuId,
    ActiveProvisionalImportSaleLine
  >();

  for (const item of args.items) {
    skuQuantityMap.set(
      item.skuId,
      (skuQuantityMap.get(item.skuId) || 0) + item.quantity,
    );
  }

  for (const [skuId, totalQuantity] of skuQuantityMap) {
    const sku = await getProductSkuById(ctx, skuId);
    if (!sku) {
      return userError({
        code: "not_found",
        message: `Product SKU ${skuId} not found.`,
      });
    }
    skusById.set(skuId, sku);

    const itemsForSku = args.items.filter((item) => item.skuId === skuId);
    const hasProvisionalImportLine = itemsForSku.some(
      (item) => item.inventoryImportProvisionalSkuId,
    );
    const hasTrustedInventoryLine = itemsForSku.some(
      (item) => !item.inventoryImportProvisionalSkuId,
    );
    if (hasProvisionalImportLine && hasTrustedInventoryLine) {
      return userError({
        code: "validation_failed",
        message:
          "This sale mixes provisional import and trusted inventory lines for the same SKU. Remove the item and add it again before continuing.",
      });
    }

    const submittedProvisionalSkuIds = Array.from(
      new Set(
        itemsForSku
          .map((item) => item.inventoryImportProvisionalSkuId)
          .filter(Boolean),
      ),
    ) as InventoryImportProvisionalSkuId[];
    if (submittedProvisionalSkuIds.length > 0) {
      for (const provisionalSkuId of submittedProvisionalSkuIds) {
        const provisionalSku = await readActiveProvisionalImportSkuForStoreSku(
          ctx,
          {
            storeId: args.storeId,
            productId: sku.productId,
            productSkuId: skuId,
            provisionalSkuId,
          },
        );

        if (!provisionalSku) {
          return userError({
            code: "precondition_failed",
            message:
              "This provisional import item is no longer active for this sale line. Refresh the register catalog before continuing.",
          });
        }

        provisionalImportLinesById.set(provisionalSku._id, provisionalSku);
      }

      continue;
    }

    if (sku.quantityAvailable < totalQuantity) {
      const itemName =
        args.items.find((item) => item.skuId === skuId)?.name ||
        "Unknown Product";
      return userError({
        code: "conflict",
        message: `Insufficient inventory for ${capitalizeWords(itemName)} (${sku.sku}). Available: ${sku.quantityAvailable}, Total Requested: ${totalQuantity}`,
      });
    }

    const availability = await validateInventoryAvailability(
      ctx.db,
      skuId,
      totalQuantity,
      {
        storeId: args.storeId,
      },
    );
    if (!availability.success) {
      return userError({
        code: "conflict",
        message:
          availability.message ??
          `Insufficient inventory for ${capitalizeWords(args.items.find((item) => item.skuId === skuId)?.name || "Unknown Product")} (${sku.sku}).`,
      });
    }
  }

  const referenceValidation = await validateDirectTransactionStoreReferences(
    ctx,
    {
      customerProfileId: args.customerProfileId,
      registerSessionId: args.registerSessionId,
      staffProfileId: args.staffProfileId,
      storeId: args.storeId,
      terminalId: args.terminalId,
      skus: [...skusById.values()],
    },
  );
  if (referenceValidation) {
    return referenceValidation;
  }

  if (args.payments.length === 0) {
    return userError({
      code: "validation_failed",
      message: "At least one payment is required.",
    });
  }

  if (args.registerSessionId && !args.terminalId) {
    return userError({
      code: "precondition_failed",
      message: "Register session transactions must include a terminal.",
    });
  }

  // U7: re-price every line against catalog authority before minting. Matched
  // lines record the server-derived basis; a deviation needs a manager override
  // (audited) or is hard-rejected. `canonicalTotals` is derived from these
  // authoritative prices, not the client echo.
  const repricing = await resolveRepricedLines(ctx, {
    storeId: args.storeId,
    actorStaffProfileId: args.staffProfileId,
    priceOverrideApprovalProofId: args.priceOverrideApprovalProofId,
    getSku: (skuId) => skusById.get(skuId),
    lines: args.items.map((item) => ({
      skuId: item.skuId,
      clientUnitPrice: item.price,
      provisionalImportedPrice: item.inventoryImportProvisionalSkuId
        ? provisionalImportLinesById.get(item.inventoryImportProvisionalSkuId)
            ?.importedPrice
        : undefined,
      displayName: item.name,
    })),
  });
  if (repricing.kind === "approval_required") {
    return approvalRequired(repricing.requirement);
  }
  if (repricing.kind === "rejected") {
    return repricing.error;
  }
  const derivedUnitPrices = repricing.unitPrices;
  const canonicalTotals = calculateCanonicalTransactionTotals(
    args.items.map((item, index) => ({
      price: derivedUnitPrices[index],
      quantity: item.quantity,
    })),
  );

  const totalPaid = calculateTotalPaid(args.payments);
  if (totalPaid < canonicalTotals.total) {
    return userError({
      code: "validation_failed",
      message: `Insufficient payment. Total: ${canonicalTotals.total.toFixed(2)}, Paid: ${totalPaid.toFixed(2)}`,
    });
  }

  const changeGiven =
    totalPaid > canonicalTotals.total
      ? totalPaid - canonicalTotals.total
      : undefined;
  const primaryPaymentMethod = args.payments[0]?.method || "cash";
  const transactionNumber = generateTransactionNumber();
  const completedAt = Date.now();

  const transactionId = await createPosTransaction(ctx, {
    transactionNumber,
    ...(idempotencyKey ? { idempotencyKey } : {}),
    storeId: args.storeId,
    sessionId: undefined,
    registerSessionId: args.registerSessionId,
    staffProfileId: args.staffProfileId,
    registerNumber: args.registerNumber,
    terminalId: args.terminalId,
    subtotal: canonicalTotals.subtotal,
    tax: canonicalTotals.tax,
    total: canonicalTotals.total,
    customerProfileId: args.customerProfileId,
    payments: args.payments,
    totalPaid,
    changeGiven,
    paymentMethod: primaryPaymentMethod,
    status: "completed",
    completedAt,
    customerInfo: args.customerInfo,
    receiptPrinted: false,
  });
  const store = await getStoreById(ctx, args.storeId);
  await appendCompletedPosLifecycleJournal(ctx, {
    completedAt,
    organizationId: store?.organizationId,
    storeId: args.storeId,
    totals: canonicalTotals,
    transactionId,
  });

  if (args.registerSessionId) {
    const sessionTerminalId = args.terminalId;

    if (!sessionTerminalId) {
      return userError({
        code: "precondition_failed",
        message: "Register session transactions must include a terminal.",
      });
    }

    await recordRegisterSessionSale(ctx, {
      changeGiven,
      idempotencyKey,
      payments: args.payments,
      registerSessionId: args.registerSessionId,
      registerNumber: args.registerNumber,
      saleTotal: canonicalTotals.total,
      storeId: args.storeId,
      terminalId: sessionTerminalId,
      transactionId,
      transactionNumber,
    });
  }

  const completionResult = buildCompleteTransactionResult({
    transactionId,
    transactionNumber,
    paymentAllocated: await recordRetailSalePaymentAllocations(ctx, {
      changeGiven,
      organizationId: store?.organizationId,
      payments: args.payments,
      posTransactionId: transactionId,
      registerSessionId: args.registerSessionId,
      storeId: args.storeId,
      transactionNumber,
    }),
  });

  if (completionResult.status !== "ok") {
    throw new Error(completionResult.message);
  }

  const provisionalQuantitiesSold = new Map<
    InventoryImportProvisionalSkuId,
    {
      provisionalSku: ActiveProvisionalImportSaleLine;
      quantitySold: number;
    }
  >();
  for (const item of args.items) {
    const provisionalSku = item.inventoryImportProvisionalSkuId
      ? provisionalImportLinesById.get(item.inventoryImportProvisionalSkuId)
      : undefined;
    if (!provisionalSku) continue;
    const existing = provisionalQuantitiesSold.get(provisionalSku._id);
    provisionalQuantitiesSold.set(provisionalSku._id, {
      provisionalSku,
      quantitySold: (existing?.quantitySold ?? 0) + item.quantity,
    });
  }

  const reportingProductIds = new Map<Id<"productSku">, Id<"product">>();
  const transactionItems = await Promise.all(
    args.items.map(async (item, index) => {
      const sku = await getProductSkuById(ctx, item.skuId);
      if (!sku) {
        throw new Error(
          `SKU ${item.skuId} not found during transaction processing`,
        );
      }
      reportingProductIds.set(item.skuId, sku.productId);

      const unitPrice = derivedUnitPrices[index];
      const image = item.image ?? sku.images?.[0];
      const provisionalSku = item.inventoryImportProvisionalSkuId
        ? provisionalImportLinesById.get(item.inventoryImportProvisionalSkuId)
        : undefined;
      const transactionItemId = await createPosTransactionItem(ctx, {
        transactionId,
        productId: sku.productId,
        productSkuId: item.skuId,
        ...(provisionalSku
          ? { inventoryImportProvisionalSkuId: provisionalSku._id }
          : {}),
        productName: item.name,
        productSku: item.sku,
        barcode: item.barcode,
        ...(image ? { image } : {}),
        quantity: item.quantity,
        unitPrice,
        totalPrice: unitPrice * item.quantity,
      });

      if (!provisionalSku) {
        await recordPosSaleInventoryMovement(ctx, {
          storeId: args.storeId,
          organizationId: store?.organizationId,
          productId: sku.productId,
          productSkuId: item.skuId,
          quantity: item.quantity,
          posTransactionId: transactionId,
          registerSessionId: args.registerSessionId,
          staffProfileId: args.staffProfileId,
          customerProfileId: args.customerProfileId,
          occurrenceAt: completedAt,
          sellableQuantityDelta: -item.quantity,
          sourceLineId: transactionItemId,
          transactionNumber,
        });
      }

      return transactionItemId;
    }),
  );
  for (const evidence of provisionalQuantitiesSold.values()) {
    await recordProvisionalImportSkuSaleEvidence(ctx, {
      provisionalSku: evidence.provisionalSku,
      posTransactionId: transactionId,
      registerSessionId: args.registerSessionId,
      quantitySold: evidence.quantitySold,
      timestamp: completedAt,
    });
  }

  await recordCompletedSaleOperationalEvent(ctx, {
    completedAt,
    changeGiven,
    customerProfileId: args.customerProfileId,
    lineCount: args.items.length,
    organizationId: store?.organizationId,
    payments: args.payments,
    posTransactionId: transactionId,
    registerSessionId: args.registerSessionId,
    staffProfileId: args.staffProfileId,
    storeCurrency: store?.currency,
    storeId: args.storeId,
    total: canonicalTotals.total,
    transactionNumber,
  });

  await appendCompletedPosSaleIngress(ctx, {
    acceptedAt: completedAt,
    items: args.items.map((item, index) => ({
      inventoryImportProvisionalSkuId:
        item.inventoryImportProvisionalSkuId,
      lineKey: String(transactionItems[index]),
      productId: reportingProductIds.get(item.skuId)!,
      productSkuId: item.skuId,
      quantity: item.quantity,
      totalAmountMinor: derivedUnitPrices[index] * item.quantity,
      unitPriceMinor: derivedUnitPrices[index],
    })),
    organizationId: store?.organizationId,
    storeCurrency: store?.currency,
    storeId: args.storeId,
    totals: canonicalTotals,
    transactionId,
  });

  if (repricing.deviations.length > 0) {
    await recordPriceOverrideAudit(ctx, {
      storeId: args.storeId,
      organizationId: store?.organizationId,
      posTransactionId: transactionId,
      transactionNumber,
      registerSessionId: args.registerSessionId,
      requesterStaffProfileId: args.staffProfileId,
      approvedByStaffProfileId: repricing.approvedByStaffProfileId,
      deviations: repricing.deviations,
    });
  }

  await markCatalogSummaryNeedsRefresh(ctx, args.storeId);

  return ok({
    transactionId: completionResult.data.transactionId,
    transactionNumber: completionResult.data.transactionNumber,
    transactionItems,
  });
}

const TRANSACTION_VOID_ACTION = APPROVAL_ACTIONS.transactionVoid;
const TRANSACTION_VOID_REQUEST_TYPE = "pos_transaction_void";
type VoidTransactionResult = {
  transactionId: Id<"posTransaction">;
  transactionNumber: string;
  voidedAt: number;
  paymentAllocationIds: Array<Id<"paymentAllocation">>;
  inventoryMovementIds: Array<Id<"inventoryMovement">>;
  operationalEventId?: Id<"operationalEvent">;
  approvalProofId?: Id<"approvalProof">;
  decisionApprovalProofId?: Id<"approvalProof">;
  approvalRequestId?: Id<"approvalRequest">;
  approverStaffProfileId?: Id<"staffProfile">;
};

function completedTransactionLabel(transaction: { transactionNumber: string }) {
  return `Transaction #${transaction.transactionNumber}`;
}

function buildVoidApprovalRequirement(args: {
  approvalRequestId?: Id<"approvalRequest">;
  reason?: string;
  requesterBinding?: ApprovalRequirement["requesterBinding"];
  transaction: {
    _id: Id<"posTransaction">;
    total: number;
    transactionNumber: string;
  };
}): ApprovalRequirement {
  return {
    action: TRANSACTION_VOID_ACTION,
    reason: "Manager approval is required to void a completed sale.",
    requiredRole: "manager",
    selfApproval: "allowed",
    subject: {
      id: args.transaction._id,
      label: completedTransactionLabel(args.transaction),
      type: "pos_transaction",
    },
    copy: {
      title: "Manager approval required",
      message:
        "A manager needs to review this completed sale void before it is applied.",
      primaryActionLabel: "Request approval",
      secondaryActionLabel: "Cancel",
    },
    resolutionModes: [
      { kind: "inline_manager_proof" },
      {
        kind: "async_request",
        requestType: TRANSACTION_VOID_REQUEST_TYPE,
        approvalRequestId: args.approvalRequestId,
      },
    ],
    ...(args.requesterBinding
      ? { requesterBinding: args.requesterBinding }
      : {}),
    metadata: {
      ...(args.reason ? { reason: args.reason } : {}),
      total: args.transaction.total,
      transactionNumber: args.transaction.transactionNumber,
    },
  };
}

async function findPendingVoidApprovalRequest(
  ctx: MutationCtx,
  args: {
    storeId: Id<"store">;
    transactionId: Id<"posTransaction">;
  },
) {
  const pendingRequests = await ctx.db
    .query("approvalRequest")
    .withIndex("by_storeId_status_posTransactionId", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("status", "pending")
        .eq("posTransactionId", args.transactionId),
    )
    .take(10);

  return (
    pendingRequests.find(
      (request) =>
        request.requestType === TRANSACTION_VOID_REQUEST_TYPE &&
        request.subjectType === "pos_transaction" &&
        request.subjectId === args.transactionId,
    ) ?? null
  );
}

async function createVoidApprovalRequest(
  ctx: MutationCtx,
  args: {
    actorStaffProfileId?: Id<"staffProfile">;
    actorUserId?: Id<"athenaUser">;
    reason?: string;
    transaction: NonNullable<Awaited<ReturnType<typeof getPosTransactionById>>>;
  },
) {
  const store = await getStoreById(ctx, args.transaction.storeId);
  const requesterBindingResult = args.actorStaffProfileId
    ? await createApprovalRequesterChallengeWithCtx(ctx, {
        actionKey: TRANSACTION_VOID_ACTION.key,
        organizationId: store?.organizationId,
        requestedByStaffProfileId: args.actorStaffProfileId,
        requiredRole: "manager",
        storeId: args.transaction.storeId,
        subject: {
          id: args.transaction._id,
          label: completedTransactionLabel(args.transaction),
          type: "pos_transaction",
        },
      })
    : null;

  if (requesterBindingResult?.kind === "user_error") {
    return requesterBindingResult;
  }

  const approvalRequestId = await ctx.db.insert(
    "approvalRequest",
    buildApprovalRequest({
      metadata: {
        actionKey: TRANSACTION_VOID_ACTION.key,
        transactionId: args.transaction._id,
        transactionNumber: args.transaction.transactionNumber,
        total: args.transaction.total,
      },
      ...(args.reason ? { notes: args.reason } : {}),
      organizationId: store?.organizationId,
      posTransactionId: args.transaction._id,
      reason: "Manager approval is required to void a completed sale.",
      registerSessionId: args.transaction.registerSessionId,
      requestType: TRANSACTION_VOID_REQUEST_TYPE,
      requestedByStaffProfileId: args.actorStaffProfileId,
      requestedByUserId: args.actorUserId,
      storeId: args.transaction.storeId,
      subjectId: args.transaction._id,
      subjectType: "pos_transaction",
    }),
  );

  await recordOperationalEventWithCtx(ctx, {
    actorStaffProfileId: args.actorStaffProfileId,
    actorUserId: args.actorUserId,
    approvalRequestId,
    customerProfileId: args.transaction.customerProfileId,
    eventType: "pos_transaction_void_approval_requested",
    message: `Void requested for ${completedTransactionLabel(args.transaction)}.`,
    metadata: {
      actionKey: TRANSACTION_VOID_ACTION.key,
      approvalMode: "async_approval",
      approvalRequestId,
      requiredRole: "manager",
      transactionNumber: args.transaction.transactionNumber,
      total: args.transaction.total,
    },
    posTransactionId: args.transaction._id,
    ...(args.reason ? { reason: args.reason } : {}),
    registerSessionId: args.transaction.registerSessionId,
    storeId: args.transaction.storeId,
    subjectId: args.transaction._id,
    subjectLabel: completedTransactionLabel(args.transaction),
    subjectType: "pos_transaction",
  });

  return ok({
    approvalRequestId,
    requesterBinding: requesterBindingResult?.data.requesterBinding,
  });
}

async function requireMatchingPendingVoidApprovalRequest(
  ctx: MutationCtx,
  args: {
    approvalRequestId?: Id<"approvalRequest">;
    storeId: Id<"store">;
    transactionId: Id<"posTransaction">;
  },
) {
  if (!args.approvalRequestId) {
    return null;
  }

  const approvalRequest = await ctx.db.get(
    "approvalRequest",
    args.approvalRequestId,
  );

  if (
    !approvalRequest ||
    approvalRequest.requestType !== TRANSACTION_VOID_REQUEST_TYPE ||
    approvalRequest.subjectType !== "pos_transaction"
  ) {
    return userError({
      code: "precondition_failed",
      message: "Void approval request not found.",
    });
  }

  if (approvalRequest.status !== "pending") {
    return userError({
      code: "precondition_failed",
      message: "Void approval request has already been decided.",
    });
  }

  if (
    approvalRequest.storeId !== args.storeId ||
    approvalRequest.subjectId !== args.transactionId
  ) {
    return userError({
      code: "precondition_failed",
      message: "Void approval request does not match this sale.",
    });
  }

  return ok(approvalRequest);
}

function completedDailyCloseRange(dailyClose: {
  operatingDate?: string;
  reportSnapshot?: {
    closeMetadata?: {
      startAt?: number;
      endAt?: number;
    };
  };
}) {
  const snapshotRange = dailyClose.reportSnapshot?.closeMetadata;
  if (
    typeof snapshotRange?.startAt === "number" &&
    typeof snapshotRange.endAt === "number"
  ) {
    return {
      startAt: snapshotRange.startAt,
      endAt: snapshotRange.endAt,
    };
  }

  if (
    typeof dailyClose.operatingDate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(dailyClose.operatingDate)
  ) {
    const startAt = Date.parse(`${dailyClose.operatingDate}T00:00:00.000Z`);
    if (Number.isFinite(startAt)) {
      return {
        startAt,
        endAt: startAt + 24 * 60 * 60 * 1000,
      };
    }
  }

  return null;
}

async function transactionFallsInCompletedDailyClose(
  ctx: MutationCtx,
  transaction: NonNullable<Awaited<ReturnType<typeof getPosTransactionById>>>,
) {
  const operatingDate = new Date(transaction.completedAt)
    .toISOString()
    .slice(0, 10);
  const completedCloses = await ctx.db
    .query("dailyClose")
    .withIndex("by_storeId_status_operatingDate", (q) =>
      q
        .eq("storeId", transaction.storeId)
        .eq("status", "completed")
        .eq("operatingDate", operatingDate),
    )
    .take(10);

  return completedCloses.some((dailyClose) => {
    if (
      dailyClose.lifecycleStatus !== undefined &&
      dailyClose.lifecycleStatus !== "active"
    ) {
      return false;
    }

    const range = completedDailyCloseRange(dailyClose);
    return (
      range !== null &&
      transaction.completedAt >= range.startAt &&
      transaction.completedAt < range.endAt
    );
  });
}

async function validateTransactionVoidPreconditions(
  ctx: MutationCtx,
  transaction: NonNullable<Awaited<ReturnType<typeof getPosTransactionById>>>,
  options?: {
    registerSessionPolicy?: "sale_usable" | "void_applicable";
  },
) {
  if (transaction.status === "void") {
    return userError({
      code: "conflict",
      message: "Sale is already voided.",
    });
  }

  if (transaction.status === "refunded") {
    return userError({
      code: "conflict",
      message: "Sale is already refunded.",
    });
  }

  if (transaction.status !== "completed") {
    return userError({
      code: "precondition_failed",
      message: "Only completed sales can be voided.",
    });
  }

  const adjustments = await listTransactionAdjustments(ctx, transaction._id);
  const blockingAdjustment = adjustments.find(
    (adjustment: { status?: string }) =>
      adjustment.status === "pending_approval" ||
      adjustment.status === "applied",
  );

  if (blockingAdjustment) {
    return userError({
      code: "precondition_failed",
      message:
        "This sale has item adjustments. Resolve the adjustment before voiding it.",
    });
  }

  if (await transactionFallsInCompletedDailyClose(ctx, transaction)) {
    return userError({
      code: "precondition_failed",
      message:
        "EOD Review is completed for this sale. Reopen EOD Review before voiding it.",
    });
  }

  if (!transaction.registerSessionId || !transaction.terminalId) {
    return userError({
      code: "precondition_failed",
      message: "Register sale is missing drawer context.",
    });
  }

  const registerSession = await getRegisterSessionById(
    ctx,
    transaction.registerSessionId,
  );

  const registerSessionPolicy =
    options?.registerSessionPolicy ?? "sale_usable";
  const registerSessionAllowed =
    registerSessionPolicy === "void_applicable"
      ? getRegisterSessionVoidApplicationStatus({
          registerSession,
          storeId: transaction.storeId,
          terminalId: transaction.terminalId,
        }).allowed
      : Boolean(
          registerSession &&
            registerSession.storeId === transaction.storeId &&
            registerSessionMatchesIdentity(registerSession, {
              terminalId: transaction.terminalId,
            }) &&
            isUsableRegisterSession(registerSession),
        );

  if (!registerSessionAllowed) {
    return userError({
      code: "precondition_failed",
      message: "Drawer closed. Open the drawer before voiding this sale.",
    });
  }

  const linkedServiceAllocations =
    await listLinkedServicePaymentAllocationsForTransaction(ctx, transaction);

  if (linkedServiceAllocations.length > 0) {
    return userError({
      code: "precondition_failed",
      message:
        "Mixed service sales cannot be voided from POS yet. Reverse the service payment in Service Ops before voiding the retail sale.",
    });
  }

  const items = await listTransactionItems(ctx, transaction._id);
  const skuRows = [];

  for (const item of items) {
    const sku = await getProductSkuById(ctx, item.productSkuId);

    if (!sku || (sku.storeId && sku.storeId !== transaction.storeId)) {
      return userError({
        code: "precondition_failed",
        message:
          "Sale item inventory record not found. Review inventory before voiding this sale.",
      });
    }

    skuRows.push({ item, sku });
  }

  return ok({ items: skuRows });
}

async function applyApprovedTransactionVoid(
  ctx: MutationCtx,
  args: {
    approvalMode: "inline_manager_proof" | "async_approval_request";
    approvalProofId?: Id<"approvalProof">;
    decisionApprovalProofId?: Id<"approvalProof">;
    decisionApprovedByStaffProfileId?: Id<"staffProfile">;
    approvalRequestId?: Id<"approvalRequest">;
    approverStaffProfileId: Id<"staffProfile">;
    items: Array<{
      item: Awaited<ReturnType<typeof listTransactionItems>>[number];
      sku: NonNullable<Awaited<ReturnType<typeof getProductSkuById>>>;
    }>;
    reason?: string;
    requesterStaffProfileId?: Id<"staffProfile">;
    requesterUserId?: Id<"athenaUser">;
    reviewerUserId?: Id<"athenaUser">;
    transaction: NonNullable<Awaited<ReturnType<typeof getPosTransactionById>>>;
  },
): Promise<CommandResult<VoidTransactionResult>> {
  const registerSessionId = args.transaction.registerSessionId;
  const terminalId = args.transaction.terminalId;
  if (!registerSessionId || !terminalId) {
    return userError({
      code: "precondition_failed",
      message: "Register sale is missing drawer context.",
    });
  }

  const approvalEvent = await recordOperationalEventWithCtx(ctx, {
    actorStaffProfileId: args.approverStaffProfileId,
    actorUserId: args.reviewerUserId ?? args.requesterUserId,
    approvalRequestId: args.approvalRequestId,
    customerProfileId: args.transaction.customerProfileId,
    eventType: "pos_transaction_void_approval_proof_consumed",
    message: `Manager approval proof consumed for ${completedTransactionLabel(args.transaction)} void.`,
    metadata: {
      actionKey: TRANSACTION_VOID_ACTION.key,
      approvalMode: args.approvalMode,
      ...(args.approvalProofId
        ? { approvalProofId: args.approvalProofId }
        : {}),
      ...(args.decisionApprovalProofId
        ? { decisionApprovalProofId: args.decisionApprovalProofId }
        : {}),
      ...(args.decisionApprovedByStaffProfileId
        ? {
            decisionApprovedByStaffProfileId:
              args.decisionApprovedByStaffProfileId,
          }
        : {}),
      approverStaffProfileId: args.approverStaffProfileId,
      requesterStaffProfileId: args.requesterStaffProfileId,
      reviewerUserId: args.reviewerUserId,
      transactionNumber: args.transaction.transactionNumber,
    },
    posTransactionId: args.transaction._id,
    ...(args.reason ? { reason: args.reason } : {}),
    registerSessionId,
    storeId: args.transaction.storeId,
    subjectId: args.transaction._id,
    subjectLabel: completedTransactionLabel(args.transaction),
    subjectType: "pos_transaction",
  });

  await recordRegisterSessionVoid(ctx, {
    changeGiven: args.transaction.changeGiven,
    idempotencyKey: `posTransaction:${args.transaction._id}:void`,
    payments: args.transaction.payments,
    registerSessionId,
    registerNumber: args.transaction.registerNumber,
    storeId: args.transaction.storeId,
    terminalId,
  });

  const store = await getStoreById(ctx, args.transaction.storeId);
  const paymentAllocations = await recordRetailVoidPaymentAllocations(ctx, {
    changeGiven: args.transaction.changeGiven,
    organizationId: store?.organizationId,
    payments: args.transaction.payments,
    posTransactionId: args.transaction._id,
    registerSessionId,
    storeId: args.transaction.storeId,
    transactionNumber: args.transaction.transactionNumber,
  });

  const inventoryMovementIds: Array<Id<"inventoryMovement">> = [];
  const voidedAt = Date.now();

  const voidInventoryBySku = new Map<
    Id<"productSku">,
    {
      productId: Id<"product">;
      productSkuId: Id<"productSku">;
      quantity: number;
      transactionItemIds: Array<Id<"posTransactionItem">>;
    }
  >();

  for (const { item, sku } of args.items) {
    if (item.pendingCheckoutItemId || item.inventoryImportProvisionalSkuId) {
      continue;
    }

    const existing = voidInventoryBySku.get(item.productSkuId);
    if (existing) {
      existing.quantity += item.quantity;
      existing.transactionItemIds.push(item._id);
      continue;
    }

    voidInventoryBySku.set(item.productSkuId, {
      productId: item.productId ?? sku.productId,
      productSkuId: item.productSkuId,
      quantity: item.quantity,
      transactionItemIds: [item._id],
    });
  }

  for (const entry of voidInventoryBySku.values()) {
    if (!store?.organizationId) {
      throw new Error("POS void organization could not be resolved.");
    }
    const originalEffects = await Promise.all(
      entry.transactionItemIds.map((transactionItemId) =>
        ctx.db
          .query("reportingInventoryEffect")
          .withIndex("by_storeId_sourceDomain_businessEventKey", (q) =>
            q
              .eq("storeId", args.transaction.storeId)
              .eq("sourceDomain", "pos")
              .eq(
                "businessEventKey",
                `pos:${args.transaction._id}:line:${transactionItemId}:sale`,
              ),
          )
          .first(),
      ),
    );
    const originalBases = originalEffects.map((effect, index) => {
      const sourceItem = args.items.find(
        ({ item }) => item._id === entry.transactionItemIds[index],
      )?.item;
      return effect && sourceItem
        ? outboundBasisFromEffect(effect, sourceItem.quantity)
        : null;
    });
    const currencies = new Set(
      originalBases
        .map((basis) => basis?.currency)
        .filter((currency): currency is string => Boolean(currency)),
    );
    const originalBasis =
      originalBases.every(Boolean) && currencies.size <= 1
        ? {
            allocatedKnownCost: originalBases.reduce(
              (sum, basis) => sum + (basis?.allocatedKnownCost ?? 0),
              0,
            ),
            basisVersion: 0,
            costedQuantity: originalBases.reduce(
              (sum, basis) => sum + (basis?.costedQuantity ?? 0),
              0,
            ),
            currency: [...currencies][0] ?? null,
            knownCostPoolBefore: originalBases.reduce(
              (sum, basis) => sum + (basis?.allocatedKnownCost ?? 0),
              0,
            ),
            roundedWeightedAverageUnitCost: null,
            uncostedQuantity: originalBases.reduce(
              (sum, basis) => sum + (basis?.uncostedQuantity ?? 0),
              0,
            ),
            unresolvedDeficitQuantity: 0,
          }
        : uncostedOutboundBasis(entry.quantity);
    const movementResult = await applyCommerceInventoryEffectWithCtx(ctx, {
      activityType: "stock_pos_transaction_void",
      storeId: args.transaction.storeId,
      organizationId: store.organizationId,
      businessEventKey: `pos:${args.transaction._id}:sku:${entry.productSkuId}:void`,
      contentFingerprint: `pos-void-inventory-v1:${args.transaction._id}:${entry.productSkuId}:${entry.quantity}`,
      effectType: "return",
      kind: "return",
      movementType: "pos_transaction_void",
      sourceType: "posTransaction",
      sourceId: args.transaction._id,
      occurrenceAt: voidedAt,
      originalBasis,
      quantity: entry.quantity,
      productId: entry.productId,
      productSkuId: entry.productSkuId,
      actorUserId: args.requesterUserId,
      actorStaffProfileId: args.requesterStaffProfileId,
      customerProfileId: args.transaction.customerProfileId,
      registerSessionId: args.transaction.registerSessionId,
      posTransactionId: args.transaction._id,
      reasonCode: "pos_transaction_void",
      sellableQuantityDelta: entry.quantity,
      sourceDomain: "pos",
      notes: `Void ${args.transaction.transactionNumber}`,
    });
    const movement = movementResult.movement;

    if (movement?._id) {
      inventoryMovementIds.push(movement._id);
    }

  }

  const pendingVoidCorrections = new Map<
    Id<"posPendingCheckoutItem">,
    { pendingCheckoutItemId: Id<"posPendingCheckoutItem">; quantityDelta: number }
  >();
  for (const { item } of args.items) {
    if (!item.pendingCheckoutItemId) {
      continue;
    }

    const existing = pendingVoidCorrections.get(item.pendingCheckoutItemId);
    pendingVoidCorrections.set(item.pendingCheckoutItemId, {
      pendingCheckoutItemId: item.pendingCheckoutItemId,
      quantityDelta: (existing?.quantityDelta ?? 0) - item.quantity,
    });
  }

  for (const correction of pendingVoidCorrections.values()) {
    await recordPendingCheckoutItemEvidenceCorrection(ctx, {
      actorStaffProfileId: args.requesterStaffProfileId,
      actorUserId: args.requesterUserId,
      pendingCheckoutItemId: correction.pendingCheckoutItemId,
      posTransactionId: args.transaction._id,
      quantityDelta: correction.quantityDelta,
      reason: "transaction_void",
      storeId: args.transaction.storeId,
      timestamp: Date.now(),
      transactionCountDelta: -1,
    });
  }

  const paymentAllocationIds = paymentAllocations
    .map((allocation) => allocation?._id)
    .filter(Boolean) as Array<Id<"paymentAllocation">>;

  const event = await recordOperationalEventWithCtx(ctx, {
    actorStaffProfileId: args.requesterStaffProfileId,
    actorUserId: args.requesterUserId,
    approvalRequestId: args.approvalRequestId,
    customerProfileId: args.transaction.customerProfileId,
    eventType: "pos_transaction_voided",
    message: `Voided ${completedTransactionLabel(args.transaction)}.`,
    metadata: {
      actionKey: TRANSACTION_VOID_ACTION.key,
      approvalMode: args.approvalMode,
      approvalOperationalEventId: approvalEvent?._id,
      ...(args.approvalProofId
        ? { approvalProofId: args.approvalProofId }
        : {}),
      ...(args.decisionApprovalProofId
        ? { decisionApprovalProofId: args.decisionApprovalProofId }
        : {}),
      ...(args.decisionApprovedByStaffProfileId
        ? {
            decisionApprovedByStaffProfileId:
              args.decisionApprovedByStaffProfileId,
          }
        : {}),
      approverStaffProfileId: args.approverStaffProfileId,
      inventoryMovementIds,
      paymentAllocationIds,
      requesterStaffProfileId: args.requesterStaffProfileId,
      reviewerUserId: args.reviewerUserId,
      representation:
        "preserve_original_sale_with_payment_register_inventory_reversal",
      transactionNumber: args.transaction.transactionNumber,
    },
    posTransactionId: args.transaction._id,
    ...(args.reason ? { reason: args.reason } : {}),
    registerSessionId: args.transaction.registerSessionId,
    storeId: args.transaction.storeId,
    subjectId: args.transaction._id,
    subjectLabel: completedTransactionLabel(args.transaction),
    subjectType: "pos_transaction",
  });

  await patchPosTransaction(ctx, args.transaction._id, {
    status: "void",
    voidedAt,
    voidReason: args.reason,
    voidedByStaffProfileId: args.requesterStaffProfileId,
    voidApprovalProofId: args.approvalProofId,
    voidDecisionApprovalProofId: args.decisionApprovalProofId,
    voidApprovalRequestId: args.approvalRequestId,
    voidApprovedByStaffProfileId: args.approverStaffProfileId,
    voidOperationalEventId: event?._id,
  });

  if (!store?.organizationId) {
    throw new Error("Voided POS sale organization could not be resolved.");
  }
  await appendPosLifecycleJournalWithCtx(ctx, {
    organizationId: store.organizationId,
    storeId: args.transaction.storeId,
    transactionId: args.transaction._id,
    eventKind: "voided",
    eventKey: `pos:${args.transaction._id}:void`,
    contentFingerprint: [
      "pos-lifecycle-void-v1",
      args.transaction._id,
      voidedAt,
      args.transaction.subtotal,
      args.transaction.tax,
      args.transaction.total,
    ].join(":"),
    occurredAt: voidedAt,
    origin: "cloud",
  });

  await appendPosVoidIngress(ctx, {
    acceptedAt: voidedAt,
    items: args.items,
    organizationId: store?.organizationId,
    storeCurrency: store?.currency,
    transaction: args.transaction,
  });

  await markCatalogSummaryNeedsRefresh(ctx, args.transaction.storeId);

  return ok({
    transactionId: args.transaction._id,
    transactionNumber: args.transaction.transactionNumber,
    voidedAt,
    paymentAllocationIds,
    inventoryMovementIds,
    operationalEventId: event?._id,
    approvalProofId: args.approvalProofId,
    decisionApprovalProofId: args.decisionApprovalProofId,
    approvalRequestId: args.approvalRequestId,
    approverStaffProfileId: args.approverStaffProfileId,
  });
}

export async function voidTransaction(
  ctx: MutationCtx,
  args: {
    actorStaffProfileId?: Id<"staffProfile">;
    actorUserId?: Id<"athenaUser">;
    approvalProofId?: Id<"approvalProof">;
    approvalRequestId?: Id<"approvalRequest">;
    transactionId: Id<"posTransaction">;
    reason?: string;
    staffProfileId?: Id<"staffProfile">;
  },
): Promise<ApprovalCommandResult<VoidTransactionResult>> {
  const actorStaffProfileId = args.actorStaffProfileId ?? args.staffProfileId;
  const transaction = await getPosTransactionById(ctx, args.transactionId);
  if (!transaction) {
    return userError({
      code: "not_found",
      message: "Transaction not found.",
    });
  }

  const reason = args.reason?.trim() || undefined;
  if (!reason) {
    return userError({
      code: "validation_failed",
      message: "Reason is required before voiding a completed sale.",
    });
  }

  const preconditions = await validateTransactionVoidPreconditions(
    ctx,
    transaction,
  );
  if (preconditions.kind !== "ok") {
    return preconditions;
  }

  if (!args.approvalProofId) {
    const existingApprovalRequest = await findPendingVoidApprovalRequest(ctx, {
      storeId: transaction.storeId,
      transactionId: transaction._id,
    });
    const createdApprovalRequest = existingApprovalRequest
      ? null
      : await createVoidApprovalRequest(ctx, {
        actorStaffProfileId,
        actorUserId: args.actorUserId,
        reason,
        transaction,
      });

    if (createdApprovalRequest?.kind === "user_error") {
      return createdApprovalRequest;
    }

    const existingRequesterBindingResult =
      existingApprovalRequest?.requestedByStaffProfileId
        ? await createApprovalRequesterChallengeWithCtx(ctx, {
            actionKey: TRANSACTION_VOID_ACTION.key,
            requestedByStaffProfileId:
              existingApprovalRequest.requestedByStaffProfileId,
            requiredRole: "manager",
            storeId: transaction.storeId,
            subject: {
              id: transaction._id,
              label: completedTransactionLabel(transaction),
              type: "pos_transaction",
            },
          })
        : null;

    if (existingRequesterBindingResult?.kind === "user_error") {
      return existingRequesterBindingResult;
    }

    return approvalRequired(
      buildVoidApprovalRequirement({
        approvalRequestId:
          existingApprovalRequest?._id ??
          createdApprovalRequest?.data.approvalRequestId,
        reason,
        requesterBinding:
          existingRequesterBindingResult?.data.requesterBinding ??
          createdApprovalRequest?.data.requesterBinding,
        transaction,
      }),
    );
  }

  const matchingApprovalRequest =
    await requireMatchingPendingVoidApprovalRequest(ctx, {
      approvalRequestId: args.approvalRequestId,
      storeId: transaction.storeId,
      transactionId: transaction._id,
    });
  if (matchingApprovalRequest?.kind === "user_error") {
    return matchingApprovalRequest;
  }

  const approvalProof = await consumeCommandApprovalProofWithCtx(ctx, {
    action: TRANSACTION_VOID_ACTION,
    approvalProofId: args.approvalProofId,
    requestedByStaffProfileId:
      matchingApprovalRequest?.kind === "ok"
        ? matchingApprovalRequest.data.requestedByStaffProfileId
        : actorStaffProfileId,
    requiredRole: "manager",
    storeId: transaction.storeId,
    subject: {
      type: "pos_transaction",
      id: transaction._id,
    },
  });

  if (approvalProof.kind !== "ok") {
    return userError({
      code: "precondition_failed",
      message: approvalProof.error.message,
    });
  }

  return applyApprovedTransactionVoid(ctx, {
    approvalMode: "inline_manager_proof",
    approvalProofId: approvalProof.data.approvalProofId,
    decisionApprovalProofId: approvalProof.data.approvalProofId,
    approvalRequestId:
      matchingApprovalRequest?.kind === "ok"
        ? matchingApprovalRequest.data._id
        : undefined,
    approverStaffProfileId: approvalProof.data.approvedByStaffProfileId,
    decisionApprovedByStaffProfileId: approvalProof.data.approvedByStaffProfileId,
    items: preconditions.data.items,
    reason,
    requesterStaffProfileId: actorStaffProfileId,
    requesterUserId: args.actorUserId,
    transaction,
  }).then(async (result) => {
    if (result.kind === "ok" && matchingApprovalRequest?.kind === "ok") {
      await ctx.db.patch("approvalRequest", matchingApprovalRequest.data._id, {
        status: "approved",
        reviewedByStaffProfileId: approvalProof.data.approvedByStaffProfileId,
        decisionApprovalProofId: approvalProof.data.approvalProofId,
        decisionApprovedByStaffProfileId:
          approvalProof.data.approvedByStaffProfileId,
        decisionNotes: reason,
        decidedAt: result.data.voidedAt,
      });
    }

    return result;
  });
}

export async function resolveTransactionVoidApprovalDecisionWithCtx(
  ctx: MutationCtx,
  args: {
    approvalProofId?: Id<"approvalProof">;
    approvalRequestId: Id<"approvalRequest">;
    decisionApprovedByStaffProfileId?: Id<"staffProfile">;
    decisionApprovalProofId?: Id<"approvalProof">;
    decision: "approved" | "rejected" | "cancelled";
    decisionNotes?: string;
    reviewedByStaffProfileId?: Id<"staffProfile">;
    reviewedByUserId?: Id<"athenaUser">;
  },
) {
  const approvalRequest = await ctx.db.get(
    "approvalRequest",
    args.approvalRequestId,
  );

  if (
    !approvalRequest ||
    approvalRequest.requestType !== TRANSACTION_VOID_REQUEST_TYPE ||
    approvalRequest.subjectType !== "pos_transaction"
  ) {
    throw new Error("Void approval request not found.");
  }

  if (args.decision !== "approved") {
    return null;
  }

  const approverStaffProfileId =
    args.decisionApprovedByStaffProfileId ?? args.reviewedByStaffProfileId;
  const decisionApprovalProofId =
    args.decisionApprovalProofId ?? args.approvalProofId;

  if (!decisionApprovalProofId || !approverStaffProfileId) {
    throw new Error("Manager approval is required to void a completed sale.");
  }

  const transactionId = approvalRequest.posTransactionId ?? approvalRequest.subjectId;
  if (!transactionId) {
    throw new Error("Void approval request is missing transaction details.");
  }

  const transaction = await getPosTransactionById(
    ctx,
    transactionId as Id<"posTransaction">,
  );
  if (!transaction) {
    throw new Error("Transaction not found.");
  }

  const matchingApprovalRequest =
    await requireMatchingPendingVoidApprovalRequest(ctx, {
      approvalRequestId: args.approvalRequestId,
      storeId: transaction.storeId,
      transactionId: transaction._id,
    });
  if (matchingApprovalRequest?.kind === "user_error") {
    throw new Error(matchingApprovalRequest.error.message);
  }

  const preconditions = await validateTransactionVoidPreconditions(
    ctx,
    transaction,
    {
      registerSessionPolicy: "void_applicable",
    },
  );
  if (preconditions.kind !== "ok") {
    throw new Error(preconditions.error.message);
  }

  const result = await applyApprovedTransactionVoid(ctx, {
    approvalMode: "async_approval_request",
    decisionApprovalProofId,
    decisionApprovedByStaffProfileId: approverStaffProfileId,
    approvalRequestId: args.approvalRequestId,
    approverStaffProfileId,
    items: preconditions.data.items,
    reason:
      args.decisionNotes?.trim() ||
      approvalRequest.notes?.trim() ||
      undefined,
    requesterStaffProfileId: approvalRequest.requestedByStaffProfileId,
    requesterUserId: approvalRequest.requestedByUserId,
    reviewerUserId: args.reviewedByUserId,
    transaction,
  });

  if (result.kind !== "ok") {
    throw new Error(result.error.message);
  }

  return result.data;
}

export async function createTransactionFromSessionHandler(
  ctx: MutationCtx,
  args: {
    sessionId: Id<"posSession">;
    staffProfileId: Id<"staffProfile">;
    payments: PosPaymentInput[];
    registerSessionId?: Id<"registerSession">;
    recordRegisterSale?: boolean;
    notes?: string;
    submittedTotals?: TransactionTotals;
    idempotencyKey?: string;
    priceOverrideApprovalProofId?: Id<"approvalProof">;
  },
): Promise<
  ApprovalCommandResult<{
    transactionId: Id<"posTransaction">;
    transactionNumber: string;
    transactionItems: Array<Id<"posTransactionItem">>;
  }>
> {
  const session = await getPosSessionById(ctx, args.sessionId);
  if (!session) {
    return userError({
      code: "not_found",
      message: "Session not found.",
    });
  }

  if (session.staffProfileId !== args.staffProfileId) {
    return userError({
      code: "precondition_failed",
      message: "This session is not associated with your cashier.",
    });
  }

  const idempotencyKey = args.idempotencyKey
    ? onlineCompletionIdempotencyKey(args.idempotencyKey)
    : undefined;
  if (idempotencyKey) {
    const existing = await resolveExistingOnlineCompletion(ctx, {
      storeId: session.storeId,
      idempotencyKey,
    });
    if (existing) {
      return ok(existing);
    }
  }

  const items = await listSessionItems(ctx, args.sessionId);
  if (items.length === 0) {
    return userError({
      code: "precondition_failed",
      message: "Cannot complete session with no items.",
    });
  }

  // Client-arithmetic consistency against the session's own line prices; U7
  // server-authoritative re-pricing happens below once catalog SKUs are loaded.
  const submittedComputedTotals = calculateCanonicalTransactionTotals(
    items.map((item) => ({
      price: item.price,
      quantity: item.quantity,
    })),
  );
  if (
    args.submittedTotals &&
    !totalsMatch(args.submittedTotals, submittedComputedTotals)
  ) {
    return staleSaleTotalError();
  }

  const resolvedRegisterSessionId = await resolveSessionRegisterSessionId(ctx, {
    session,
    providedRegisterSessionId: args.registerSessionId,
  });
  if (resolvedRegisterSessionId.kind === "user_error") {
    return resolvedRegisterSessionId;
  }

  const skuQuantityMap = new Map<Id<"productSku">, number>();
  const linkedPendingTrustedItemIds = new Set<Id<"posPendingCheckoutItem">>();
  const provisionalImportLinesById = new Map<
    InventoryImportProvisionalSkuId,
    ActiveProvisionalImportSaleLine
  >();
  const provisionalImportSkuIdsBySkuId = new Set<Id<"productSku">>();
  for (const item of items) {
    if (item.pendingCheckoutItemId) {
      const pendingItem = await ctx.db.get(
        "posPendingCheckoutItem",
        item.pendingCheckoutItemId,
      );
      if (
        pendingItem?.storeId === session.storeId &&
        pendingItem.status === "linked_to_catalog" &&
        pendingItem.approvedProductId === item.productId &&
        pendingItem.approvedProductSkuId === item.productSkuId
      ) {
        linkedPendingTrustedItemIds.add(item.pendingCheckoutItemId);
        skuQuantityMap.set(
          item.productSkuId,
          (skuQuantityMap.get(item.productSkuId) || 0) + item.quantity,
        );
        continue;
      }

      if (
        !pendingItem ||
        pendingItem.storeId !== session.storeId ||
        (pendingItem.status !== "pending_review" &&
          pendingItem.status !== "flagged") ||
        pendingItem.provisionalProductId !== item.productId ||
        pendingItem.provisionalProductSkuId !== item.productSkuId
      ) {
        return userError({
          code: "conflict",
          message:
            "This pending checkout item no longer matches the sale line. Add it again before completing the sale.",
        });
      }
      continue;
    }

    if (item.inventoryImportProvisionalSkuId) {
      const provisionalSku = await readActiveProvisionalImportSkuForStoreSku(ctx, {
        storeId: session.storeId,
        productId: item.productId,
        productSkuId: item.productSkuId,
        provisionalSkuId: item.inventoryImportProvisionalSkuId,
      });
      if (provisionalSku) {
        provisionalImportLinesById.set(
          item.inventoryImportProvisionalSkuId,
          provisionalSku,
        );
        provisionalImportSkuIdsBySkuId.add(item.productSkuId);
        continue;
      }
      return userError({
        code: "conflict",
        message:
          "This provisional import item is no longer active for this sale line. Refresh the register catalog before completing the sale.",
      });
    }

    skuQuantityMap.set(
      item.productSkuId,
      (skuQuantityMap.get(item.productSkuId) || 0) + item.quantity,
    );
  }

  for (const skuId of skuQuantityMap.keys()) {
    if (provisionalImportSkuIdsBySkuId.has(skuId)) {
      return userError({
        code: "validation_failed",
        message:
          "This sale mixes provisional import and trusted inventory lines for the same SKU. Remove the item and add it again before continuing.",
      });
    }
  }

  for (const [skuId, totalQuantity] of skuQuantityMap) {
    const sku = await getProductSkuById(ctx, skuId);
    if (!sku) {
      return userError({
        code: "not_found",
        message: `Product SKU ${skuId} not found.`,
      });
    }

    if (sku.inventoryCount < totalQuantity) {
      const item = items.find(
        (sessionItem) => sessionItem.productSkuId === skuId,
      );
      return userError({
        code: "conflict",
        message: `Insufficient inventory for ${capitalizeWords(item?.productName || "Unknown Product")} (${sku.sku}). In Stock: ${sku.inventoryCount}, Needed: ${totalQuantity}`,
      });
    }

    const availability = await validateInventoryAvailability(
      ctx.db,
      skuId,
      totalQuantity,
      {
        storeId: session.storeId,
        sessionId: args.sessionId,
      },
    );
    if (!availability.success) {
      const item = items.find(
        (sessionItem) => sessionItem.productSkuId === skuId,
      );
      return userError({
        code: "conflict",
        message:
          availability.message ??
          `Insufficient inventory for ${capitalizeWords(item?.productName || "Unknown Product")} (${sku.sku}).`,
      });
    }
  }

  if (session.inventoryHoldMode === "ledger") {
    const heldQuantities = await readActiveInventoryHoldQuantitiesForSession(
      ctx.db,
      {
        sessionId: args.sessionId,
        now: Date.now(),
      },
    );

    for (const [skuId, totalQuantity] of skuQuantityMap) {
      const heldQuantity = heldQuantities.get(skuId) ?? 0;
      if (heldQuantity < totalQuantity) {
        const item = items.find(
          (sessionItem) => sessionItem.productSkuId === skuId,
        );
        return userError({
          code: "conflict",
          message: `Inventory hold expired for ${capitalizeWords(item?.productName || "Unknown Product")}. Scan it again before completing this sale.`,
        });
      }
    }
  }

  if (args.payments.length === 0) {
    return userError({
      code: "validation_failed",
      message: "At least one payment is required.",
    });
  }

  // U7: re-price every session line against catalog authority before minting.
  const repricingSkuById = new Map<
    Id<"productSku">,
    { price?: number; netPrice?: number } | null
  >();
  for (const item of items) {
    if (!repricingSkuById.has(item.productSkuId)) {
      repricingSkuById.set(
        item.productSkuId,
        await getProductSkuById(ctx, item.productSkuId),
      );
    }
  }
  const repricing = await resolveRepricedLines(ctx, {
    storeId: session.storeId,
    actorStaffProfileId: args.staffProfileId,
    priceOverrideApprovalProofId: args.priceOverrideApprovalProofId,
    getSku: (skuId) => repricingSkuById.get(skuId),
    lines: items.map((item) => ({
      skuId: item.productSkuId,
      clientUnitPrice: item.price,
      provisionalImportedPrice: item.inventoryImportProvisionalSkuId
        ? provisionalImportLinesById.get(item.inventoryImportProvisionalSkuId)
            ?.importedPrice
        : undefined,
      displayName: item.productName,
      // Only an UNRESOLVED pending-checkout line (pending_review/flagged) carries
      // an operator-entered price with no catalog basis and is exempt. A
      // linked_to_catalog line resolves to a trusted catalog SKU
      // (`approvedProductSkuId === item.productSkuId`) and MUST be re-priced
      // against it — the offline authoritative path re-prices these too, so
      // exempting them would let a tampered terminal sell a real catalog item at
      // an arbitrary price with no override or audit.
      exemptFromReprice: Boolean(
        item.pendingCheckoutItemId &&
          !linkedPendingTrustedItemIds.has(item.pendingCheckoutItemId),
      ),
    })),
  });
  if (repricing.kind === "approval_required") {
    return approvalRequired(repricing.requirement);
  }
  if (repricing.kind === "rejected") {
    return repricing.error;
  }
  const derivedUnitPrices = repricing.unitPrices;
  const canonicalTotals = calculateCanonicalTransactionTotals(
    items.map((item, index) => ({
      price: derivedUnitPrices[index],
      quantity: item.quantity,
    })),
  );

  const totalPaid = calculateTotalPaid(args.payments);
  const subtotal = canonicalTotals.subtotal;
  const tax = canonicalTotals.tax;
  const total = canonicalTotals.total;

  if (totalPaid < total) {
    return userError({
      code: "validation_failed",
      message: `Insufficient payment. Total: ${total.toFixed(2)}, Paid: ${totalPaid.toFixed(2)}`,
    });
  }

  const changeGiven = totalPaid > total ? totalPaid - total : undefined;
  const primaryPaymentMethod = args.payments[0]?.method || "cash";
  const transactionNumber = generateTransactionNumber();
  const completedAt = Date.now();

  const transactionId = await createPosTransaction(ctx, {
    transactionNumber,
    ...(idempotencyKey ? { idempotencyKey } : {}),
    storeId: session.storeId,
    sessionId: args.sessionId,
    registerSessionId: resolvedRegisterSessionId.data,
    staffProfileId: session.staffProfileId,
    registerNumber: session.registerNumber,
    terminalId: session.terminalId,
    subtotal,
    tax,
    total,
    customerProfileId: session.customerProfileId,
    payments: args.payments,
    totalPaid,
    changeGiven,
    paymentMethod: primaryPaymentMethod,
    status: "completed",
    completedAt,
    customerInfo: session.customerInfo,
    receiptPrinted: false,
    notes: args.notes,
  });
  const store = await getStoreById(ctx, session.storeId);
  await appendCompletedPosLifecycleJournal(ctx, {
    completedAt,
    organizationId: store?.organizationId,
    storeId: session.storeId,
    totals: canonicalTotals,
    transactionId,
  });

  if (args.recordRegisterSale !== false) {
    await recordRegisterSessionSale(ctx, {
      changeGiven,
      idempotencyKey,
      payments: args.payments,
      registerSessionId: resolvedRegisterSessionId.data,
      registerNumber: session.registerNumber,
      saleTotal: total,
      storeId: session.storeId,
      terminalId: session.terminalId,
      transactionId,
      transactionNumber,
    });
  }

  const completionResult = buildCompleteTransactionResult({
    transactionId,
    transactionNumber,
    paymentAllocated: await recordRetailSalePaymentAllocations(ctx, {
      changeGiven,
      organizationId: store?.organizationId,
      payments: args.payments,
      posTransactionId: transactionId,
      registerSessionId: resolvedRegisterSessionId.data,
      storeId: session.storeId,
      transactionNumber,
    }),
  });

  if (completionResult.status !== "ok") {
    throw new Error(completionResult.message);
  }

  const consumedHoldQuantities = await consumeInventoryHoldsForSession(ctx.db, {
    sessionId: args.sessionId,
    items: items
      .filter(
        (item) =>
          (!item.pendingCheckoutItemId ||
            linkedPendingTrustedItemIds.has(item.pendingCheckoutItemId)) &&
          !(
            item.inventoryImportProvisionalSkuId &&
            provisionalImportLinesById.has(item.inventoryImportProvisionalSkuId)
          ),
      )
      .map((item) => ({
        skuId: item.productSkuId,
        quantity: item.quantity,
      })),
    now: completedAt,
    activityContext: {
      actorStaffProfileId: args.staffProfileId,
      posTransactionId: transactionId,
      registerSessionId: resolvedRegisterSessionId.data,
      terminalId: session.terminalId,
      workflowTraceId: session.workflowTraceId,
      metadata: {
        transactionNumber,
      },
    },
    recordSkuActivityEvent: ((_db, event) =>
      recordSkuActivityEventWithCtx(ctx, event)) satisfies SkuActivityRecorder,
  });

  const provisionalQuantitiesSold = new Map<
    InventoryImportProvisionalSkuId,
    {
      provisionalSku: ActiveProvisionalImportSaleLine;
      quantitySold: number;
    }
  >();
  for (const item of items) {
    const provisionalSku = item.inventoryImportProvisionalSkuId
      ? provisionalImportLinesById.get(item.inventoryImportProvisionalSkuId)
      : undefined;
    if (!provisionalSku) continue;
    const existing = provisionalQuantitiesSold.get(provisionalSku._id);
    provisionalQuantitiesSold.set(provisionalSku._id, {
      provisionalSku,
      quantitySold: (existing?.quantitySold ?? 0) + item.quantity,
    });
  }

  const transactionItems = await Promise.all(
    items.map(async (item, index) => {
      const sku = await getProductSkuById(ctx, item.productSkuId);
      if (!sku) {
        throw new Error(
          `SKU ${item.productSkuId} not found during transaction processing`,
        );
      }

      const unitPrice = derivedUnitPrices[index];
      const image = item.image ?? sku.images?.[0];
      const provisionalSku = item.inventoryImportProvisionalSkuId
        ? provisionalImportLinesById.get(item.inventoryImportProvisionalSkuId)
        : undefined;
      const transactionItemId = await createPosTransactionItem(ctx, {
        transactionId,
        productId: item.productId,
        productSkuId: item.productSkuId,
        pendingCheckoutItemId: item.pendingCheckoutItemId,
        ...(provisionalSku
          ? { inventoryImportProvisionalSkuId: provisionalSku._id }
          : {}),
        productName: item.productName,
        productSku: item.productSku ?? "",
        barcode: item.barcode,
        ...(image ? { image } : {}),
        quantity: item.quantity,
        unitPrice,
        totalPrice: unitPrice * item.quantity,
      });

      const consumedHoldQuantity =
        consumedHoldQuantities.get(item.productSkuId) ?? 0;
      const quantityAvailableToSubtract =
        consumedHoldQuantity >= item.quantity ? item.quantity : 0;

      const linkedPendingTrustedLine =
        item.pendingCheckoutItemId &&
        linkedPendingTrustedItemIds.has(item.pendingCheckoutItemId);

      if (!provisionalSku && (!item.pendingCheckoutItemId || linkedPendingTrustedLine)) {
        await recordPosSaleInventoryMovement(ctx, {
          storeId: session.storeId,
          organizationId: store?.organizationId,
          productId: item.productId,
          productSkuId: item.productSkuId,
          quantity: item.quantity,
          posTransactionId: transactionId,
          registerSessionId: resolvedRegisterSessionId.data,
          staffProfileId: session.staffProfileId,
          customerProfileId: session.customerProfileId,
          occurrenceAt: completedAt,
          sellableQuantityDelta: -quantityAvailableToSubtract,
          sourceLineId: transactionItemId,
          transactionNumber,
        });
      } else if (item.pendingCheckoutItemId) {
        await recordPendingCheckoutItemSaleEvidence(ctx, {
          actorStaffProfileId: session.staffProfileId,
          pendingCheckoutItemId: item.pendingCheckoutItemId,
          posTransactionId: transactionId,
          price: item.price,
          quantitySold: item.quantity,
          registerSessionId: resolvedRegisterSessionId.data,
          source: "online",
          storeId: session.storeId,
          terminalId: session.terminalId,
          timestamp: Date.now(),
        });
      }

      return transactionItemId;
    }),
  );
  for (const evidence of provisionalQuantitiesSold.values()) {
    await recordProvisionalImportSkuSaleEvidence(ctx, {
      provisionalSku: evidence.provisionalSku,
      posTransactionId: transactionId,
      registerSessionId: resolvedRegisterSessionId.data,
      quantitySold: evidence.quantitySold,
      timestamp: completedAt,
    });
  }

  await patchPosSession(ctx, args.sessionId, {
    transactionId,
    registerSessionId: resolvedRegisterSessionId.data,
  });

  await recordCompletedSaleOperationalEvent(ctx, {
    completedAt,
    changeGiven,
    customerProfileId: session.customerProfileId,
    lineCount: items.length,
    organizationId: store?.organizationId,
    payments: args.payments,
    posTransactionId: transactionId,
    registerSessionId: resolvedRegisterSessionId.data,
    staffProfileId: session.staffProfileId,
    storeCurrency: store?.currency,
    storeId: session.storeId,
    total,
    transactionNumber,
  });

  await appendCompletedPosSaleIngress(ctx, {
    acceptedAt: completedAt,
    items: items.map((item, index) => ({
      inventoryImportProvisionalSkuId:
        item.inventoryImportProvisionalSkuId,
      lineKey: String(transactionItems[index]),
      pendingCheckoutItemId: item.pendingCheckoutItemId,
      productId: item.productId,
      productSkuId: item.productSkuId,
      quantity: item.quantity,
      totalAmountMinor: derivedUnitPrices[index] * item.quantity,
      unitPriceMinor: derivedUnitPrices[index],
    })),
    organizationId: store?.organizationId,
    storeCurrency: store?.currency,
    storeId: session.storeId,
    totals: { subtotal, tax, total },
    transactionId,
  });

  if (repricing.deviations.length > 0) {
    await recordPriceOverrideAudit(ctx, {
      storeId: session.storeId,
      organizationId: store?.organizationId,
      posTransactionId: transactionId,
      transactionNumber,
      registerSessionId: resolvedRegisterSessionId.data,
      requesterStaffProfileId: args.staffProfileId,
      approvedByStaffProfileId: repricing.approvedByStaffProfileId,
      deviations: repricing.deviations,
    });
  }

  await markCatalogSummaryNeedsRefresh(ctx, session.storeId);

  return ok({
    transactionId: completionResult.data.transactionId,
    transactionNumber: completionResult.data.transactionNumber,
    transactionItems,
  });
}
