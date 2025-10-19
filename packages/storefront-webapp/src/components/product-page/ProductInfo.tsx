import { ProductSku } from "@athena/webapp";
import { getProductName } from "@/lib/productUtils";
import { SellingFastSignal, SoldOutBadge } from "./InventoryLevelBadge";
import { useProductQueries } from "@/lib/queries/product";
import { EyeIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useGetProductReviewsQuery } from "@/hooks/useGetProductReviews";
import { ReviewSummary } from "./ReviewSummary";

interface ProductInfoProps {
  selectedSku: ProductSku;
  formatter: Intl.NumberFormat;
  isSoldOut: boolean;
  isLowStock: boolean;
  className?: string;
  productDiscount?: {
    hasDiscount: boolean;
    discountedPrice: number;
    originalPrice: number;
    discount?: {
      type: "percentage" | "amount";
      value: number;
      code: string;
    };
  };
}

function ViewCount({ productId }: { productId: string }) {
  const productQueries = useProductQueries();
  const { data: viewCount, isLoading } = useQuery(
    productQueries.viewCount({ productId: productId || "" })
  );

  if (!productId) return null;
  if (
    !isLoading &&
    (!viewCount || (viewCount.daily === 0 && viewCount.total === 0))
  )
    return null;

  const daily = viewCount?.daily ?? 0;
  const total = viewCount?.total ?? 0;

  let dailyText = "";
  if (daily === 1) dailyText = "Viewed once today";
  else if (daily > 1) dailyText = `${daily} views today`;

  let totalText = "";
  if (total === 1) totalText = "1 total view";
  else if (total > 1) totalText = `${total} total views`;

  return (
    <div className="text-sm text-gray-500 flex items-center gap-2 min-h-[20px]">
      <p>👀</p>
      {isLoading ? (
        <span className="inline-block w-24 h-3 bg-gray-200 rounded animate-pulse" />
      ) : (
        <>
          {daily > 0 && <span className="font-medium">{dailyText}</span>}
          {dailyText && totalText ? " · " : ""}
          {totalText}
        </>
      )}
    </div>
  );
}

export function ProductInfo({
  selectedSku,
  formatter,
  isSoldOut,
  isLowStock,
  className = "",
  productDiscount,
}: ProductInfoProps) {
  const { data: reviews } = useGetProductReviewsQuery(selectedSku.productId);

  const hasDiscount = productDiscount?.hasDiscount ?? false;
  const discountedPrice = productDiscount?.discountedPrice ?? selectedSku.price;
  const originalPrice = productDiscount?.originalPrice ?? selectedSku.price;
  const isFree = hasDiscount && discountedPrice === 0;

  return (
    <div className={`space-y-6 ${className}`}>
      <div className="flex items-baseline gap-3">
        <p className="text-2xl md:text-4xl leading-tight">
          {getProductName(selectedSku)}
        </p>
        {reviews && reviews.length > 0 && (
          <span className="align-middle">
            <ReviewSummary reviews={reviews} />
          </span>
        )}
      </div>
      <div className="flex items-center gap-4 flex-wrap">
        {isSoldOut && <SoldOutBadge />}

        {isLowStock && !isSoldOut && (
          <SellingFastSignal message={`Almost gone`} />
        )}

        {!hasDiscount && (
          <p className="text-md md:text-2xl">
            {formatter.format(selectedSku.price)}
          </p>
        )}

        {hasDiscount && !isFree && (
          <div className="flex items-center gap-3">
            <p className="text-md md:text-2xl line-through text-muted-foreground">
              {formatter.format(originalPrice)}
            </p>
            <p className="text-md md:text-2xl text-accent2">
              {formatter.format(discountedPrice)}
            </p>
          </div>
        )}

        {isFree && (
          <div className="flex items-center gap-3">
            <p className="text-md md:text-2xl line-through text-muted-foreground">
              {formatter.format(originalPrice)}
            </p>
            <p className="text-md md:text-2xl">Free</p>
          </div>
        )}
      </div>
      {/* <ViewCount productId={selectedSku.productId} /> */}
    </div>
  );
}
