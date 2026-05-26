import {
  useConvexBarcodeLookup,
  useConvexQuickAddCatalogItem,
  useConvexProductIdLookup,
  useConvexProductSearch,
  useConvexRegisterCatalog,
} from "@/lib/pos/infrastructure/convex/catalogGateway";
import { useConvexDirectTransactionMutation } from "@/lib/pos/infrastructure/convex/commandGateway";
import type { Id } from "~/convex/_generated/dataModel";

export function usePOSProductSearch(
  storeId: Id<"store"> | undefined,
  searchQuery: string,
) {
  return useConvexProductSearch({ storeId, searchQuery });
}

export function usePOSBarcodeSearch(
  storeId: Id<"store"> | undefined,
  barcode: string,
) {
  return useConvexBarcodeLookup({ storeId, barcode });
}

export function usePOSProductIdSearch(
  storeId: Id<"store"> | undefined,
  productId: string,
) {
  return useConvexProductIdLookup({ storeId, productId });
}

export function usePOSRegisterCatalog(storeId: Id<"store"> | undefined) {
  return useConvexRegisterCatalog({ storeId });
}

export const usePOSTransactionComplete = () => useConvexDirectTransactionMutation();

export const usePOSQuickAddProductSku = () => useConvexQuickAddCatalogItem();
