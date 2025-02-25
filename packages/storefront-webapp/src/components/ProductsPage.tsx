import { useStoreContext } from "@/contexts/StoreContext";
import { Product, ProductSku } from "@athena/webapp";
import { Link } from "@tanstack/react-router";
import { Skeleton } from "./ui/skeleton";
import { ProductCard, ProductSkuCard } from "./ProductCard";
import { useGetProductFilters } from "@/hooks/useGetProductFilters";

function ProductCardLoadingSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="w-64 h-64 bg-accent5 rounded-md"></Skeleton>
      <div className="space-y-2">
        <Skeleton className="w-[180px] h-[16px] bg-accent5 rounded"></Skeleton>
        <Skeleton className="w-[96px] h-[16px] bg-accent5 rounded"></Skeleton>
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
  const { formatter } = useStoreContext();

  const { filtersCount } = useGetProductFilters();

  const origin = "shop";

  if (products?.length == 0 && filtersCount > 0) {
    return (
      <div className="space-y-8 container mx-auto max-w-[1024px] h-screen">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div className="space-y-4">
            <div className="w-[80px] h-[24px] bg-accent5 rounded" />
          </div>
        </div>

        <div>
          <p className="text-sm font-light">
            No products found with the selected filters
          </p>
        </div>
      </div>
    );
  }

  if (products?.length == 0 && !productSkus) {
    return (
      <div className="space-y-8 container mx-auto max-w-[1024px] h-screen">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div className="space-y-4">
            <div className="w-[80px] h-[24px] bg-accent5 rounded" />
          </div>
        </div>

        <div>
          <p className="text-sm font-light">
            We're currently updating this section of our store. Check back soon.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto grid grid-cols-2 lg:grid-cols-3 gap-2 lg:gap-12">
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
            className="block mb-4"
          >
            <ProductSkuCard sku={sku} currencyFormatter={formatter} />
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
            className="block mb-4"
          >
            <ProductCard product={product} currencyFormatter={formatter} />
          </Link>
        ))}
    </div>
  );
}
