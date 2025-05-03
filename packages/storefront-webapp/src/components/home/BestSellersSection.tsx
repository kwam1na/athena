import { motion } from "framer-motion";
import { Link } from "@tanstack/react-router";
import { Button } from "../ui/button";
import { ProductSkuCard } from "../ProductCard";
import { useStoreContext } from "@/contexts/StoreContext";
import { ProductSku } from "@athena/webapp";

interface BestSellersSectionProps {
  bestSellersProducts: ProductSku[];
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
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6, delay: 0.2 }}
      className="space-y-8"
    >
      <p className="text-md font-medium">Shop best sellers</p>

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
    </motion.div>
  );
}

// Helper component for product grid display
function ProductSkuGrid({
  products,
  formatter,
  origin,
}: {
  products: ProductSku[];
  formatter: any;
  origin: string;
}) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-8 md:gap-24 xl:gap-4">
      {products?.slice(0, 4).map((product: ProductSku) => (
        <Link
          to="/shop/product/$productSlug"
          key={product?._id}
          className="h-64 w-48 md:h-80 md:w-80 xl:h-96 xl:w-96 flex-shrink-0"
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
