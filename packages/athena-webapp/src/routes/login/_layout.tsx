import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { useConvexAuth, useMutation } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { useAuthToken } from "@convex-dev/auth/react";
import {
  LOGGED_IN_USER_ID_KEY,
  PENDING_ATHENA_AUTH_SYNC_KEY,
} from "~/src/lib/constants";
import { api } from "~/convex/_generated/api";

const HOME_PATH = "/";

const QUOTES = [
  {
    quote: "There is nothing impossible to they who will try.",
    author: "Alexander the Great",
  },
  {
    quote: "The only way to do great work is to love what you do.",
    author: "Steve Jobs",
  },
  {
    quote: "The best way to predict the future is to create it.",
    author: "Peter Drucker",
  },
  {
    quote:
      "The only limit to our realization of tomorrow will be our doubts of today.",
    author: "Franklin D. Roosevelt",
  },
  {
    quote: "The only thing we have to fear is fear itself.",
    author: "Franklin D. Roosevelt",
  },
];

const randomQuote = QUOTES[Math.floor(Math.random() * QUOTES.length)];
const AUTH_SYNC_RETRY_DELAY_MS = 100;
const AUTH_SYNC_MAX_ATTEMPTS = 20;
const AUTH_SYNC_RETRYABLE_MESSAGE = "Sign in again to continue.";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const Route = createFileRoute("/login/_layout")({
  component: LoginLayout,
});

export function LoginLayout() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const authToken = useAuthToken();
  const syncAuthenticatedAthenaUser = useMutation(
    api.inventory.auth.syncAuthenticatedAthenaUser
  );
  const [authSyncError, setAuthSyncError] = useState<string | null>(null);
  const [pendingAuthSyncTick, setPendingAuthSyncTick] = useState(0);
  const isSyncingRef = useRef(false);
  const isMountedRef = useRef(true);

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

      let user = null;
      let lastRetryError: unknown = null;

      try {
        for (let attempt = 0; attempt < AUTH_SYNC_MAX_ATTEMPTS; attempt += 1) {
          try {
            user = await syncAuthenticatedAthenaUser({});
            break;
          } catch (error) {
            lastRetryError = error;
            const message = error instanceof Error ? error.message : "";

            if (!message.includes(AUTH_SYNC_RETRYABLE_MESSAGE)) {
              throw error;
            }

            if (attempt === AUTH_SYNC_MAX_ATTEMPTS - 1) {
              break;
            }

            await sleep(AUTH_SYNC_RETRY_DELAY_MS);
          }
        }

        if (!user) {
          throw lastRetryError instanceof Error
            ? lastRetryError
            : new Error("Could not load your Athena user profile.");
        }

        if (!isMountedRef.current) {
          return;
        }

        sessionStorage.removeItem(PENDING_ATHENA_AUTH_SYNC_KEY);
        localStorage.setItem(LOGGED_IN_USER_ID_KEY, user._id);
        window.location.assign("/");
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
    pendingAuthSyncTick,
    syncAuthenticatedAthenaUser,
  ]);

  return (
    <div className="flex h-screen w-full" aria-busy={isLoading}>
      <div className="absolute left-1/2 top-10 mx-auto flex -translate-x-1/2 transform lg:hidden">
        <Link
          to={HOME_PATH}
          className="z-10 flex h-10 flex-col items-center justify-center gap-2"
        >
          athena
        </Link>
      </div>
      <div className="relative hidden h-full w-[50%] flex-col justify-between overflow-hidden bg-card p-10 lg:flex">
        <Link to={HOME_PATH} className="z-10 flex h-10 w-10 items-center gap-1">
          athena
        </Link>

        {/* <div className="z-10 flex flex-col items-start gap-2">
          <p className="text-base font-normal text-primary">
            {randomQuote.quote}
          </p>
          <p className="text-base font-normal text-primary/60">
            -{randomQuote.author}
          </p>
        </div> */}
        <div className="base-grid absolute left-0 top-0 z-0 h-full w-full opacity-40" />
      </div>
      <div className="flex h-full w-full flex-col border-l border-primary/5 bg-card lg:w-[50%]">
        {authSyncError && (
          <div className="px-6 pt-6 text-sm text-destructive">
            {authSyncError}
          </div>
        )}
        <Outlet />
      </div>
    </div>
  );
}
