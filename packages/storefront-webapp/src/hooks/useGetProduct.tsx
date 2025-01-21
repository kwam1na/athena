import { getProduct } from "@/api/product";
import { useQuery } from "@tanstack/react-query";
import { useStoreContext } from "@/contexts/StoreContext";
import { DEFAULT_STALE_TIME } from "@/queries";

export const useGetProductQuery = (id?: string) => {
  const { store } = useStoreContext();

  return useQuery({
    queryKey: ["product", id],
    queryFn: () =>
      getProduct({
        organizationId: store!.organizationId,
        storeId: store!._id,
        productId: id!,
      }),
    enabled: Boolean(id && store),
    retry: false,
    staleTime: DEFAULT_STALE_TIME,
  });
};
