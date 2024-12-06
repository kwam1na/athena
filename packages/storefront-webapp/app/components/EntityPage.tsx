import { useQuery } from "@tanstack/react-query";
import { OG_ORGANIZTION_ID, OG_STORE_ID } from "@/lib/constants";
import { useParams, useSearch } from "@tanstack/react-router";
import { capitalizeFirstLetter, slugToWords } from "@/lib/utils";
import { productQueries } from "@/queries";
import ProductsPage from "./ProductsPage";

export default function EntityPage() {
  const search = useSearch({ from: "/_layout/_shopLayout" });

  const { categorySlug, subcategorySlug } = useParams({ strict: false });

  const { data, isLoading } = useQuery(
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

  return <ProductsPage products={data} isLoading={isLoading} />;
}
