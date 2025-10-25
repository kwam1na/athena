import { Address } from "../../types";
import { ALL_COUNTRIES } from "../constants/countries";
import { accraNeighborhoods, ghanaRegions } from "../constants/ghana";

type OrderItem = {
  productSkuId: string;
  quantity: number;
  price: number;
};

type Discount = {
  type?: "percentage" | "amount";
  discountType?: "percentage" | "amount";
  value?: number;
  discountValue?: number;
  span?: "entire-order" | "selected-products";
  productSkus?: string[];
  totalDiscount?: number;
};

/**
 * Calculate the discount value based on discount type and span
 * @param items - Array of order items with productSkuId, quantity, and price (in GHS)
 * @param discount - Discount object with type, value, span, and optional productSkus
 * @returns The total discount amount in pesewas/cents
 */
export const getDiscountValue = (
  items: OrderItem[],
  discount?: Discount | null
): number => {
  if (!discount) return 0;

  // If totalDiscount is pre-calculated (from backend), use it directly
  if (discount.totalDiscount !== undefined) {
    return discount.totalDiscount * 100; // Convert to pesewas
  }

  const type = discount.type || discount.discountType;
  const value = discount.value || discount.discountValue;

  if (!type || value === undefined) return 0;

  // Handle entire-order discounts
  if (discount.span === "entire-order" || !discount.span) {
    const subtotal = items.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    ); // subtotal is in GHS

    if (type === "percentage") {
      return subtotal * (value / 100) * 100; // Calculate discount in GHS, then convert to pesewas
    }
    // For amount type, discount value is in GHS, convert to pesewas
    return value * 100;
  }

  // Handle selected-products discounts
  if (discount.span === "selected-products" && discount.productSkus) {
    // Calculate subtotal of only eligible items (in GHS)
    const eligibleItemsSubtotal = items
      .filter((item) => discount.productSkus?.includes(item.productSkuId))
      .reduce((sum, item) => sum + item.price * item.quantity, 0);

    if (type === "percentage") {
      return eligibleItemsSubtotal * (value / 100) * 100; // Calculate discount in GHS, then convert to pesewas
    }
    // For amount type, discount value is in GHS, convert to pesewas
    // Don't exceed the eligible items subtotal
    return Math.min(value * 100, eligibleItemsSubtotal * 100);
  }

  return 0;
};

/**
 * Calculate discount for a single product (useful for displaying individual product discounts)
 * @param price - Product price in GHS
 * @param discount - Discount object
 * @returns The discount amount in GHS (for display/email purposes)
 */
export const getProductDiscountValue = (
  price: number,
  discount?: Discount | null
): number => {
  if (!discount) return 0;

  const type = discount.type || discount.discountType;
  const value = discount.value || discount.discountValue;

  if (!type || value === undefined) return 0;

  if (type === "percentage") {
    return price * (value / 100);
  }
  // For amount type, discount value is in GHS, don't exceed product price
  return Math.min(value, price);
};

export const getOrderAmount = ({
  items,
  discount,
  deliveryFee,
  subtotal,
}: {
  items: OrderItem[];
  discount?: Discount | null;
  deliveryFee: number | null;
  subtotal: number;
}) => {
  const discountValue = getDiscountValue(items, discount);
  return Math.round(subtotal - discountValue + (deliveryFee || 0));
};

/**
 * Format delivery address details based on country
 * @param address - Address object containing delivery details
 * @returns Object with formatted address line and country name
 */
export const formatDeliveryAddress = (address: Address) => {
  if (!address) return { addressLine: "", country: "" };

  const country = ALL_COUNTRIES.find((c) => c.code == address.country)?.name;

  const isUSOrder = address.country === "US";
  const isGHOrder = address.country === "GH";
  const isROWOrder = !isUSOrder && !isGHOrder;

  let addressLine = "";

  if (isUSOrder) {
    addressLine = `${address.address}, ${address.city}, ${address.state}, ${address.zip}`;
  }

  if (isROWOrder) {
    addressLine = `${address.address}, ${address.city}`;
  }

  if (isGHOrder) {
    const region = ghanaRegions.find((r) => r.code == address.region)?.name;
    const neighborhood = accraNeighborhoods.find(
      (n) => n.value == address?.neighborhood
    )?.label;
    addressLine = `${address?.houseNumber || ""} ${address?.street}, ${neighborhood}, ${region}`;
  }

  return {
    addressLine: addressLine.trim(),
    country,
  };
};
