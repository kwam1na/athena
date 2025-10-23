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
  const { origin, utm_source } = useSearch({ strict: false });

  useEffect(() => {
    if ((origin || utm_source) && isReady) {
      postAnalytics({
        action,
        origin: origin ?? utm_source,
        data,
        productId,
      });
    }
  }, [origin, utm_source, isReady, ...deps]);
};
