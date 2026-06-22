import {
  type StorefrontObservabilityBaseContext,
  type StorefrontObservabilityEvent,
  createStorefrontObservabilityContext,
  trackStorefrontEvent,
} from "@/lib/storefrontObservability";
import {
  createStorefrontRouteViewedContextEvent,
  trackStorefrontContextEvent,
} from "@/lib/storefrontContextEvents";
import { useAuth } from "@/hooks/useAuth";
import { useRouterState, useSearch } from "@tanstack/react-router";
import React, { createContext, useContext, useEffect, useRef } from "react";

type StorefrontObservabilityContextValue = {
  baseContext: StorefrontObservabilityBaseContext;
  track: (event: StorefrontObservabilityEvent) => Promise<unknown>;
};

const StorefrontObservabilityContext = createContext<
  StorefrontObservabilityContextValue | undefined
>(undefined);

export function StorefrontObservabilityProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const { origin, utm_source } = useSearch({ strict: false });
  const { userId, guestId } = useAuth();
  const trackedRoutes = useRef(new Set<string>());

  const baseContext = createStorefrontObservabilityContext({
    pathname,
    search: {
      origin,
      utm_source,
    },
    userId,
    guestId,
    storage:
      typeof window === "undefined" ? undefined : window.sessionStorage,
  });

  useEffect(() => {
    const routeKey = `${baseContext.sessionId}:${baseContext.route}`;
    if (trackedRoutes.current.has(routeKey)) return;

    trackedRoutes.current.add(routeKey);

    void trackStorefrontContextEvent({
      eventInput: createStorefrontRouteViewedContextEvent({
        baseContext,
      }),
      baseContext,
    });
  }, [baseContext]);

  return (
    <StorefrontObservabilityContext.Provider
      value={{
        baseContext,
        track: (event) => trackStorefrontEvent({ event, baseContext }),
      }}
    >
      {children}
    </StorefrontObservabilityContext.Provider>
  );
}

export function useStorefrontObservability() {
  const context = useContext(StorefrontObservabilityContext);

  if (!context) {
    throw new Error(
      "useStorefrontObservability must be used within a StorefrontObservabilityProvider",
    );
  }

  return context;
}
