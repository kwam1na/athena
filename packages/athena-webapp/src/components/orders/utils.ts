import { getDiscountValue as sharedGetDiscountValue } from "~/shared/orderMath";

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
  code?: string;
  productSkus?: string[];
  span?: "entire-order" | "selected-products";
  totalDiscount?: number;
  type?: "percentage" | "amount";
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
      0,
    ) || 0;

  const orderAmount = order.amount ?? 0;

  const isFullyRefunded = amountRefunded === orderAmount;

  const isPartiallyRefunded =
    amountRefunded > 0 && amountRefunded < orderAmount;

  const hasIssuedRefund = order.status === "refunded";

  const isRefundPending = ["refund-pending", "refund-processing"].includes(
    order.status,
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
 * Discount value for an order, in pesewas.
 *
 * Delegates to `shared/orderMath`, which is the single authority every other
 * discount surface reads: order emails, the storefront order views, and the
 * checkout session panel. Order money — `items[].price`, `amount`,
 * `deliveryFee` and a fixed discount's `value` — is stored in pesewas, so no
 * scaling happens here. Callers convert once, at the display boundary.
 */
export const getDiscountValue = (
  order: Pick<OrderStateInput, "discount" | "items">,
): number => {
  const items = (order.items ?? [])
    .filter((item): item is OrderLineItem & { productSkuId: string } =>
      Boolean(item.productSkuId),
    )
    .map((item) => ({
      productSkuId: item.productSkuId,
      quantity: item.quantity,
      price: item.price,
    }));

  return sharedGetDiscountValue(items, order.discount);
};

export const getAmountPaidForOrder = (
  order: Pick<OrderStateInput, "amount" | "deliveryFee" | "discount" | "items">,
) => {
  const discount = getDiscountValue(order); // pesewas

  const orderAmount = (order.amount ?? 0) + (order.deliveryFee || 0); // both pesewas

  return orderAmount - discount;
};
