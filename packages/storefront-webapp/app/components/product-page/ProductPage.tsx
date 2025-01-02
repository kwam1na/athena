import { useStoreContext } from "@/contexts/StoreContext";
import {
  Link,
  useNavigate,
  useParams,
  useSearch,
} from "@tanstack/react-router";
import { LoadingButton } from "../ui/loading-button";
import { useShoppingBag } from "@/hooks/useShoppingBag";
import { Product, ProductSku } from "@athena/webapp-2";
import { Button } from "../ui/button";
import { capitalizeWords, getProductName } from "@/lib/utils";
import { AlertCircleIcon, HeartIcon } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import placeholder from "@/assets/placeholder.png";
import { motion } from "framer-motion";

import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import NotFound from "../states/not-found/NotFound";
import GalleryViewer from "./GalleryViewer";
import { useGetProductQuery } from "@/hooks/useGetProduct";
import { HeartIconFilled } from "@/assets/icons/HeartIconFilled";
import { BagProduct, PickupDetails, ShippingPolicy } from "./ProductDetails";
import { ProductAttribute } from "./ProductAttribute";
import { Reviews } from "./ProductReviews";

// Main Product Page Component
export default function ProductPage() {
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
    addProductToSavedBag,
    isUpdatingSavedBag,
  } = useShoppingBag();

  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [activeImage, setActiveImage] = useState(0);
  const imageRefs = useRef<HTMLImageElement[] | null[]>([]);
  const [isRefsReady, setRefsReady] = useState(false);
  const pageRef = useRef<HTMLDivElement | null>(null);

  const sheetContent = useRef<React.ReactNode | null>(null);

  const { data: product, error } = useGetProductQuery(productSlug);

  const { variant } = useSearch({ strict: false });

  const [selectedSku, setSelectedSku] = useState<ProductSku | null>(null);

  useEffect(() => {
    if (product && variant) {
      const selectedSku = product?.skus?.find(
        (sku: ProductSku) => sku.sku === variant
      );
      setSelectedSku(selectedSku);
    } else if (product && !selectedSku) {
      const sortedSkus = product?.skus?.sort(
        (a: ProductSku, b: ProductSku) =>
          parseInt(a.length) - parseInt(b.length)
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

  // Setup Intersection Observer
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const index = imageRefs.current.findIndex(
              (img) => img === entry.target
            );
            setActiveImage(index);
          }
        });
      },
      {
        threshold: 0.5,
      }
    );

    imageRefs.current.forEach((img) => {
      if (img) observer.observe(img);
    });

    return () => {
      observer.disconnect();
    };
  }, [imageRefs.current, isRefsReady, selectedSku]);

  useEffect(() => {
    if (imageRefs.current.length === selectedSku?.images?.length) {
      setRefsReady(true);
    }
  }, [selectedSku, activeImage]);

  useEffect(() => {
    if (addedItemSuccessfully) {
      sheetContent.current = <BagProduct product={selectedSku} />;
    }

    const t = setTimeout(() => {
      if (addedItemSuccessfully) {
        setIsSheetOpen(false);
      }
    }, 3500);

    return () => clearTimeout(t);
  }, [addedItemSuccessfully]);

  const bagItem = bag?.items?.find(
    (item: ProductSku) => item.productSku === selectedSku?.sku
  );

  const savedBagItem = savedBag?.items?.find(
    (item: ProductSku) => item.productSku === selectedSku?.sku
  );

  const handleUpdateBag = async () => {
    sheetContent.current = null;

    if (bagItem) {
      await updateBag({ itemId: bagItem._id, quantity: bagItem.quantity + 1 });
    } else {
      await addProductToBag({
        quantity: 1,
        productId: product._id,
        productSkuId: selectedSku._id,
        productSku: selectedSku.sku,
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
        productId: product._id,
        productSkuId: selectedSku._id,
        productSku: selectedSku.sku,
      });
    }
  };

  const showShippingPolicy = () => {
    sheetContent.current = <ShippingPolicy />;
  };

  if (!selectedSku || !product) return <div className="h-screen" />;

  if (error || (product && !selectedSku)) {
    return <NotFound />;
  }

  return (
    <>
      <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
        <SheetTitle />
        <SheetContent>{sheetContent.current}</SheetContent>

        <motion.main
          ref={pageRef}
          className="container mx-auto grid grid-cols-1 xl:grid-cols-4 gap-12 pb-16"
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.1 } }}
            className="col-span-1 md:col-span-2"
          >
            <GalleryViewer images={selectedSku.images} />
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
                <p className="text-xl">{getProductName(selectedSku)}</p>
                <p className="text-muted-foreground">
                  {formatter.format(selectedSku.price)}
                </p>
              </div>
              <ProductAttribute
                product={product}
                selectedSku={selectedSku}
                setSelectedSku={setSelectedSku}
              />
            </div>

            <div className="space-y-4">
              <div className="flex gap-4">
                <LoadingButton
                  className="w-[288px]"
                  isLoading={false}
                  disabled={isUpdatingBag}
                  onClick={handleUpdateBag}
                >
                  {isUpdatingBag ? "Adding to Bag.." : "Add to Bag"}
                </LoadingButton>

                <LoadingButton
                  variant={"outline"}
                  isLoading={false}
                  disabled={isUpdatingSavedBag}
                  onClick={handleUpdateSavedBag}
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
        </motion.main>
      </Sheet>
    </>
  );
}
