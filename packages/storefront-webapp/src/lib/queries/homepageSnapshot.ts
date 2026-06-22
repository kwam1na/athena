import { getHomepageSnapshot } from "@/api/homepageSnapshot";
import { DEFAULT_STALE_TIME } from "@/lib/constants";
import { useQueryEnabled } from "@/hooks/useQueryEnabled";
import { queryOptions } from "@tanstack/react-query";

export const homepageSnapshotKeys = {
  all: ["homepageSnapshot"] as const,
  snapshot: () => [...homepageSnapshotKeys.all, "v1"] as const,
};

export const useHomepageSnapshotQueries = () => {
  const queryEnabled = useQueryEnabled();

  return {
    snapshot: () =>
      queryOptions({
        queryKey: homepageSnapshotKeys.snapshot(),
        queryFn: () => getHomepageSnapshot({ asNewUser: false }),
        staleTime: DEFAULT_STALE_TIME,
        enabled: queryEnabled,
      }),
  };
};
