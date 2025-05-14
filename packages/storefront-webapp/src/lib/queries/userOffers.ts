import { queryOptions } from "@tanstack/react-query";
import { useQueryEnabled } from "@/hooks/useQueryEnabled";
import { getUserOffersEligibility } from "@/api/userOffers";

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
  };
};
