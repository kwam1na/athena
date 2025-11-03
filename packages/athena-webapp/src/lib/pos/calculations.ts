import { CartItem } from "@/components/pos/types";

/**
 * Calculate cart totals including subtotal, tax, and total
 *
 * @param items - Array of cart items
 * @param taxRate - Tax rate as a decimal (e.g., 0.08 for 8%). Defaults to 0.
 * @returns Object containing subtotal, tax, and total
 */
export function calculateCartTotals(
  items: CartItem[],
  taxRate: number = 0
): {
  subtotal: number;
  tax: number;
  total: number;
} {
  const subtotal = items.reduce(
    (sum: number, item: CartItem) => sum + item.price * item.quantity,
    0
  );

  const tax = subtotal * taxRate;
  const total = subtotal + tax;

  return {
    subtotal,
    tax,
    total,
  };
}
