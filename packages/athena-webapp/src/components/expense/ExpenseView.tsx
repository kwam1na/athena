import { POSRegisterView } from "@/components/pos/POSRegisterView";
import { useExpenseRegisterViewModel } from "@/lib/pos/presentation/expense/useExpenseRegisterViewModel";

export function ExpenseView() {
  const viewModel = useExpenseRegisterViewModel();

  return <POSRegisterView workflowMode="expense" viewModel={viewModel} />;
}
