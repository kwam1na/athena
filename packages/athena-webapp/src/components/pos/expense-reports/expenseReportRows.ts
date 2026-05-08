import { formatStoredAmount } from "~/src/lib/pos/displayAmounts";

import type { ExpenseReportRow } from "./expenseReportColumns";

export type ExpenseTransactionSummary = {
  _id: ExpenseReportRow["_id"];
  transactionNumber: string;
  totalValue: number;
  staffProfileName: string | null;
  itemCount: number;
  completedAt: number;
  notes?: string | null;
};

export function toExpenseReportRows(
  transactions: ExpenseTransactionSummary[],
  formatter: Intl.NumberFormat,
): ExpenseReportRow[] {
  return transactions.map((transaction) => ({
    _id: transaction._id,
    transactionNumber: transaction.transactionNumber,
    formattedTotal: formatStoredAmount(formatter, transaction.totalValue),
    cashierName: transaction.staffProfileName,
    itemCount: transaction.itemCount,
    completedAt: transaction.completedAt,
    notes: transaction.notes,
  }));
}
