import { getStore } from "@/api/storefront";
import config from "@/config";
import { useQuery } from "@tanstack/react-query";

export const useGetStore = () => {
  return useQuery({
    queryKey: ["store"],
    staleTime: 1 * 60 * 1000,
    queryFn: () => getStore(config.storefront.storeName),
  });
};
