import { useQuery } from "@tanstack/react-query";
import { useParams, useSearch } from "@tanstack/react-router";
import ProductsPage from "./ProductsPage";
import { useProductQueries } from "@/lib/queries/product";

export default function EntityPage() {
  const search = useSearch({ from: "/_layout/_shopLayout" });

  const { categorySlug, subcategorySlug } = useParams({ strict: false });

  const productQueries = useProductQueries();

  const { data: products, isLoading: isLoadingProducts } = useQuery(
    productQueries.list({
      filters: {
        category: categorySlug,
        subcategory: subcategorySlug,
        ...search,
      },
    })
  );

  const { data: bestSellers, isLoading: isLoadingBestSellers } = useQuery(
    productQueries.bestSellers()
  );

  let skus;

  if (bestSellers?.length && categorySlug === "best-sellers") {
    skus = bestSellers.map((bestSeller: any) => bestSeller.productSku);
  }

  const isLoading = isLoadingProducts || isLoadingBestSellers;

  return (
    <ProductsPage
      products={products}
      productSkus={skus}
      isLoading={isLoading}
    />
  );
}
