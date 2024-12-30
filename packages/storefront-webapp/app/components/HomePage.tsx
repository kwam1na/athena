import { useQuery } from "@tanstack/react-query";
import { OG_ORGANIZTION_ID, OG_STORE_ID } from "@/lib/constants";
import { productQueries } from "@/queries";
import Footer from "./footer/Footer";
import { Link } from "@tanstack/react-router";
import { Button } from "./ui/button";
import { useStoreContext } from "@/contexts/StoreContext";
import { ProductCard } from "./ProductCard";

export default function HomePage() {
  const { data, isLoading } = useQuery(
    productQueries.bestSellers({
      organizationId: OG_ORGANIZTION_ID,
      storeId: OG_STORE_ID,
    })
  );

  const { formatter } = useStoreContext();

  // console.log(data);

  return (
    <div className="container mx-auto max-w-[1024px]">
      <div className="space-y-48 pb-56">
        <div className="p-32">
          <div className="flex flex-col">
            <p className="text-center">Switch your look</p>
            <p className="font-lavish text-7xl text-center text-accent2">
              to match your mood
            </p>
          </div>
        </div>

        <div className="space-y-8">
          <p>Shop best sellers</p>

          <div className="flex gap-4 pb-16">
            {data?.map((product: any) => {
              return (
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
                  <ProductCard
                    product={product}
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

        <div className="space-y-16">
          <p>Shop closures</p>

          <div className="flex gap-4">
            <div className="h-56 w-56 bg-gray-100 rounded-sm"></div>
            <div className="h-56 w-56 bg-gray-100 rounded-sm"></div>
            <div className="h-56 w-56 bg-gray-100 rounded-sm"></div>
          </div>

          <div className="text-sm">
            <Link
              to="/shop/$categorySlug/$subcategorySlug"
              params={{
                categorySlug: "hair",
                subcategorySlug: "closures",
              }}
            >
              <Button variant={"link"}>Shop all</Button>
            </Link>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}
