import { useMemo, useState } from "react";
import type { RegisterCheckoutState } from "@/lib/pos/presentation/register/registerUiState";
import { ExpenseCompletion } from "@/components/expense/ExpenseCompletion";

interface ExpenseCompletionPanelProps {
  checkout: RegisterCheckoutState;
}

export function ExpenseCompletionPanel({
  checkout,
}: ExpenseCompletionPanelProps) {
  const [isCompleting, setIsCompleting] = useState(false);

  const completedTransactionData = useMemo(() => {
    if (!checkout.completedTransactionData) {
      return undefined;
    }

    return {
      completedAt: checkout.completedTransactionData.completedAt,
      cartItems: checkout.completedTransactionData.cartItems,
      totalValue: checkout.completedTransactionData.total,
    };
  }, [checkout.completedTransactionData]);

  const handleComplete = async () => {
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
      cartItems={checkout.cartItems}
      totalValue={checkout.total}
      notes=""
      onNotesChange={() => {}}
      onComplete={handleComplete}
      isCompleting={isCompleting}
      isCompleted={checkout.isTransactionCompleted}
      completedTransactionData={completedTransactionData}
    />
  );
}
