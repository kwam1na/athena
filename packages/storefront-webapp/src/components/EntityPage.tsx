import { useQuery } from "@tanstack/react-query";
import { useParams, useSearch } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import ProductsPage from "./ProductsPage";
import { useProductQueries } from "@/lib/queries/product";
import { useStorefrontObservability } from "@/hooks/useStorefrontObservability";
import { createCategoryBrowseViewedEvent } from "@/lib/storefrontJourneyEvents";
import { slugToWords } from "@/lib/utils";

export default function EntityPage() {
  const search = useSearch({ from: "/_layout/_shopLayout" });
  const lastTrackedDiscoveryView = useRef<string | null>(null);

  const { categorySlug, subcategorySlug } = useParams({ strict: false });
  const { track } = useStorefrontObservability();

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

  useEffect(() => {
    const discoveryKey = `${categorySlug ?? ""}:${subcategorySlug ?? ""}`;

    if (lastTrackedDiscoveryView.current === discoveryKey) return;

    lastTrackedDiscoveryView.current = discoveryKey;

    void track(
      createCategoryBrowseViewedEvent({
        categorySlug,
        subcategorySlug,
      }),
    ).catch((error) => {
      console.error("Failed to track category browse view:", error);
    });
  }, [categorySlug, subcategorySlug, track]);

  const isLoading = isLoadingProducts || isLoadingBestSellers;

  return (
    <ProductsPage
      products={products}
      productSkus={skus}
      isLoading={isLoading}
    />
  );
}
