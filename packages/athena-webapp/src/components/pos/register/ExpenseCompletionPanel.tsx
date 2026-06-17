import { useCallback, useMemo, useState } from "react";
import type { RegisterCheckoutState } from "@/lib/pos/presentation/register/registerUiState";
import { ExpenseCompletion } from "@/components/expense/ExpenseCompletion";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { usePrint } from "@/hooks/usePrint";
import { buildExpenseReceiptHtml } from "@/lib/pos/expenseReceipt";
import { currencyFormatter } from "~/shared/currencyFormatter";

interface ExpenseCompletionPanelProps {
  checkout: RegisterCheckoutState;
}

function isLocalExpenseReportNumber(value: string | null | undefined) {
  return value?.startsWith("local-expense-event-") ?? false;
}

export function ExpenseCompletionPanel({
  checkout,
}: ExpenseCompletionPanelProps) {
  const [isCompleting, setIsCompleting] = useState(false);
  const { activeStore } = useGetActiveStore();
  const { printReceipt } = usePrint();
  const formatter = useMemo(
    () => currencyFormatter(activeStore?.currency || "GHS"),
    [activeStore],
  );

  const completedTransactionData = useMemo(() => {
    if (!checkout.completedTransactionData) {
      return undefined;
    }

    return {
      transactionId: checkout.completedTransactionData.transactionId,
      completedAt: checkout.completedTransactionData.completedAt,
      cartItems: checkout.completedTransactionData.cartItems,
      totalValue: checkout.completedTransactionData.total,
      notes: checkout.completedTransactionData.notes,
    };
  }, [checkout.completedTransactionData]);
  const displayCartItems =
    checkout.isTransactionCompleted && completedTransactionData
      ? completedTransactionData.cartItems
      : checkout.cartItems;
  const displayTotal =
    checkout.isTransactionCompleted && completedTransactionData
      ? completedTransactionData.totalValue
      : checkout.total;
  const displayReportNumber = isLocalExpenseReportNumber(
    checkout.completedOrderNumber,
  )
    ? null
    : checkout.completedOrderNumber;

  const handlePrintReceipt = useCallback(async () => {
    if (!activeStore || !completedTransactionData) {
      return false;
    }

    try {
      const receiptHtml = await buildExpenseReceiptHtml({
        store: activeStore,
        formatter,
        reportNumber: displayReportNumber ?? "Expense",
        completedAt: completedTransactionData.completedAt,
        recordedBy: checkout.cashierName,
        registerNumber: checkout.registerNumber,
        cartItems: completedTransactionData.cartItems,
        totalValue: completedTransactionData.totalValue,
        notes: completedTransactionData.notes,
      });

      printReceipt(receiptHtml);
      return true;
    } catch (error) {
      console.error("Error printing expense receipt:", error);
      return false;
    }
  }, [
    activeStore,
    checkout.cashierName,
    checkout.registerNumber,
    completedTransactionData,
    displayReportNumber,
    formatter,
    printReceipt,
  ]);

  const handleComplete = async () => {
    if (checkout.isTransactionCompleted) {
      checkout.onStartNewTransaction();
      return;
    }

    if (!checkout.onCompleteTransaction) {
      return;
    }

    setIsCompleting(true);
    try {
      await checkout.onCompleteTransaction();
    } finally {
      setIsCompleting(false);
    }
  };

  return (
    <ExpenseCompletion
      cartItems={displayCartItems}
      totalValue={displayTotal}
      notes=""
      onNotesChange={() => {}}
      onComplete={handleComplete}
      isCompleting={isCompleting}
      isCompleted={checkout.isTransactionCompleted}
      completedTransactionData={completedTransactionData}
      reportNumber={displayReportNumber}
      recordedBy={checkout.cashierName}
      onPrintReceipt={() => {
        void handlePrintReceipt();
      }}
    />
  );
}
