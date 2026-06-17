/**
 * Expense Session Lifetime Utilities
 *
 * Expense sessions follow POS continuity: they do not expire automatically in
 * the cashier path. Keep a far-future timestamp for compatibility with older
 * rows and result contracts that still carry `expiresAt`.
 */

/**
 * Compatibility lifetime for expense sessions.
 */
const EXPENSE_SESSION_NON_EXPIRING_DURATION_MS = 100 * 365 * 24 * 60 * 60 * 1000;

/**
 * Calculates the compatibility lifetime timestamp for an expense session.
 *
 * @param baseTime - Base time in milliseconds (usually Date.now())
 * @param customDuration - Optional custom duration in milliseconds. Defaults to EXPENSE_SESSION_NON_EXPIRING_DURATION_MS
 * @returns Compatibility lifetime timestamp in milliseconds
 */
export function calculateExpenseSessionExpiration(
  baseTime: number,
  customDuration?: number
): number {
  const duration = customDuration ?? EXPENSE_SESSION_NON_EXPIRING_DURATION_MS;
  return baseTime + duration;
}

/**
 * Gets the default expense session compatibility lifetime in milliseconds.
 * Useful for display purposes or when you need the duration value
 *
 * @returns Default compatibility lifetime in milliseconds
 */
export function getExpenseSessionExpiryDuration(): number {
  return EXPENSE_SESSION_NON_EXPIRING_DURATION_MS;
}

/**
 * Gets the default expense session compatibility lifetime in minutes.
 * Useful for user-facing displays
 *
 * @returns Default compatibility lifetime in minutes
 */
export function getExpenseSessionExpiryDurationMinutes(): number {
  return EXPENSE_SESSION_NON_EXPIRING_DURATION_MS / (60 * 1000);
}
