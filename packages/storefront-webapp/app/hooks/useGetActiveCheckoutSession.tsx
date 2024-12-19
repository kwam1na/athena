import { useQuery } from "@tanstack/react-query";
import { useStoreContext } from "@/contexts/StoreContext";
import { getActiveCheckoutSession } from "@/api/checkoutSession";

export const useGetActiveCheckoutSession = () => {
  const { store, userId } = useStoreContext();

  return useQuery({
    queryKey: ["active-checkout-session", userId],
    queryFn: () =>
      getActiveCheckoutSession({
        customerId: userId!,
        storeId: store!._id,
        organizationId: store!.organizationId,
      }),
    enabled: Boolean(store && userId),
    staleTime: 1 * 60 * 1000,
    retry: false,
  });
};
