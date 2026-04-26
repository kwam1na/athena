import type { RegisterExpenseCompletionState } from "@/lib/pos/presentation/register/registerUiState";
import { ExpenseCompletion } from "@/components/expense/ExpenseCompletion";

interface ExpenseCompletionPanelProps {
  expenseCompletion: RegisterExpenseCompletionState;
}

export function ExpenseCompletionPanel({
  expenseCompletion,
}: ExpenseCompletionPanelProps) {
  return (
    <ExpenseCompletion
      cartItems={expenseCompletion.cartItems}
      totalValue={expenseCompletion.totalValue}
      notes={expenseCompletion.notes}
      onNotesChange={expenseCompletion.onNotesChange}
      onComplete={expenseCompletion.onComplete}
      isCompleting={expenseCompletion.isCompleting}
      isCompleted={expenseCompletion.isCompleted}
      completedTransactionData={expenseCompletion.completedTransactionData}
      onTransactionStateChange={expenseCompletion.onTransactionStateChange}
    />
  );
}
