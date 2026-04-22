import type { Id } from "../../../_generated/dataModel";
import type { QueryCtx } from "../../../_generated/server";

import {
  getCashierById,
  getCustomerById,
  getPosTransactionById,
  listCompletedTransactions,
  listCompletedTransactionsForDay,
  listTransactionItems,
  listTransactionsByStore,
} from "../../infrastructure/repositories/transactionRepository";

function formatCashierName(args: { firstName: string; lastName: string }) {
  return [args.firstName, `${args.lastName.charAt(0)}.`]
    .filter(Boolean)
    .join(" ")
    .trim();
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
      const cashier = transaction.cashierId
        ? await getCashierById(ctx, transaction.cashierId)
        : null;
      const customer = transaction.customerId
        ? await getCustomerById(ctx, transaction.customerId)
        : null;
      const items = await listTransactionItems(ctx, transaction._id);

      return {
        _id: transaction._id,
        transactionNumber: transaction.transactionNumber,
        total: transaction.total,
        paymentMethod: transaction.paymentMethod || null,
        completedAt: transaction.completedAt,
        hasTrace: Boolean(transaction.workflowTraceId),
        cashierName: cashier
          ? formatCashierName({
              firstName: cashier.firstName,
              lastName: cashier.lastName,
            })
          : null,
        customerName:
          customer?.name ?? transaction.customerInfo?.name ?? null,
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

  const cashier = transaction.cashierId
    ? await getCashierById(ctx, transaction.cashierId)
    : null;
  const customer = transaction.customerId
    ? await getCustomerById(ctx, transaction.customerId)
    : null;
  const items = await listTransactionItems(ctx, transaction._id);

  return {
    _id: transaction._id,
    transactionNumber: transaction.transactionNumber,
    subtotal: transaction.subtotal ?? 0,
    tax: transaction.tax ?? 0,
    total: transaction.total,
    hasTrace: Boolean(transaction.workflowTraceId),
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
          firstName: cashier.firstName,
          lastName: cashier.lastName,
        }
      : null,
    customer: customer
      ? {
          _id: customer._id,
          name: customer.name ?? undefined,
          email: customer.email ?? undefined,
          phone: customer.phone ?? undefined,
        }
      : transaction.customerInfo
        ? {
            _id: undefined,
            name: transaction.customerInfo.name,
            email: transaction.customerInfo.email,
            phone: transaction.customerInfo.phone,
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
      const customer = transaction.customerId
        ? await getCustomerById(ctx, transaction.customerId)
        : null;

      return {
        _id: transaction._id,
        transactionNumber: transaction.transactionNumber,
        total: transaction.total,
        status: transaction.status,
        completedAt: transaction.completedAt,
        customerId: transaction.customerId,
        customerInfo: transaction.customerInfo,
        customerName: customer?.name || null,
        hasCustomerLink: Boolean(transaction.customerId),
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
