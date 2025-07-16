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

  const discountValue = getDiscountValue(order.amount, order.discount);

  const discount =
    order.discount && order.discount?.type === "percentage"
      ? discountValue
      : discountValue * 100;

  const amountPaid = getAmountPaidForOrder(order);

  const amountRefunded =
    order?.refunds?.reduce((acc, refund) => acc + refund.amount, 0) || 0;

  const netAmount = amountPaid - amountRefunded;

  const discountText =
    order.discount?.type === "percentage"
      ? `${order.discount.value}%`
      : `${formatter.format(discountValue)}`;

  return (
    <div className="space-y-4">
      <div className="flex justify-between">
        <p className="text-sm">Subtotal</p>
        <p className="text-sm">{formatter.format(order.amount / 100)}</p>
      </div>

      {order.deliveryFee && (
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
                  {`${order.discount?.code} - ${discountText}`} off entire order
                </p>
              </div>
            </div>

            <p className="text-sm">{formatter.format(discount / 100)}</p>
          </div>

          <div className="flex text-sm justify-between font-medium">
            <strong>Amount paid</strong>
            <strong>{formatter.format(amountPaid / 100)}</strong>
          </div>
        </>
      )}

      {!order.discount && (
        <div className="flex text-sm justify-between">
          <strong>Amount paid</strong>
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
