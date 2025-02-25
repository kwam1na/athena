import { postAnalytics } from "@/api/analytics";
import { useEffect } from "react";

export const useTrackEvent = ({
  action,
  data = {},
}: {
  action: string;
  data?: Record<string, any>;
}) => {
  useEffect(() => {
    postAnalytics({
      action,
      data,
    });
  }, []);
};
