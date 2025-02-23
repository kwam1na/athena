import { getActiveSavedBag } from "@/api/savedBag";
import { queryOptions } from "@tanstack/react-query";
import { DEFAULT_STALE_TIME } from "../constants";
import { getActiveBag } from "@/api/bag";
import { useQueryEnabled } from "@/hooks/useQueryEnabled";

export const useBagQueries = () => {
  const queryEnabled = useQueryEnabled();

  return {
    activeSavedBagKey: () => ["active-saved-bag"],
    activeSavedBag: () =>
      queryOptions({
        queryKey: ["active-saved-bag"],
        queryFn: () => getActiveSavedBag(),
        retry: false,
        enabled: queryEnabled,
        staleTime: DEFAULT_STALE_TIME,
      }),
    activeBagKey: () => ["active-bag"],
    activeBag: () =>
      queryOptions({
        queryKey: ["active-bag"],
        queryFn: () => getActiveBag(),
        retry: false,
        enabled: queryEnabled,
        staleTime: DEFAULT_STALE_TIME,
      }),
  };
};
