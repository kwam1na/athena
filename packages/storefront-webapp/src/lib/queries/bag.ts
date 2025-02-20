import { getActiveSavedBag } from "@/api/savedBag";
import { queryOptions } from "@tanstack/react-query";
import { DEFAULT_STALE_TIME } from "../constants";
import { getActiveBag } from "@/api/bag";

export const bagQueries = {
  activeSavedBagKey: () => ["active-saved-bag"],
  activeSavedBag: () =>
    queryOptions({
      queryKey: [...bagQueries.activeSavedBagKey()],
      queryFn: () => getActiveSavedBag(),
      retry: false,
      staleTime: DEFAULT_STALE_TIME,
    }),
  activeBagKey: () => ["active-bag"],
  activeBag: () =>
    queryOptions({
      queryKey: [...bagQueries.activeBagKey()],
      queryFn: () => getActiveBag(),
      retry: false,
      staleTime: DEFAULT_STALE_TIME,
    }),
};
