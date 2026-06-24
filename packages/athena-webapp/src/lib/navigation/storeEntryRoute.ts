import type { Role } from "~/types";

export const POS_STORE_ENTRY_ROUTE = "/$orgUrlSlug/store/$storeUrlSlug/pos";
export const OPERATIONS_STORE_ENTRY_ROUTE =
  "/$orgUrlSlug/store/$storeUrlSlug/operations";

export function getStoreEntryRouteForRole(role?: Role | null) {
  return role === "pos_only"
    ? POS_STORE_ENTRY_ROUTE
    : OPERATIONS_STORE_ENTRY_ROUTE;
}
