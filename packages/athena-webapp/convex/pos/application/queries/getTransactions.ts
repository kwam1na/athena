import type { Id } from "../../../_generated/dataModel";
import type { QueryCtx } from "../../../_generated/server";

import {
  getCashierById,
  getPosSessionById,
  getPosTransactionById,
  listCompletedTransactions,
  listCompletedTransactionsForDay,
  listTransactionItems,
  listTransactionsByStore,
} from "../../infrastructure/repositories/transactionRepository";

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

function formatCashierName(args: { firstName?: string; lastName?: string; fullName?: string }) {
  const summary = summarizeCashierName(args);
  return [summary.firstName, summary.lastName ? `${summary.lastName.charAt(0)}.` : ""]
    .filter(Boolean)
    .join(" ")
    .trim();
}

async function loadCustomerProfile(
  ctx: QueryCtx,
  customerProfileId?: Id<"customerProfile">,
) {
  return customerProfileId
    ? ctx.db.get("customerProfile", customerProfileId)
    : null;
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
    storeId: Id<"store">;
    limit?: number;
  },
) {
  const transactions = await listCompletedTransactions(ctx, args);

  return Promise.all(
    transactions.map(async (transaction) => {
      const cashier = transaction.staffProfileId
        ? await getCashierById(ctx, transaction.staffProfileId)
        : null;
      const session = transaction.sessionId
        ? await getPosSessionById(ctx, transaction.sessionId)
        : null;
      const items = await listTransactionItems(ctx, transaction._id);
      const sessionTraceId = session?.workflowTraceId ?? null;
      const customerProfileId =
        transaction.customerProfileId ?? session?.customerProfileId;
      const customerProfile = await loadCustomerProfile(ctx, customerProfileId);

      return {
        _id: transaction._id,
        transactionNumber: transaction.transactionNumber,
        total: transaction.total,
        paymentMethod: transaction.paymentMethod || null,
        completedAt: transaction.completedAt,
        hasTrace: Boolean(sessionTraceId),
        sessionTraceId,
        cashierName: cashier
          ? formatCashierName(cashier)
          : null,
        customerProfileId,
        customerName:
          customerProfile?.fullName ?? transaction.customerInfo?.name ?? null,
        itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
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
  const items = await listTransactionItems(ctx, transaction._id);
  const sessionTraceId = session?.workflowTraceId ?? null;
  const customerProfileId =
    transaction.customerProfileId ?? session?.customerProfileId;
  const customerProfile = await loadCustomerProfile(ctx, customerProfileId);

  return {
    _id: transaction._id,
    transactionNumber: transaction.transactionNumber,
    subtotal: transaction.subtotal ?? 0,
    tax: transaction.tax ?? 0,
    total: transaction.total,
    hasTrace: Boolean(sessionTraceId),
    sessionTraceId,
    paymentMethod: transaction.paymentMethod,
    payments: transaction.payments,
    totalPaid: transaction.totalPaid ?? transaction.total,
    changeGiven: transaction.changeGiven,
    status: transaction.status,
    completedAt: transaction.completedAt,
    notes: transaction.notes,
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
    storeId: Id<"store">;
  },
) {
  const now = new Date();
  const startOfDay = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const endOfDay = startOfDay + 24 * 60 * 60 * 1000 - 1;
  const todayTransactions = await listCompletedTransactionsForDay(ctx, {
    storeId: args.storeId,
    startOfDay,
    endOfDay,
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
    totalTransactions,
    totalSales,
    totalItemsSold,
    averageTransaction:
      totalTransactions > 0 ? totalSales / totalTransactions : 0,
    date: now.toISOString().split("T")[0],
  };
}
