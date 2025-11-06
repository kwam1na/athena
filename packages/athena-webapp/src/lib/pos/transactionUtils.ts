/**
 * POS Transaction Utilities
 *
 * Helper functions for transaction processing and formatting.
 */

/**
 * Generates a unique transaction number based on timestamp
 */
export function generateTransactionNumber(): string {
  const now = new Date();
  const year = now.getFullYear().toString().slice(-2);
  const month = (now.getMonth() + 1).toString().padStart(2, "0");
  const day = now.getDate().toString().padStart(2, "0");
  const hours = now.getHours().toString().padStart(2, "0");
  const minutes = now.getMinutes().toString().padStart(2, "0");
  const seconds = now.getSeconds().toString().padStart(2, "0");
  const ms = now.getMilliseconds().toString().padStart(3, "0");

  return `TXN-${year}${month}${day}-${hours}${minutes}${seconds}-${ms}`;
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
