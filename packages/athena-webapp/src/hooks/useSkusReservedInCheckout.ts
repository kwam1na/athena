import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import useGetActiveStore from "./useGetActiveStore";

/**
 * Hook to check which SKUs are currently reserved in active checkout sessions.
 * This prevents editing stock/quantity fields for SKUs that customers are actively purchasing.
 *
 * @param skus - Array of SKU strings to check
 * @returns Object with reserved SKUs and helper functions
 */
export function useSkusReservedInCheckout(skus: (string | undefined)[]) {
  const { activeStore } = useGetActiveStore();

  // Filter out undefined/empty SKUs
  const validSkus = skus.filter((sku): sku is string => Boolean(sku));

  const reservedSkusQuery = useQuery(
    api.inventory.stockValidation.getSkusReservedInCheckout,
    activeStore?._id && validSkus.length > 0
      ? { skus: validSkus, storeId: activeStore._id }
      : "skip"
  );

  const reservedSkus = reservedSkusQuery || [];

  return {
    /** Array of SKUs that are currently reserved in checkout sessions */
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
