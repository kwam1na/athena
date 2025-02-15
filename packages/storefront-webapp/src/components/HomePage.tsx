import { useQuery } from "@tanstack/react-query";
import {
  INITIAL_LOAD_KEY,
  INITIAL_LOAD_TIME_KEY,
  SESSION_STORAGE_KEY,
} from "@/lib/constants";
import { productQueries } from "@/queries";
import Footer from "./footer/Footer";
import { Link } from "@tanstack/react-router";
import { Button } from "./ui/button";
import { useStoreContext } from "@/contexts/StoreContext";
import { ProductCard, ProductSkuCard } from "./ProductCard";
import { motion } from "framer-motion";
import { useEffect } from "react";
import { Product, ProductSku } from "@athena/webapp";
import ImageWithFallback from "./ui/image-with-fallback";
import { useNavigationBarContext } from "@/contexts/NavigationBarProvider";

function FeaturedProduct({ product }: { product: any }) {
  const { formatter } = useStoreContext();

  // find the lowest price sku for the product (product.skus)
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
          <p className="font-medium">{product.name}</p>
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
            search={{ variant: product.skus?.[0].sku }}
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
        search={{ variant: product.skus?.[0].sku }}
      >
        <ImageWithFallback
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
  products: Product[];
  formatter: any;
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
          search={{ variant: product?.skus?.[0].sku }}
        >
          <ProductCard product={product} currencyFormatter={formatter} />
        </Link>
      ))}
    </div>
  );
}

function ProductSkuGrid({
  products,
  formatter,
}: {
  products: ProductSku[];
  formatter: any;
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
          search={{ variant: product?.sku }}
        >
          <ProductSkuCard sku={product} currencyFormatter={formatter} />
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
        <p className="text-md font-medium">{`Shop ${name}`}</p>

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
        <p className="text-md font-medium">{`Shop ${name}`}</p>

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
  const { organizationId, storeId, store } = useStoreContext();

  const { setNavBarLayout } = useNavigationBarContext();

  const { data: bestSellers, isLoading: isLoadingBestSellers } = useQuery(
    productQueries.bestSellers({
      organizationId,
      storeId,
    })
  );

  const { data: featured, isLoading: isLoadingFeatured } = useQuery(
    productQueries.featured({
      organizationId,
      storeId,
    })
  );

  const { data: products, isLoading: isLoadingProducts } = useQuery(
    productQueries.list({
      organizationId,
      storeId,
    })
  );

  useEffect(() => {
    setNavBarLayout("sticky");
  }, []);

  const firstLoad = true;

  useEffect(() => {
    const savedState = sessionStorage.getItem(INITIAL_LOAD_KEY);
    const lastLoadTime = sessionStorage.getItem(INITIAL_LOAD_TIME_KEY);

    if (!savedState || !lastLoadTime) {
      sessionStorage.setItem(INITIAL_LOAD_KEY, "true");
      sessionStorage.setItem(
        SESSION_STORAGE_KEY,
        new Date().getTime().toString()
      );
    }
  }, []);

  useEffect(() => {
    if (firstLoad) {
      sessionStorage.setItem(INITIAL_LOAD_KEY, "false");
      sessionStorage.setItem(
        INITIAL_LOAD_TIME_KEY,
        new Date().getTime().toString()
      );
    }
  }, [firstLoad]);

  const { formatter } = useStoreContext();

  const bestSellersSorted = bestSellers?.sort(
    (a: any, b: any) => a.rank - b.rank
  );

  const bestSellersProducts = bestSellersSorted?.map((bestSeller: any) => {
    return bestSeller.productSku;
  });

  const featuredSectionSorted = featured?.sort(
    (a: any, b: any) => a.rank - b.rank
  );

  const isLoading =
    isLoadingBestSellers || isLoadingFeatured || isLoadingProducts;

  if (isLoading) return <div className="h-screen" />;

  const initialAnimation = firstLoad
    ? { opacity: 0, y: -8 }
    : { opacity: 0, y: 0 };
  const secondAnimation = firstLoad
    ? { opacity: 0, y: 8 }
    : { opacity: 0, y: 0 };
  const sectionAnimation = firstLoad
    ? { opacity: 0, x: -16 }
    : { opacity: 0, x: 0 };

  if (products && products.length == 0) {
    return (
      <div className="container mx-auto px-4 lg:px-0 overflow-hidden">
        <div className="flex items-center justify-center h-screen">
          <div className="space-y-2">
            <p className="text-xl text-center font-medium">
              We're updating our store...
            </p>
            <p className="text-muted-foreground tex-sm text-center">
              We're working on bringing you amazing products. Check back soon!
            </p>
          </div>
        </div>
      </div>
    );
  }

  // console.log("bestSellersProducts", bestSellersProducts);

  // console.log("featured", featured);

  return (
    <>
      <div className="overflow-hidden">
        <div className="space-y-32 pb-56">
          <div className="relative">
            <motion.img
              initial={{ opacity: 0, scale: 1.05 }}
              animate={{
                opacity: 1,
                scale: 1,
                transition: {
                  duration: 1,
                  ease: [0.6, 0.05, 0.01, 0.9],
                },
              }}
              src={store?.config?.showroomImage}
              className="w-full h-screen object-cover"
            />
            <motion.div
              initial={{ opacity: 0 }}
              animate={{
                opacity: 0.4,
                transition: {
                  duration: 0.5,
                  delay: 1, // Start after image animation completes
                },
              }}
              className="absolute inset-0 bg-black"
            />
            <div className="absolute inset-0 flex flex-col items-center justify-center -translate-y-[10%]">
              <motion.p
                initial={initialAnimation}
                animate={{
                  opacity: 1,
                  y: 0,
                  transition: firstLoad
                    ? { ease: "easeOut", duration: 0.4, delay: 1.3 }
                    : { ease: "easeOut", duration: 0, delay: 0.3 },
                }}
                className="text-2xl text-center text-accent5 drop-shadow-lg"
              >
                Switch your look
              </motion.p>
              <motion.p
                initial={secondAnimation}
                animate={{
                  opacity: 1,
                  y: 0,
                  transition: firstLoad
                    ? { ease: "easeOut", duration: 0.4, delay: 1.6 }
                    : { ease: "easeOut", duration: 0, delay: 0.3 },
                }}
                className="font-lavish text-8xl md:text-9xl text-center text-accent5 drop-shadow-lg"
              >
                to match your mood
              </motion.p>
            </div>
          </div>

          <div className="container mx-auto space-y-32 pb-56 px-4 lg:px-0">
            {Boolean(bestSellersSorted?.length) && (
              <motion.div
                initial={sectionAnimation}
                animate={{
                  opacity: 1,
                  x: 0,
                  transition: firstLoad
                    ? { duration: 0.3, delay: 0.3 }
                    : { duration: 0 },
                }}
                className="space-y-8"
              >
                <p className="text-md font-medium">Shop best sellers</p>

                <div className="space-y-8 lg:space-y-20">
                  <ProductSkuGrid
                    products={bestSellersProducts || []}
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
                initial={sectionAnimation}
                animate={{
                  opacity: 1,
                  x: 0,
                  transition: firstLoad
                    ? { duration: 0.3, delay: 0.3 }
                    : { duration: 0 },
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
      </div>

      <Footer />
    </>
  );
}
