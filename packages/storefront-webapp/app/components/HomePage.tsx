import { useQuery } from "@tanstack/react-query";
import { OG_ORGANIZTION_ID, OG_STORE_ID } from "@/lib/constants";
import { productQueries } from "@/queries";
import Footer from "./footer/Footer";
import { Link } from "@tanstack/react-router";
import { Button } from "./ui/button";
import { useStoreContext } from "@/contexts/StoreContext";
import { ProductCard } from "./ProductCard";

function FeaturedProduct({ product }: { product: any }) {
  const { formatter } = useStoreContext();

  // find the lowest price sku for the product (product.skus)
  const lowestPriceSku = product.skus.reduce(
    (lowest: any, current: any) =>
      current.price < lowest.price ? current : lowest,
    product.skus[0]
  );

  return (
    <div className="flex items-center w-full justify-center gap-16">
      <div className="space-y-4">
        <div className="text-sm flex flex-col px-4 lg:px-0 items-start gap-4">
          <p className="font-medium">{product.name}</p>
          <p className="text-xs">{`Starting at ${formatter.format(lowestPriceSku.price)}`}</p>
          <p className="text-xs">Available in multiple lengths</p>
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

      <img
        alt={`${product.name} image`}
        className="aspect-square object-cover w-96 h-96"
        src={product.skus[0].images[0]}
      />
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
    <div className="flex gap-4 pb-16">
      {products?.slice(0, 4).map((product: any) => (
        <Link
          to="/shop/product/$productSlug"
          key={product._id}
          className="h-56 w-56"
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
    return (
      <div className="space-y-16">
        <p>{`Shop ${name}`}</p>
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
    );
  }

  if (data.category) {
    const { name, products, slug } = data.category;
    return (
      <div className="space-y-16">
        <p>{`Shop ${name}`}</p>
        <ProductGrid products={products} formatter={formatter} />
        <div className="text-sm"></div>
        <Link to="/shop/$categorySlug" params={{ categorySlug: slug }}>
          <Button className="p-0" variant={"link"}>
            Shop all
          </Button>
        </Link>
      </div>
    );
  }

  if (data.product) {
    return <FeaturedProduct product={data.product} />;
  }

  return null;
}

export default function HomePage() {
  const { data: bestSellers, isLoading } = useQuery(
    productQueries.bestSellers({
      organizationId: OG_ORGANIZTION_ID,
      storeId: OG_STORE_ID,
    })
  );

  const { data: featured } = useQuery(
    productQueries.featured({
      organizationId: OG_ORGANIZTION_ID,
      storeId: OG_STORE_ID,
    })
  );

  const { formatter } = useStoreContext();

  const bestSellersSorted = bestSellers?.sort(
    (a: any, b: any) => a.rank - b.rank
  );

  const featuredSectionSorted = featured?.sort(
    (a: any, b: any) => a.rank - b.rank
  );

  return (
    <div className="container mx-auto">
      <div className="space-y-48 pb-56">
        <div className="p-32">
          <div className="flex flex-col">
            <p className="text-md text-center">Switch your look</p>
            <p className="font-lavish text-7xl text-center text-accent2">
              to match your mood
            </p>
          </div>
        </div>

        {Boolean(bestSellersSorted?.length) && (
          <div className="space-y-8">
            <p>Shop best sellers</p>

            <div className="flex gap-4 pb-16">
              {bestSellersSorted?.slice(0, 4).map((bestSeller: any) => {
                return (
                  <Link
                    to="/shop/product/$productSlug"
                    key={bestSeller._id}
                    className="h-56 w-56"
                    params={(params) => ({
                      ...params,
                      productSlug: bestSeller?.product._id,
                    })}
                    search={{ variant: bestSeller?.product.skus[0].sku }}
                  >
                    <ProductCard
                      product={bestSeller?.product}
                      currencyFormatter={formatter}
                    />
                  </Link>
                );
              })}
            </div>

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
        )}

        {Boolean(featuredSectionSorted?.length) && (
          <div className="space-y-48">
            {featuredSectionSorted?.map((data: any) => (
              <FeaturedSection key={data._id} data={data} />
            ))}
          </div>
        )}
      </div>
      <Footer />
    </div>
  );
}
