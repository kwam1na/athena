import {
  getActiveCheckoutSession,
  getCheckoutSession,
  getPendingCheckoutSessions,
} from "@/api/checkoutSession";
import { queryOptions } from "@tanstack/react-query";
import { DEFAULT_STALE_TIME } from "../constants";
import { useQueryEnabled } from "@/hooks/useQueryEnabled";

export const useCheckoutSessionQueries = () => {
  const queryEnabled = useQueryEnabled();

  return {
    activeSessionKey: () => ["active-checkout-session"],
    activeSession: () =>
      queryOptions({
        queryKey: ["active-checkout-session"],
        queryFn: () => getActiveCheckoutSession(),
        enabled: queryEnabled,
        staleTime: 1 * 60 * 1000,
      }),
    pendingSessionsKey: () => ["pending-checkout-sessions"],
    pendingSessions: () =>
      queryOptions({
        queryKey: ["pending-checkout-sessions"],
        queryFn: () => getPendingCheckoutSessions(),
        enabled: queryEnabled,
        staleTime: DEFAULT_STALE_TIME,
      }),
    sessionKey: () => ["checkout-session"],
    session: (sessionId?: string) =>
      queryOptions({
        queryKey: ["checkout-session", sessionId],
        queryFn: () => getCheckoutSession(sessionId!),
        enabled: Boolean(sessionId),
        retry: false,
        staleTime: DEFAULT_STALE_TIME,
      }),
  };
};
