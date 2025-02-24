import { useStoreContext } from "@/contexts/StoreContext";
import {
  Link,
  useNavigate,
  useParams,
  useSearch,
} from "@tanstack/react-router";
import { LoadingButton } from "../ui/loading-button";
import { useShoppingBag } from "@/hooks/useShoppingBag";
import { BagItem, ProductSku, SavedBagItem } from "@athena/webapp";
import { getProductName } from "@/lib/utils";
import { AlertCircleIcon, HeartIcon } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";

import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import NotFound from "../states/not-found/NotFound";
import GalleryViewer from "./GalleryViewer";
import { useGetProductQuery } from "@/hooks/useGetProduct";
import { HeartIconFilled } from "@/assets/icons/HeartIconFilled";
import { BagProduct, PickupDetails, ShippingPolicy } from "./ProductDetails";
import { ProductAttribute } from "./ProductAttribute";
import { Reviews } from "./ProductReviews";
import { About } from "./About";
import { Badge } from "../ui/badge";

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
      selectedSku && setSelectedSku(selectedSku);
    } else if (product && !selectedSku) {
      const sortedSkus = product?.skus?.sort(
        (a: ProductSku, b: ProductSku) => (a.length ?? 0) - (b.length ?? 0)
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

  const bagItem = bag?.items?.find(
    (item: BagItem) => item.productSku === selectedSku?.sku
  );

  const savedBagItem = savedBag?.items?.find(
    (item: SavedBagItem) => item.productSku === selectedSku?.sku
  );

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

  if (error) return <NotFound />;

  if (!selectedSku || !product) return <div className="h-screen" />;

  if (error || (product && !selectedSku)) {
    return <NotFound />;
  }

  const isSoldOut =
    selectedSku?.quantityAvailable === 0 && selectedSku.inventoryCount === 0;

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
            className="col-span-1 md:col-span-2 pt-8 px-6 lg:px-16 space-y-16"
          >
            <div className="space-y-16">
              <div className="space-y-6">
                <p className="text-3xl">{getProductName(selectedSku)}</p>

                <div className="flex items-center gap-4">
                  {isSoldOut && (
                    <Badge
                      variant={"outline"}
                      className="bg-gray-600 text-gray-50 border-gray-600"
                    >
                      Sold Out
                    </Badge>
                  )}

                  <p className="text-lg text-muted-foreground">
                    {formatter.format(selectedSku.price)}
                  </p>
                </div>
              </div>
              <ProductAttribute
                product={product}
                selectedSku={selectedSku}
                setSelectedSku={setSelectedSku}
              />
            </div>

            {(selectedSku as any).productCategory == "Hair" && (
              <About
                productAttributes={product.attributes || {}}
                productSku={selectedSku}
              />
            )}

            <div className="space-y-4">
              <div className="flex gap-4">
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{
                    opacity: 1,
                    y: 0,
                    transition: { ease: "easeInOut" },
                  }}
                >
                  <LoadingButton
                    className="w-[288px]"
                    isLoading={false}
                    onClick={handleUpdateBag}
                    disabled={isSoldOut}
                  >
                    {isUpdatingBag ? "Adding to Bag.." : "Add to Bag"}
                  </LoadingButton>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{
                    opacity: 1,
                    y: 0,
                    transition: { ease: "easeInOut" },
                  }}
                >
                  <LoadingButton
                    variant={"outline"}
                    isLoading={false}
                    onClick={handleUpdateSavedBag}
                    disabled={isSoldOut}
                    className={`${savedBagItem ? "border-[#EC4683] shadow-md" : ""} hover:shadow-md`}
                  >
                    {!savedBagItem && (
                      <HeartIcon className="w-4 h-4 text-muted-foreground" />
                    )}
                    {savedBagItem && <HeartIconFilled width={16} height={16} />}
                  </LoadingButton>
                </motion.div>
              </div>

              {addedItemSuccessfully == false && (
                <div className="flex gap-1 items-center text-destructive">
                  <AlertCircleIcon className="w-3.5 h-3.5" />
                  <p className="text-sm">
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
