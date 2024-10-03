import { Organization, Product, Store } from "@athena/db";
import { useLoaderData, useParams } from "@tanstack/react-router";

export const useGetStoreData = () => {
  const { productSlug } = useParams({ strict: false });

  const route = productSlug
    ? "/_authed/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug"
    : "/_authed/$orgUrlSlug/store/$storeUrlSlug/products/new";

  const data:
    | { store: Store; product: Product; org: Organization }
    | undefined = useLoaderData({
    from: route,
  });

  const { product, store, org } = data || {};

  return {
    product,
    store,
    org,
  };
};
