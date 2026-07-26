import { useStoreContext } from "@/contexts/StoreContext";
import { Product, ProductSku } from "@athena/webapp";
import { Link, useParams } from "@tanstack/react-router";
import { Skeleton } from "./ui/skeleton";
import { ProductCard, ProductSkuCard } from "./ProductCard";
import { useGetProductFilters } from "@/hooks/useGetProductFilters";
import { getStoreFallbackImageUrl } from "@/lib/storeConfig";
import { useEffect } from "react";
import { PageState } from "./states/PageState";
import { StorefrontPage } from "./common/StorefrontPage";

function ProductCardLoadingSkeleton() {
  return (
    <div className="space-y-layout-sm" aria-hidden="true">
      <Skeleton className="aspect-square w-full rounded-lg" />
      <div className="space-y-layout-xs">
        <Skeleton className="h-4 w-44 rounded-sm" />
        <Skeleton className="h-4 w-24 rounded-sm" />
      </div>
    </div>
  );
}

export default function ProductsPage({
  products,
  productSkus,
  isLoading,
}: {
  isLoading: boolean;
  products?: Product[];
  productSkus?: ProductSku[];
}) {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [products?.length]);

  const { formatter, store } = useStoreContext();
  const fallbackImageUrl = getStoreFallbackImageUrl(store);

  const { filtersCount } = useGetProductFilters();

  const { categorySlug } = useParams({ strict: false });

  const origin = categorySlug ? `shop_${categorySlug}` : "shop";

  if (products?.length == 0 && filtersCount > 0) {
    return (
      <StorefrontPage as="div" spacing="compact">
        <PageState
          description="Clear or adjust your filters to see more products."
          inline
          state="empty"
          title="No products match these filters"
        />
      </StorefrontPage>
    );
  }

  if (products?.length == 0 && !productSkus) {
    return (
      <StorefrontPage as="div" spacing="compact">
        <PageState
          description="We're updating this collection. Check back soon."
          inline
          state="empty"
          title="Nothing here yet"
        />
      </StorefrontPage>
    );
  }

  return (
    <div
      aria-busy={isLoading || undefined}
      className="grid min-w-0 grid-cols-2 gap-layout-sm md:grid-cols-3 lg:gap-layout-xl"
    >
      {isLoading && (
        <>
          <ProductCardLoadingSkeleton />
          <ProductCardLoadingSkeleton />
          <ProductCardLoadingSkeleton />
          <ProductCardLoadingSkeleton />

          <ProductCardLoadingSkeleton />
          <ProductCardLoadingSkeleton />
          <ProductCardLoadingSkeleton />
          <ProductCardLoadingSkeleton />

          <ProductCardLoadingSkeleton />
          <ProductCardLoadingSkeleton />
          <ProductCardLoadingSkeleton />
          <ProductCardLoadingSkeleton />
        </>
      )}
      {!isLoading &&
        productSkus?.flatMap((sku) => (
          <Link
            to="/shop/product/$productSlug"
            key={`${sku._id}-${sku.sku}`}
            params={(params) => ({
              ...params,
              productSlug: sku.productId,
            })}
            search={{ variant: sku.sku, origin }}
            className="group mb-layout-md block min-w-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2"
          >
            <ProductSkuCard
              fallbackImageUrl={fallbackImageUrl}
              sku={sku}
              currencyFormatter={formatter}
            />
          </Link>
        ))}

      {!isLoading &&
        products?.flatMap((product: Product) => (
          <Link
            to="/shop/product/$productSlug"
            key={`${product?._id}}`}
            params={(params) => ({
              ...params,
              productSlug: product?._id,
            })}
            search={{ variant: product?.skus?.[0].sku, origin }}
            className="group mb-layout-md block min-w-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2"
          >
            <ProductCard
              fallbackImageUrl={fallbackImageUrl}
              product={product}
              currencyFormatter={formatter}
            />
          </Link>
        ))}
    </div>
  );
}
