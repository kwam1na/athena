import { Link } from "@tanstack/react-router";
import { Button } from "../ui/button";
import { ProductSkuCard } from "../ProductCard";
import { useStoreContext } from "@/contexts/StoreContext";
import { ProductSku } from "@athena/webapp";
import type { HomepageDisplaySku } from "./homePageContent";

interface BestSellersSectionProps {
  bestSellersProducts: Array<ProductSku | HomepageDisplaySku>;
  origin: string;
}

/**
 * Best sellers section component for the homepage
 * Displays a grid of best-selling products
 */
export function BestSellersSection({
  bestSellersProducts,
  origin,
}: BestSellersSectionProps) {
  const { formatter } = useStoreContext();

  if (!bestSellersProducts?.length) return null;

  return (
    <section className="space-y-layout-md" aria-labelledby="best-sellers-heading">
      <h2 id="best-sellers-heading" className="text-md font-medium">
        Shop best sellers
      </h2>

      <div className="space-y-8 lg:space-y-24">
        <ProductSkuGrid
          products={bestSellersProducts || []}
          formatter={formatter}
          origin={origin}
        />

        <div className="text-sm">
          <Link
            to="/shop/$categorySlug"
            params={{
              categorySlug: "best-sellers",
            }}
            search={{
              origin: "shop_bestsellers",
            }}
          >
            <Button className="p-0" variant={"link"}>
              Shop all
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
}

// Helper component for product grid display
function ProductSkuGrid({
  products,
  formatter,
  origin,
}: {
  products: Array<ProductSku | HomepageDisplaySku>;
  formatter: any;
  origin: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-layout-md md:grid-cols-3 xl:grid-cols-4">
      {products?.slice(0, 4).map((product) => (
        <Link
          to="/shop/product/$productSlug"
          key={product?._id}
          className="rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2"
          params={(params) => ({
            ...params,
            productSlug: product?.productId,
          })}
          search={{ variant: product?.sku, origin }}
        >
          <ProductSkuCard sku={product} currencyFormatter={formatter} />
        </Link>
      ))}
    </div>
  );
}
