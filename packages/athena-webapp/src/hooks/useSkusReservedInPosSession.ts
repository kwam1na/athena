import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import useGetActiveStore from "./useGetActiveStore";

/**
 * Hook to check which SKUs are currently reserved in active POS sessions.
 * This prevents editing stock/quantity fields for SKUs that are actively in use at POS terminals.
 *
 * @param skus - Array of SKU strings to check
 * @returns Object with reserved SKUs and helper functions
 */
export function useSkusReservedInPosSession(skus: (string | undefined)[]) {
  const { activeStore } = useGetActiveStore();

  // Filter out undefined/empty SKUs
  const validSkus = skus.filter((sku): sku is string => Boolean(sku));

  const reservedSkusQuery = useQuery(
    api.inventory.stockValidation.getSkusReservedInPosSession,
    activeStore?._id && validSkus.length > 0
      ? { skus: validSkus, storeId: activeStore._id }
      : "skip"
  );

  const reservedSkus = reservedSkusQuery || [];

  return {
    /** Array of SKUs that are currently reserved in POS sessions */
    reservedSkus,

    /** Check if a specific SKU is reserved */
    isSkuReserved: (sku: string | undefined) => {
      return sku ? reservedSkus.includes(sku) : false;
    },

    /** Check if any of the provided SKUs are reserved */
    hasReservedSkus: reservedSkus.length > 0,

    /** Loading state */
    isLoading:
      reservedSkusQuery === undefined &&
      validSkus.length > 0 &&
      activeStore?._id,

    /** Number of reserved SKUs */
    reservedCount: reservedSkus.length,
  };
}
