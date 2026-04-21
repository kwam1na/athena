import { useQuery } from "convex/react";
import { toast } from "sonner";

import { api } from "~/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { CartItem } from "../pos/types";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { currencyFormatter } from "~/convex/utils";
import { CashierView } from "../pos/CashierView";
import { useExpenseStore } from "~/src/stores/expenseStore";
import { useExpenseActiveSession } from "~/src/hooks/useExpenseSessions";
import { useSessionManagementExpense } from "~/src/hooks/useSessionManagementExpense";
import { toDisplayAmount } from "~/convex/lib/currency";

interface ExpenseCompletionProps {
  cartItems: CartItem[];
  totalValue: number;
  notes: string;
  onNotesChange: (notes: string) => void;
  onComplete: () => void;
  isCompleting: boolean;
  isCompleted: boolean;
  completedTransactionData?: {
    completedAt: Date;
    cartItems: CartItem[];
    totalValue: number;
    notes?: string;
  } | null;
  onTransactionStateChange?: (isCompleted: boolean) => void;
}

export function ExpenseCompletion({
  cartItems,
  totalValue,
  notes,
  onNotesChange,
  onComplete,
  isCompleting,
  isCompleted,
  completedTransactionData,
  onTransactionStateChange,
}: ExpenseCompletionProps) {
  const { activeStore } = useGetActiveStore();
  const formatter = currencyFormatter(activeStore?.currency || "GHS");

  const cashierId = useExpenseStore((state) => state.cashier.id);
  const terminalId = useExpenseStore((state) => state.terminalId);
  const storeId = useExpenseStore((state) => state.storeId);
  const clearCashier = useExpenseStore((state) => state.clearCashier);
  const activeSession = useExpenseActiveSession(
    storeId,
    terminalId,
    cashierId || undefined,
  );
  const { voidSession } = useSessionManagementExpense();
  const cashier = useQuery(
    api.inventory.cashier.getById,
    cashierId ? { id: cashierId } : "skip",
  );
  const cashierName = cashier
    ? `${cashier.firstName} ${cashier.lastName.charAt(0)}.`
    : "Unassigned";

  const handleCashierSignOut = async () => {
    if (activeSession) {
      const result = await voidSession();
      if (!result.success) {
        toast.error(result.error);
        return;
      }
    }

    clearCashier();
  };

  //   if (isCompleted && completedTransactionData) {
  //     return (
  //       <div className="space-y-6">
  //         <div className="flex items-center justify-center p-8 bg-green-50 rounded-lg border-2 border-green-200">
  //           <div className="text-center space-y-4">
  //             <div className="flex items-center justify-center">
  //               <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center">
  //                 <Check className="w-8 h-8 text-white" />
  //               </div>
  //             </div>
  //             <div>
  //               <h3 className="text-xl font-semibold text-green-900">
  //                 Expense Recorded Successfully
  //               </h3>
  //               <p className="text-sm text-green-700 mt-2">
  //                 Total Value:{" "}
  //                 {formatter.format(completedTransactionData.totalValue)}
  //               </p>
  //             </div>
  //           </div>
  //         </div>

  //         {completedTransactionData.notes && (
  //           <div className="p-4 bg-gray-50 rounded-lg">
  //             <Label className="text-sm font-semibold">Notes</Label>
  //             <p className="text-sm text-gray-700 mt-1">
  //               {completedTransactionData.notes}
  //             </p>
  //           </div>
  //         )}

  //         <Button
  //           onClick={() => {
  //             onTransactionStateChange?.(false);
  //           }}
  //           className="w-full"
  //           size="lg"
  //         >
  //           Start New Expense
  //         </Button>
  //       </div>
  //     );
  //   }

  return (
    <div className="space-y-6">
      <div className="space-y-24">
        <div className="p-4 bg-gray-50 rounded-lg">
          <div className="flex justify-between items-center">
            <span className="text-sm font-medium text-gray-700">
              Total Value
            </span>
            <span className="text-4xl font-bold text-gray-900">
              {formatter.format(toDisplayAmount(totalValue))}
            </span>
          </div>
          {/* <p className="text-xs text-gray-500 mt-1">
            {cartItems.length} item{cartItems.length !== 1 ? "s" : ""}
          </p> */}
        </div>

        {/* <div className="space-y-2">
          <Label htmlFor="expense-notes">Notes (Optional)</Label>
          <Textarea
            id="expense-notes"
            placeholder="Enter reason for expense..."
            value={notes}
            onChange={(e) => onNotesChange(e.target.value)}
            rows={4}
            className="resize-none"
          />
        </div> */}

        <Button
          onClick={onComplete}
          disabled={isCompleting || cartItems.length === 0}
          className="w-full p-8 bg-green-500 text-white hover:text-white hover:bg-green-600"
          variant="outline"
          size="lg"
        >
          {isCompleting ? "Recording Expense..." : "Complete Expense"}
        </Button>

        {storeId && terminalId && cashierId && (
          <CashierView
            cashierName={cashierName}
            onSignOut={handleCashierSignOut}
          />
        )}
      </div>
    </div>
  );
}
