import { capitalizeWords } from "@/lib/utils";
import { Product, ProductSku } from "@athena/webapp";
import {
  useProductDiscount,
  useProductDiscounts,
} from "@/hooks/useProductDiscount";
import { formatStoredAmount } from "@/lib/currency";
import { StorefrontImage } from "./ui/storefront-image";
import { StatusBadge } from "./ui/status-badge";
import placeholder from "@/assets/placeholder.png";

type ProductCardSku = Pick<
  ProductSku,
  "images" | "price" | "productName" | "quantityAvailable" | "sku"
> & {
  _id: string;
  color?: string;
};

type ProductCardProduct = Pick<Product, "name"> & {
  _id: string;
  skus: ProductCardSku[];
};

const hasSellableAvailability = (sku: Pick<ProductCardSku, "quantityAvailable">) =>
  sku.quantityAvailable > 0;

const getPreferredCardSku = (
  skus: ProductCardSku[],
  discountedSkuId?: string,
) => {
  const discountedSku = skus.find((sku) => sku._id === discountedSkuId);

  if (discountedSku && hasSellableAvailability(discountedSku)) {
    return discountedSku;
  }

  return skus.find(hasSellableAvailability) ?? discountedSku ?? skus[0];
};

export function ProductCard({
  product,
  currencyFormatter,
  fallbackImageUrl,
}: {
  product: ProductCardProduct;
  currencyFormatter: Intl.NumberFormat;
  fallbackImageUrl?: string;
}) {
  if (!product) return null;

  const uniqueColors = Array.from(
    new Set(product.skus.map((sku) => sku.color)),
  ).length;

  const isSoldOut = product.skus.every((sku) => !hasSellableAvailability(sku));

  const isSellingFast = product.skus.some(
    (sku) => sku.quantityAvailable > 0 && sku.quantityAvailable <= 2,
  );

  // Check all SKUs for discounts - returns discount info and ID of discounted SKU
  const { hasDiscount, discountedPrice, originalPrice, discountedSkuId } =
    useProductDiscounts(
      product.skus.map((sku) => ({ _id: sku._id, price: sku.price })),
    );

  const displayedSku = getPreferredCardSku(product.skus, discountedSkuId);

  const isFree = hasDiscount && discountedPrice === 0;

  return (
    <article className="flex min-w-0 flex-col space-y-layout-sm">
      <div className="overflow-hidden relative">
        <StorefrontImage
          alt={`${product?.name} image`}
          aspectRatio="3 / 4"
          className="object-cover transition-transform duration-standard ease-standard group-hover:scale-105 motion-reduce:transform-none"
          decoding="async"
          fallbackSrc={fallbackImageUrl || placeholder}
          loading="lazy"
          sizes="(max-width: 768px) 50vw, (max-width: 1280px) 33vw, 25vw"
          src={displayedSku.images[0] || fallbackImageUrl}
          wrapperClassName="rounded-lg"
        />
        {isSoldOut && (
          <StatusBadge className="absolute left-2 top-2" tone="danger">
            Sold Out
          </StatusBadge>
        )}

        {!isSoldOut && isSellingFast && (
          <StatusBadge className="absolute left-2 top-2" tone="warning">
            🔥 Selling fast — Few left
          </StatusBadge>
        )}

        {!isSoldOut && hasDiscount && !isSellingFast && (
          <StatusBadge className="absolute left-2 top-2" tone="info">
            Sale
          </StatusBadge>
        )}
      </div>
      <div className="flex flex-col items-start space-y-2">
        <p className="font-medium">{capitalizeWords(product?.name)}</p>
        <div className="flex gap-2">
          {!hasDiscount && (
            <p className="text-sm">
              {formatStoredAmount(currencyFormatter, displayedSku.price)}
            </p>
          )}
          {hasDiscount && !isFree && (
            <div className="flex items-center gap-2 text-sm">
              <p className="line-through text-muted-foreground">
                {formatStoredAmount(currencyFormatter, originalPrice)}
              </p>
              <p>
                {formatStoredAmount(currencyFormatter, discountedPrice)}
              </p>
            </div>
          )}
          {isFree && (
            <div className="flex items-center gap-2 text-sm">
              <p className="line-through text-muted-foreground">
                {formatStoredAmount(currencyFormatter, originalPrice)}
              </p>
              <p>Free</p>
            </div>
          )}
          {uniqueColors > 1 && (
            <p className="text-sm text-muted-foreground">{uniqueColors} colors</p>
          )}
        </div>
      </div>
    </article>
  );
}

export function ProductSkuCard({
  sku,
  currencyFormatter,
  fallbackImageUrl,
}: {
  sku: ProductCardSku;
  currencyFormatter: Intl.NumberFormat;
  fallbackImageUrl?: string;
}) {
  const isSoldOut = !hasSellableAvailability(sku);

  const { hasDiscount, discountedPrice, originalPrice } = useProductDiscount(
    sku._id,
    sku.price,
  );

  const isFree = hasDiscount && discountedPrice === 0;

  return (
    <article className="flex min-w-0 flex-col">
      <div className="mb-2 overflow-hidden relative">
        <StorefrontImage
          alt={`${sku?.productName} image`}
          aspectRatio="3 / 4"
          className="object-cover transition-transform duration-standard ease-standard group-hover:scale-105 motion-reduce:transform-none"
          decoding="async"
          fallbackSrc={fallbackImageUrl || placeholder}
          loading="lazy"
          sizes="(max-width: 768px) 50vw, (max-width: 1280px) 33vw, 25vw"
          src={sku.images[0] || fallbackImageUrl}
          wrapperClassName="rounded-lg"
        />

        {isSoldOut && (
          <StatusBadge className="absolute left-2 top-2" tone="danger">
            Sold Out
          </StatusBadge>
        )}

        {!isSoldOut && hasDiscount && (
          <StatusBadge className="absolute left-2 top-2" tone="info">
            Sale
          </StatusBadge>
        )}
      </div>
      <div className="text-sm flex flex-col items-start gap-4">
        <p className="font-medium">
          {sku?.productName && capitalizeWords(sku?.productName)}
        </p>
        {!hasDiscount && (
          <p className="text-xs">
            {formatStoredAmount(currencyFormatter, sku.price)}
          </p>
        )}
        {hasDiscount && !isFree && (
          <div className="flex items-center gap-2 text-xs">
            <p className="line-through text-muted-foreground">
              {formatStoredAmount(currencyFormatter, originalPrice)}
            </p>
            <p>{formatStoredAmount(currencyFormatter, discountedPrice)}</p>
          </div>
        )}
        {isFree && (
          <div className="flex items-center gap-2 text-xs">
            <p className="line-through text-muted-foreground">
              {formatStoredAmount(currencyFormatter, originalPrice)}
            </p>
            <p>Free</p>
          </div>
        )}
      </div>
    </article>
  );
}
