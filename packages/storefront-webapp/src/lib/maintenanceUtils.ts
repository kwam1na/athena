import { isStoreMaintenanceMode } from "@/lib/storeConfig";

/**
 * Determines if the store is in maintenance mode.
 * Supports both legacy and grouped V2 config shapes.
 */
export function isInMaintenanceMode(config?: Record<string, any>): boolean {
  return isStoreMaintenanceMode(config);
}
