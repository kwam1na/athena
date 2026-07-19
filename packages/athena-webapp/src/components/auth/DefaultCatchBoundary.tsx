import {
  ErrorComponentProps,
  Link,
  rootRouteId,
  useMatch,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { ArrowLeft, Home, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  GENERIC_UNEXPECTED_ERROR_MESSAGE,
  GENERIC_UNEXPECTED_ERROR_TITLE,
} from "~/shared/commandResult";
import { getRecoveryHomePath } from "@/lib/navigation/appEntryRoutes";

type DefaultCatchBoundaryProps = ErrorComponentProps & {
  reloadPage?: () => void;
};

const ROUTE_MODULE_LOAD_ERROR_PATTERN =
  /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|chunkloaderror|loading chunk \d+ failed/i;

export function DefaultCatchBoundary({
  error,
  reloadPage = () => window.location.reload(),
}: DefaultCatchBoundaryProps) {
  const router = useRouter();
  const isRoot = useMatch({
    strict: false,
    select: (state) => state.id === rootRouteId,
  });
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const recoveryHomePath = getRecoveryHomePath(pathname);
  const isExpiredDemoSession = /(?:shared )?demo session has expired/i.test(
    error.message,
  );
  const isRouteModuleLoadError = ROUTE_MODULE_LOAD_ERROR_PATTERN.test(
    error.message,
  );
  const actionClassName =
    "transition-transform duration-150 ease-emphasized active:scale-[0.98]";

  console.error(error);

  return (
    <section
      aria-labelledby="default-catch-boundary-title"
      className="flex min-h-[100svh] min-w-0 flex-1 items-center justify-center bg-background px-6 py-12 text-foreground sm:px-10 lg:px-14"
    >
      <div className="mx-auto w-full max-w-3xl space-y-layout-2xl">
        <div className="space-y-layout-lg">
          <div className="space-y-3">
            <h1
              id="default-catch-boundary-title"
              className="font-display text-4xl leading-tight tracking-normal text-foreground sm:text-[clamp(2.75rem,4.6vw,4.75rem)] sm:leading-[0.95] sm:tracking-[-0.05em]"
            >
              {isExpiredDemoSession
                ? "Your demo session ended"
                : GENERIC_UNEXPECTED_ERROR_TITLE}
            </h1>
            <p className="text-sm leading-6 text-muted-foreground md:text-lg md:leading-7">
              {isExpiredDemoSession
                ? "Open the demo again to start a fresh session and continue exploring Athena."
                : isRouteModuleLoadError
                  ? "The app could not load this page. Reload Athena to reconnect and try again."
                : `${GENERIC_UNEXPECTED_ERROR_MESSAGE} If the problem keeps happening, go back and retry the action.`}
            </p>
          </div>
        </div>

        <div className="flex flex-col items-start gap-2 sm:flex-row sm:flex-wrap">
          {isExpiredDemoSession ? (
            <Button asChild className={actionClassName} variant="default">
              <Link to="/demo">
                <RotateCcw aria-hidden="true" className="h-4 w-4" />
                Open demo again
              </Link>
            </Button>
          ) : isRoot ? (
            <Button asChild className={actionClassName} variant="outline">
              <Link to={recoveryHomePath}>
                <Home aria-hidden="true" className="h-4 w-4" />
                Home
              </Link>
            </Button>
          ) : (
            <Button asChild className={actionClassName} variant="outline">
              <Link
                to={recoveryHomePath}
                onClick={(event) => {
                  event.preventDefault();
                  window.history.back();
                }}
              >
                <ArrowLeft aria-hidden="true" className="h-4 w-4" />
                Go back
              </Link>
            </Button>
          )}

          {!isExpiredDemoSession ? (
            <Button
              onClick={() => {
                if (isRouteModuleLoadError) {
                  reloadPage();
                  return;
                }

                void router.invalidate();
              }}
              className={actionClassName}
              variant="default"
            >
              {isRouteModuleLoadError ? (
                <RotateCcw aria-hidden="true" className="h-4 w-4" />
              ) : null}
              {isRouteModuleLoadError ? "Reload app" : "Try again"}
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
