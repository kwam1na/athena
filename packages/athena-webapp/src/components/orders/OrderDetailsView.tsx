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

  const netAmount = order.amount - amountRefunded;

  return (
    <View
      className="h-auto w-full"
      header={<p className="text-sm text-sm text-muted-foreground">Details</p>}
    >
      <div className="p-8 grid grid-cols-2 gap-16">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Total</p>
          <p className="text-sm">{formatter.format(order.amount / 100)}</p>
        </div>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Payment status</p>
          {order.hasVerifiedPayment && !isOrderRefunded && (
            <div className="flex gap-2 items-center">
              <p className="text-sm">Fully paid</p>
              <Check className="h-4 w-4 text-green-700" />
            </div>
          )}

          {Boolean(amountRefunded) && <p className="text-sm">{refundText}</p>}

          {!order.hasVerifiedPayment && (
            <div className="flex gap-2 items-center">
              <p className="text-sm">Not verified</p>
            </div>
          )}
        </div>

        {Boolean(amountRefunded) && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Refunded</p>
            <p className="text-sm">{`- ${formatter.format(amountRefunded / 100)}`}</p>
          </div>
        )}

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Payment channel</p>
          <p className="text-sm">{`${paymentMethod?.bank} ${paymentChannel}`}</p>
        </div>

        {Boolean(amountRefunded) && Boolean(netAmount) && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Net</p>
            <p className="text-sm">{formatter.format(netAmount / 100)}</p>
          </div>
        )}

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Payment method</p>
          <p className="text-sm">{`Account ending in ${paymentMethod?.last4}`}</p>
        </div>
      </div>
    </View>
  );
}
