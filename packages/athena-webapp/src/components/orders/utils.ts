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

/**
 * Calculate the discount value based on discount type and span
 * @param items - Array of bag items with productSkuId, quantity, and price
 * @param discount - Discount object with type, value, span, and optional productSkus
 * @returns The total discount amount in the same currency unit as item prices
 */
export const getDiscountValue = (order: any, isInCents?: boolean): number => {
  if (!order.discount) return 0;

  // Handle entire-order discounts
  if (order.discount.span === "entire-order") {
    const subtotal = order.items.reduce(
      (sum: number, item: any) => sum + item.price * item.quantity,
      0
    );

    if (order.discount.type === "percentage") {
      return subtotal * (order.discount.value / 100) * (isInCents ? 100 : 1);
    }
    // For amount type, apply discount value directly
    return order.discount.value * (isInCents ? 100 : 1);
  }

  // Handle selected-products discounts
  if (
    order.discount.span === "selected-products" &&
    order.discount.productSkus
  ) {
    // Calculate subtotal of only eligible items
    const eligibleItemsSubtotal = order.items
      .filter((item: any) =>
        order.discount.productSkus?.includes(item.productSkuId)
      )
      .reduce((sum: number, item: any) => sum + item.price * item.quantity, 0);

    if (order.discount.type === "percentage") {
      return (
        eligibleItemsSubtotal *
        (order.discount.value / 100) *
        (isInCents ? 100 : 1)
      );
    }
    // For amount type, apply discount value to eligible items
    // Note: amount discounts are typically applied once, not per item
    return (
      Math.min(order.discount.value, eligibleItemsSubtotal) *
      (isInCents ? 100 : 1)
    );
  }

  return 0;
};

export const getAmountPaidForOrder = (order: any) => {
  const discountValue = getDiscountValue(order) * 100;

  const discount =
    order.discount && order.discount?.type === "percentage"
      ? discountValue
      : discountValue * 100;

  const orderAmount = order.amount + (order.deliveryFee || 0) * 100;

  return orderAmount - discount;
};
