import { useQuery } from "@tanstack/react-query";
import { getAllProducts } from "@/api/product";
import { OG_ORGANIZTION_ID, OG_STORE_ID } from "@/lib/constants";
import { Link, useSearch } from "@tanstack/react-router";
import { useStoreContext } from "@/contexts/StoreContext";
import { Product } from "../../../athena-webapp";
import FilterComponent from "./footer/Filter";
import { getAllColors } from "@/api/color";
import { useEffect } from "react";

export default function HomePage() {
  const search = useSearch({ from: "/" });

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["products", "filter"],
    queryFn: () =>
      getAllProducts({
        organizationId: OG_ORGANIZTION_ID,
        storeId: OG_STORE_ID,
        filters: search,
      }),
  });

  // console.log("data in home ->", data);

  return <ProductsPage products={data || []} />;
}

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
      <div className="flex flex-col items-start gap-2">
        <p className="text-lg font-medium">{product.name}</p>
        <p className="text-gray-500">
          {currencyFormatter.format(product.skus[0].price)}
        </p>
      </div>
    </div>
  );
}

function ProductsPage({ products }: { products: Product[] }) {
  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ["products", "colors"],
    queryFn: () =>
      getAllColors({
        organizationId: OG_ORGANIZTION_ID,
        storeId: OG_STORE_ID,
      }),
  });

  const { formatter } = useStoreContext();

  // if (products.length === 0) return null;

  const colors = data?.map((col) => ({ label: col.name, value: col._id }));

  return (
    <main className="px-4 py-8 space-y-4">
      <FilterComponent filters={colors || []} type="color" />
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {products?.map((product, index) => (
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
    </main>
  );
}
