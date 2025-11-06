/**
 * Calculation Service
 *
 * Handles all POS cart calculations including totals, tax, and pricing.
 * Extracted from posStore for better separation of concerns.
 */

export interface CartItem {
  id: string;
  price: number;
  quantity: number;
  areProcessingFeesAbsorbed?: boolean;
}

export interface CartTotals {
  subtotal: number;
  tax: number;
  total: number;
}

/**
 * Tax rate for calculations (default 10%)
 * In a production system, this would come from store configuration
 */
const TAX_RATE = 0.0;

/**
 * Calculates cart totals including subtotal, tax, and total
 */
export function calculateCartTotals(items: CartItem[]): CartTotals {
  if (!items || items.length === 0) {
    return {
      subtotal: 0,
      tax: 0,
      total: 0,
    };
  }

  // Calculate subtotal (sum of price * quantity for all items)
  const subtotal = items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );

  // Calculate tax on subtotal
  const tax = subtotal * TAX_RATE;

  // Calculate total
  const total = subtotal + tax;

  return {
    subtotal: Number(subtotal.toFixed(2)),
    tax: Number(tax.toFixed(2)),
    total: Number(total.toFixed(2)),
  };
}

/**
 * Calculates total for a single item
 */
export function calculateItemTotal(price: number, quantity: number): number {
  return Number((price * quantity).toFixed(2));
}

/**
 * Calculates change to give customer
 */
export function calculateChange(amountPaid: number, total: number): number {
  return Number((amountPaid - total).toFixed(2));
}

/**
 * Formats a number as currency
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

/**
 * Validates that payment amount is sufficient
 */
export function isPaymentSufficient(
  amountPaid: number,
  total: number
): boolean {
  return amountPaid >= total;
}

/**
 * Gets the effective price for a product
 * Handles processing fees if they're absorbed
 */
export function getEffectivePrice(
  price: number,
  areProcessingFeesAbsorbed?: boolean
): number {
  // If processing fees are absorbed, we don't modify the price
  // This is here for future expansion if needed
  return price;
}
