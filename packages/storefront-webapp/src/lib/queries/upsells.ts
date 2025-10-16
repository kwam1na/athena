import { queryOptions } from "@tanstack/react-query";
import { useQueryEnabled } from "@/hooks/useQueryEnabled";
import { getLastViewedProduct } from "@/api/upsells";
import { DEFAULT_STALE_TIME } from "../constants";

export const useUpsellsQueries = ({
  category,
  minAgeHours,
}: { category?: string; minAgeHours?: number } = {}) => {
  const queryEnabled = useQueryEnabled();

  return {
    upsells: () =>
      queryOptions({
        queryKey: [
          "upsells",
          { category: category ?? null, minAgeHours: minAgeHours ?? 24 },
        ],
        queryFn: () => getLastViewedProduct({ category, minAgeHours }),
        enabled: queryEnabled,
        staleTime: DEFAULT_STALE_TIME,
      }),
  };
};
