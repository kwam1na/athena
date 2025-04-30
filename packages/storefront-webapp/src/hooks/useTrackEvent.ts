import { postAnalytics } from "@/api/analytics";
import { useEffect } from "react";

export const useTrackEvent = ({
  action,
  data = {},
  isReady = true,
}: {
  action: string;
  data?: Record<string, any>;
  isReady?: boolean;
}) => {
  useEffect(() => {
    if (isReady) {
      postAnalytics({
        action,
        data,
      });
    }
  }, [isReady]);
};
