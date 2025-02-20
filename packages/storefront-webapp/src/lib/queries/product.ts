import {
  getAllProducts,
  getBestSellers,
  getFeatured,
  getProduct,
} from "@/api/product";
import { FilterParams } from "@/api/types";
import { DEFAULT_STALE_TIME } from "@/lib/constants";
import { queryOptions } from "@tanstack/react-query";

export const productQueries = {
  all: () => ["products"],
  bestSellers: ({ filters }: { filters?: FilterParams } = {}) =>
    queryOptions({
      queryKey: ["bestSellers", filters],
      queryFn: () => getBestSellers(),
      staleTime: DEFAULT_STALE_TIME,
    }),
  featured: () =>
    queryOptions({
      queryKey: ["featured"],
      queryFn: () => getFeatured(),
      staleTime: DEFAULT_STALE_TIME,
    }),
  lists: () => [...productQueries.all(), "list"],
  list: ({ filters }: { filters?: FilterParams } = {}) =>
    queryOptions({
      queryKey: [...productQueries.lists(), filters],
      queryFn: () => getAllProducts({ filters }),
      staleTime: DEFAULT_STALE_TIME,
    }),
  details: () => [...productQueries.all(), "detail"],
  detail: ({ productId }: { productId: string }) =>
    queryOptions({
      queryKey: [...productQueries.details(), productId],
      queryFn: () => getProduct(productId),
      staleTime: DEFAULT_STALE_TIME,
    }),
};
