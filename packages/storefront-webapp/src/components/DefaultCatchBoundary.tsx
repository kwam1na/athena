import {
  ErrorComponent,
  Link,
  rootRouteId,
  useMatch,
  useRouter,
} from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { useEffect } from "react";
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
    <div className="min-w-0 flex-1 p-4 flex flex-col items-center justify-center gap-6">
      <ErrorComponent error={error} />
      <div className="flex gap-2 items-center flex-wrap">
        <button
          onClick={() => {
            router.invalidate();
          }}
          className={`px-2 py-1 bg-gray-600 dark:bg-gray-700 rounded text-white uppercase font-extrabold`}
        >
          Try Again
        </button>
        {isRoot ? (
          <Link
            to="/"
            className={`px-2 py-1 bg-gray-600 dark:bg-gray-700 rounded text-white uppercase font-extrabold`}
          >
            Home
          </Link>
        ) : (
          <Link
            to="/"
            className={`px-2 py-1 bg-gray-600 dark:bg-gray-700 rounded text-white uppercase font-extrabold`}
            onClick={(e) => {
              e.preventDefault();
              window.history.back();
            }}
          >
            Go Back
          </Link>
        )}
      </div>
    </div>
  );
}
