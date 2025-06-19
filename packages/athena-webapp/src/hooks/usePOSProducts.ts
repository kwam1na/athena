import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";

export function usePOSProductSearch(
  storeId: Id<"store"> | undefined,
  searchQuery: string
) {
  return useQuery(
    api.inventory.pos.searchProducts,
    storeId && searchQuery.trim().length > 0 ? { storeId, searchQuery } : "skip"
  );
}

export function usePOSBarcodeSearch(
  storeId: Id<"store"> | undefined,
  barcode: string
) {
  return useQuery(
    api.inventory.pos.lookupByBarcode,
    storeId && barcode.trim().length > 0 ? { storeId, barcode } : "skip"
  );
}

export const usePOSTransactionComplete = () => {
  const completeMutation = useMutation(api.inventory.pos.completeTransaction);

  return completeMutation;
};
