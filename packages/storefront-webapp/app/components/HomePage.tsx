import { useQuery } from "@tanstack/react-query";
import { OG_ORGANIZTION_ID, OG_STORE_ID } from "@/lib/constants";
import { useSearch } from "@tanstack/react-router";
import { productQueries } from "@/queries";
import ProductsPage from "./ProductsPage";

export default function HomePage() {
  const search = useSearch({ from: "/_layout/_shopLayout" });

  const { data, isLoading } = useQuery(
    productQueries.list({
      organizationId: OG_ORGANIZTION_ID,
      storeId: OG_STORE_ID,
      filters: search,
    })
  );

  return <ProductsPage products={data} isLoading={isLoading} />;
}
