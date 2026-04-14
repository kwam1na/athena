import { postAnalytics } from "@/api/analytics";
import { useSearch } from "@tanstack/react-router";
import { useEffect } from "react";

import { resolveStorefrontAnalyticsOrigin } from "@/lib/storefrontObservability";

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
  const resolvedOrigin = resolveStorefrontAnalyticsOrigin({
    searchOrigin: origin,
    utmSource: utm_source,
  });

  useEffect(() => {
    if (resolvedOrigin && isReady) {
      postAnalytics({
        action,
        origin: resolvedOrigin,
        data,
        productId,
      });
    }
  }, [resolvedOrigin, isReady, ...deps]);
};
