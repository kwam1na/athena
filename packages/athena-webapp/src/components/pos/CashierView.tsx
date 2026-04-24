import { Button } from "../ui/button";

interface CashierViewProps {
  cashierName: string;
  onSignOut: () => void | Promise<void>;
}

export const CashierView = ({
  cashierName,
  onSignOut,
}: CashierViewProps) => {
  return (
    <div className="h-20 w-full rounded-lg border bg-gradient-to-br from-gray-50/50 to-gray-100/30 p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Cashier</p>
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium capitalize">{cashierName}</p>
        </div>
      </div>
      <div className="flex">
        <Button
          variant="link"
          onClick={onSignOut}
          className="ml-auto h-10 px-2"
          title="Sign out"
        >
          <p className="text-sm font-semibold text-muted-foreground">Sign out</p>
        </Button>
      </div>
    </div>
  );
};
