import { getStore } from "@/api/storefront";
import config from "@/config";
import { queryOptions } from "@tanstack/react-query";

export const storeQueries = {
  store: () =>
    queryOptions({
      queryKey: ["store"],
      staleTime: 1 * 60 * 1000,
      queryFn: () => getStore(config.storefront.storeName),
    }),
};
