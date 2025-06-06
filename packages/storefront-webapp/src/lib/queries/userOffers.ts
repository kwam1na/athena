import { queryOptions } from "@tanstack/react-query";
import { useQueryEnabled } from "@/hooks/useQueryEnabled";
import { getUserOffersEligibility } from "@/api/userOffers";
import { getUserRedeemedOffers } from "@/api/offers";

export const useUserOffersQueries = () => {
  const queryEnabled = useQueryEnabled();

  return {
    eligibility: () =>
      queryOptions({
        queryKey: ["userOffers", "eligibility"],
        queryFn: () => getUserOffersEligibility(),
        staleTime: 0,
        enabled: queryEnabled,
      }),
    redeemed: () =>
      queryOptions({
        queryKey: ["userOffers", "redeemed"],
        queryFn: () => getUserRedeemedOffers(),
        staleTime: 0,
        enabled: queryEnabled,
      }),
  };
};
