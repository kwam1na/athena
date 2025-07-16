export const getOrderState = (order: any) => {
  const isOrderOpen = order?.status === "open";

  const isOrderCancelled = order?.status === "cancelled";

  // covers ready-for-pickup and ready-for-delivery
  const isOrderReady = order?.status.includes("ready");

  const isOrderOutForDelivery = order?.status.includes("out-for-delivery");

  const isOrderDelivered = order?.status.includes("delivered");

  const isOrderPickedUp = order?.status.includes("picked-up");

  const hasOrderTransitioned =
    isOrderOutForDelivery || isOrderPickedUp || isOrderDelivered;

  const amountRefunded =
    order?.refunds?.reduce(
      (acc: number, refund: any) => acc + refund.amount,
      0
    ) || 0;

  const isFullyRefunded = amountRefunded === order.amount;

  const isPartiallyRefunded =
    amountRefunded > 0 && amountRefunded < order.amount;

  const hasIssuedRefund = order.status === "refunded";

  const isRefundPending = ["refund-pending", "refund-processing"].includes(
    order.status
  );

  const isOrderCompleted =
    isOrderDelivered || isOrderPickedUp || isFullyRefunded;

  return {
    isFullyRefunded,
    isPartiallyRefunded,
    hasIssuedRefund,
    isRefundPending,
    amountRefunded,
    isOrderOpen,
    isOrderCancelled,
    isOrderReady,
    isOrderOutForDelivery,
    isOrderDelivered,
    isOrderPickedUp,
    hasOrderTransitioned,
    isOrderCompleted,
  };
};

export const getDiscountValue = (
  subtotal: number,
  discount?: Record<string, any> | null
) => {
  return (
    (discount?.type === "percentage"
      ? (subtotal * discount?.value) / 100
      : discount?.value) || 0
  );
};

export const getAmountPaidForOrder = (order: any) => {
  const discountValue = getDiscountValue(order.amount, order.discount);

  const discount =
    order.discount && order.discount?.type === "percentage"
      ? discountValue
      : discountValue * 100;

  const orderAmount = order.amount + (order.deliveryFee || 0) * 100;

  return orderAmount - discount;
};
