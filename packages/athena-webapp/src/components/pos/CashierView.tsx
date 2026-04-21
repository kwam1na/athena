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
    <div className="h-[96px] w-full border rounded-lg p-4 bg-gradient-to-br from-gray-50/50 to-gray-100/30">
      <div className="flex items-center justify-between">
        <p className="text-md font-medium">Cashier</p>
        <div className="flex items-center gap-2">
          <p className="font-medium capitalize">{cashierName}</p>
        </div>
      </div>
      <div className="flex">
        <Button
          variant="link"
          onClick={onSignOut}
          className="ml-auto px-0"
          title="Sign out"
        >
          <p className="text-muted-foreground font-semibold">Sign out</p>
        </Button>
      </div>
    </div>
  );
};
