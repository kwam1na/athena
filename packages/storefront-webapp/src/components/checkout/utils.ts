import { Discount, Address } from "./types";
import { ALL_COUNTRIES } from "@/lib/countries";
import { GHANA_REGIONS } from "@/lib/ghanaRegions";
import { accraNeighborhoods } from "@/lib/ghana";

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
  const amountCharged = subtotal - discountValue + (deliveryFee || 0);
  const amountPaid = subtotal - discountValue;

  return { amountCharged, discountValue, amountPaid };
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
    const region = GHANA_REGIONS.find((r) => r.code == address.region)?.name;
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
