/**
 * Generate a POS transaction number
 * Format: POS-XXXXXX where XXXXXX is a 6-digit number
 *
 * The number is generated using:
 * - Last 5 digits of current timestamp (seconds since epoch)
 * - Random padding digit (0-9)
 *
 * @returns Transaction number in format POS-XXXXXX
 */
export function generateTransactionNumber(): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const baseTransactionNumber = timestamp % 100000;
  const randomPadding = Math.floor(Math.random() * 10);
  const transactionNumber = (baseTransactionNumber * 10 + randomPadding)
    .toString()
    .padStart(6, "0");

  return `POS-${transactionNumber}`;
}
