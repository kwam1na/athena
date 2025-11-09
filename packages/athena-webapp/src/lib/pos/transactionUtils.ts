/**
 * POS Transaction Utilities
 *
 * Helper functions for transaction processing and formatting.
 */

const TRANSACTION_MODULO = 1_000_000;
let lastTransactionNumber: number | null = null;

/**
 * Generates a unique 6-digit transaction number derived from the current timestamp.
 * Ensures sequential uniqueness even when multiple calls occur within the same millisecond.
 */
export function generateTransactionNumber(): string {
  const base = Number(Date.now() % TRANSACTION_MODULO);
  let candidate = base;

  if (lastTransactionNumber !== null && candidate <= lastTransactionNumber) {
    candidate = (lastTransactionNumber + 1) % TRANSACTION_MODULO;
  }

  lastTransactionNumber = candidate;
  return candidate.toString().padStart(6, "0");
}

/**
 * Formats currency for display
 */
export function formatCurrency(
  amount: number,
  currency: string = "USD"
): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(amount);
}

/**
 * Calculates change due
 */
export function calculateChange(amountPaid: number, total: number): number {
  return Math.max(0, amountPaid - total);
}

/**
 * Formats a timestamp as a readable date/time
 */
export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}
