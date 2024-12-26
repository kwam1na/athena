import { Check, CheckCircle2 } from "lucide-react";
import View from "../View";
import { useOnlineOrder } from "~/src/contexts/OnlineOrderContext";
import { currencyFormatter, getRelativeTime } from "~/src/lib/utils";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";

export function OrderDetailsView() {
  const { order } = useOnlineOrder();
  const { activeStore } = useGetActiveStore();

  if (!order || !activeStore) return null;

  const formatter = currencyFormatter(activeStore.currency);

  // console.log(order);

  const { paymentMethod } = order;

  const paymentChannel =
    paymentMethod?.channel == "mobile_money" ? "Mobile Money" : "Card";

  return (
    <View
      className="h-auto w-full"
      header={<p className="text-sm text-sm text-muted-foreground">Details</p>}
    >
      <div className="p-8 flex items-center justify-between">
        {/* <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Placed</p>
          <p className="text-sm">{getRelativeTime(order._creationTime)}</p>
        </div> */}

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Total</p>
          <p className="text-sm">{formatter.format(order.amount / 100)}</p>
        </div>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Payment status</p>
          {order.hasVerifiedPayment && (
            <div className="flex gap-2 items-center">
              <p className="text-sm">Verified</p>
              <Check className="h-4 w-4 text-green-700" />
            </div>
          )}

          {!order.hasVerifiedPayment && (
            <div className="flex gap-2 items-center">
              <p className="text-sm">Not verified</p>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Payment channel</p>
          <p className="text-sm">{`${paymentMethod?.bank} ${paymentChannel}`}</p>
        </div>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Payment method</p>
          <p className="text-sm">{`Account ending in ${paymentMethod?.last4}`}</p>
        </div>
      </div>
    </View>
  );
}
