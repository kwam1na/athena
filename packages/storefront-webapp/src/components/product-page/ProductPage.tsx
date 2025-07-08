import { useEffect, useRef } from "react";
import { motion } from "framer-motion";

import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import NotFound from "../states/not-found/NotFound";
import GalleryViewer from "./GalleryViewer";
import { BagProduct, PickupDetails, ShippingPolicy } from "./ProductDetails";
import { ProductAttribute } from "./ProductAttribute";
import { Reviews } from "./ProductReviews";
import { About } from "./About";
import { useTrackAction } from "@/hooks/useTrackAction";
import { OnsaleProduct } from "./OnSaleProduct";
import { useProductPageLogic } from "@/hooks/useProductPageLogic";
import { ProductInfo } from "./ProductInfo";
import { ProductActions } from "./ProductActions";

// Main Product Page Component
export default function ProductPage() {
  const {
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
    savedBagItem,
    formatter,
    isSoldOut,
    isLowStock,
    isPromoCodeItem,
    addedItemSuccessfully,
    isUpdatingBag,
    bagAction,
  } = useProductPageLogic();

  const pageRef = useRef<HTMLDivElement | null>(null);

  useTrackAction({
    action: "viewed_product",
    data: {
      product: productSlug,
      productSku: selectedSku?.sku,
      productImageUrl: selectedSku?.images?.[0],
    },
    productId: productSlug,
    isReady: !!selectedSku,
    deps: [selectedSku?.sku],
  });

  useEffect(() => {
    if (addedItemSuccessfully && selectedSku) {
      sheetContent.current = (
        <BagProduct product={selectedSku} action={bagAction} />
      );
    }
  }, [addedItemSuccessfully, bagAction, selectedSku]);

  const showShippingPolicy = () => {
    sheetContent.current = <ShippingPolicy />;
    setIsSheetOpen(true);
  };

  if (error) return <NotFound />;
  if (!selectedSku || !product) return <div className="h-screen" />;
  if (product?.isVisible === false || isPromoCodeItem) {
    return <NotFound />;
  }

  return (
    <>
      <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
        <SheetTitle />
        <SheetContent>{sheetContent.current}</SheetContent>

        {/* Mobile UI: Full-width layout with scrollable content */}
        <div className="md:hidden min-h-screen pb-40">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.1 } }}
            // className="px-4"
          >
            <GalleryViewer images={selectedSku.images} />
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{
              opacity: 1,
              transition: { duration: 0.4, delay: 0.1, ease: "easeInOut" },
            }}
            className="pt-8 px-6 space-y-12"
          >
            <div className="space-y-8">
              <ProductInfo
                selectedSku={selectedSku}
                formatter={formatter}
                isSoldOut={isSoldOut}
                isLowStock={isLowStock}
              />

              <ProductAttribute
                product={product}
                selectedSku={selectedSku}
                setSelectedSku={setSelectedSku}
              />
            </div>

            {selectedSku.productCategory === "Hair" && (
              <About
                productAttributes={product.attributes || {}}
                productSku={selectedSku}
              />
            )}

            {selectedSku.productCategory === "Hair" && <OnsaleProduct />}

            <ProductActions
              handleUpdateBag={handleUpdateBag}
              handleUpdateSavedBag={handleUpdateSavedBag}
              isUpdatingBag={isUpdatingBag}
              savedBagItem={savedBagItem}
              isSoldOut={isSoldOut}
              addedItemSuccessfully={addedItemSuccessfully}
            />

            <PickupDetails showShippingPolicy={showShippingPolicy} />

            <Reviews
              productId={product._id}
              productCategory={(product as any).categoryName}
            />
          </motion.div>
        </div>

        {/* Desktop UI: Grid layout */}
        <motion.main
          ref={pageRef}
          className="hidden md:grid container mx-auto grid-cols-1 xl:grid-cols-4 gap-12 pb-32"
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
              <ProductInfo
                selectedSku={selectedSku}
                formatter={formatter}
                isSoldOut={isSoldOut}
                isLowStock={isLowStock}
              />

              <ProductAttribute
                product={product}
                selectedSku={selectedSku}
                setSelectedSku={setSelectedSku}
              />
            </div>

            {selectedSku.productCategory === "Hair" && (
              <About
                productAttributes={product.attributes || {}}
                productSku={selectedSku}
              />
            )}

            {selectedSku.productCategory === "Hair" && <OnsaleProduct />}

            <ProductActions
              handleUpdateBag={handleUpdateBag}
              handleUpdateSavedBag={handleUpdateSavedBag}
              isUpdatingBag={isUpdatingBag}
              savedBagItem={savedBagItem}
              isSoldOut={isSoldOut}
              addedItemSuccessfully={addedItemSuccessfully as boolean | null}
            />

            <PickupDetails showShippingPolicy={showShippingPolicy} />

            <Reviews
              productId={product._id}
              productCategory={(product as any).categoryName}
            />
          </motion.div>
        </motion.main>
      </Sheet>
    </>
  );
}
