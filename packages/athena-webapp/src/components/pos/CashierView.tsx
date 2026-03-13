import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import { Id } from "~/convex/_generated/dataModel";
import { Button } from "../ui/button";
import { usePOSStore } from "~/src/stores/posStore";
import { useExpenseStore } from "~/src/stores/expenseStore";
import { toast } from "sonner";
import { usePOSActiveSession } from "~/src/hooks/usePOSSessions";
import { useExpenseActiveSession } from "~/src/hooks/useExpenseSessions";
import { useSessionManagerOperations } from "~/src/hooks/useSessionManagerOperations";
import { usePOSOperations } from "~/src/hooks/usePOSOperations";
import { useSessionManagementExpense } from "~/src/hooks/useSessionManagementExpense";

interface CashierViewProps {
  storeId: Id<"store">;
  terminalId: Id<"posTerminal">;
  cashierId: Id<"cashier">;
  sessionType?: "pos" | "expense";
}

export const CashierView = ({
  storeId,
  terminalId,
  cashierId,
  sessionType = "pos",
}: CashierViewProps) => {
  const posStore = usePOSStore();
  const expenseStore = useExpenseStore();
  const store = sessionType === "pos" ? posStore : expenseStore;

  const { state: posState } = usePOSOperations();
  const isTransactionCompleted =
    sessionType === "pos"
      ? posState.isTransactionCompleted
      : expenseStore.transaction.isCompleted;

  const posActiveSession = usePOSActiveSession(storeId, terminalId, cashierId);
  const expenseActiveSession = useExpenseActiveSession(
    storeId,
    terminalId,
    cashierId
  );
  const activeSession =
    sessionType === "pos" ? posActiveSession : expenseActiveSession;

  const {
    handleHoldCurrentSession: handleHoldPOSSession,
    handleVoidSession: handleVoidPOSSession,
  } = useSessionManagerOperations(storeId, terminalId, cashierId);

  const { holdSession: holdExpenseSession, voidSession: voidExpenseSession } =
    useSessionManagementExpense();

  const cashier = useQuery(
    api.inventory.cashier.getById,
    cashierId ? { id: cashierId } : "skip"
  );

  const displayName = cashier
    ? `${cashier.firstName} ${cashier.lastName.charAt(0)}.`
    : "Unassigned";

  const handleSignOut = async () => {
    const session = activeSession || store.session.activeSession;

    if (session) {
      if (store.cart.items.length) {
        // Hold session if it has items
        if (sessionType === "pos") {
          const holdResult = await handleHoldPOSSession("Signing out");
          if (!holdResult.success) {
            toast.error(holdResult.error);
            return;
          }
        } else {
          const holdResult = await voidExpenseSession();
          if (!holdResult.success) {
            toast.error(holdResult.error);
            return;
          }
        }
        store.clearCashier();
        return;
      }

      // Void empty session
      if (sessionType === "pos") {
        const voidResult = await handleVoidPOSSession(
          session._id as Id<"posSession">
        );
        if (!voidResult.success) {
          toast.error(voidResult.error);
          return;
        }
      } else {
        // Expense voidSession uses active session from store, no sessionId needed
        const voidResult = await voidExpenseSession();
        if (!voidResult.success) {
          toast.error(voidResult.error);
          return;
        }
      }

      store.clearCashier();
    } else {
      store.clearCashier();
    }
  };

  if (isTransactionCompleted) {
    return null;
  }

  return (
    <div className="h-[96px] w-full border rounded-lg p-4 bg-gradient-to-br from-gray-50/50 to-gray-100/30">
      <div className="flex items-center justify-between">
        <p className="text-md font-medium">Cashier</p>
        <div className="flex items-center gap-2">
          <p className="font-medium capitalize">{displayName}</p>
        </div>
      </div>
      <div className="flex">
        {cashierId && (
          <Button
            variant="link"
            onClick={handleSignOut}
            className="ml-auto px-0"
            title="Sign out"
          >
            <p className="text-muted-foreground font-semibold">Sign out</p>
          </Button>
        )}
      </div>
    </div>
  );
};
