import type { Id } from "../../../_generated/dataModel";
import type { QueryCtx } from "../../../_generated/server";
import {
  getCashierById,
  getPosSessionById,
  getPosTransactionById,
  getRegisterSessionById,
  listCompletedTransactions,
  listCompletedTransactionsForDay,
  listTransactionItems,
  listTransactionsByStore,
} from "../../infrastructure/repositories/transactionRepository";
import { getTerminalById } from "../../infrastructure/repositories/terminalRepository";
import { formatStaffDisplayName } from "../../../../shared/staffDisplayName";
import { listReceiptDeliveriesForTransaction } from "../../../customerMessaging/repository";
import { statusIsRetryable } from "../../../customerMessaging/domain";
import {
  buildPosOperatorSnapshot,
  getStorePulseSummaryForWindow,
  type PosPulseWindow,
} from "./storePulse";

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
    productSku:
      stringFromMetadata(lineItem.productSku) ??
      stringFromMetadata(lineItem.sku),
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
  const adjustment = (
    metadata?.adjustment &&
    typeof metadata.adjustment === "object" &&
    !Array.isArray(metadata.adjustment)
      ? metadata.adjustment
      : metadata
  ) as AdjustmentMetadata | undefined;

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
          typeof lineItem === "object" &&
          lineItem !== null &&
          !Array.isArray(lineItem),
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
        ? await ctx.db.get(
            "operationalWorkItem",
            serviceCase.operationalWorkItemId,
          )
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
      const serviceLines = await listMixedServiceLinesForTransaction(
        ctx,
        transaction,
      );
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
        cashierName: cashier ? formatStaffDisplayName(cashier) : null,
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
    transaction.terminalId ??
    session?.terminalId ??
    registerSession?.terminalId;
  const terminal = terminalId ? await getTerminalById(ctx, terminalId) : null;
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
    new Set([
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
    ]),
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
          ? (actorStaffNamesById.get(event.actorStaffProfileId) ?? null)
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
          ? (actorStaffNamesById.get(approval.requestedByStaffProfileId) ??
            null)
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
    terminalName: terminal?.displayName,
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
        ? (actorStaffNamesById.get(event.actorStaffProfileId) ?? null)
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
        ? (actorStaffNamesById.get(delivery.actorStaffProfileId) ?? null)
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
    return getStorePulseSummaryForWindow(ctx, {
      currentDayEnd: summaryWindow.endOfDay,
      currentDayStart: summaryWindow.startOfDay,
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

async function resolveCurrentPosSummaryWindow(
  ctx: Pick<QueryCtx, "db">,
  args: {
    now: number;
    storeId: Id<"store">;
  },
) {
  const currentStoreDay = await findCurrentStoreDayOpening(ctx, {
    now: args.now,
    storeId: args.storeId,
  });
  const operatingDate =
    currentStoreDay?.operatingDate ??
    new Date(args.now).toISOString().slice(0, 10);
  const fallbackStartOfDay = Date.parse(`${operatingDate}T00:00:00.000Z`);
  const storeDayRange = currentStoreDay
    ? {
        endOfDay: currentStoreDay.endAt - 1,
        startOfDay: currentStoreDay.startAt,
      }
    : null;

  if (!Number.isFinite(fallbackStartOfDay)) {
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
    endOfDay: storeDayRange?.endOfDay ?? fallbackStartOfDay + DAY_MS - 1,
    operatingDate,
    startOfDay: storeDayRange?.startOfDay ?? fallbackStartOfDay,
  };
}

function isValidPosSummaryWindowRange(startAt: unknown, endAt: unknown) {
  return (
    typeof startAt === "number" &&
    typeof endAt === "number" &&
    Number.isFinite(startAt) &&
    Number.isFinite(endAt) &&
    endAt > startAt &&
    endAt - startAt <= 36 * 60 * 60 * 1000
  );
}

type CurrentStoreDayOpening = {
  endAt: number;
  operatingDate: string;
  startAt: number;
};

async function findCurrentStoreDayOpening(
  ctx: Pick<QueryCtx, "db">,
  args: {
    now: number;
    storeId: Id<"store">;
  },
): Promise<CurrentStoreDayOpening | null> {
  const startedOpenings = await ctx.db
    .query("dailyOpening")
    .withIndex("by_storeId_status_operatingDate", (q) =>
      q.eq("storeId", args.storeId).eq("status", "started"),
    )
    .order("desc")
    .take(10);

  for (const opening of startedOpenings) {
    if (!isActivePosSummaryOpeningAt(opening, args.now)) {
      continue;
    }

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

function isActivePosSummaryOpeningAt(
  opening: { endAt?: number; startAt?: number },
  now: number,
): opening is { endAt: number; startAt: number } {
  const { endAt, startAt } = opening;

  return (
    typeof startAt === "number" &&
    typeof endAt === "number" &&
    isValidPosSummaryWindowRange(startAt, endAt) &&
    Number.isFinite(now) &&
    now >= startAt &&
    now < endAt
  );
}
