import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RegisterCheckoutState } from "@/lib/pos/presentation/register/registerUiState";
import { ExpenseCompletion } from "@/components/expense/ExpenseCompletion";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { usePrint } from "@/hooks/usePrint";
import { buildExpenseReceiptHtml } from "@/lib/pos/expenseReceipt";
import { currencyFormatter } from "~/shared/currencyFormatter";

interface ExpenseCompletionPanelProps {
  checkout: RegisterCheckoutState;
}

export function ExpenseCompletionPanel({
  checkout,
}: ExpenseCompletionPanelProps) {
  const [isCompleting, setIsCompleting] = useState(false);
  const printedReceiptKeyRef = useRef<string | null>(null);
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
  const completedReceiptKey =
    checkout.completedOrderNumber ??
    completedTransactionData?.transactionId ??
    completedTransactionData?.completedAt?.toISOString() ??
    null;
  const displayCartItems =
    checkout.isTransactionCompleted && completedTransactionData
      ? completedTransactionData.cartItems
      : checkout.cartItems;
  const displayTotal =
    checkout.isTransactionCompleted && completedTransactionData
      ? completedTransactionData.totalValue
      : checkout.total;

  const handlePrintReceipt = useCallback(async () => {
    if (!activeStore || !completedTransactionData) {
      return;
    }

    try {
      const receiptHtml = await buildExpenseReceiptHtml({
        store: activeStore,
        formatter,
        reportNumber: checkout.completedOrderNumber ?? "Expense",
        completedAt: completedTransactionData.completedAt,
        recordedBy: checkout.cashierName,
        registerNumber: checkout.registerNumber,
        cartItems: completedTransactionData.cartItems,
        totalValue: completedTransactionData.totalValue,
        notes: completedTransactionData.notes,
      });

      printReceipt(receiptHtml);
    } catch (error) {
      console.error("Error printing expense receipt:", error);
    }
  }, [
    activeStore,
    checkout.cashierName,
    checkout.completedOrderNumber,
    checkout.registerNumber,
    completedTransactionData,
    formatter,
    printReceipt,
  ]);

  useEffect(() => {
    if (
      !checkout.isTransactionCompleted ||
      !completedTransactionData ||
      !completedReceiptKey
    ) {
      printedReceiptKeyRef.current = null;
      return;
    }

    if (printedReceiptKeyRef.current === completedReceiptKey) {
      return;
    }

    printedReceiptKeyRef.current = completedReceiptKey;
    void handlePrintReceipt();
  }, [
    checkout.isTransactionCompleted,
    completedReceiptKey,
    completedTransactionData,
    handlePrintReceipt,
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
      reportNumber={checkout.completedOrderNumber}
      onPrintReceipt={handlePrintReceipt}
    />
  );
}
