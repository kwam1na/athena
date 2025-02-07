import { Check, Tag } from "lucide-react";
import View from "../View";
import { useOnlineOrder } from "~/src/contexts/OnlineOrderContext";
import { currencyFormatter } from "~/src/lib/utils";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { Badge } from "../ui/badge";

export function OrderDetailsView() {
  const { order } = useOnlineOrder();
  const { activeStore } = useGetActiveStore();

  if (!order || !activeStore) return null;

  const formatter = currencyFormatter(activeStore.currency);

  const amountRefunded =
    order?.refunds?.reduce((acc, refund) => acc + refund.amount, 0) || 0;

  const isFullyRefunded = amountRefunded === order.amount;

  const isPartiallyRefunded =
    amountRefunded > 0 && amountRefunded < order.amount;

  const isOrderRefunded = isFullyRefunded || isPartiallyRefunded;

  const refundText = isFullyRefunded
    ? "Refunded"
    : isPartiallyRefunded
      ? "Partially refunded"
      : "Refund pending";

  const { paymentMethod } = order;

  const paymentChannel =
    paymentMethod?.channel == "mobile_money" ? "Mobile Money" : "Card";

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="h-auto w-full"
      header={<p className="text-sm text-sm text-muted-foreground">Payment</p>}
    >
      <div className="py-4">
        <div className="space-y-4">
          <div className="flex items-center gap-8">
            <div className="space-y-2">
              <p className="text-sm">{`${paymentMethod?.bank} ${paymentChannel}`}</p>
              {/* <p className="text-sm text-muted-foreground">Payment channel</p> */}
            </div>

            {order.hasVerifiedPayment && (
              <Badge variant={"outline"} className="bg-green-50 text-green-600">
                <p className="text-xs mr-2">Verified</p>
                <Check className="h-4 w-4" />
              </Badge>
            )}

            {!order.hasVerifiedPayment && (
              <Badge
                variant={"outline"}
                className="text-yellow-600 bg-yellow-50"
              >
                <p className="text-xs">Not verified</p>
              </Badge>
            )}
          </div>

          <div className="space-y-4">
            <p className="text-sm">{`Account ending in ${paymentMethod?.last4}`}</p>
          </div>
        </div>
      </div>
    </View>
  );
}
