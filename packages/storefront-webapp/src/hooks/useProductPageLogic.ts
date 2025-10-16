import { useStoreContext } from "@/contexts/StoreContext";
import { useParams, useSearch } from "@tanstack/react-router";
import { useShoppingBag } from "@/hooks/useShoppingBag";
import { BagItem, ProductSku, SavedBagItem } from "@athena/webapp";
import { useEffect, useRef, useState } from "react";
import { useGetProductQuery } from "@/hooks/useGetProduct";
import { usePromoCodesQueries } from "@/lib/queries/promoCode";
import { useQuery } from "@tanstack/react-query";
import { postAnalytics } from "@/api/analytics";
import { isSoldOut, hasLowStock, sortSkusByLength } from "@/lib/productUtils";
import { useProductDiscount } from "@/hooks/useProductDiscount";

export function useProductPageLogic() {
  const { productSlug } = useParams({ strict: false });
  const { formatter } = useStoreContext();
  const {
    bag,
    deleteItemFromSavedBag,
    addProductToBag,
    updateBag,
    isUpdatingBag,
    addedItemSuccessfully,
    savedBag,
    bagAction,
    addProductToSavedBag,
  } = useShoppingBag();

  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const sheetContent = useRef<React.ReactNode | null>(null);

  const { data: product, error } = useGetProductQuery(productSlug);
  const promoCodeQueries = usePromoCodesQueries();
  const { data: promoCodeItems } = useQuery(promoCodeQueries.getAllItems());
  const promoCodeItem = promoCodeItems?.[0]?.productSku;

  const { variant } = useSearch({ strict: false });
  const [selectedSku, setSelectedSku] = useState<ProductSku | null>(null);

  const isPromoCodeItemInBag = bag?.items?.find(
    (item: BagItem) => item.productSkuId === promoCodeItem?._id
  );

  // Initialize selected SKU
  useEffect(() => {
    if (product && variant) {
      const selectedSku = product?.skus?.find(
        (sku: ProductSku) => sku.sku === variant
      );
      selectedSku && setSelectedSku(selectedSku);
    } else if (product && !selectedSku) {
      setSelectedSku(sortSkusByLength(product?.skus || [])[0]);
    }
  }, [variant, product, selectedSku]);

  // Clear variant from URL after using it
  useEffect(() => {
    if (variant && selectedSku) {
      const url = new URL(window.location.href);
      url.searchParams.delete("variant");
      window.history.replaceState({}, "", url);
    }
  }, [variant, selectedSku]);

  // Auto-close sheet after successful add
  useEffect(() => {
    const t = setTimeout(() => {
      if (addedItemSuccessfully) {
        setIsSheetOpen(false);
      }
    }, 3500);

    return () => clearTimeout(t);
  }, [addedItemSuccessfully]);

  const bagItem = bag?.items?.find(
    (item: BagItem) => item.productSku === selectedSku?.sku
  );

  const savedBagItem = savedBag?.items?.find(
    (item: SavedBagItem) => item.productSku === selectedSku?.sku
  );

  const handleUpdateBag = async () => {
    sheetContent.current = null;

    if (bagItem) {
      await Promise.all([
        updateBag({ itemId: bagItem._id, quantity: bagItem.quantity + 1 }),
        postAnalytics({
          action: "updated_product_in_bag",
          data: {
            product: productSlug,
            productSku: selectedSku?.sku,
            productImageUrl: selectedSku?.images?.[0],
            quantity: bagItem.quantity + 1,
          },
        }),
      ]);
    } else {
      await Promise.all([
        addProductToBag({
          quantity: 1,
          productId: product?._id as string,
          productSkuId: selectedSku?._id as string,
          productSku: selectedSku?.sku as string,
        }),
        postAnalytics({
          action: "added_product_to_bag",
          data: {
            product: productSlug,
            productSku: selectedSku?.sku,
            productImageUrl: selectedSku?.images?.[0],
          },
        }),
      ]);
    }

    if (
      !isPromoCodeItemInBag &&
      promoCodeItem &&
      selectedSku?.productCategory == "Hair"
    ) {
      await Promise.all([
        addProductToBag({
          quantity: 1,
          productId: promoCodeItem?.productId as string,
          productSkuId: promoCodeItem?._id as string,
          productSku: promoCodeItem?.sku as string,
        }),
        postAnalytics({
          action: "added_product_to_bag",
          data: {
            product: promoCodeItem?.productId,
            productSku: promoCodeItem?.sku,
            productImageUrl: promoCodeItem.images[0],
          },
        }),
      ]);
    }

    setIsSheetOpen(true);
  };

  const handleUpdateSavedBag = async () => {
    if (savedBagItem) {
      await Promise.all([
        deleteItemFromSavedBag(savedBagItem._id),
        postAnalytics({
          action: "deleted_product_from_saved",
          data: {
            product: productSlug,
            productSku: selectedSku?.sku,
            productImageUrl: selectedSku?.images?.[0],
          },
        }),
      ]);
    } else {
      await Promise.all([
        addProductToSavedBag({
          quantity: 1,
          productId: product?._id as string,
          productSkuId: selectedSku?._id as string,
          productSku: selectedSku?.sku as string,
        }),
        postAnalytics({
          action: "added_product_to_saved",
          data: {
            product: productSlug,
            productSku: selectedSku?.sku,
            productImageUrl: selectedSku?.images?.[0],
          },
        }),
      ]);
      setIsSheetOpen(true);
    }
  };

  const soldOut = selectedSku ? isSoldOut(selectedSku) : false;
  const lowStock = selectedSku ? hasLowStock(selectedSku) : false;
  const isPromoCodeItem = promoCodeItem?.productId === productSlug;

  // Get discount info for selected SKU
  const productDiscount = useProductDiscount(
    selectedSku?._id,
    selectedSku?.price
  );

  return {
    productSlug,
    product,
    error,
    selectedSku,
    setSelectedSku,
    isSheetOpen,
    setIsSheetOpen,
    sheetContent,
    handleUpdateBag,
    handleUpdateSavedBag,
    bagItem,
    savedBagItem,
    formatter,
    isSoldOut: soldOut,
    isLowStock: lowStock,
    isPromoCodeItem,
    addedItemSuccessfully,
    isUpdatingBag,
    bagAction,
    productDiscount,
  };
}
