import { useStoreContext } from "@/contexts/StoreContext";
import { useQuery } from "@tanstack/react-query";
import {
  Link,
  useNavigate,
  useParams,
  useSearch,
} from "@tanstack/react-router";
import { LoadingButton } from "../ui/loading-button";
import { useShoppingBag } from "@/hooks/useShoppingBag";
import { getProduct } from "@/api/product";
import { Product, ProductSku } from "@athena/webapp-2";
import { Button } from "../ui/button";
import { capitalizeWords } from "@/lib/utils";
import { HeartIcon } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import placeholder from "@/assets/placeholder.png";

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

// Helper Function
const getProductName = (item: ProductSku) =>
  item.productCategory === "Hair"
    ? `${item.length}" ${capitalizeWords(item.colorName)} ${item.productName}`
    : item.productName;

// Product Attribute Selector
function ProductAttribute({
  product,
  selectedSku,
}: {
  product: Product;
  selectedSku: ProductSku;
}) {
  const colors: string[] = Array.from(
    new Set(product.skus.map((sku: ProductSku) => sku.colorName))
  );

  const lengths: number[] = Array.from(
    new Set(
      product.skus
        .filter((sk: ProductSku) => sk.colorName == selectedSku.colorName)
        .map((sku: ProductSku) => parseInt(sku.length))
        .sort((a: number, b: number) => a - b)
    )
  );

  const navigate = useNavigate();

  const handleClick = (attribute: "color" | "length", value: string) => {
    let variant;

    if (attribute == "color") {
      variant =
        product.skus.find(
          (sk: ProductSku) =>
            sk.colorName == value && sk.length == selectedSku.length
        ) || product.skus.find((sk: ProductSku) => sk.colorName == value);
    } else {
      variant =
        product.skus.find(
          (sk: ProductSku) =>
            sk.length == value && sk.colorName == selectedSku.colorName
        ) || product.skus.find((sk: ProductSku) => sk.length == value);
    }

    navigate({
      to: "/shop/product/$productSlug",
      params: (prev) => ({ productSlug: prev.productSlug! }),
      search: {
        variant: variant.sku,
      },
    });
  };

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <p className="text-sm">Color</p>

        <div className="grid grid-cols-5 gap-4">
          {colors.map((color, index) => {
            return (
              <Button
                variant={"ghost"}
                key={index}
                className={`${selectedSku?.colorName == color ? "border border-black" : "border border-background-muted"}`}
                onClick={() => handleClick("color", color)}
              >
                {capitalizeWords(color)}
              </Button>
            );
          })}
        </div>
      </div>

      <div className="space-y-4">
        <p className="text-sm">Length</p>

        <div className="grid grid-cols-5 gap-4">
          {lengths.map((length, index) => {
            return (
              <Button
                variant={"ghost"}
                key={index}
                className={`${selectedSku?.length == length ? "border border-black" : "border border-background-muted"}`}
                onClick={() => handleClick("length", length.toString())}
              >
                {`${length}"`}
              </Button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Product Details Section
function ProductDetails({
  showShippingPolicy,
}: {
  showShippingPolicy: () => void;
}) {
  return (
    <div className="text-sm space-y-8">
      <div className="space-y-4">
        <p className="font-bold">Free store pickup</p>
        <div className="flex gap-4">
          <p>Wigclub Hair Studio</p>
          <a href="https://google.com" className="font-bold underline">
            Get directions
          </a>
        </div>
      </div>
      <SheetTrigger asChild onClick={showShippingPolicy}>
        <p className="font-bold cursor-pointer">
          Shipping, returns, and exchanges
        </p>
      </SheetTrigger>
    </div>
  );
}

// Bag Product Summary
function BagProduct({ product }: { product: ProductSku }) {
  return (
    <div className="flex flex-col gap-12 pt-12">
      <div className="space-y-8">
        <p className="text-md">Added to your bag</p>
        <div className="flex gap-4">
          <img
            alt={`Bag image`}
            className="w-[140px] h-[180px] aspect-square object-cover"
            src={product.images[0] || placeholder}
          />
          <p className="text-sm">{getProductName(product)}</p>
        </div>
      </div>
      <Link to="/shop/bag">
        <Button variant="outline" className="w-full">
          See Bag
        </Button>
      </Link>
    </div>
  );
}

// Bag Product Summary
function SavedProduct({ product }: { product: ProductSku }) {
  return (
    <div className="flex flex-col gap-12 pt-12">
      <div className="space-y-8">
        <p className="text-md">Added to your saved items</p>
        <div className="flex gap-4">
          <img
            alt={`Bag image`}
            className="w-[140px] h-[180px] aspect-square object-cover"
            src={product.images[0] || placeholder}
          />
          <p className="text-sm">{getProductName(product)}</p>
        </div>
      </div>
      <Link to="/shop/saved">
        <Button variant="outline" className="w-full">
          See Saved
        </Button>
      </Link>
    </div>
  );
}

// Shipping Policy Section
function ShippingPolicy() {
  return (
    <div className="space-y-12 pt-12">
      <div className="space-y-4">
        <p className="text-md">Shipping</p>
        <p className="text-sm text-muted-foreground">
          Orders take 24 - 48 hours to process. You will receive an email when
          your order has been shipped.
        </p>
      </div>
      <div className="space-y-4">
        <p className="text-md">Returns and exchanges</p>
        <p className="text-sm text-muted-foreground">
          You have 7 days from the date your order is received to return your
          purchase.
        </p>
      </div>
    </div>
  );
}

function Reviews() {
  return (
    <div className="space-y-4">
      <p>Reviews (3)</p>

      <div className="space-y-16">
        <ProductReview />
        <ProductReview />
        <ProductReview />
      </div>
    </div>
  );
}

function ProductReview() {
  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <div className="bg-gray-100 rounded-md w-full h-[24px]"></div>
        <div className="bg-gray-100 rounded-md w-full h-[80px]"></div>
      </div>
      <div className="bg-gray-100 rounded-md w-[80%] h-[24px]"></div>
    </div>
  );
}

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
    updateSavedBag,
  } = useShoppingBag();

  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [activeImage, setActiveImage] = useState(0);
  const imageRefs = useRef<HTMLImageElement[] | null[]>([]);
  const [isRefsReady, setRefsReady] = useState(false);
  const pageRef = useRef<HTMLDivElement | null>(null);

  const sheetContent = useRef<React.ReactNode | null>(null);

  const { data: product, error } = useGetProductQuery(productSlug);

  const { variant } = useSearch({ strict: false });

  const selectedSku = product?.skus?.find(
    (sku: ProductSku) => sku.sku === variant
  );

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

  if (error || (product && !selectedSku)) {
    return <NotFound />;
  }

  if (!product) return null;

  return (
    <>
      <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
        <SheetTitle />
        <SheetContent>{sheetContent.current}</SheetContent>

        <main
          ref={pageRef}
          className="grid grid-cols-1 xl:grid-cols-4 gap-12 xl:px-48 pb-16"
        >
          <div className="col-span-1 md:col-span-2">
            <GalleryViewer images={selectedSku.images} />
          </div>

          <div className="col-span-1 md:col-span-2 pt-8 px-6 lg:px-16 space-y-12">
            <div className="space-y-8">
              <div className="space-y-6">
                <p className="text-xl">{getProductName(selectedSku)}</p>
                <p className="text-muted-foreground">
                  {formatter.format(selectedSku.price)}
                </p>
              </div>
              <ProductAttribute product={product} selectedSku={selectedSku} />
            </div>

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

            <ProductDetails showShippingPolicy={showShippingPolicy} />

            <Reviews />
          </div>
        </main>
      </Sheet>
    </>
  );
}
