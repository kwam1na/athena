import { queryOptions } from "@tanstack/react-query";
import { useQueryEnabled } from "@/hooks/useQueryEnabled";
import { getPromoCodes } from "@/api/promoCodes";
import { DEFAULT_STALE_TIME } from "../constants";

export const usePromoCodesQueries = () => {
  const queryEnabled = useQueryEnabled();

  return {
    getAll: () =>
      queryOptions({
        queryKey: ["promoCodes"],
        queryFn: () => getPromoCodes(),
        enabled: queryEnabled,
        staleTime: DEFAULT_STALE_TIME,
      }),
  };
};
