import { CheckCircle2, CircleDashed, RotateCcw } from "lucide-react";
import { capitalizeFirstLetter, slugToWords } from "~/src/lib/utils";
import { Badge } from "../ui/badge";

export const OrderStatus = ({ order }: { order: any }) => {
  const showCheck =
    order.status.includes("ready") ||
    order.status == "out-for-delivery" ||
    order.status == "delivered" ||
    order.status == "picked-up";

  return (
    <Badge
      variant="outline"
      className={`rounded-md px-2 py-1 ${
        order.status.includes("refunded")
          ? "bg-red-100 text-red-600"
          : order.status === "delivered" || order.status === "picked-up"
            ? "bg-green-100 text-green-600"
            : order.status === "out-for-delivery"
              ? "bg-blue-100 text-blue-600"
              : order.status.includes("ready")
                ? "bg-emerald-100 text-emerald-600"
                : "bg-zinc-100 text-zinc-600"
      }`}
    >
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
    </Badge>
  );
};
