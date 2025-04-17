import { useStoreContext } from "@/contexts/StoreContext";
import { useGetProductQuery } from "@/hooks/useGetProduct";
import { getProductName } from "@/lib/productUtils";
import { BagItem, ProductSku, SavedBagItem } from "@athena/webapp";
import { Link, useSearch } from "@tanstack/react-router";
import { useParams } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { LoadingButton } from "../ui/loading-button";
import { ProductAttribute } from "./ProductAttribute";
import { useShoppingBag } from "@/hooks/useShoppingBag";
import { useEffect, useRef, useState } from "react";

import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "../ui/sheet";
import NotFound from "../states/not-found/NotFound";
import { AlertCircleIcon, HeartIcon } from "lucide-react";
import { HeartIconFilled } from "@/assets/icons/HeartIconFilled";
import { BagProduct, PickupDetails, ShippingPolicy } from "./ProductDetails";
import { Reviews } from "./ProductReviews";
import { About } from "./About";
import { OnsaleProduct } from "./OnSaleProduct";
import { usePromoCodesQueries } from "@/lib/queries/promoCode";
import { useQuery } from "@tanstack/react-query";
import {
  LowStockBadge,
  SellingFastBadge,
  SellingFastSignal,
  SoldOutBadge,
} from "./InventoryLevelBadge";

export default function MobileProductPage() {
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  const { productSlug } = useParams({ strict: false });

  const { data: product, error } = useGetProductQuery(productSlug);

  const promoCodeQueries = usePromoCodesQueries();

  const { data: promoCodeItems } = useQuery(promoCodeQueries.getAllItems());

  const promoCodeItem = promoCodeItems?.[0];

  const { variant } = useSearch({ strict: false });

  const { formatter } = useStoreContext();

  const {
    bag,
    deleteItemFromSavedBag,
    addProductToBag,
    updateBag,
    isUpdatingBag,
    addedItemSuccessfully,
    savedBag,
    addProductToSavedBag,
  } = useShoppingBag();

  const sheetContent = useRef<React.ReactNode | null>(null);

  const [selectedSku, setSelectedSku] = useState<ProductSku | null>(null);

  const isPromoCodeItemInBag = bag?.items?.find(
    (item: BagItem) => item.productSkuId === promoCodeItem?._id
  );

  useEffect(() => {
    if (product && variant) {
      const selectedSku = product?.skus?.find(
        (sku: ProductSku) => sku.sku === variant
      );
      if (selectedSku) setSelectedSku(selectedSku);
    } else if (product && !selectedSku) {
      const sortedSkus = product?.skus?.sort(
        (a: ProductSku, b: ProductSku) => (a?.length ?? 0) - (b?.length ?? 0)
      );

      setSelectedSku(sortedSkus?.[0]);
    }
  }, [variant, product, selectedSku]);

  useEffect(() => {
    if (variant && selectedSku) {
      const url = new URL(window.location.href);
      url.searchParams.delete("variant");
      window.history.replaceState({}, "", url);
    }
  }, [variant, selectedSku]);

  useEffect(() => {
    if (addedItemSuccessfully && selectedSku) {
      sheetContent.current = <BagProduct product={selectedSku} />;
    }

    const t = setTimeout(() => {
      if (addedItemSuccessfully) {
        setIsSheetOpen(false);
      }
    }, 3500);

    return () => clearTimeout(t);
  }, [addedItemSuccessfully]);

  const handleUpdateBag = async () => {
    sheetContent.current = null;

    if (bagItem) {
      await updateBag({ itemId: bagItem._id, quantity: bagItem.quantity + 1 });
    } else {
      await addProductToBag({
        quantity: 1,
        productId: product?._id as string,
        productSkuId: selectedSku?._id as string,
        productSku: selectedSku?.sku as string,
      });
    }

    if (
      !isPromoCodeItemInBag &&
      promoCodeItem &&
      selectedSku?.productCategory == "Hair"
    ) {
      await addProductToBag({
        quantity: 1,
        productId: promoCodeItem?.productId as string,
        productSkuId: promoCodeItem?._id as string,
        productSku: promoCodeItem?.sku as string,
      });
    }

    setIsSheetOpen(true);
  };

  const handleUpdateSavedBag = async () => {
    if (savedBagItem) {
      await deleteItemFromSavedBag(savedBagItem._id);
    } else {
      await addProductToSavedBag({
        quantity: 1,
        productId: product?._id as string,
        productSkuId: selectedSku?._id as string,
        productSku: selectedSku?.sku as string,
      });
    }
  };

  const showShippingPolicy = () => {
    sheetContent.current = <ShippingPolicy />;
  };

  const bagItem = bag?.items?.find(
    (item: BagItem) => item.productSku === selectedSku?.sku
  );

  const savedBagItem = savedBag?.items?.find(
    (item: SavedBagItem) => item.productSku === selectedSku?.sku
  );

  if (!selectedSku || !product) return <div className="h-screen" />;

  if (error || (product && !selectedSku)) {
    return <NotFound />;
  }

  const isSoldOut =
    selectedSku?.quantityAvailable === 0 && selectedSku.inventoryCount === 0;

  const isLowStock =
    selectedSku?.quantityAvailable <= 2 || selectedSku.inventoryCount <= 2;

  return (
    <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
      <SheetTitle />
      <SheetContent>{sheetContent.current}</SheetContent>

      <div className="min-h-screen pb-40">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { duration: 0.1 } }}
          className="h-[60vh] overflow-y-auto"
        >
          {selectedSku.images.map((img: any, index: number) => (
            <img
              key={index}
              alt={`image`}
              className={`aspect-square w-full h-full object-cover cursor-pointer`}
              src={img}
            />
          ))}
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{
            opacity: 1,
            transition: { duration: 0.4, delay: 0.1, ease: "easeInOut" },
          }}
          className="col-span-1 md:col-span-2 pt-8 px-6 lg:px-16 space-y-12"
        >
          <div className="space-y-8">
            <div className="space-y-6">
              <p className="text-2xl">{getProductName(selectedSku)}</p>
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  {isSoldOut && <SoldOutBadge />}

                  {isLowStock && !isSoldOut && (
                    <SellingFastSignal
                      message={`Only ${selectedSku.quantityAvailable} left`}
                    />
                  )}
                </div>

                <p>{formatter.format(selectedSku.price)}</p>
              </div>
            </div>
            <ProductAttribute
              product={product}
              selectedSku={selectedSku}
              setSelectedSku={setSelectedSku}
            />
          </div>

          {selectedSku.productCategory == "Hair" && (
            <About
              productAttributes={product.attributes || {}}
              productSku={selectedSku}
            />
          )}

          {selectedSku.productCategory == "Hair" && <OnsaleProduct />}

          <div className="space-y-4">
            <div className="flex gap-4">
              <LoadingButton
                className="w-[288px]"
                isLoading={false}
                onClick={handleUpdateBag}
                disabled={isSoldOut}
              >
                {isUpdatingBag ? "Adding to Bag.." : "Add to Bag"}
              </LoadingButton>

              <LoadingButton
                variant={"outline"}
                isLoading={false}
                onClick={handleUpdateSavedBag}
                disabled={isSoldOut}
              >
                {!savedBagItem && (
                  <HeartIcon className="w-4 h-4 text-muted-foreground" />
                )}
                {savedBagItem && <HeartIconFilled width={16} height={16} />}
              </LoadingButton>
            </div>

            {addedItemSuccessfully == false && (
              <div className="flex gap-1 items-center text-destructive">
                <AlertCircleIcon className="w-4 h-4" />
                <p className="text-xs">
                  An error occured processing your last request
                </p>
              </div>
            )}
          </div>

          <PickupDetails showShippingPolicy={showShippingPolicy} />

          <Reviews />
        </motion.div>
      </div>
    </Sheet>
  );
}
