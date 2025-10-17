import { Id } from "../../_generated/dataModel";
import { getDiscountValue, getOrderAmount } from "../../inventory/utils";
import { OrderItem } from "../../types/payment";
import { PAYMENT_CONSTANTS } from "../../constants/payment";

/**
 * Generate a Payment on Delivery reference
 */
export function generatePODReference(
  checkoutSessionId: Id<"checkoutSession">
): string {
  return `POD-${Date.now()}-${checkoutSessionId}`;
}

/**
 * Extract order items from session or order data
 */
export function extractOrderItems(
  items: Array<{
    productSkuId: Id<"productSku">;
    quantity: number;
    price: number;
  }>
): OrderItem[] {
  return items.map((item) => ({
    productSkuId: item.productSkuId,
    quantity: item.quantity,
    price: item.price,
  }));
}

/**
 * Calculate the total order amount including discounts and fees
 */
export function calculateOrderAmount(params: {
  items: OrderItem[];
  discount: any;
  deliveryFee: number;
  subtotal: number;
}): number {
  return getOrderAmount({
    items: params.items,
    discount: params.discount,
    deliveryFee: params.deliveryFee,
    subtotal: params.subtotal,
  });
}

/**
 * Calculate reward points for an order
 * Points are calculated as 10 points per dollar (amount / 1000)
 */
export function calculateRewardPoints(amount: number): number {
  const pointsToAward = amount / PAYMENT_CONSTANTS.POINTS_DIVISOR;
  return Math.floor(pointsToAward);
}

/**
 * Validate that the payment amount matches the expected order amount
 */
export function validatePaymentAmount(params: {
  paystackAmount: number;
  orderAmount: number;
  paystackStatus: string;
}): boolean {
  return (
    params.paystackStatus === "success" &&
    params.paystackAmount === params.orderAmount
  );
}

/**
 * Get the discount value for an order
 */
export function getOrderDiscountValue(
  items: OrderItem[],
  discount: any
): number {
  return getDiscountValue(items, discount);
}
