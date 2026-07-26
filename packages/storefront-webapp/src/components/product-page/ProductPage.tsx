import { useEffect, useRef } from "react";

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
import { MobileProductActions } from "./MobileProductActions";
import { TrustSignals } from "../communication/TrustSignals";
import { AboutProduct } from "./AboutProduct";
import { useProductDiscount } from "@/hooks/useProductDiscount";
import { DiscountBadge } from "./DiscountBadge";
import { useStoreContext } from "@/contexts/StoreContext";
import { getStoreFallbackImageUrl } from "@/lib/storeConfig";
import placeholder from "@/assets/placeholder.png";
import { PageState } from "../states/PageState";

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
    productDiscount,
  } = useProductPageLogic();

  const pageRef = useRef<HTMLElement | null>(null);

  const { store } = useStoreContext();
  const fallbackImageUrl =
    getStoreFallbackImageUrl(store, placeholder) || placeholder;

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

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const showShippingPolicy = () => {
    sheetContent.current = <ShippingPolicy />;
    setIsSheetOpen(true);
  };

  const isSingleSkuHidden =
    product?.skus?.length === 1 &&
    (selectedSku as (typeof selectedSku & { isVisible?: boolean }))?.isVisible ===
      false;

  if (error) return <NotFound />;
  if (!product) return <PageState state="loading" title="Loading product" />;
  if (product.skus.length === 0) return <NotFound />;
  if (!selectedSku) return <PageState state="loading" title="Loading product" />;
  if (
    product?.isVisible === false ||
    isSingleSkuHidden ||
    isPromoCodeItem ||
    selectedSku.price === 0 ||
    selectedSku.price === undefined
  ) {
    return <NotFound />;
  }

  const images = selectedSku.images.length
    ? selectedSku.images
    : [fallbackImageUrl];

  return (
    <>
      <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
        <SheetContent>
          <SheetTitle className="sr-only">Product details</SheetTitle>
          {sheetContent.current}
        </SheetContent>

        <main ref={pageRef}>
        {/* Mobile UI: Full-width layout with scrollable content */}
        <div className="md:hidden min-h-screen pb-24">
          <div className="relative">
            <GalleryViewer
              fallbackImageUrl={fallbackImageUrl}
              images={images}
              productName={selectedSku.productName || product.name || "Product"}
            />
            <DiscountBadge
              size="sm"
              productSkuId={selectedSku._id}
              productPrice={selectedSku.price}
            />
          </div>

          <div className="space-y-layout-lg px-gutter pt-layout-md">
            <div className="space-y-8">
              <ProductInfo
                selectedSku={selectedSku}
                formatter={formatter}
                isSoldOut={isSoldOut}
                isLowStock={isLowStock}
                productDiscount={productDiscount}
              />

              <ProductAttribute
                product={product}
                selectedSku={selectedSku}
                setSelectedSku={setSelectedSku}
              />
            </div>

            {selectedSku.productCategory === "Hair" && <OnsaleProduct />}

            <TrustSignals />

            <MobileProductActions
              product={product}
              selectedSku={selectedSku}
              setSelectedSku={setSelectedSku}
              handleUpdateBag={handleUpdateBag}
              handleUpdateSavedBag={handleUpdateSavedBag}
              isUpdatingBag={isUpdatingBag}
              savedBagItem={savedBagItem}
              isSoldOut={isSoldOut}
              addedItemSuccessfully={addedItemSuccessfully}
            />

            <AboutProduct
              productAttributes={product.attributes || {}}
              productSku={selectedSku}
            />

            <PickupDetails showShippingPolicy={showShippingPolicy} />

            <Reviews
              productId={product._id}
              productCategory={(product as any).categoryName}
            />
          </div>
        </div>

        {/* Desktop UI: Grid layout */}
        <div className="mx-auto hidden max-w-content grid-cols-2 gap-layout-lg px-gutter pb-layout-xl md:grid">
          <div className="relative">
            <GalleryViewer
              fallbackImageUrl={fallbackImageUrl}
              images={images}
              productName={selectedSku.productName || product.name || "Product"}
            />
            <DiscountBadge
              size="md"
              productSkuId={selectedSku._id}
              productPrice={selectedSku.price}
            />
          </div>

          <div className="space-y-layout-xl px-gutter pt-layout-md">
            <div className="space-y-16">
              <ProductInfo
                selectedSku={selectedSku}
                formatter={formatter}
                isSoldOut={isSoldOut}
                isLowStock={isLowStock}
                productDiscount={productDiscount}
              />

              <ProductAttribute
                product={product}
                selectedSku={selectedSku}
                setSelectedSku={setSelectedSku}
              />
            </div>

            <AboutProduct
              productAttributes={product.attributes || {}}
              productSku={selectedSku}
            />

            {selectedSku.productCategory === "Hair" && <OnsaleProduct />}

            <div className="space-y-4">
              <TrustSignals />

              <ProductActions
                handleUpdateBag={handleUpdateBag}
                handleUpdateSavedBag={handleUpdateSavedBag}
                isUpdatingBag={isUpdatingBag}
                savedBagItem={savedBagItem}
                isSoldOut={isSoldOut}
                addedItemSuccessfully={addedItemSuccessfully as boolean | null}
              />
            </div>

            <PickupDetails showShippingPolicy={showShippingPolicy} />

            <Reviews
              productId={product._id}
              productCategory={(product as any).categoryName}
            />
          </div>
        </div>
        </main>
      </Sheet>
    </>
  );
}
