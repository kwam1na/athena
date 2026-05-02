import {
  createFileRoute,
  Link,
  Outlet,
  useNavigate,
} from "@tanstack/react-router";
import { useConvexAuth, useMutation } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { useAuthToken } from "@convex-dev/auth/react";
import {
  LOGGED_IN_USER_ID_KEY,
  PENDING_ATHENA_AUTH_SYNC_KEY,
} from "~/src/lib/constants";
import { api } from "~/convex/_generated/api";
import { runCommand } from "~/src/lib/errors/runCommand";

const HOME_PATH = "/";

const AUTH_SYNC_RETRY_DELAY_MS = 100;
const AUTH_SYNC_MAX_ATTEMPTS = 20;
const AUTH_SYNC_RETRYABLE_MESSAGE = "Sign in again to continue.";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function useDocumentScrollLock() {
  useEffect(() => {
    const htmlStyle = document.documentElement.style;
    const bodyStyle = document.body.style;
    const previousHtmlHeight = htmlStyle.height;
    const previousHtmlOverflow = htmlStyle.overflow;
    const previousHtmlOverscrollBehaviorY = htmlStyle.overscrollBehaviorY;
    const previousBodyHeight = bodyStyle.height;
    const previousBodyOverflow = bodyStyle.overflow;
    const previousBodyOverscrollBehaviorY = bodyStyle.overscrollBehaviorY;

    htmlStyle.height = "100%";
    htmlStyle.overflow = "hidden";
    htmlStyle.overscrollBehaviorY = "none";
    bodyStyle.height = "100%";
    bodyStyle.overflow = "hidden";
    bodyStyle.overscrollBehaviorY = "none";

    return () => {
      htmlStyle.height = previousHtmlHeight;
      htmlStyle.overflow = previousHtmlOverflow;
      htmlStyle.overscrollBehaviorY = previousHtmlOverscrollBehaviorY;
      bodyStyle.height = previousBodyHeight;
      bodyStyle.overflow = previousBodyOverflow;
      bodyStyle.overscrollBehaviorY = previousBodyOverscrollBehaviorY;
    };
  }, []);
}

export const Route = createFileRoute("/login/_layout")({
  component: LoginLayout,
});

export function LoginLayout() {
  useDocumentScrollLock();

  const { isAuthenticated, isLoading } = useConvexAuth();
  const authToken = useAuthToken();
  const syncAuthenticatedAthenaUser = useMutation(
    api.inventory.auth.syncAuthenticatedAthenaUser
  );
  const [authSyncError, setAuthSyncError] = useState<string | null>(null);
  const [pendingAuthSyncTick, setPendingAuthSyncTick] = useState(0);
  const isSyncingRef = useRef(false);
  const isMountedRef = useRef(true);
  const navigate = useNavigate();

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const handlePendingAuthSync = () => {
      setPendingAuthSyncTick((tick) => tick + 1);
    };

    window.addEventListener("athena:pending-auth-sync", handlePendingAuthSync);

    return () => {
      window.removeEventListener(
        "athena:pending-auth-sync",
        handlePendingAuthSync
      );
    };
  }, []);

  useEffect(() => {
    const pendingAuthSync =
      sessionStorage.getItem(PENDING_ATHENA_AUTH_SYNC_KEY) === "1";
    const hasLoggedInUserId = Boolean(
      localStorage.getItem(LOGGED_IN_USER_ID_KEY)
    );
    const shouldRecoverAuthenticatedSession =
      isAuthenticated && Boolean(authToken) && !hasLoggedInUserId;
    const shouldCompletePendingAuthSync =
      pendingAuthSync || shouldRecoverAuthenticatedSession;

    if (isSyncingRef.current || !shouldCompletePendingAuthSync) {
      return;
    }

    if (isLoading || !isAuthenticated || !authToken) {
      return;
    }

    const completePendingAuthSync = async () => {
      isSyncingRef.current = true;
      setAuthSyncError(null);

      let userId: string | null = null;
      let finalErrorMessage: string | null = null;

      try {
        for (let attempt = 0; attempt < AUTH_SYNC_MAX_ATTEMPTS; attempt += 1) {
          const result = await runCommand(() => syncAuthenticatedAthenaUser({}));

          if (result.kind === "ok") {
            const resolvedUserId =
              result.data && typeof result.data._id === "string"
                ? result.data._id
                : null;

            if (resolvedUserId) {
              userId = resolvedUserId;
              break;
            }

            finalErrorMessage = "Could not load your Athena user profile.";
            break;
          }

          finalErrorMessage = result.error.message;
          const shouldRetry =
            result.kind === "user_error" &&
            result.error.retryable === true &&
            result.error.message === AUTH_SYNC_RETRYABLE_MESSAGE;

          if (!shouldRetry || attempt === AUTH_SYNC_MAX_ATTEMPTS - 1) {
            break;
          }

          await sleep(AUTH_SYNC_RETRY_DELAY_MS);
        }

        if (!userId) {
          throw new Error(
            finalErrorMessage ?? "Could not load your Athena user profile."
          );
        }

        if (!isMountedRef.current) {
          return;
        }

        sessionStorage.removeItem(PENDING_ATHENA_AUTH_SYNC_KEY);
        localStorage.setItem(LOGGED_IN_USER_ID_KEY, userId);
        navigate({ to: "/" });
      } catch (error) {
        if (!isMountedRef.current) {
          return;
        }

        const message =
          error instanceof Error
            ? error.message
            : "Could not finish loading your Athena profile.";

        setAuthSyncError(message);
        isSyncingRef.current = false;
      }
    };

    void completePendingAuthSync();
  }, [
    authToken,
    isAuthenticated,
    isLoading,
    navigate,
    pendingAuthSyncTick,
    syncAuthenticatedAthenaUser,
  ]);

  return (
    <main
      className="relative isolate flex h-screen w-full overflow-hidden bg-background text-foreground"
      aria-busy={isLoading}
    >
      <div
        className="pointer-events-none absolute inset-0 z-0 bg-background"
        aria-hidden="true"
      >
        <div className="absolute inset-0 opacity-70 [background-image:linear-gradient(to_right,hsl(var(--border)/0.36)_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--border)/0.28)_1px,transparent_1px)] [background-size:48px_48px] [mask-image:linear-gradient(to_bottom,black,black_68%,transparent)]" />
        <div className="absolute inset-y-0 right-0 w-[62%] opacity-45 [background-image:repeating-linear-gradient(135deg,transparent_0,transparent_28px,hsl(var(--border)/0.34)_28px,hsl(var(--border)/0.34)_29px)] [mask-image:linear-gradient(to_left,black,transparent_76%)]" />
      </div>

      <div className="absolute left-layout-xl top-layout-xl z-20">
        <Link
          to={HOME_PATH}
          className="flex h-10 items-center justify-center rounded-md px-layout-sm font-display text-base font-light tracking-[0.18em] text-foreground transition-colors duration-standard ease-standard hover:text-signal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          athena
        </Link>
      </div>

      <div className="relative z-10 flex h-full w-full items-center justify-center px-layout-md py-layout-xl sm:px-layout-xl">
        <section className="w-full max-w-[25rem]">
          {authSyncError && (
            <div
              className="mb-layout-md rounded-md border border-danger/20 bg-danger/10 px-layout-md py-layout-sm text-sm text-danger"
              role="alert"
            >
              {authSyncError}
            </div>
          )}
          <Outlet />
        </section>
      </div>
    </main>
  );
}
