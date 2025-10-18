import { getBannerMessage } from "@/api/bannerMessage";
import { DEFAULT_STALE_TIME } from "@/lib/constants";
import { queryOptions } from "@tanstack/react-query";
import { useQueryEnabled } from "@/hooks/useQueryEnabled";

export const useBannerMessageQueries = () => {
  const queryEnabled = useQueryEnabled();

  return {
    get: () =>
      queryOptions({
        queryKey: ["bannerMessage"],
        queryFn: () => getBannerMessage(),
        enabled: queryEnabled,
        staleTime: 0,
      }),
  };
};
