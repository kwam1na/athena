import { getProduct } from "@/api/product";
import { useQuery } from "@tanstack/react-query";
import { DEFAULT_STALE_TIME } from "@/lib/constants";

export const useGetProductQuery = (id?: string) => {
  return useQuery({
    queryKey: ["product", id],
    queryFn: () => getProduct(id!),
    enabled: Boolean(id),
    retry: false,
    staleTime: DEFAULT_STALE_TIME,
  });
};
