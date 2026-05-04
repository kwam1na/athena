import { useMutation, useQuery } from "convex/react";

import type {
  PosBarcodeLookupInput,
  PosCatalogItemDto,
  PosProductIdLookupInput,
  PosProductSearchInput,
  PosRegisterCatalogInput,
  PosRegisterCatalogRowDto,
} from "@/lib/pos/application/dto";
import type { PosCatalogReader } from "@/lib/pos/application/ports";
import {
  extractBarcodeFromInput,
  isValidConvexId,
} from "@/lib/pos/barcodeUtils";
import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";

type ProductByIdResult = {
  _id: Id<"product">;
  name?: string;
  description?: string;
  areProcessingFeesAbsorbed?: boolean;
  skus?: Array<{
    _id: Id<"productSku">;
    sku?: string;
    barcode?: string;
    netPrice?: number;
    price: number;
    productCategory?: string;
    quantityAvailable: number;
    images?: string[];
    isVisible?: boolean;
    size?: string;
    length?: number | null;
    colorName?: string;
  }>;
} | null;

function mapProductByIdResult(
  productData: ProductByIdResult,
): PosCatalogItemDto[] {
  if (!productData?.skus) {
    return [];
  }

  const availableSkus = productData.skus.filter((sku) => sku.isVisible);

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

export function useConvexRegisterCatalog(
  input: PosRegisterCatalogInput,
): PosRegisterCatalogRowDto[] | undefined {
  return useQuery(
    api.pos.public.catalog.listRegisterCatalogSnapshot,
    input.storeId ? { storeId: input.storeId } : "skip",
  );
}

export function useConvexProductSearch(
  input: PosProductSearchInput,
): PosCatalogItemDto[] | undefined {
  const extracted = extractBarcodeFromInput(input.searchQuery);
  let searchQuery = input.searchQuery;

  if (extracted.type === "productId") {
    searchQuery = extracted.value;
  }

  return useQuery(
    api.pos.public.catalog.search,
    input.storeId && input.searchQuery.trim().length > 0
      ? { storeId: input.storeId, searchQuery }
      : "skip",
  );
}

export function useConvexBarcodeLookup(
  input: PosBarcodeLookupInput,
): PosCatalogItemDto | PosCatalogItemDto[] | null | undefined {
  return useQuery(
    api.pos.public.catalog.barcodeLookup,
    input.storeId && input.barcode.trim().length > 0
      ? { storeId: input.storeId, barcode: input.barcode }
      : "skip",
  );
}

export function useConvexProductIdLookup(
  input: PosProductIdLookupInput,
): PosCatalogItemDto[] | undefined {
  const normalizedProductId = input.productId.trim();
  const hasStore = !!input.storeId;
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
    shouldQuery
      ? {
          id: normalizedProductId as Id<"product">,
          storeId: input.storeId as Id<"store">,
        }
      : "skip",
  );

  if (productData === undefined) {
    return undefined;
  }

  return mapProductByIdResult(productData as ProductByIdResult);
}

export function useConvexQuickAddCatalogItem() {
  return useMutation(api.pos.public.catalog.quickAddSku);
}

export const convexCatalogReader: PosCatalogReader = {
  useRegisterCatalog: useConvexRegisterCatalog,
  useProductSearch: useConvexProductSearch,
  useBarcodeLookup: useConvexBarcodeLookup,
  useProductIdLookup: useConvexProductIdLookup,
};
