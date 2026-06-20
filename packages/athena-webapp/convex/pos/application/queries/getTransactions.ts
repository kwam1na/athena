import type { Id } from "../../../_generated/dataModel";
import type { QueryCtx } from "../../../_generated/server";

import {
  getCashierById,
  getPosSessionById,
  getPosTransactionById,
  getRegisterSessionById,
  listCompletedTransactions,
  listCompletedTransactionsForRange,
  listCompletedTransactionsSince,
  listCompletedTransactionsForDay,
  listTransactionItems,
  listTransactionsByStore,
} from "../../infrastructure/repositories/transactionRepository";
import { formatStaffDisplayName } from "../../../../shared/staffDisplayName";
import { listReceiptDeliveriesForTransaction } from "../../../customerMessaging/repository";
import { statusIsRetryable } from "../../../customerMessaging/domain";

const ITEM_ADJUSTMENT_REQUEST_TYPES = new Set([
  "pos_item_adjustment",
  "pos_item_adjustment_review",
]);

const ITEM_ADJUSTMENT_EVENT_TYPES = new Set([
  "pos_transaction_item_adjustment_applied",
  "pos_transaction_item_adjusted",
]);
const TRANSACTION_VOID_REQUEST_TYPE = "pos_transaction_void";
const DAY_MS = 24 * 60 * 60 * 1000;
const POS_OPERATOR_HISTORY_DAYS = 14;
const POS_OPERATOR_HISTORY_LIMIT = 400;

type PosPulseSummaryTotals = {
  totalItemsSold: number;
  totalSales: number;
  totalTransactions: number;
};

export type PosPulseWindow =
  | "today"
  | "yesterday"
  | "this_week"
  | "this_month"
  | "all_time"
  | "last_week"
  | "last_month";

type AdjustmentMetadata = {
  adjustedTotal?: number;
  correctedTotal?: number;
  lineItems?: Array<Record<string, unknown>>;
  lines?: Array<Record<string, unknown>>;
  originalTotal?: number;
  payload?: {
    lines?: Array<Record<string, unknown>>;
  };
  settlementAmount?: number;
  settlementDirection?: string;
  settlementMethod?: string;
  deltaTotal?: number;
  totalDelta?: number;
  transactionId?: Id<"posTransaction">;
};

type MixedServiceLine = {
  id: string;
  name: string;
  quantity: number;
  serviceCaseId: Id<"serviceCase"> | null;
  serviceCaseTitle: string | null;
  serviceCaseUnavailable: boolean;
  serviceMode: string | null;
  servicePaymentStatus: string | null;
  serviceStatus: string | null;
  totalPrice: number;
  unitPrice: number;
};

type PosOperatorDayBucket = {
  averageTransaction: number;
  date: string;
  label: string;
  totalItemsSold: number;
  totalSales: number;
  transactionCount: number;
};

type PosOperatorPaymentBucket = {
  count: number;
  label: string;
  method: string;
  share: number;
  total: number;
};

type PosOperatorItemBucket = {
  name: string;
  productSku: string | null;
  quantity: number;
  totalSales: number;
};

function calculateDeltaPercent(current: number, previous: number) {
  return previous > 0 ? Math.round(((current - previous) / previous) * 100) : 0;
}

function summarizeCashierName(args: {
  fullName?: string;
  firstName?: string;
  lastName?: string;
}) {
  const firstName = args.firstName?.trim();
  const lastName = args.lastName?.trim();

  if (firstName || lastName) {
    return {
      firstName: firstName ?? args.fullName?.trim() ?? "Staff",
      lastName: lastName ?? "",
    };
  }

  const fullName = args.fullName?.trim();
  if (!fullName) {
    return {
      firstName: "Staff",
      lastName: "",
    };
  }

  const parts = fullName.split(/\s+/);
  return {
    firstName: parts[0] ?? "Staff",
    lastName: parts.slice(1).join(" "),
  };
}

async function loadCustomerProfile(
  ctx: QueryCtx,
  customerProfileId?: Id<"customerProfile">,
) {
  return customerProfileId
    ? ctx.db.get("customerProfile", customerProfileId)
    : null;
}

function getPaymentMethods(transaction: {
  paymentMethod?: string;
  payments?: Array<{ method: string }>;
}) {
  const paymentMethods = transaction.payments?.length
    ? transaction.payments.map((payment) => payment.method)
    : transaction.paymentMethod
      ? [transaction.paymentMethod]
      : [];

  return Array.from(new Set(paymentMethods));
}

async function loadCorrectionEvents(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
    transactionId: Id<"posTransaction">;
  },
) {
  // eslint-disable-next-line @convex-dev/no-collect-in-query -- Transaction detail returns complete correction history for one transaction.
  return ctx.db
    .query("operationalEvent")
    .withIndex("by_storeId_subject", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("subjectType", "pos_transaction")
        .eq("subjectId", args.transactionId),
    )
    .collect();
}

async function loadPendingItemAdjustmentApprovals(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
    transactionId: Id<"posTransaction">;
  },
) {
  const approvalRequests = await ctx.db
    .query("approvalRequest")
    .withIndex("by_storeId_status_posTransactionId", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("status", "pending")
        .eq("posTransactionId", args.transactionId),
    )
    .take(10);

  return approvalRequests.filter(
    (request) =>
      ITEM_ADJUSTMENT_REQUEST_TYPES.has(request.requestType) &&
      ((request.subjectType === "pos_transaction" &&
        request.subjectId === String(args.transactionId)) ||
        request.metadata?.transactionId === args.transactionId),
  );
}

async function loadPendingVoidApprovalRequest(
  ctx: QueryCtx,
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

  const request = pendingRequests.find(
    (candidate) =>
      candidate.requestType === TRANSACTION_VOID_REQUEST_TYPE &&
      candidate.subjectType === "pos_transaction" &&
      candidate.subjectId === args.transactionId,
  );

  return request
    ? {
        _id: request._id,
        createdAt: request.createdAt,
        requestedByStaffProfileId: request.requestedByStaffProfileId,
      }
    : null;
}

async function listStaffNames(
  ctx: QueryCtx,
  staffProfileIds: Set<Id<"staffProfile">>,
) {
  const staffEntries = await Promise.all(
    Array.from(staffProfileIds).map(async (staffProfileId) => {
      const staffProfile = await ctx.db.get("staffProfile", staffProfileId);
      const staffName = formatStaffDisplayName(staffProfile);
      return staffName ? [staffProfileId, staffName] : null;
    }),
  );

  return new Map(
    staffEntries.filter(Boolean) as Array<[Id<"staffProfile">, string]>,
  );
}

function numberFromMetadata(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function stringFromMetadata(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function normalizeAdjustmentLineItem(lineItem: Record<string, unknown>) {
  return {
    productName:
      stringFromMetadata(lineItem.productName) ??
      stringFromMetadata(lineItem.name) ??
      "Unnamed item",
    productSku: stringFromMetadata(lineItem.productSku) ?? stringFromMetadata(lineItem.sku),
    originalQuantity: numberFromMetadata(lineItem.originalQuantity),
    adjustedQuantity: numberFromMetadata(lineItem.adjustedQuantity),
    quantityDelta:
      numberFromMetadata(lineItem.quantityDelta) ??
      (typeof lineItem.inventoryDelta === "number"
        ? -lineItem.inventoryDelta
        : undefined),
    unitPrice: numberFromMetadata(lineItem.unitPrice),
    totalDelta: numberFromMetadata(lineItem.totalDelta),
  };
}

function normalizeAdjustmentMetadata(metadata?: Record<string, unknown>) {
  const adjustment = (metadata?.adjustment &&
  typeof metadata.adjustment === "object" &&
  !Array.isArray(metadata.adjustment)
    ? metadata.adjustment
    : metadata) as AdjustmentMetadata | undefined;

  const rawLineItems = Array.isArray(adjustment?.lineItems)
    ? adjustment.lineItems
    : Array.isArray(adjustment?.lines)
      ? adjustment.lines
      : Array.isArray(adjustment?.payload?.lines)
        ? adjustment.payload.lines
        : [];

  return {
    adjustedTotal:
      numberFromMetadata(adjustment?.adjustedTotal) ??
      numberFromMetadata(adjustment?.correctedTotal),
    lineItems: rawLineItems
      .filter(
        (lineItem): lineItem is Record<string, unknown> =>
          typeof lineItem === "object" && lineItem !== null && !Array.isArray(lineItem),
      )
      .map(normalizeAdjustmentLineItem),
    originalTotal: numberFromMetadata(adjustment?.originalTotal),
    settlementAmount: numberFromMetadata(adjustment?.settlementAmount),
    settlementDirection: stringFromMetadata(adjustment?.settlementDirection),
    settlementMethod: stringFromMetadata(adjustment?.settlementMethod),
    totalDelta:
      numberFromMetadata(adjustment?.totalDelta) ??
      numberFromMetadata(adjustment?.deltaTotal),
  };
}

async function listMixedServiceLinesForTransaction(
  ctx: QueryCtx,
  transaction: {
    _id: Id<"posTransaction">;
  },
): Promise<MixedServiceLine[]> {
  // eslint-disable-next-line @convex-dev/no-collect-in-query -- Transaction-scoped service lines are bounded by checkout line count and are needed together for receipt/report totals.
  const serviceLines = await ctx.db
    .query("posTransactionServiceLine")
    .withIndex("by_transactionId", (q) =>
      q.eq("transactionId", transaction._id),
    )
    .collect();

  return Promise.all(
    serviceLines.map(async (line) => {
      const serviceCase = await ctx.db.get("serviceCase", line.serviceCaseId);
      const workItem = serviceCase?.operationalWorkItemId
        ? await ctx.db.get("operationalWorkItem", serviceCase.operationalWorkItemId)
        : null;
      const refundedAmount =
        line.isRefunded && line.refundedQuantity
          ? Math.min(line.totalPrice, line.refundedQuantity * line.unitPrice)
          : 0;
      const totalPrice = Math.max(0, line.totalPrice - refundedAmount);

      return {
        id: String(line._id),
        name:
          line.serviceName ??
          workItem?.title ??
          (serviceCase ? "Service case" : "Service case unavailable"),
        quantity: line.quantity,
        serviceCaseId: serviceCase ? line.serviceCaseId : null,
        serviceCaseTitle: workItem?.title ?? null,
        serviceCaseUnavailable: !serviceCase,
        serviceMode: serviceCase?.serviceMode ?? line.serviceMode ?? null,
        servicePaymentStatus: serviceCase?.paymentStatus ?? null,
        serviceStatus: serviceCase?.status ?? null,
        totalPrice,
        unitPrice: line.unitPrice,
      };
    }),
  );
}

export async function getTransaction(
  ctx: QueryCtx,
  args: {
    transactionId: Id<"posTransaction">;
  },
) {
  const transaction = await getPosTransactionById(ctx, args.transactionId);
  if (!transaction) {
    return null;
  }

  const items = await listTransactionItems(ctx, args.transactionId);
  return { ...transaction, items };
}

export async function getTransactionsByStore(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
    limit?: number;
  },
) {
  return listTransactionsByStore(ctx, args);
}

export async function getCompletedTransactions(
  ctx: QueryCtx,
  args: {
    completedFrom?: number;
    registerSessionId?: Id<"registerSession">;
    storeId: Id<"store">;
    limit?: number;
  },
) {
  const transactions = await listCompletedTransactions(ctx, args);

  return Promise.all(
    transactions.map(async (transaction) => {
      const paymentMethods = getPaymentMethods(transaction);
      const cashier = transaction.staffProfileId
        ? await getCashierById(ctx, transaction.staffProfileId)
        : null;
      const session = transaction.sessionId
        ? await getPosSessionById(ctx, transaction.sessionId)
        : null;
      const items = await listTransactionItems(ctx, transaction._id);
      const serviceLines = await listMixedServiceLinesForTransaction(ctx, transaction);
      const sessionTraceId = session?.workflowTraceId ?? null;
      const customerProfileId =
        transaction.customerProfileId ?? session?.customerProfileId;
      const customerProfile = await loadCustomerProfile(ctx, customerProfileId);

      return {
        _id: transaction._id,
        transactionNumber: transaction.transactionNumber,
        total: transaction.total,
        paymentMethod: transaction.paymentMethod || null,
        paymentMethods,
        hasMultiplePaymentMethods: paymentMethods.length > 1,
        status: transaction.status,
        completedAt: transaction.completedAt,
        voidedAt: transaction.voidedAt,
        voidReason: transaction.voidReason,
        voidApprovalRequestId: transaction.voidApprovalRequestId,
        voidApprovalProofId: transaction.voidApprovalProofId,
        hasTrace: Boolean(sessionTraceId),
        sessionTraceId,
        cashierName: cashier
          ? formatStaffDisplayName(cashier)
          : null,
        customerProfileId,
        customerName:
          customerProfile?.fullName ?? transaction.customerInfo?.name ?? null,
        itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
        serviceLineCount: serviceLines.length,
        servicePaymentTotal: serviceLines.reduce(
          (sum, line) => sum + line.totalPrice,
          0,
        ),
      };
    }),
  );
}

export async function getTransactionById(
  ctx: QueryCtx,
  args: {
    transactionId: Id<"posTransaction">;
  },
) {
  const transaction = await getPosTransactionById(ctx, args.transactionId);
  if (!transaction) {
    return null;
  }

  const cashier = transaction.staffProfileId
    ? await getCashierById(ctx, transaction.staffProfileId)
    : null;
  const session = transaction.sessionId
    ? await getPosSessionById(ctx, transaction.sessionId)
    : null;
  const registerSessionId =
    transaction.registerSessionId ?? session?.registerSessionId;
  const registerSession = registerSessionId
    ? await getRegisterSessionById(ctx, registerSessionId)
    : null;
  const registerNumber =
    transaction.registerNumber ??
    session?.registerNumber ??
    registerSession?.registerNumber;
  const terminalId =
    transaction.terminalId ?? session?.terminalId ?? registerSession?.terminalId;
  const items = await listTransactionItems(ctx, transaction._id);
  const serviceLines = await listMixedServiceLinesForTransaction(ctx, {
    _id: transaction._id,
  });
  const sessionTraceId = session?.workflowTraceId ?? null;
  const customerProfileId =
    transaction.customerProfileId ?? session?.customerProfileId;
  const customerProfile = await loadCustomerProfile(ctx, customerProfileId);
  const correctionHistory = await loadCorrectionEvents(ctx, {
    storeId: transaction.storeId,
    transactionId: transaction._id,
  });
  const pendingItemAdjustmentApprovals =
    await loadPendingItemAdjustmentApprovals(ctx, {
      storeId: transaction.storeId,
      transactionId: transaction._id,
    });
  const pendingVoidApprovalRequest = await loadPendingVoidApprovalRequest(ctx, {
    storeId: transaction.storeId,
    transactionId: transaction._id,
  });
  const receiptDeliveries = await listReceiptDeliveriesForTransaction(ctx, {
    storeId: transaction.storeId,
    transactionId: transaction._id,
  });
  const actorStaffNamesById = await listStaffNames(
    ctx,
    new Set(
      [
        ...correctionHistory.flatMap((event) =>
          event.actorStaffProfileId ? [event.actorStaffProfileId] : [],
        ),
        ...receiptDeliveries.flatMap((delivery) =>
          delivery.actorStaffProfileId ? [delivery.actorStaffProfileId] : [],
        ),
        ...pendingItemAdjustmentApprovals.flatMap((approval) =>
          approval.requestedByStaffProfileId
            ? [approval.requestedByStaffProfileId]
            : [],
        ),
      ],
    ),
  );
  const appliedAdjustmentSummaries = correctionHistory
    .filter((event) => ITEM_ADJUSTMENT_EVENT_TYPES.has(event.eventType))
    .map((event) => {
      const adjustment = normalizeAdjustmentMetadata(event.metadata);
      return {
        _id: event._id,
        status: "applied" as const,
        createdAt: event.createdAt,
        appliedAt: event.createdAt,
        reason: event.reason ?? undefined,
        actorStaffName: event.actorStaffProfileId
          ? actorStaffNamesById.get(event.actorStaffProfileId) ?? null
          : null,
        ...adjustment,
        originalTotal: adjustment.originalTotal ?? transaction.total,
        adjustedTotal: adjustment.adjustedTotal ?? transaction.total,
        settlementAmount: adjustment.settlementAmount ?? 0,
        settlementDirection: adjustment.settlementDirection ?? "none",
      };
    });
  const pendingAdjustmentSummaries = pendingItemAdjustmentApprovals.map(
    (approval) => {
      const adjustment = normalizeAdjustmentMetadata(approval.metadata);
      return {
        _id: approval._id,
        status: "pending_approval" as const,
        approvalRequestId: approval._id,
        createdAt: approval.createdAt,
        reason: approval.reason ?? approval.notes ?? undefined,
        actorStaffName: approval.requestedByStaffProfileId
          ? actorStaffNamesById.get(approval.requestedByStaffProfileId) ?? null
          : null,
        ...adjustment,
        originalTotal: adjustment.originalTotal ?? transaction.total,
        adjustedTotal: adjustment.adjustedTotal ?? transaction.total,
        settlementAmount: adjustment.settlementAmount ?? 0,
        settlementDirection: adjustment.settlementDirection ?? "none",
      };
    },
  );
  const totalAppliedAdjustmentDelta = appliedAdjustmentSummaries.reduce(
    (sum, adjustment) =>
      sum +
      (adjustment.totalDelta ??
        adjustment.adjustedTotal - adjustment.originalTotal),
    0,
  );
  const effectiveNetTotal = transaction.total + totalAppliedAdjustmentDelta;

  return {
    _id: transaction._id,
    transactionNumber: transaction.transactionNumber,
    subtotal: transaction.subtotal ?? 0,
    tax: transaction.tax ?? 0,
    total: transaction.total,
    hasTrace: Boolean(sessionTraceId),
    sessionTraceId,
    registerNumber,
    registerSessionId,
    registerSessionStatus: registerSession?.status,
    terminalId,
    paymentMethod: transaction.paymentMethod,
    payments: transaction.payments,
    totalPaid: transaction.totalPaid ?? transaction.total,
    changeGiven: transaction.changeGiven,
    originalTotal: transaction.total,
    effectiveNetTotal,
    totalAppliedAdjustmentDelta,
    adjustmentSummary: {
      hasAdjustments:
        appliedAdjustmentSummaries.length > 0 ||
        pendingAdjustmentSummaries.length > 0,
      pendingCount: pendingAdjustmentSummaries.length,
      appliedCount: appliedAdjustmentSummaries.length,
      effectiveNetTotal,
      originalTotal: transaction.total,
      totalAppliedAdjustmentDelta,
    },
    adjustments: [
      ...pendingAdjustmentSummaries,
      ...appliedAdjustmentSummaries,
    ].sort((first, second) => second.createdAt - first.createdAt),
    status: transaction.status,
    completedAt: transaction.completedAt,
    notes: transaction.notes,
    voidedAt: transaction.voidedAt,
    voidReason: transaction.voidReason ?? transaction.notes,
    voidedByStaffProfileId: transaction.voidedByStaffProfileId,
    voidApprovalRequestId: transaction.voidApprovalRequestId,
    voidApprovalProofId: transaction.voidApprovalProofId,
    voidApprovedByStaffProfileId: transaction.voidApprovedByStaffProfileId,
    voidOperationalEventId: transaction.voidOperationalEventId,
    pendingVoidApprovalRequest,
    cashier: cashier
      ? {
          _id: cashier._id,
          ...summarizeCashierName(cashier),
        }
      : null,
    customer: customerProfile
      ? {
          customerProfileId,
          name: customerProfile.fullName ?? undefined,
          email: customerProfile.email ?? undefined,
          phone: customerProfile.phoneNumber ?? undefined,
        }
      : transaction.customerInfo
        ? {
            customerProfileId,
            name: transaction.customerInfo.name,
            email: transaction.customerInfo.email,
            phone: transaction.customerInfo.phone,
          }
        : customerProfileId
          ? {
              _id: undefined,
              customerProfileId,
            }
        : null,
    customerInfo: transaction.customerInfo,
    correctionHistory: correctionHistory.map((event) => ({
      _id: event._id,
      eventType: event.eventType,
      message: event.message,
      reason: event.reason,
      metadata: event.metadata,
      createdAt: event.createdAt,
      actorUserId: event.actorUserId,
      actorStaffProfileId: event.actorStaffProfileId,
      actorStaffName: event.actorStaffProfileId
        ? actorStaffNamesById.get(event.actorStaffProfileId) ?? null
        : null,
    })),
    receiptDeliveryHistory: receiptDeliveries.map((delivery) => ({
      _id: delivery._id,
      status: delivery.status,
      providerStatus: delivery.providerStatus,
      recipientSource: delivery.recipientSource,
      recipientDisplay: delivery.recipientDisplay,
      actorStaffProfileId: delivery.actorStaffProfileId,
      actorStaffName: delivery.actorStaffProfileId
        ? actorStaffNamesById.get(delivery.actorStaffProfileId) ?? null
        : null,
      createdAt: delivery.createdAt,
      updatedAt: delivery.updatedAt,
      sentAt: delivery.sentAt,
      deliveredAt: delivery.deliveredAt,
      readAt: delivery.readAt,
      failedAt: delivery.failedAt,
      failureCategory: delivery.failureCategory,
      failureMessage: delivery.failureMessage,
      retryable: statusIsRetryable(delivery.status),
    })),
    serviceLines,
    serviceLineCount: serviceLines.length,
    servicePaymentTotal: serviceLines.reduce(
      (sum, line) => sum + line.totalPrice,
      0,
    ),
    items: items.map((item) => ({
      _id: item._id,
      productId: item.productId,
      productSkuId: item.productSkuId,
      productName: item.productName,
      productSku: item.productSku,
      barcode: item.barcode,
      image: item.image,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      totalPrice: item.totalPrice,
      discount: item.discount,
      discountReason: item.discountReason,
    })),
  };
}

export async function getRecentTransactionsWithCustomers(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
    limit?: number;
  },
) {
  const transactions = await listTransactionsByStore(ctx, {
    storeId: args.storeId,
    limit: args.limit || 10,
  });

  return Promise.all(
    transactions.map(async (transaction) => {
      const customerProfile = await loadCustomerProfile(
        ctx,
        transaction.customerProfileId,
      );

      return {
        _id: transaction._id,
        transactionNumber: transaction.transactionNumber,
        total: transaction.total,
        status: transaction.status,
        completedAt: transaction.completedAt,
        customerProfileId: transaction.customerProfileId,
        customerInfo: transaction.customerInfo,
        customerName:
          customerProfile?.fullName ?? transaction.customerInfo?.name ?? null,
        hasCustomerLink: Boolean(transaction.customerProfileId),
      };
    }),
  );
}

export async function getTodaySummary(
  ctx: QueryCtx,
  args: {
    pulseWindow?: PosPulseWindow;
    storeId: Id<"store">;
  },
) {
  const summaryWindow = await resolveCurrentPosSummaryWindow(ctx, {
    now: Date.now(),
    storeId: args.storeId,
  });

  if (args.pulseWindow) {
    return getPulseSummaryForWindow(ctx, {
      currentOperatingDate: summaryWindow.operatingDate,
      pulseWindow: args.pulseWindow,
      storeId: args.storeId,
    });
  }

  const todayTransactions = await listCompletedTransactionsForDay(ctx, {
    storeId: args.storeId,
    startOfDay: summaryWindow.startOfDay,
    endOfDay: summaryWindow.endOfDay,
  });

  const totalTransactions = todayTransactions.length;
  const totalSales = todayTransactions.reduce(
    (sum, transaction) => sum + transaction.total,
    0,
  );

  let totalItemsSold = 0;
  for (const transaction of todayTransactions) {
    const items = await listTransactionItems(ctx, transaction._id);
    totalItemsSold += items.reduce((sum, item) => sum + item.quantity, 0);
  }

  return {
    averageTransaction:
      totalTransactions > 0 ? totalSales / totalTransactions : 0,
    date: summaryWindow.operatingDate,
    operatorSnapshot: await buildPosOperatorSnapshot(ctx, {
      currentOperatingDate: summaryWindow.operatingDate,
      storeId: args.storeId,
      todaySummary: {
        totalItemsSold,
        totalSales,
        totalTransactions,
      },
    }),
    totalItemsSold,
    totalSales,
    totalTransactions,
  };
}

async function getPulseSummaryForWindow(
  ctx: QueryCtx,
  args: {
    currentOperatingDate: string;
    pulseWindow: PosPulseWindow;
    storeId: Id<"store">;
  },
) {
  const pulseWindow = resolvePosPulseWindow({
    currentOperatingDate: args.currentOperatingDate,
    pulseWindow: args.pulseWindow,
  });
  const [transactions, comparisonTransactions] = await Promise.all([
    listCompletedTransactionsForRange(ctx, {
      completedFrom: pulseWindow.rangeStart,
      completedTo: pulseWindow.rangeEnd,
      storeId: args.storeId,
    }),
    pulseWindow.comparisonStart !== undefined &&
    pulseWindow.comparisonEnd !== undefined
      ? listCompletedTransactionsForRange(ctx, {
          completedFrom: pulseWindow.comparisonStart,
          completedTo: pulseWindow.comparisonEnd,
          storeId: args.storeId,
        })
      : Promise.resolve([]),
  ]);
  const todaySummary = await summarizePosPulseTransactions(ctx, transactions);
  const comparisonSummary = await summarizePosPulseTransactions(
    ctx,
    comparisonTransactions,
  );

  return {
    averageTransaction:
      todaySummary.totalTransactions > 0
        ? todaySummary.totalSales / todaySummary.totalTransactions
        : 0,
    date: toIsoDate(pulseWindow.rangeEnd),
    operatorSnapshot: await buildPosOperatorSnapshot(ctx, {
      comparisonEnd: pulseWindow.comparisonEnd,
      comparisonSummary,
      comparisonStart: pulseWindow.comparisonStart,
      currentOperatingDate: args.currentOperatingDate,
      historyBucketMode: pulseWindow.historyBucketMode,
      historyDays: pulseWindow.dayCount,
      historyEnd: pulseWindow.rangeEnd,
      historyStart: pulseWindow.rangeStart,
      storeId: args.storeId,
      todaySummary,
    }),
    totalItemsSold: todaySummary.totalItemsSold,
    totalSales: todaySummary.totalSales,
    totalTransactions: todaySummary.totalTransactions,
  };
}

async function summarizePosPulseTransactions(
  ctx: QueryCtx,
  transactions: Array<{ _id: Id<"posTransaction">; total: number }>,
): Promise<PosPulseSummaryTotals> {
  let totalItemsSold = 0;

  for (const transaction of transactions) {
    const items = await listTransactionItems(ctx, transaction._id);
    totalItemsSold += items.reduce((sum, item) => sum + item.quantity, 0);
  }

  return {
    totalItemsSold,
    totalSales: transactions.reduce(
      (sum, transaction) => sum + transaction.total,
      0,
    ),
    totalTransactions: transactions.length,
  };
}

async function buildPosOperatorSnapshot(
  ctx: QueryCtx,
  args: {
    comparisonEnd?: number;
    comparisonSummary?: PosPulseSummaryTotals;
    comparisonStart?: number;
    currentOperatingDate: string;
    historyBucketMode?: "fixed" | "transaction_dates";
    historyDays?: number;
    historyEnd?: number;
    historyStart?: number;
    storeId: Id<"store">;
    todaySummary: {
      totalItemsSold: number;
      totalSales: number;
      totalTransactions: number;
    };
  },
) {
  const currentDayStart = parseOperatingDateStart(args.currentOperatingDate);
  const historyDays = args.historyDays ?? POS_OPERATOR_HISTORY_DAYS;
  const historyStart =
    args.historyStart ?? currentDayStart - (historyDays - 1) * DAY_MS;
  const historyEnd = args.historyEnd ?? currentDayStart + DAY_MS - 1;
  const queryStart = args.comparisonStart ?? historyStart;
  const loadedTransactions = (
    await listCompletedTransactionsSince(ctx, {
      completedFrom: queryStart,
      limit: POS_OPERATOR_HISTORY_LIMIT,
      storeId: args.storeId,
    })
  ).filter((transaction) => transaction.completedAt <= historyEnd);
  const transactions = args.comparisonStart
    ? loadedTransactions.filter(
        (transaction) =>
          transaction.completedAt >= historyStart &&
          transaction.completedAt <= historyEnd,
      )
    : loadedTransactions;
  const days =
    args.historyBucketMode === "transaction_dates"
      ? buildTransactionDateBuckets(transactions, historyEnd)
      : buildRecentDayBuckets(historyStart, historyDays);
  const dayBucketsByDate = new Map(days.map((day) => [day.date, day]));
  const itemBuckets = new Map<string, PosOperatorItemBucket>();
  const paymentBuckets = new Map<string, PosOperatorPaymentBucket>();
  const hourBuckets = new Map<
    number,
    { hour: number; totalSales: number; transactionCount: number }
  >();

  for (const transaction of transactions) {
    const date = toIsoDate(transaction.completedAt);
    const dayBucket = dayBucketsByDate.get(date);
    if (dayBucket) {
      dayBucket.totalSales += transaction.total;
      dayBucket.transactionCount += 1;
    }

    const hour = new Date(transaction.completedAt).getUTCHours();
    const hourBucket = hourBuckets.get(hour) ?? {
      hour,
      totalSales: 0,
      transactionCount: 0,
    };
    hourBucket.totalSales += transaction.total;
    hourBucket.transactionCount += 1;
    hourBuckets.set(hour, hourBucket);

    const payments = transaction.payments?.length
      ? transaction.payments
      : transaction.paymentMethod
        ? [
            {
              amount: transaction.total,
              method: transaction.paymentMethod,
              timestamp: transaction.completedAt,
            },
          ]
        : [];
    for (const payment of payments) {
      const method = payment.method || "unknown";
      const existing = paymentBuckets.get(method) ?? {
        count: 0,
        label: formatPaymentMethodLabel(method),
        method,
        share: 0,
        total: 0,
      };
      existing.count += 1;
      existing.total += payment.amount;
      paymentBuckets.set(method, existing);
    }

    const items = await listTransactionItems(ctx, transaction._id);
    const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
    if (dayBucket) {
      dayBucket.totalItemsSold += itemCount;
    }

    for (const item of items) {
      const key = `${item.productId}:${item.productSkuId}`;
      const existing = itemBuckets.get(key) ?? {
        name: item.productName,
        productSku: item.productSku || null,
        quantity: 0,
        totalSales: 0,
      };
      existing.quantity += item.quantity;
      existing.totalSales += item.totalPrice;
      itemBuckets.set(key, existing);
    }
  }

  for (const day of days) {
    day.averageTransaction =
      day.transactionCount > 0 ? day.totalSales / day.transactionCount : 0;
  }

  const totalPaymentSales = Array.from(paymentBuckets.values()).reduce(
    (sum, payment) => sum + payment.total,
    0,
  );
  const paymentMix = Array.from(paymentBuckets.values())
    .map((payment) => ({
      ...payment,
      share:
        totalPaymentSales > 0
          ? Math.round((payment.total / totalPaymentSales) * 100)
          : 0,
    }))
    .sort((first, second) => second.total - first.total)
    .slice(0, 4);
  const topItems = Array.from(itemBuckets.values())
    .sort((first, second) => {
      if (second.quantity !== first.quantity) {
        return second.quantity - first.quantity;
      }
      return second.totalSales - first.totalSales;
    })
    .slice(0, 10);
  const busiestHour = Array.from(hourBuckets.values()).sort((first, second) => {
    if (second.transactionCount !== first.transactionCount) {
      return second.transactionCount - first.transactionCount;
    }
    return second.totalSales - first.totalSales;
  })[0];
  const priorDays = days.slice(0, -1);
  const priorDaysWithSales = priorDays.filter(
    (day) => day.transactionCount > 0,
  );
  const yesterday = priorDays.at(-1);
  const hasComparison = Boolean(args.comparisonStart && args.comparisonEnd);
  const shouldCompareWithPreviousDay =
    !hasComparison && args.historyBucketMode !== "transaction_dates";
  const yesterdaySales = hasComparison
    ? (args.comparisonSummary?.totalSales ?? 0)
    : shouldCompareWithPreviousDay
      ? (yesterday?.totalSales ?? 0)
      : 0;
  const yesterdayTransactions = hasComparison
    ? (args.comparisonSummary?.totalTransactions ?? 0)
    : shouldCompareWithPreviousDay
      ? (yesterday?.transactionCount ?? 0)
      : 0;
  const yesterdayItemsSold = hasComparison
    ? (args.comparisonSummary?.totalItemsSold ?? 0)
    : shouldCompareWithPreviousDay
      ? (yesterday?.totalItemsSold ?? 0)
      : 0;

  const currentAverageTransaction =
    args.todaySummary.totalTransactions > 0
      ? args.todaySummary.totalSales / args.todaySummary.totalTransactions
      : 0;
  const yesterdayAverageTransaction =
    yesterdayTransactions > 0 ? yesterdaySales / yesterdayTransactions : 0;

  return {
    busiestHour: busiestHour
      ? {
          hour: busiestHour.hour,
          label: formatHourLabel(busiestHour.hour),
          totalSales: busiestHour.totalSales,
          transactionCount: busiestHour.transactionCount,
        }
      : null,
    comparison: {
      averageTransactionDeltaPercent: calculateDeltaPercent(
        currentAverageTransaction,
        yesterdayAverageTransaction,
      ),
      currentAverageTransaction,
      currentItemsSold: args.todaySummary.totalItemsSold,
      currentSales: args.todaySummary.totalSales,
      currentTransactions: args.todaySummary.totalTransactions,
      itemsSoldDeltaPercent: calculateDeltaPercent(
        args.todaySummary.totalItemsSold,
        yesterdayItemsSold,
      ),
      salesDeltaPercent: calculateDeltaPercent(
        args.todaySummary.totalSales,
        yesterdaySales,
      ),
      transactionDeltaPercent: calculateDeltaPercent(
        args.todaySummary.totalTransactions,
        yesterdayTransactions,
      ),
      yesterdayAverageTransaction,
      yesterdayItemsSold,
      yesterdaySales,
      yesterdayTransactions,
    },
    historyDays:
      args.historyBucketMode === "transaction_dates" ? days.length : historyDays,
    isLimited: loadedTransactions.length >= POS_OPERATOR_HISTORY_LIMIT,
    paymentMix,
    topItems,
    trend: days,
    usableHistoryDays: priorDaysWithSales.length,
  };
}

function resolvePosPulseWindow(args: {
  currentOperatingDate: string;
  pulseWindow: PosPulseWindow;
}) {
  const currentDayStart = parseOperatingDateStart(args.currentOperatingDate);
  const currentDayEnd = currentDayStart + DAY_MS - 1;

  if (args.pulseWindow === "all_time") {
    return {
      dayCount: 0,
      historyBucketMode: "transaction_dates" as const,
      rangeEnd: currentDayEnd,
      rangeStart: 0,
    };
  }

  if (args.pulseWindow === "today") {
    return {
      comparisonEnd: currentDayStart - 1,
      comparisonStart: currentDayStart - DAY_MS,
      dayCount: 1,
      rangeEnd: currentDayEnd,
      rangeStart: currentDayStart,
    };
  }

  if (args.pulseWindow === "yesterday") {
    const rangeStart = currentDayStart - DAY_MS;

    return {
      comparisonEnd: rangeStart - 1,
      comparisonStart: rangeStart - DAY_MS,
      dayCount: 1,
      rangeEnd: rangeStart + DAY_MS - 1,
      rangeStart,
    };
  }

  if (args.pulseWindow === "this_week") {
    const dayOfWeek = new Date(currentDayStart).getUTCDay();
    const daysSinceMonday = (dayOfWeek + 6) % 7;
    const dayCount = daysSinceMonday + 1;
    const rangeStart = currentDayStart - daysSinceMonday * DAY_MS;
    const comparisonStart = rangeStart - 7 * DAY_MS;

    return {
      comparisonEnd: comparisonStart + dayCount * DAY_MS - 1,
      comparisonStart,
      dayCount,
      rangeEnd: currentDayEnd,
      rangeStart,
    };
  }

  if (args.pulseWindow === "last_week") {
    const dayOfWeek = new Date(currentDayStart).getUTCDay();
    const daysSinceMonday = (dayOfWeek + 6) % 7;
    const currentWeekStart = currentDayStart - daysSinceMonday * DAY_MS;
    const rangeStart = currentWeekStart - 7 * DAY_MS;
    const comparisonStart = rangeStart - 7 * DAY_MS;

    return {
      comparisonEnd: rangeStart - 1,
      comparisonStart,
      dayCount: 7,
      rangeEnd: currentWeekStart - 1,
      rangeStart,
    };
  }

  const currentDate = new Date(currentDayStart);
  const rangeStart = Date.UTC(
    currentDate.getUTCFullYear(),
    currentDate.getUTCMonth(),
    1,
  );
  const dayCount =
    Math.floor((currentDayStart - rangeStart) / DAY_MS) + 1;
  const previousMonthStart = Date.UTC(
    currentDate.getUTCFullYear(),
    currentDate.getUTCMonth() - 1,
    1,
  );
  const currentMonthStart = rangeStart;

  if (args.pulseWindow === "last_month") {
    const monthBeforePreviousStart = Date.UTC(
      currentDate.getUTCFullYear(),
      currentDate.getUTCMonth() - 2,
      1,
    );
    const previousMonthDayCount = Math.round(
      (currentMonthStart - previousMonthStart) / DAY_MS,
    );

    return {
      comparisonEnd: previousMonthStart - 1,
      comparisonStart: monthBeforePreviousStart,
      dayCount: previousMonthDayCount,
      rangeEnd: currentMonthStart - 1,
      rangeStart: previousMonthStart,
    };
  }

  const previousMonthDayCount = Math.round(
    (currentMonthStart - previousMonthStart) / DAY_MS,
  );
  const comparisonDayCount = Math.min(dayCount, previousMonthDayCount);

  return {
    comparisonEnd: previousMonthStart + comparisonDayCount * DAY_MS - 1,
    comparisonStart: previousMonthStart,
    dayCount,
    rangeEnd: currentDayEnd,
    rangeStart,
  };
}

function parseOperatingDateStart(operatingDate: string) {
  const parsed = Date.parse(`${operatingDate}T00:00:00.000Z`);
  return Number.isFinite(parsed)
    ? parsed
    : Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
}

function buildRecentDayBuckets(startAt: number, dayCount: number) {
  return Array.from({ length: dayCount }, (_, index): PosOperatorDayBucket => {
    const dateAt = startAt + index * DAY_MS;
    const date = toIsoDate(dateAt);
    return {
      averageTransaction: 0,
      date,
      label: formatShortDate(date),
      totalItemsSold: 0,
      totalSales: 0,
      transactionCount: 0,
    };
  });
}

function buildTransactionDateBuckets(
  transactions: Array<{ completedAt: number }>,
  fallbackDateAt: number,
) {
  const dates = Array.from(
    new Set(transactions.map((transaction) => toIsoDate(transaction.completedAt))),
  ).sort();

  if (!dates.length) {
    const date = toIsoDate(fallbackDateAt);

    return [
      {
        averageTransaction: 0,
        date,
        label: formatShortDate(date),
        totalItemsSold: 0,
        totalSales: 0,
        transactionCount: 0,
      },
    ];
  }

  return dates.map((date): PosOperatorDayBucket => ({
    averageTransaction: 0,
    date,
    label: formatShortDate(date),
    totalItemsSold: 0,
    totalSales: 0,
    transactionCount: 0,
  }));
}

function toIsoDate(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function formatShortDate(date: string) {
  const [, month = "01", day = "01"] = date.split("-");
  const monthIndex = Math.max(0, Math.min(11, Number(month) - 1));
  const monthLabel = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ][monthIndex];

  return `${monthLabel} ${Number(day)}`;
}

function formatHourLabel(hour: number) {
  const normalizedHour = ((hour % 24) + 24) % 24;
  const suffix = normalizedHour >= 12 ? "PM" : "AM";
  const hour12 = normalizedHour % 12 || 12;
  return `${hour12} ${suffix}`;
}

function formatPaymentMethodLabel(method: string) {
  switch (method) {
    case "mobile_money":
      return "Mobile money";
    case "credit_card":
      return "Credit card";
    case "debit_card":
      return "Debit card";
    case "card":
      return "Card";
    case "cash":
      return "Cash";
    default:
      return method
        .replace(/[-_]/g, " ")
        .replace(/\b\w/g, (character) => character.toUpperCase());
  }
}

async function resolveCurrentPosSummaryWindow(
  ctx: Pick<QueryCtx, "db">,
  args: {
    now: number;
    storeId: Id<"store">;
  },
) {
  const activeOpening = await findLatestOpenOperatingDay(ctx, {
    storeId: args.storeId,
  });
  const operatingDate =
    activeOpening?.operatingDate ??
    new Date(args.now).toISOString().slice(0, 10);
  const startOfDay = Date.parse(`${operatingDate}T00:00:00.000Z`);

  if (!Number.isFinite(startOfDay)) {
    const fallbackStart = Date.parse(
      `${new Date(args.now).toISOString().slice(0, 10)}T00:00:00.000Z`,
    );

    return {
      endOfDay: fallbackStart + DAY_MS - 1,
      operatingDate: new Date(args.now).toISOString().slice(0, 10),
      startOfDay: fallbackStart,
    };
  }

  return {
    endOfDay: startOfDay + DAY_MS - 1,
    operatingDate,
    startOfDay,
  };
}

async function findLatestOpenOperatingDay(
  ctx: Pick<QueryCtx, "db">,
  args: {
    storeId: Id<"store">;
  },
) {
  const startedOpenings = await ctx.db
    .query("dailyOpening")
    .withIndex("by_storeId_status_operatingDate", (q) =>
      q.eq("storeId", args.storeId).eq("status", "started"),
    )
    .order("desc")
    .take(10);

  for (const opening of startedOpenings) {
    const closes = await ctx.db
      .query("dailyClose")
      .withIndex("by_storeId_operatingDate", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("operatingDate", opening.operatingDate),
      )
      .take(10);
    const hasCompletedActiveClose = closes.some(
      (close) =>
        close.status === "completed" && close.lifecycleStatus !== "reopened",
    );

    if (!hasCompletedActiveClose) {
      return opening;
    }
  }

  return null;
}
