import { useQuery } from "@tanstack/react-query";
import { getInventoryBySkuIds, InventoryStatus } from "@/api/product";
import { useMemo } from "react";

/**
 * Hook to fetch inventory status (inventoryCount and quantityAvailable) for multiple SKUs
 * Returns a Map for O(1) lookup by SKU ID
 */
export function useInventoryStatus(productSkuIds: string[]) {
  const { data: inventoryData, isLoading } = useQuery({
    queryKey: ["inventory-status", productSkuIds],
    queryFn: () => getInventoryBySkuIds(productSkuIds),
    enabled: productSkuIds.length > 0,
    staleTime: 30000, // 30 seconds - inventory changes relatively frequently
  });

  const inventoryMap = useMemo(() => {
    const map = new Map<
      string,
      { inventoryCount: number; quantityAvailable: number }
    >();

    if (inventoryData) {
      inventoryData.forEach((item: InventoryStatus) => {
        map.set(item._id, {
          inventoryCount: item.inventoryCount,
          quantityAvailable: item.quantityAvailable,
        });
      });
    }

    return map;
  }, [inventoryData]);

  return {
    inventoryMap,
    isLoading,
  };
}
