import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import { Id } from "~/convex/_generated/dataModel";
import { Button } from "../ui/button";
import { usePOSStore } from "~/src/stores/posStore";
import { toast } from "sonner";
import { usePOSActiveSession } from "~/src/hooks/usePOSSessions";
import { useSessionManagerOperations } from "~/src/hooks/useSessionManagerOperations";
import { usePOSOperations } from "~/src/hooks/usePOSOperations";

interface CashierViewProps {
  storeId: Id<"store">;
  terminalId: Id<"posTerminal">;
  cashierId: Id<"cashier">;
}

export const CashierView = ({
  storeId,
  terminalId,
  cashierId,
}: CashierViewProps) => {
  const store = usePOSStore();
  const { state } = usePOSOperations();

  const activeSession = usePOSActiveSession(storeId, terminalId, cashierId);

  const { handleHoldCurrentSession, handleVoidSession } =
    useSessionManagerOperations(storeId, terminalId, cashierId);

  const cashier = useQuery(
    api.inventory.cashier.getById,
    cashierId ? { id: cashierId } : "skip"
  );

  const displayName = cashier
    ? `${cashier.firstName} ${cashier.lastName.charAt(0)}.`
    : "Unassigned";

  const handleSignOut = async () => {
    const session = activeSession || store.session.activeSession;

    // if (session?.status === "active" && store.cart.items.length) {
    //   toast.error("Hold or void the session before signing out");
    //   return;
    // }

    if (session) {
      if (store.cart.items.length) {
        const holdResult = await handleHoldCurrentSession("Signing out");

        if (!holdResult.success) {
          toast.error(holdResult.error);
          return;
        }
        store.clearCashier();
        return;
      }

      const voidResult = await handleVoidSession(session._id);

      if (!voidResult.success) {
        toast.error(voidResult.error);
        return;
      }

      store.clearCashier();
    } else {
      store.clearCashier();
    }
  };

  if (state.isTransactionCompleted) {
    return null;
  }

  return (
    <div className="h-[96px] w-full border rounded-lg p-4">
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
