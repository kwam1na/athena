/**
 * Session Expiration Utilities
 *
 * Centralized logic for calculating POS session expiration times.
 * Reduces hardcoding and makes it easy to adjust expiration duration.
 */

/**
 * Default session expiration duration in milliseconds
 * Sessions expire after 20 minutes of inactivity
 */
const SESSION_EXPIRY_DURATION_MS = 20 * 60 * 1000; // 20 minutes

/**
 * Calculates the expiration timestamp for a POS session
 *
 * @param baseTime - Base time in milliseconds (usually Date.now())
 * @param customDuration - Optional custom duration in milliseconds. Defaults to SESSION_EXPIRY_DURATION_MS
 * @returns Expiration timestamp in milliseconds
 */
export function calculateSessionExpiration(
  baseTime: number,
  customDuration?: number
): number {
  const duration = customDuration ?? SESSION_EXPIRY_DURATION_MS;
  return baseTime + duration;
}

/**
 * Gets the default session expiration duration in milliseconds
 * Useful for display purposes or when you need the duration value
 *
 * @returns Default expiration duration in milliseconds
 */
export function getSessionExpiryDuration(): number {
  return SESSION_EXPIRY_DURATION_MS;
}

/**
 * Gets the default session expiration duration in minutes
 * Useful for user-facing displays
 *
 * @returns Default expiration duration in minutes
 */
export function getSessionExpiryDurationMinutes(): number {
  return SESSION_EXPIRY_DURATION_MS / (60 * 1000);
}
