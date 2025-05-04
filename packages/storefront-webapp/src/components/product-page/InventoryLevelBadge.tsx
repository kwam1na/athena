import { Badge } from "../ui/badge";

export const SoldOutBadge = () => {
  return (
    <Badge
      variant={"outline"}
      className="bg-red-100 border-red-100 text-red-600"
    >
      Sold Out
    </Badge>
  );
};

export const LowStockBadge = ({ message }: { message: string }) => {
  return (
    <Badge variant={"outline"} className="border-yellow-600 text-yellow-600">
      {message}
    </Badge>
  );
};

export const SellingFastBadge = () => {
  return (
    <Badge variant={"outline"} className="border-orange-600 text-orange-600">
      🔥 Selling fast — Few left!
    </Badge>
  );
};

export const SellingFastSignal = ({ message }: { message: string }) => {
  return (
    <div className="flex items-center gap-2">
      <SellingFastBadge />
      {/* <LowStockBadge message={message} /> */}
    </div>
  );
};
