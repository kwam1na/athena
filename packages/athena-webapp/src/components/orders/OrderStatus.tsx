import { CheckCircle2, CircleDashed, RotateCcw } from "lucide-react";
import { capitalizeFirstLetter, slugToWords } from "~/src/lib/utils";

export const OrderStatus = ({ order }: { order: any }) => {
  const showCheck =
    order.status.includes("ready") ||
    order.status == "out-for-delivery" ||
    order.status == "delivered" ||
    order.status == "picked-up";

  return (
    <div className="flex items-center">
      {showCheck && <CheckCircle2 className="h-3 w-3 mr-2" />}
      {order.status.includes("refunded") && (
        <RotateCcw className="h-3 w-3 mr-2" />
      )}
      {order.status.includes("open") && (
        <CircleDashed className="h-3 w-3 mr-2" />
      )}
      <p>{capitalizeFirstLetter(slugToWords(order.status))}</p>
    </div>
  );
};
