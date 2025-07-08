import { postAnalytics } from "@/api/analytics";
import { useSearch } from "@tanstack/react-router";
import { useEffect } from "react";

export const useTrackAction = ({
  action,
  data,
  isReady = true,
  productId,
  deps = [],
}: {
  action: string;
  data: Record<string, any>;
  productId?: string;
  isReady?: boolean;
  deps?: any[];
}) => {
  const { origin } = useSearch({ strict: false });

  useEffect(() => {
    if (origin && isReady) {
      postAnalytics({
        action,
        origin,
        data,
        productId,
      });
    }
  }, [origin, isReady, ...deps]);
};
