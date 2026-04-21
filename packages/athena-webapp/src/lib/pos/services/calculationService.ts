/**
 * Calculation Service
 *
 * Legacy compatibility surface over the extracted POS browser domain helpers.
 */

import {
  calculatePosCartTotals,
  calculatePosChange,
  calculatePosItemTotal,
  getPosEffectivePrice,
  isPosPaymentSufficient,
} from "../domain";
import type { PosCartLineInput, PosMoneyTotals } from "../domain";

export type CartItem = PosCartLineInput;
export type CartTotals = PosMoneyTotals;

/**
 * Tax rate for calculations (default 10%)
 * In a production system, this would come from store configuration
 */
const TAX_RATE = 0.0;

/**
 * Calculates cart totals including subtotal, tax, and total
 */
export function calculateCartTotals(items: CartItem[]): CartTotals {
  return calculatePosCartTotals(items ?? [], TAX_RATE);
}

/**
 * Calculates total for a single item
 */
export function calculateItemTotal(price: number, quantity: number): number {
  return calculatePosItemTotal(price, quantity);
}

/**
 * Calculates change to give customer
 */
export function calculateChange(amountPaid: number, total: number): number {
  return calculatePosChange(amountPaid, total);
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
  return isPosPaymentSufficient(amountPaid, total);
}

/**
 * Gets the effective price for a product
 * Handles processing fees if they're absorbed
 */
export function getEffectivePrice(
  price: number,
  areProcessingFeesAbsorbed?: boolean
): number {
  return getPosEffectivePrice(price, areProcessingFeesAbsorbed);
}
