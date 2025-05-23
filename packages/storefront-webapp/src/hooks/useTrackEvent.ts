import { postAnalytics } from "@/api/analytics";
import { useEffect, useRef } from "react";

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
  const hasRun = useRef(false);

  useEffect(() => {
    // Wait for the next tick to ensure state is stable
    const timeoutId = setTimeout(() => {
      if (isReady && !hasRun.current) {
        postAnalytics({
          action,
          origin,
          data,
        });
        hasRun.current = true;
      }
    }, 0);

    return () => clearTimeout(timeoutId);
  }, [isReady, action, origin, data]);
};
