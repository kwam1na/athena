import {
  AlertCircleIcon,
  CheckCircle2,
  CircleDashed,
  RotateCcw,
  XCircle,
} from "lucide-react";
import { capitalizeFirstLetter, slugToWords } from "~/src/lib/utils";
import { Badge } from "../ui/badge";

export const OrderStatus = ({ order }: { order: { status: string } }) => {
  const showCheck =
    order.status.includes("ready") ||
    order.status == "out-for-delivery" ||
    order.status == "delivered" ||
    order.status == "picked-up";

  const showX = order.status === "cancelled";
  const showAlert = order.status === "pickup-exception";

  return (
    <Badge
      variant="outline"
      className={`rounded-md border-transparent px-2 py-1 ${
        order.status.includes("refunded")
          ? "bg-danger/10 text-danger"
          : order.status === "cancelled"
            ? "bg-danger/10 text-danger"
            : order.status === "pickup-exception"
              ? "bg-warning/10 text-warning"
              : order.status === "delivered" || order.status === "picked-up"
                ? "bg-success/10 text-success"
                : order.status === "out-for-delivery"
                  ? "bg-primary/10 text-primary"
                  : order.status.includes("ready")
                    ? "bg-success/10 text-success"
                    : "bg-muted text-muted-foreground"
      }`}
    >
      <div className="flex items-center">
        {showCheck && <CheckCircle2 className="h-3 w-3 mr-2" />}
        {order.status.includes("refunded") && (
          <RotateCcw className="h-3 w-3 mr-2" />
        )}
        {showX && <XCircle className="h-3 w-3 mr-2" />}
        {showAlert && <AlertCircleIcon className="h-3 w-3 mr-2" />}
        {order.status.includes("open") && (
          <CircleDashed className="h-3 w-3 mr-2" />
        )}
        <p>{capitalizeFirstLetter(slugToWords(order.status))}</p>
      </div>
    </Badge>
  );
};
