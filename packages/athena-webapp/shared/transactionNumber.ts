/**
 * Shared so the POS register and Convex mint transaction numbers the same way.
 * Convex code should keep importing this through `convex/utils`, which
 * re-exports it.
 */
export function generateTransactionNumber(): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const baseTransactionNumber = timestamp % 100000;
  const randomPadding = Math.floor(Math.random() * 10);
  const transactionNumber = (baseTransactionNumber * 10 + randomPadding)
    .toString()
    .padStart(6, "0");

  return transactionNumber;
}
