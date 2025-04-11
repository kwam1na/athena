import { postAnalytics } from "@/api/analytics";
import { useSearch } from "@tanstack/react-router";
import { useEffect } from "react";

export const useTrackAction = ({
  action,
  data,
  isReady = true,
}: {
  action: string;
  data: Record<string, any>;
  isReady?: boolean;
}) => {
  const { origin } = useSearch({ strict: false });

  useEffect(() => {
    if (origin && isReady) {
      postAnalytics({
        action,
        origin,
        data,
      });
    }
  }, [origin, isReady]);
};
