import { useQuery } from "@tanstack/react-query";
import { OG_ORGANIZTION_ID, OG_STORE_ID } from "@/lib/constants";
import { useParams, useSearch } from "@tanstack/react-router";
import { productQueries } from "@/queries";
import ProductsPage from "./ProductsPage";

export default function EntityPage() {
  const search = useSearch({ from: "/_layout/_shopLayout" });

  const { categorySlug, subcategorySlug } = useParams({ strict: false });

  const { data: products, isLoading: isLoadingProducts } = useQuery(
    productQueries.list({
      organizationId: OG_ORGANIZTION_ID,
      storeId: OG_STORE_ID,
      filters: {
        category: categorySlug,
        subcategory: subcategorySlug,
        ...search,
      },
    })
  );

  const { data: bestSellers, isLoading: isLoadingBestSellers } = useQuery(
    productQueries.bestSellers({
      organizationId: OG_ORGANIZTION_ID,
      storeId: OG_STORE_ID,
    })
  );

  let data = products;

  if (bestSellers?.length && categorySlug === "best-sellers") {
    data = bestSellers.map((bestSeller: any) => bestSeller.product);
  }

  const isLoading = isLoadingProducts || isLoadingBestSellers;

  return <ProductsPage products={data} isLoading={isLoading} />;
}
