import { useQuery } from "@tanstack/react-query";
import { OG_ORGANIZTION_ID, OG_STORE_ID } from "@/lib/constants";
import { useParams, useSearch } from "@tanstack/react-router";
import { capitalizeFirstLetter } from "@/lib/utils";
import { productQueries } from "@/queries";
import ProductsPage from "./ProductsPage";

export default function EntityPage() {
  const search = useSearch({ from: "/_layout/_shopLayout" });

  const { subcategorySlug } = useParams({ strict: false });

  const { data } = useQuery(
    productQueries.list({
      organizationId: OG_ORGANIZTION_ID,
      storeId: OG_STORE_ID,
      filters: {
        subcategory: subcategorySlug
          ? capitalizeFirstLetter(subcategorySlug)
          : undefined,
        ...search,
      },
    })
  );

  return <ProductsPage products={data || []} />;
}
