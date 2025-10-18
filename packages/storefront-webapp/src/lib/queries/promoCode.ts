import { queryOptions } from "@tanstack/react-query";
import { useQueryEnabled } from "@/hooks/useQueryEnabled";
import {
  getPromoCodeItems,
  getPromoCodes,
  getRedeemedPromoCodes,
} from "@/api/promoCodes";

export const usePromoCodesQueries = () => {
  const queryEnabled = useQueryEnabled();

  return {
    getAll: () =>
      queryOptions({
        queryKey: ["promoCodes"],
        queryFn: () => getPromoCodes(),
        enabled: queryEnabled,
        staleTime: 0.15 * 60 * 1000,
        refetchOnWindowFocus: true,
      }),
    getAllItems: () =>
      queryOptions({
        queryKey: ["promoCodeItems"],
        queryFn: () => getPromoCodeItems(),
        enabled: queryEnabled,
        staleTime: 0.15 * 60 * 1000,
      }),
    getRedeemed: () =>
      queryOptions({
        queryKey: ["redeemedPromoCodes"],
        queryFn: () => getRedeemedPromoCodes(),
        enabled: queryEnabled,
        staleTime: 0.15 * 60 * 1000,
      }),
  };
};
