import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useConvexAuth, useMutation } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { useAuthToken } from "@convex-dev/auth/react";
import {
  ATHENA_PENDING_AUTH_SYNC_EVENT,
  LOGGED_IN_USER_ID_KEY,
  POS_APP_ACCOUNT_ID_KEY,
} from "~/src/lib/constants";
import { api } from "~/convex/_generated/api";
import { runCommand } from "~/src/lib/errors/runCommand";
import {
  clearAthenaAuthSyncHandoff,
  failAthenaAuthSyncHandoff,
  getAthenaAuthSyncHandoffStatus,
} from "~/src/components/auth/Login/authSyncHandoff";
import {
  APP_ENTRY_PATH,
  PUBLIC_HOME_PATH,
} from "~/src/lib/navigation/appEntryRoutes";
import {
  getPosServiceAuthPresentation,
  POS_SERVICE_AUTH_PRESENTATION_EVENT,
} from "~/src/components/auth/Login/posRecoveryFlow";

const AUTH_SYNC_RETRY_DELAY_MS = 250;
const AUTH_SYNC_MAX_ATTEMPTS = 60;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function navigationTargetForRedirect(redirectTo: string) {
  const url = new URL(redirectTo, window.location.origin);
  const pathname = url.pathname || "/";
  const search = Object.fromEntries(url.searchParams.entries());

  if (Object.keys(search).length === 0) {
    return { to: pathname };
  }

  return { to: pathname, search };
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

export function LoginLayout() {
  useDocumentScrollLock();

  const { isAuthenticated, isLoading } = useConvexAuth();
  const authToken = useAuthToken();
  const syncAuthenticatedAthenaUser = useMutation(
    api.inventory.auth.syncAuthenticatedAthenaUser,
  );
  const [authSyncError, setAuthSyncError] = useState<string | null>(null);
  const [pendingAuthSyncTick, setPendingAuthSyncTick] = useState(0);
  const [servicePresentationTick, setServicePresentationTick] = useState(0);
  const isSyncingRef = useRef(false);
  const isServiceSessionNavigatingRef = useRef(false);
  const isMountedRef = useRef(true);
  const navigate = useNavigate();

  useEffect(() => {
    const handleServicePresentation = () => {
      setServicePresentationTick((tick) => tick + 1);
    };
    window.addEventListener(
      POS_SERVICE_AUTH_PRESENTATION_EVENT,
      handleServicePresentation,
    );
    return () =>
      window.removeEventListener(
        POS_SERVICE_AUTH_PRESENTATION_EVENT,
        handleServicePresentation,
      );
  }, []);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const handlePendingAuthSync = () => {
      setPendingAuthSyncTick((tick) => tick + 1);
    };

    window.addEventListener(
      ATHENA_PENDING_AUTH_SYNC_EVENT,
      handlePendingAuthSync,
    );

    return () => {
      window.removeEventListener(
        ATHENA_PENDING_AUTH_SYNC_EVENT,
        handlePendingAuthSync,
      );
    };
  }, []);

  useEffect(() => {
    const servicePresentation = getPosServiceAuthPresentation();

    if (
      servicePresentation?.kind !== "active" ||
      isLoading ||
      !isAuthenticated ||
      !authToken ||
      isServiceSessionNavigatingRef.current
    ) {
      return;
    }

    isServiceSessionNavigatingRef.current = true;
    localStorage.removeItem(LOGGED_IN_USER_ID_KEY);
    localStorage.removeItem(POS_APP_ACCOUNT_ID_KEY);
    navigate(
      navigationTargetForRedirect(servicePresentation.redirectTo) as never,
    );
  }, [
    authToken,
    isAuthenticated,
    isLoading,
    navigate,
    servicePresentationTick,
  ]);

  useEffect(() => {
    if (getPosServiceAuthPresentation()) {
      return;
    }

    const handoffStatus = getAthenaAuthSyncHandoffStatus();
    const pendingAuthSync = handoffStatus.kind === "active";
    const hasLoggedInUserId = Boolean(
      localStorage.getItem(LOGGED_IN_USER_ID_KEY),
    );
    const shouldRecoverAuthenticatedSession =
      isAuthenticated && Boolean(authToken) && !hasLoggedInUserId;
    const shouldCompletePendingAuthSync =
      pendingAuthSync || shouldRecoverAuthenticatedSession;

    if (handoffStatus.kind === "expired" || handoffStatus.kind === "invalid") {
      failAthenaAuthSyncHandoff();
      return;
    }

    if (isSyncingRef.current || !shouldCompletePendingAuthSync) {
      return;
    }

    if (isLoading || !isAuthenticated || !authToken) {
      if (pendingAuthSync) {
        const timeoutId = window.setTimeout(
          () => {
            const latestStatus = getAthenaAuthSyncHandoffStatus();
            if (latestStatus.kind === "active") {
              failAthenaAuthSyncHandoff();
              setPendingAuthSyncTick((tick) => tick + 1);
            }
          },
          Math.max(handoffStatus.expiresAt - Date.now(), 0),
        );

        return () => window.clearTimeout(timeoutId);
      }

      return;
    }

    const completePendingAuthSync = async () => {
      isSyncingRef.current = true;
      setAuthSyncError(null);

      let userId: string | null = null;
      let finalErrorMessage: string | null = null;

      try {
        for (let attempt = 0; attempt < AUTH_SYNC_MAX_ATTEMPTS; attempt += 1) {
          const result = await runCommand(() =>
            syncAuthenticatedAthenaUser({}),
          );

          if (result.kind === "ok") {
            const resolvedUserId =
              result.data && typeof result.data._id === "string"
                ? result.data._id
                : null;

            if (resolvedUserId) {
              userId = resolvedUserId;
              break;
            }

            finalErrorMessage = "Could not load your Athena user profile";
            break;
          }

          finalErrorMessage = result.error.message;
          const shouldRetry =
            result.kind === "user_error" && result.error.retryable === true;

          if (!shouldRetry || attempt === AUTH_SYNC_MAX_ATTEMPTS - 1) {
            break;
          }

          await sleep(AUTH_SYNC_RETRY_DELAY_MS);
        }

        if (!userId) {
          throw new Error(
            finalErrorMessage ?? "Could not load your Athena user profile",
          );
        }

        if (!isMountedRef.current) {
          return;
        }

        const redirectTo =
          handoffStatus.kind === "active"
            ? handoffStatus.handoff.redirectTo
            : APP_ENTRY_PATH;
        clearAthenaAuthSyncHandoff();
        localStorage.setItem(LOGGED_IN_USER_ID_KEY, userId);
        localStorage.setItem(POS_APP_ACCOUNT_ID_KEY, userId);
        navigate(navigationTargetForRedirect(redirectTo) as never);
      } catch (error) {
        if (!isMountedRef.current) {
          return;
        }

        const message =
          error instanceof Error
            ? error.message
            : "Could not finish loading your Athena profile";

        setAuthSyncError(message);
        failAthenaAuthSyncHandoff();
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
        className="pointer-events-none absolute inset-0 z-0 bg-background [mask-composite:intersect] [mask-image:linear-gradient(to_bottom,transparent,black_12%,black_68%,transparent),linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]"
        aria-hidden="true"
      >
        <div className="absolute inset-0 opacity-70 [background-image:linear-gradient(to_right,hsl(var(--border)/0.36)_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--border)/0.28)_1px,transparent_1px)] [background-size:48px_48px]" />
        <div className="absolute inset-y-0 right-0 w-[62%] opacity-45 [background-image:repeating-linear-gradient(135deg,transparent_0,transparent_28px,hsl(var(--border)/0.34)_28px,hsl(var(--border)/0.34)_29px)] [mask-image:linear-gradient(to_left,black,transparent_76%)]" />
      </div>

      <div className="absolute left-layout-xl top-layout-xl z-20">
        <Link
          to={PUBLIC_HOME_PATH}
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
