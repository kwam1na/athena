import { StatusBadge } from "../ui/status-badge";

export const SoldOutBadge = () => {
  return (
    <StatusBadge tone="danger">
      Sold Out
    </StatusBadge>
  );
};

export const LowStockBadge = ({ message }: { message: string }) => {
  return (
    <StatusBadge tone="warning">
      {message}
    </StatusBadge>
  );
};

export const SellingFastBadge = () => {
  return (
    <StatusBadge tone="warning">
      🔥 Selling fast — Few left!
    </StatusBadge>
  );
};

export const SellingFastSignal = ({ message: _message }: { message: string }) => {
  return (
    <div className="flex items-center gap-2">
      <SellingFastBadge />
      {/* <LowStockBadge message={message} /> */}
    </div>
  );
};
