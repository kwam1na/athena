import { Discount } from "./CheckoutProvider";

export type BagItem = {
  productSkuId: string;
  quantity: number;
  price: number;
};

/**
 * Calculate the discount value based on discount type and span
 * @param items - Array of bag items with productSkuId, quantity, and price
 * @param discount - Discount object with type, value, span, and optional productSkus
 * @returns The total discount amount in the same currency unit as item prices
 */
export const getDiscountValue = (
  items: BagItem[],
  discount?: Discount | null,
  isInCents?: boolean
): number => {
  if (!discount) return 0;

  // Handle entire-order discounts
  if (discount.span === "entire-order") {
    const subtotal = items.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );

    if (discount.type === "percentage") {
      return subtotal * (discount.value / 100) * (isInCents ? 100 : 1);
    }
    // For amount type, apply discount value directly
    return discount.value * (isInCents ? 100 : 1);
  }

  // Handle selected-products discounts
  if (discount.span === "selected-products" && discount.productSkus) {
    // Calculate subtotal of only eligible items
    const eligibleItemsSubtotal = items
      .filter((item) => discount.productSkus?.includes(item.productSkuId))
      .reduce((sum, item) => sum + item.price * item.quantity, 0);

    if (discount.type === "percentage") {
      return (
        eligibleItemsSubtotal * (discount.value / 100) * (isInCents ? 100 : 1)
      );
    }
    // For amount type, apply discount value to eligible items
    // Note: amount discounts are typically applied once, not per item
    return (
      Math.min(discount.value, eligibleItemsSubtotal) * (isInCents ? 100 : 1)
    );
  }

  return 0;
};

export const getOrderAmount = ({
  items,
  discount,
  deliveryFee,
  subtotal,
  isInCents,
}: {
  items: BagItem[];
  discount?: Discount | null;
  deliveryFee: number | null;
  subtotal: number;
  isInCents?: boolean;
}) => {
  const discountValue = getDiscountValue(items, discount, isInCents);
  return subtotal - discountValue + (deliveryFee || 0);
};
