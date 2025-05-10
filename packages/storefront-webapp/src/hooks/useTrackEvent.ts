import { postAnalytics } from "@/api/analytics";
import { useEffect } from "react";

export const useTrackEvent = ({
  action,
  origin,
  data = {},
  isReady = true,
}: {
  action: string;
  origin?: string;
  data?: Record<string, any>;
  isReady?: boolean;
}) => {
  useEffect(() => {
    if (isReady) {
      postAnalytics({
        action,
        origin,
        data,
      });
    }
  }, [isReady]);
};
