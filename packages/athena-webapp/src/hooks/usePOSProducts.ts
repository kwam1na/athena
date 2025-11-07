import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import type { Product } from "../components/pos/types";
import { isValidConvexId } from "@/lib/pos/barcodeUtils";

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

export function usePOSProductIdSearch(
  storeId: Id<"store"> | undefined,
  productId: string
): Product[] | undefined {
  const normalizedProductId = productId.trim();
  const hasStore = !!storeId;
  const hasInput = normalizedProductId.length > 0;
  const isValidId = isValidConvexId(normalizedProductId);

  if (hasStore && hasInput && !isValidId) {
    console.warn("[POS] Skipping product query - invalid Convex id", {
      productId: normalizedProductId,
    });
  }

  const shouldQuery = hasStore && hasInput && isValidId;
  const productData = useQuery(
    api.inventory.products.getById,
    shouldQuery ? { id: normalizedProductId as Id<"product">, storeId } : "skip"
  );

  // Still loading
  if (productData === undefined) {
    return undefined;
  }

  // Product not found or no product data
  if (!productData || !productData.skus) {
    return [];
  }

  // Transform product data to POS Product format
  // Filter to only available SKUs and transform each SKU to Product format
  const availableSkus = productData.skus.filter((sku) => sku.isVisible);

  if (availableSkus.length === 0) {
    return [];
  }

  return availableSkus.map((sku) => ({
    id: sku._id,
    name: productData.name || "",
    sku: sku.sku || "",
    barcode: sku.barcode || "",
    price: sku.netPrice || sku.price,
    category: sku.productCategory || "",
    description: productData.description || "",
    inStock: sku.quantityAvailable > 0,
    quantityAvailable: sku.quantityAvailable,
    image: sku.images?.[0] || null,
    size: sku.size || "",
    length: sku.length || null,
    color: sku.colorName || "",
    productId: productData._id,
    skuId: sku._id,
    areProcessingFeesAbsorbed: productData.areProcessingFeesAbsorbed || false,
  }));
}

export const usePOSTransactionComplete = () => {
  const completeMutation = useMutation(api.inventory.pos.completeTransaction);

  return completeMutation;
};
