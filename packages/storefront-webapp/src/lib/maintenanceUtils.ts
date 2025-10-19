/**
 * Utility functions for maintenance mode logic
 */

type StoreConfig = {
  availability?: {
    inMaintenanceMode?: boolean;
  };
  maintenance?: {
    countdownEndsAt?: number;
  };
};

/**
 * Determines if the store is in maintenance mode
 * Takes into account both the maintenance mode flag and countdown expiration
 */
export function isInMaintenanceMode(config?: StoreConfig): boolean {
  if (!config?.availability?.inMaintenanceMode) {
    return false;
  }

  const countdownEndsAt = config?.maintenance?.countdownEndsAt;

  const now = Date.now();
  const timeLeft = countdownEndsAt ? countdownEndsAt - now : 0;

  // If no countdown is set, use the maintenance mode flag directly
  if (countdownEndsAt === undefined) {
    // If countdown expired, not in maintenance mode
    if (timeLeft <= 0) {
      return false;
    }

    return true;
  }

  // Countdown is active and hasn't expired
  return true;
}
