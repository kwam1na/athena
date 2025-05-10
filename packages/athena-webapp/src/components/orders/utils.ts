export const getOrderState = (order: any) => {
  const isOrderOpen = order?.status === "open";

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
