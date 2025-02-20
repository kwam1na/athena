import {
  getActiveCheckoutSession,
  getCheckoutSession,
  getPendingCheckoutSessions,
} from "@/api/checkoutSession";
import { queryOptions } from "@tanstack/react-query";
import { DEFAULT_STALE_TIME } from "../constants";

export const checkoutSessionQueries = {
  activeSessionKey: () => ["active-checkout-session"],
  activeSession: () =>
    queryOptions({
      queryKey: [...checkoutSessionQueries.activeSessionKey()],
      queryFn: () => getActiveCheckoutSession(),
      staleTime: 1 * 60 * 1000,
    }),
  pendingSessionsKey: () => ["pending-checkout-sessions"],
  pendingSessions: () =>
    queryOptions({
      queryKey: [...checkoutSessionQueries.pendingSessionsKey()],
      queryFn: () => getPendingCheckoutSessions(),
      staleTime: DEFAULT_STALE_TIME,
    }),
  sessionKey: () => ["checkout-session"],
  session: (sessionId?: string) =>
    queryOptions({
      queryKey: [...checkoutSessionQueries.sessionKey(), sessionId],
      queryFn: () => getCheckoutSession(sessionId!),
      enabled: Boolean(sessionId),
      retry: false,
      staleTime: DEFAULT_STALE_TIME,
    }),
};
