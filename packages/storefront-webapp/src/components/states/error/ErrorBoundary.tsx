import { useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import {
  getCustomerErrorMessage,
  PageState,
} from "@/components/states/PageState";
import { useEffect } from "react";
import { emitStorefrontFailure } from "@/lib/storefrontFailureObservability";
import {
  createStorefrontObservabilityContext,
  trackStorefrontEvent,
} from "@/lib/storefrontObservability";

export function ErrorBoundary({ error, reset }: ErrorComponentProps) {
  const router = useRouter();

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
        boundary: "root_error_boundary",
      },
      track: (event) => trackStorefrontEvent({ event, baseContext }),
    }).catch(() => undefined);
  }, [error]);

  const handleReset = () => {
    reset();
  };

  const handleGoHome = () => {
    router.navigate({ to: "/" });
  };

  return (
    <PageState
      state="error"
      title="Something went wrong"
      description={getCustomerErrorMessage(error)}
      primaryAction={<Button onClick={handleReset}>Try again</Button>}
      secondaryAction={
        <Button onClick={handleGoHome} variant="outline">
          Return home
        </Button>
      }
      className="min-h-screen"
    />
  );
}
