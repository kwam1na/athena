import { useQuery } from "@tanstack/react-query";
import { OG_ORGANIZTION_ID, OG_STORE_ID } from "@/lib/constants";
import { productQueries } from "@/queries";
import Footer from "./footer/Footer";
import { Link } from "@tanstack/react-router";
import { Button } from "./ui/button";
import { useStoreContext } from "@/contexts/StoreContext";
import { ProductCard } from "./ProductCard";
import { AnimatePresence, motion } from "framer-motion";

function FeaturedProduct({ product }: { product: any }) {
  const { formatter } = useStoreContext();

  // find the lowest price sku for the product (product.skus)
  const lowestPriceSku = product.skus.reduce(
    (lowest: any, current: any) =>
      current.price < lowest.price ? current : lowest,
    product.skus[0]
  );

  return (
    <div className="w-full flex flex-col xl:flex-row items-center justify-center gap-8 xl:gap-16">
      <div className="space-y-4 order-2 xl:order-1">
        <div className="text-sm flex flex-col items-start gap-4">
          <p className="font-medium">{product.name}</p>
          <p className="text-sm text-muted-foreground">{`Starting at ${formatter.format(lowestPriceSku.price)}`}</p>
          <p className="text-sm text-muted-foreground">
            Available in multiple lengths
          </p>
        </div>

        <div>
          <Link
            to="/shop/product/$productSlug"
            params={(params) => ({ ...params, productSlug: product._id })}
            search={{ variant: product.skus[0].sku }}
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
        search={{ variant: product.skus[0].sku }}
      >
        <img
          alt={`${product.name} image`}
          className="aspect-square object-cover w-96 h-96 rounded"
          src={product.skus[0].images[0]}
        />
      </Link>
    </div>
  );
}

function ProductGrid({
  products,
  formatter,
}: {
  products: any[];
  formatter: any;
}) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-8 md:gap-24 xl:gap-4">
      {products?.slice(0, 4).map((product: any) => (
        <Link
          to="/shop/product/$productSlug"
          key={product._id}
          className="h-64 w-48 md:h-80 md:w-80 xl:h-96 xl:w-96 flex-shrink-0"
          params={(params) => ({
            ...params,
            productSlug: product._id,
          })}
          search={{ variant: product.skus[0].sku }}
        >
          <ProductCard product={product} currencyFormatter={formatter} />
        </Link>
      ))}
    </div>
  );
}

function FeaturedSection({ data }: { data: any }) {
  const { formatter } = useStoreContext();

  if (data.subcategory) {
    const { name, products, slug } = data.subcategory;

    if (!products.length) return null;

    return (
      <div className="space-y-8">
        <p className="text-sm">{`Shop ${name}`}</p>

        <div className="space-y-8 lg:space-y-20">
          <ProductGrid products={products} formatter={formatter} />
          <div className="text-sm">
            <Link
              to="/shop/$categorySlug/$subcategorySlug"
              params={{
                categorySlug: "hair",
                subcategorySlug: slug,
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
        <p className="text-sm">{`Shop ${name}`}</p>

        <div className="space-y-8 lg:space-y-20">
          <ProductGrid products={products} formatter={formatter} />
          <div className="text-sm"></div>
          <Link to="/shop/$categorySlug" params={{ categorySlug: slug }}>
            <Button className="p-0" variant={"link"}>
              Shop all
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  if (data.product) {
    return <FeaturedProduct product={data.product} />;
  }

  return null;
}

export default function HomePage() {
  const { data: bestSellers, isLoading: isLoadingBestSellers } = useQuery(
    productQueries.bestSellers({
      organizationId: OG_ORGANIZTION_ID,
      storeId: OG_STORE_ID,
    })
  );

  const { data: featured, isLoading: isLoadingFeatured } = useQuery(
    productQueries.featured({
      organizationId: OG_ORGANIZTION_ID,
      storeId: OG_STORE_ID,
    })
  );

  const { formatter } = useStoreContext();

  const bestSellersSorted = bestSellers?.sort(
    (a: any, b: any) => a.rank - b.rank
  );

  const bestSellersProducts = bestSellersSorted?.map((bestSeller: any) => {
    return bestSeller.product;
  });

  const featuredSectionSorted = featured?.sort(
    (a: any, b: any) => a.rank - b.rank
  );

  const isLoading = isLoadingBestSellers || isLoadingFeatured;

  if (isLoading) return <div className="h-screen"></div>;

  return (
    <>
      <div className="container mx-auto px-4 lg:px-0 overflow-hidden">
        <div className="space-y-32 pb-56">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{
              opacity: 1,
              transition: { ease: "easeOut", duration: 0.2 },
            }}
            className="px-8 pt-16 xl:p-32"
          >
            <div className="flex flex-col">
              <p className="text-md text-center">Switch your look</p>
              <p className="font-lavish text-7xl text-center text-accent2">
                to match your mood
              </p>
            </div>
          </motion.div>

          {Boolean(bestSellersSorted?.length) && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{
                opacity: 1,
                transition: { ease: "easeOut", duration: 0.2 },
              }}
              className="space-y-8"
            >
              <p className="text-sm">Shop best sellers</p>

              <div className="space-y-8 lg:space-y-20">
                <ProductGrid
                  products={bestSellersProducts}
                  formatter={formatter}
                />

                <div className="text-sm">
                  <Link
                    to="/shop/$categorySlug"
                    params={{
                      categorySlug: "best-sellers",
                    }}
                  >
                    <Button className="p-0" variant={"link"}>
                      Shop all
                    </Button>
                  </Link>
                </div>
              </div>
            </motion.div>
          )}

          {Boolean(featuredSectionSorted?.length) && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{
                opacity: 1,
                transition: { ease: "easeOut", duration: 0.2 },
              }}
              className="space-y-32"
            >
              {featuredSectionSorted?.map((data: any) => (
                <FeaturedSection key={data._id} data={data} />
              ))}
            </motion.div>
          )}
        </div>
      </div>

      <Footer />
    </>
  );
}
