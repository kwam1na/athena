export function getOnlineOrderPlacedAt(order: {
  _creationTime: number;
  placedAt?: number;
}) {
  return order.placedAt ?? order._creationTime;
}

type OrderRefund = {
  amount: number;
};

type OrderDiscount = {
  productSkus?: string[];
  span?: string;
  type?: string;
  value?: number;
};

type OrderLineItem = {
  price: number;
  productSkuId?: string;
  quantity: number;
};

type OrderStateInput = {
  amount?: number;
  deliveryFee?: number | null;
  deliveryMethod?: string;
  discount?: OrderDiscount | null;
  isPODOrder?: boolean;
  items?: OrderLineItem[];
  paymentCollected?: boolean;
  paymentMethod?: {
    type?: string;
  } | null;
  refunds?: OrderRefund[];
  status: string;
};

export const getOrderState = (order: OrderStateInput) => {
  const isOrderOpen = order?.status === "open";

  const isOrderCancelled = order?.status === "cancelled";

  // covers ready-for-pickup and ready-for-delivery
  const isOrderReady = order?.status.includes("ready");

  const isOrderOutForDelivery = order?.status.includes("out-for-delivery");

  const isOrderDelivered = order?.status.includes("delivered");

  const isOrderPickedUp = order?.status.includes("picked-up");

  const isPickupException = order?.status === "pickup-exception";

  const hasOrderTransitioned =
    isOrderOutForDelivery ||
    isOrderPickedUp ||
    isOrderDelivered ||
    isPickupException;

  const amountRefunded =
    order?.refunds?.reduce(
      (acc: number, refund: OrderRefund) => acc + refund.amount,
      0
    ) || 0;

  const orderAmount = order.amount ?? 0;

  const isFullyRefunded = amountRefunded === orderAmount;

  const isPartiallyRefunded =
    amountRefunded > 0 && amountRefunded < orderAmount;

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
    isPickupException,
    hasOrderTransitioned,
    isOrderCompleted,
  };
};

export const getPickupActionState = (order: OrderStateInput) => {
  const { isOrderReady, isPickupException } = getOrderState(order);
  const isPickupOrder = order?.deliveryMethod === "pickup";
  const isPODOrder =
    order?.isPODOrder || order?.paymentMethod?.type === "payment_on_delivery";

  return {
    canMarkPickupException: isPickupOrder && isOrderReady,
    canResolvePickupException: isPickupOrder && isPickupException,
    needsPickupPaymentCollection:
      isPickupOrder && isOrderReady && isPODOrder && !order?.paymentCollected,
  };
};

export function shouldShowPickupExceptionAction(input: {
  canMarkPickupException: boolean;
  isSharedDemo: boolean;
}) {
  return input.canMarkPickupException && !input.isSharedDemo;
}

/**
 * Calculate the discount value based on discount type and span
 * @param items - Array of bag items with productSkuId, quantity, and price
 * @param discount - Discount object with type, value, span, and optional productSkus
 * @returns The total discount amount in the same currency unit as item prices
 */
export const getDiscountValue = (
  order: Pick<OrderStateInput, "discount" | "items">,
  isInCents?: boolean
): number => {
  const discount = order.discount;
  const items = order.items ?? [];

  if (!discount) return 0;

  // Handle entire-order discounts
  if (discount.span === "entire-order") {
    const subtotal = items.reduce(
      (sum: number, item: OrderLineItem) => sum + item.price * item.quantity,
      0
    );

    const discountValue = discount.value ?? 0;

    if (discount.type === "percentage") {
      return subtotal * (discountValue / 100) * (isInCents ? 100 : 1);
    }
    // For amount type, apply discount value directly
    return discountValue * (isInCents ? 100 : 1);
  }

  // Handle selected-products discounts
  if (
    discount.span === "selected-products" &&
    discount.productSkus
  ) {
    // Calculate subtotal of only eligible items
    const eligibleItemsSubtotal = items
      .filter((item: OrderLineItem) =>
        item.productSkuId
          ? discount.productSkus?.includes(item.productSkuId)
          : false
      )
      .reduce(
        (sum: number, item: OrderLineItem) => sum + item.price * item.quantity,
        0
      );

    const discountValue = discount.value ?? 0;

    if (discount.type === "percentage") {
      return (
        eligibleItemsSubtotal *
        (discountValue / 100) *
        (isInCents ? 100 : 1)
      );
    }
    // For amount type, apply discount value to eligible items
    // Note: amount discounts are typically applied once, not per item
    return (
      Math.min(discountValue, eligibleItemsSubtotal) *
      (isInCents ? 100 : 1)
    );
  }

  return 0;
};

export const getAmountPaidForOrder = (
  order: Pick<OrderStateInput, "amount" | "deliveryFee" | "discount" | "items">
) => {
  const discountValue = getDiscountValue(order, true); // returns pesewas

  const discount = discountValue; // getDiscountValue always returns pesewas

  const orderAmount = (order.amount ?? 0) + (order.deliveryFee || 0); // both pesewas

  return orderAmount - discount;
};
