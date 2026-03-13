/**
 * Expense Session Expiration Utilities
 *
 * Centralized logic for calculating expense session expiration times.
 * Expense sessions expire after 5 minutes of inactivity (shorter than POS sessions).
 */

/**
 * Default expense session expiration duration in milliseconds
 * Expense sessions expire after 5 minutes of inactivity
 */
const EXPENSE_SESSION_EXPIRY_DURATION_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Calculates the expiration timestamp for an expense session
 *
 * @param baseTime - Base time in milliseconds (usually Date.now())
 * @param customDuration - Optional custom duration in milliseconds. Defaults to EXPENSE_SESSION_EXPIRY_DURATION_MS
 * @returns Expiration timestamp in milliseconds
 */
export function calculateExpenseSessionExpiration(
  baseTime: number,
  customDuration?: number
): number {
  const duration = customDuration ?? EXPENSE_SESSION_EXPIRY_DURATION_MS;
  return baseTime + duration;
}

/**
 * Gets the default expense session expiration duration in milliseconds
 * Useful for display purposes or when you need the duration value
 *
 * @returns Default expiration duration in milliseconds
 */
export function getExpenseSessionExpiryDuration(): number {
  return EXPENSE_SESSION_EXPIRY_DURATION_MS;
}

/**
 * Gets the default expense session expiration duration in minutes
 * Useful for user-facing displays
 *
 * @returns Default expiration duration in minutes
 */
export function getExpenseSessionExpiryDurationMinutes(): number {
  return EXPENSE_SESSION_EXPIRY_DURATION_MS / (60 * 1000);
}
