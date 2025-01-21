import { useQuery } from "@tanstack/react-query";
import { useParams, useSearch } from "@tanstack/react-router";
import { productQueries } from "@/queries";
import ProductsPage from "./ProductsPage";
import { useStoreContext } from "@/contexts/StoreContext";

export default function EntityPage() {
  const search = useSearch({ from: "/_layout/_shopLayout" });

  const { categorySlug, subcategorySlug } = useParams({ strict: false });

  const { organizationId, storeId } = useStoreContext();

  const { data: products, isLoading: isLoadingProducts } = useQuery(
    productQueries.list({
      organizationId,
      storeId,
      filters: {
        category: categorySlug,
        subcategory: subcategorySlug,
        ...search,
      },
    })
  );

  const { data: bestSellers, isLoading: isLoadingBestSellers } = useQuery(
    productQueries.bestSellers({
      organizationId,
      storeId,
    })
  );

  let data = products;

  if (bestSellers?.length && categorySlug === "best-sellers") {
    data = bestSellers.map((bestSeller: any) => bestSeller.product);
  }

  const isLoading = isLoadingProducts || isLoadingBestSellers;

  return <ProductsPage products={data} isLoading={isLoading} />;
}
