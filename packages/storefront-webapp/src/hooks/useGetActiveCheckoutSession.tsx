import { useQuery } from "@tanstack/react-query";
import { useStoreContext } from "@/contexts/StoreContext";
import { getActiveCheckoutSession } from "@/api/checkoutSession";

export const useGetActiveCheckoutSession = () => {
  const { userId } = useStoreContext();

  return useQuery({
    queryKey: ["active-checkout-session", userId],
    queryFn: () => getActiveCheckoutSession(),
    staleTime: 1 * 60 * 1000,
    retry: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
  });
};
