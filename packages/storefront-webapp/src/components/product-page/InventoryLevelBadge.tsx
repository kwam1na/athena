import { Badge } from "../ui/badge";

export const SoldOutBadge = () => {
  return (
    <Badge variant={"outline"} className="bg-primary/90 text-gray-50">
      Sold Out
    </Badge>
  );
};

export const LowStockBadge = ({ message }: { message: string }) => {
  return (
    <Badge
      variant={"outline"}
      className="bg-yellow-50 text-yellow-600 border-yellow-50"
    >
      {message}
    </Badge>
  );
};

export const SellingFastBadge = () => {
  return (
    <Badge variant={"outline"} className="bg-red-50 text-red-600 border-red-50">
      🔥 Selling fast
    </Badge>
  );
};

export const SellingFastSignal = ({ message }: { message: string }) => {
  return (
    <div className="flex items-center gap-2">
      <SellingFastBadge />
      <LowStockBadge message={message} />
    </div>
  );
};
