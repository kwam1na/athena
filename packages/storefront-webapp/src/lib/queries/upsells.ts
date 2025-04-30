import { queryOptions } from "@tanstack/react-query";
import { useQueryEnabled } from "@/hooks/useQueryEnabled";
import { getLastViewedProduct } from "@/api/upsells";
import { DEFAULT_STALE_TIME } from "../constants";

export const useUpsellsQueries = () => {
  const queryEnabled = useQueryEnabled();

  return {
    upsells: () =>
      queryOptions({
        queryKey: ["upsells"],
        queryFn: () => getLastViewedProduct(),
        enabled: queryEnabled,
        staleTime: DEFAULT_STALE_TIME,
      }),
  };
};
