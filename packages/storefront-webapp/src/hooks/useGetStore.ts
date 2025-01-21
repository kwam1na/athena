import { getStore } from "@/api/storefront";
import config from "@/config";
import { useQuery } from "@tanstack/react-query";

export const useGetStore = () => {
  return useQuery({
    queryKey: ["store"],
    queryFn: () => getStore(config.storefront.storeName),
  });
};
