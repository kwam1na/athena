import type { Doc } from "../_generated/dataModel";

type PaymentTotalTransaction = Pick<
  Doc<"posTransaction">,
  "completedAt" | "paymentMethod" | "payments" | "total" | "totalPaid"
>;

type CashDeltaTransaction = PaymentTotalTransaction &
  Pick<Doc<"posTransaction">, "changeGiven">;

function listTransactionPayments(transaction: PaymentTotalTransaction) {
  if (transaction.payments.length > 0) return transaction.payments;

  return transaction.paymentMethod
    ? [
        {
          amount: transaction.total,
          method: transaction.paymentMethod,
          timestamp: transaction.completedAt,
        },
      ]
    : [];
}

function transactionPaymentTotals(transaction: PaymentTotalTransaction) {
  const totals = new Map<string, number>();

  listTransactionPayments(transaction).forEach((payment) => {
    totals.set(payment.method, (totals.get(payment.method) ?? 0) + payment.amount);
  });

  const nonCashTotal = Array.from(totals.entries()).reduce(
    (sum, [method, amount]) => (method === "cash" ? sum : sum + amount),
    0,
  );
  const cashTotal = totals.get("cash");
  if (cashTotal !== undefined) {
    totals.set(
      "cash",
      Math.min(cashTotal, Math.max(0, transaction.total - nonCashTotal)),
    );
  }

  return Array.from(totals.entries()).map(([method, amount]) => ({
    amount,
    method,
  }));
}

export function buildPaymentTotals(
  transactions: Array<PaymentTotalTransaction>,
) {
  const paymentTotals = new Map<
    string,
    {
      amount: number;
      transactionCount: number;
    }
  >();

  transactions.forEach((transaction) => {
    transactionPaymentTotals(transaction).forEach((payment) => {
      const existing = paymentTotals.get(payment.method) ?? {
        amount: 0,
        transactionCount: 0,
      };

      paymentTotals.set(payment.method, {
        amount: existing.amount + payment.amount,
        transactionCount: existing.transactionCount + 1,
      });
    });
  });

  return Array.from(paymentTotals.entries()).map(([method, total]) => ({
    method,
    ...total,
  }));
}

export function transactionCashDelta(transaction: CashDeltaTransaction) {
  if (transaction.payments.length === 0 && transaction.paymentMethod === "cash") {
    return Math.max(
      0,
      (transaction.totalPaid ?? transaction.total) - (transaction.changeGiven ?? 0),
    );
  }

  const cashTendered = listTransactionPayments(transaction).reduce(
    (sum, payment) => (payment.method === "cash" ? sum + payment.amount : sum),
    0,
  );

  return Math.max(0, cashTendered - (transaction.changeGiven ?? 0));
}
