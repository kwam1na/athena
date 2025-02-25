import { postAnalytics } from "@/api/analytics";
import { useSearch } from "@tanstack/react-router";
import { useEffect } from "react";

export const useTrackAction = ({
  action,
  data,
}: {
  action: string;
  data: Record<string, any>;
}) => {
  const { origin } = useSearch({ strict: false });

  useEffect(() => {
    if (origin) {
      postAnalytics({
        action,
        origin,
        data,
      });
    }
  }, [origin]);
};
