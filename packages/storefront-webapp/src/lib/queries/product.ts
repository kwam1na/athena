import { getAllColors } from "@/api/color";
import {
  getAllProducts,
  getBestSellers,
  getFeatured,
  getProduct,
} from "@/api/product";
import { FilterParams } from "@/api/types";
import { DEFAULT_STALE_TIME } from "@/lib/constants";
import { queryOptions } from "@tanstack/react-query";
import { useQueryEnabled } from "@/hooks/useQueryEnabled";

export const useProductQueries = () => {
  const queryEnabled = useQueryEnabled();

  return {
    all: () => ["products"],
    colors: () =>
      queryOptions({
        queryKey: ["products", "colors"],
        queryFn: () => getAllColors(),
        enabled: queryEnabled,
      }),
    bestSellers: ({ filters }: { filters?: FilterParams } = {}) =>
      queryOptions({
        queryKey: ["bestSellers", filters],
        queryFn: () => getBestSellers(),
        staleTime: DEFAULT_STALE_TIME,
        enabled: queryEnabled,
      }),
    featured: () =>
      queryOptions({
        queryKey: ["featured"],
        queryFn: () => getFeatured(),
        staleTime: DEFAULT_STALE_TIME,
        enabled: queryEnabled,
      }),
    lists: () => ["products", "list"],
    list: ({ filters }: { filters?: FilterParams } = {}) =>
      queryOptions({
        queryKey: ["products", "list", filters],
        queryFn: () => getAllProducts({ filters }),
        staleTime: DEFAULT_STALE_TIME,
        enabled: queryEnabled,
      }),
    details: () => ["products", "detail"],
    detail: ({ productId }: { productId: string }) =>
      queryOptions({
        queryKey: ["products", "detail", productId],
        queryFn: () => getProduct(productId),
        staleTime: DEFAULT_STALE_TIME,
        enabled: queryEnabled,
      }),
  };
};
