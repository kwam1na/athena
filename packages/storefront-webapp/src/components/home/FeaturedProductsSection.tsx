import { motion } from "framer-motion";
import { Link } from "@tanstack/react-router";
import { Button } from "../ui/button";
import { ProductCard } from "../ProductCard";
import { useStoreContext } from "@/contexts/StoreContext";
import { Product } from "@athena/webapp";
import { getProductName } from "@/lib/productUtils";
import ImageWithFallback from "../ui/image-with-fallback";

interface FeaturedProductsSectionProps {
  featuredSectionSorted: any[] | undefined;
  origin: string;
}

/**
 * Featured products section component for the homepage
 * Displays featured products, categories, or subcategories
 */
export function FeaturedProductsSection({
  featuredSectionSorted,
  origin,
}: FeaturedProductsSectionProps) {
  if (!featuredSectionSorted?.length) return null;

  return (
    <div className="space-y-40 md:space-y-48">
      {featuredSectionSorted.map((data: any) => (
        <motion.div
          key={data._id}
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.2 }}
        >
          <FeaturedSection data={data} origin={origin} />
        </motion.div>
      ))}
    </div>
  );
}

/**
 * Featured section component that can display different types of featured content
 */
function FeaturedSection({ data, origin }: { data: any; origin: string }) {
  const { formatter } = useStoreContext();

  if (data.subcategory) {
    const { name, products, slug } = data.subcategory;

    if (!products.length) return null;

    return (
      <div className="space-y-8">
        <p className="text-md font-medium">{`Shop ${name}`}</p>

        <div className="space-y-8 lg:space-y-24">
          <ProductGrid
            products={products}
            formatter={formatter}
            origin={origin}
          />
          <div className="text-sm">
            <Link
              to="/shop/$categorySlug/$subcategorySlug"
              params={{
                categorySlug: "hair",
                subcategorySlug: slug,
              }}
              search={{
                origin: "shop_hair",
              }}
            >
              <Button className="p-0" variant={"link"}>
                Shop all
              </Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (data.category) {
    const { name, products, slug } = data.category;

    if (!products?.length) return null;
    return (
      <div className="space-y-8">
        <p className="text-md font-medium">{`Shop ${name}`}</p>

        <div className="space-y-8 lg:space-y-24">
          <ProductGrid
            products={products}
            formatter={formatter}
            origin={origin}
          />
          <div className="text-sm"></div>
          <Link
            to="/shop/$categorySlug"
            params={{ categorySlug: slug }}
            search={{
              origin: `shop ${slug}`,
            }}
          >
            <Button className="p-0" variant={"link"}>
              Shop all
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  if (data.product) {
    return <FeaturedProduct product={data.product} origin={origin} />;
  }

  return null;
}

/**
 * Featured product display component
 */
function FeaturedProduct({
  product,
  origin,
}: {
  product: any;
  origin: string;
}) {
  const { formatter } = useStoreContext();

  // find the lowest price sku for the product
  const lowestPriceSku = product.skus.reduce(
    (lowest: any, current: any) =>
      current.price < lowest.price ? current : lowest,
    product.skus[0]
  );

  const hasMultipleSkus = product.skus.length > 1;

  const priceLabel = hasMultipleSkus
    ? `Starting at ${formatter.format(lowestPriceSku.price)}`
    : formatter.format(lowestPriceSku.price);

  return (
    <div className="w-full flex flex-col xl:flex-row items-center justify-center gap-8 xl:gap-16">
      <div className="space-y-4 order-2 xl:order-1">
        <div className="text-sm flex flex-col items-start gap-4">
          <p className="font-medium">{getProductName(product.skus[0])}</p>
          <p className="text-sm text-muted-foreground">{priceLabel}</p>
          {product.skus && product.skus.length > 1 && (
            <p className="text-sm text-muted-foreground">
              Available in multiple lengths
            </p>
          )}
        </div>

        <div>
          <Link
            to="/shop/product/$productSlug"
            params={(params) => ({ ...params, productSlug: product._id })}
            search={{ variant: product.skus?.[0].sku, origin }}
          >
            <Button className="p-0" variant={"link"}>
              <p className="text-xs underline">Shop</p>
            </Button>
          </Link>
        </div>
      </div>

      <Link
        to="/shop/product/$productSlug"
        params={(params) => ({ ...params, productSlug: product._id })}
        search={{ variant: product.skus?.[0].sku, origin }}
      >
        <ImageWithFallback
          alt={`${product.name} image`}
          className="aspect-square object-cover w-[400px] h-[400px] md:w-[600px] md:h-[640px] rounded"
          src={product.skus[0].images[0]}
        />
      </Link>
    </div>
  );
}

/**
 * Product grid display component
 */
function ProductGrid({
  products,
  formatter,
  origin,
}: {
  products: Product[];
  formatter: any;
  origin: string;
}) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-8 md:gap-24 xl:gap-4">
      {products?.slice(0, 4).map((product: Product) => (
        <Link
          to="/shop/product/$productSlug"
          key={product?._id}
          className="h-64 w-48 md:h-80 md:w-80 xl:h-96 xl:w-96 flex-shrink-0"
          params={(params) => ({
            ...params,
            productSlug: product?._id,
          })}
          search={{ variant: product?.skus?.[0].sku, origin }}
        >
          <ProductCard product={product} currencyFormatter={formatter} />
        </Link>
      ))}
    </div>
  );
}
