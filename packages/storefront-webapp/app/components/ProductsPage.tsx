import { useStoreContext } from "@/contexts/StoreContext";
import { Product } from "../../../athena-webapp";
import { Link } from "@tanstack/react-router";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";

function ProductCard({
  product,
  currencyFormatter,
}: {
  product: Product;
  currencyFormatter: Intl.NumberFormat;
}) {
  return (
    <div className="flex flex-col mb-24">
      <div className="mb-2">
        <img
          alt={`${product.name} image`}
          className="aspect-square object-cover"
          src={product.skus[0].images[0]}
        />
      </div>
      <div className="flex flex-col px-4 lg:px-0 items-start gap-4">
        <p className="font-medium">{product.name}</p>
        <p className="text-gray-500">
          {currencyFormatter.format(product.skus[0].price)}
        </p>
      </div>
    </div>
  );
}

function ProductCardLoadingSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="w-[30vw] h-[30vw] bg-zinc-100 rounded-md"></Skeleton>
      <div className="space-y-4">
        <Skeleton className="w-[180px] h-[24px] bg-zinc-100 rounded"></Skeleton>
        <Skeleton className="w-[96px] h-[24px] bg-zinc-100 rounded"></Skeleton>
      </div>
    </div>
  );
}

export default function ProductsPage({
  products,
  isLoading,
}: {
  isLoading: boolean;
  products?: Product[];
}) {
  const { formatter } = useStoreContext();

  if (products?.length == 0) {
    return (
      <div className="space-y-8 px-8">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div className="space-y-4">
            <div className="w-[30vw] h-[30vw] bg-zinc-100 rounded-md"></div>
            <div className="space-y-4">
              <div className="w-[180px] h-[24px] bg-zinc-100 rounded"></div>
            </div>
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
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 lg:px-8">
      {isLoading && (
        <>
          <ProductCardLoadingSkeleton />
          <ProductCardLoadingSkeleton />
          <ProductCardLoadingSkeleton />
          <ProductCardLoadingSkeleton />
          <ProductCardLoadingSkeleton />
          <ProductCardLoadingSkeleton />
        </>
      )}
      {!isLoading &&
        products?.map((product, index) => (
          <Link
            to="/shop/product/$productSlug"
            key={index}
            params={(params) => ({
              ...params,
              productSlug: product._id,
            })}
            search={{ variant: product.skus[0].sku }}
            className="block"
          >
            <ProductCard
              key={product.id}
              product={product}
              currencyFormatter={formatter}
            />
          </Link>
        ))}
    </div>
  );
}
