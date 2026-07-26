import {
  rootRouteId,
  useMatch,
  useRouter,
} from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  getCustomerErrorMessage,
  PageState,
} from "@/components/states/PageState";
import { emitStorefrontFailure } from "@/lib/storefrontFailureObservability";
import {
  createStorefrontObservabilityContext,
  trackStorefrontEvent,
} from "@/lib/storefrontObservability";

export function DefaultCatchBoundary({ error }: ErrorComponentProps) {
  const router = useRouter();
  const isRoot = useMatch({
    strict: false,
    select: (state) => state.id === rootRouteId,
  });

  useEffect(() => {
    const route = window.location.pathname || "/";
    const search = new URLSearchParams(window.location.search);
    const baseContext = createStorefrontObservabilityContext({
      pathname: route,
      search: {
        origin: search.get("origin") ?? undefined,
        utm_source: search.get("utm_source") ?? undefined,
      },
      storage: window.sessionStorage,
    });

    void emitStorefrontFailure({
      route,
      step: "route_render",
      error,
      fallbackCategory: "client_render",
      context: {
        boundary: "default_catch_boundary",
      },
      track: (event) => trackStorefrontEvent({ event, baseContext }),
    }).catch(() => undefined);
  }, [error]);

  return (
    <PageState
      state="error"
      title="We couldn't load this page"
      description={getCustomerErrorMessage(error)}
      primaryAction={
        <Button onClick={() => void router.invalidate()}>
          Try Again
        </Button>
      }
      secondaryAction={
        <Button
          variant="outline"
          onClick={() => {
            if (isRoot) {
              void router.navigate({ to: "/" });
              return;
            }
            window.history.back();
          }}
        >
          {isRoot ? "Return home" : "Go back"}
        </Button>
      }
    />
  );
}
