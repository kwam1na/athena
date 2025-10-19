import { useOnlineOrder } from "~/src/contexts/OnlineOrderContext";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { currencyFormatter } from "~/src/lib/utils";
import { getAmountPaidForOrder, getDiscountValue } from "./utils";
import { Tag } from "lucide-react";

export const OrderSummary = () => {
  const { order } = useOnlineOrder();
  const { activeStore } = useGetActiveStore();

  if (!order || !activeStore) return null;

  const formatter = currencyFormatter(activeStore.currency);

  const discountValue = getDiscountValue(order, true);

  const discount =
    order.discount && order.discount?.type === "percentage"
      ? discountValue
      : discountValue * 100;

  const amountPaid = getAmountPaidForOrder(order);

  const isPODOrder =
    order.isPODOrder || order.paymentMethod?.type === "payment_on_delivery";

  const amountPaidLabel = isPODOrder
    ? order.paymentCollected
      ? "Amount paid"
      : "Amount to collect"
    : "Amount paid";

  const amountRefunded =
    order?.refunds?.reduce((acc, refund) => acc + refund.amount, 0) || 0;

  const netAmount = amountPaid - amountRefunded;

  const discountText =
    order.discount?.type === "percentage"
      ? `${order.discount.value}%`
      : `${formatter.format(discountValue)}`;

  const discountSpan =
    order.discount?.span == "entire-order" ? "entire order" : "select items";

  return (
    <div className="space-y-4">
      <div className="flex justify-between">
        <p className="text-sm">Subtotal</p>
        <p className="text-sm">{formatter.format(order.amount / 100)}</p>
      </div>

      {Boolean(order.deliveryFee) && order.deliveryFee && (
        <div className="flex justify-between">
          <p className="text-sm">Delivery fees</p>
          <p className="text-sm">{formatter.format(order.deliveryFee)}</p>
        </div>
      )}

      {order.discount && (
        <>
          <div className="flex justify-between">
            <div>
              <div className="flex gap-2 items-center">
                <p className="text-sm">Discounts</p>
                <Tag className="w-3 h-3" />
                <p className="text-sm">
                  {`${order.discount?.code} - ${discountText}`} off{" "}
                  {discountSpan}
                </p>
              </div>
            </div>

            <p className="text-sm">{formatter.format(discount / 100)}</p>
          </div>

          <div className="flex text-sm justify-between font-medium">
            <strong>{amountPaidLabel}</strong>
            <strong>{formatter.format(amountPaid / 100)}</strong>
          </div>
        </>
      )}

      {!order.discount && (
        <div className="flex text-sm justify-between">
          <strong>{amountPaidLabel}</strong>
          <strong>{formatter.format(amountPaid / 100)}</strong>
        </div>
      )}

      {Boolean(amountRefunded) && (
        <div className="flex text-sm justify-between">
          <strong>Refunded</strong>
          <strong>{`- ${formatter.format(amountRefunded / 100)}`}</strong>
        </div>
      )}

      {Boolean(amountRefunded) && Boolean(netAmount) && (
        <div className="flex text-sm justify-between">
          <strong>Net</strong>
          <strong>{formatter.format(netAmount / 100)}</strong>
        </div>
      )}
    </div>
  );
};
