import { useConvexAuth, useQuery } from "convex/react";
import { useAuthToken } from "@convex-dev/auth/react";
import {
  ATHENA_PENDING_AUTH_SYNC_EVENT,
  LOGGED_IN_USER_ID_KEY,
} from "../lib/constants";
import { api } from "~/convex/_generated/api";
import { useEffect, useState } from "react";
import {
  failAthenaAuthSyncHandoff,
  getAthenaAuthSyncHandoffStatus,
} from "../components/auth/Login/authSyncHandoff";

export const useAuth = () => {
  const [loggedInUserId, setLoggedInUserId] = useState<string | null>(null);
  const [isStorageLoaded, setIsStorageLoaded] = useState(false);
  const [pendingAuthSyncTick, setPendingAuthSyncTick] = useState(0);
  const authToken = useAuthToken();
  const { isAuthenticated, isLoading: isLoadingConvexAuth } = useConvexAuth();
  const pendingAuthSyncStatus = getAthenaAuthSyncHandoffStatus();
  const isPendingAuthSync = pendingAuthSyncStatus.kind === "active";
  const currentConvexUser = useQuery(api.app.getCurrentUser);
  const isRecoveringConvexSession =
    Boolean(authToken) && !isAuthenticated && currentConvexUser === undefined;
  const hasReadyConvexUser = Boolean(currentConvexUser);
  const isLoadingConvexUser =
    (isAuthenticated || Boolean(authToken)) &&
    currentConvexUser === undefined;
  const authenticatedAthenaUser = useQuery(
    api.inventory.athenaUser.getAuthenticatedUser,
    hasReadyConvexUser ? {} : "skip"
  );
  const isLoadingAthenaUser =
    hasReadyConvexUser && authenticatedAthenaUser === undefined;

  useEffect(() => {
    const id = localStorage.getItem(LOGGED_IN_USER_ID_KEY);
    setLoggedInUserId(id);
    setIsStorageLoaded(true);
  }, []);

  useEffect(() => {
    const handlePendingAuthSync = () => {
      setPendingAuthSyncTick((tick) => tick + 1);
    };

    window.addEventListener(ATHENA_PENDING_AUTH_SYNC_EVENT, handlePendingAuthSync);
    window.addEventListener("storage", handlePendingAuthSync);

    return () => {
      window.removeEventListener(
        ATHENA_PENDING_AUTH_SYNC_EVENT,
        handlePendingAuthSync,
      );
      window.removeEventListener("storage", handlePendingAuthSync);
    };
  }, []);

  useEffect(() => {
    const status = getAthenaAuthSyncHandoffStatus();
    if (status.kind === "expired" || status.kind === "invalid") {
      failAthenaAuthSyncHandoff();
      return;
    }

    if (status.kind !== "active") {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      const latestStatus = getAthenaAuthSyncHandoffStatus();
      if (latestStatus.kind === "active") {
        failAthenaAuthSyncHandoff();
        setPendingAuthSyncTick((tick) => tick + 1);
      }
    }, Math.max(status.expiresAt - Date.now(), 0));

    return () => window.clearTimeout(timeoutId);
  }, [authToken, isAuthenticated, isLoadingConvexAuth, pendingAuthSyncTick]);

  useEffect(() => {
    if (
      !isStorageLoaded ||
      isLoadingConvexAuth ||
      isPendingAuthSync ||
      isRecoveringConvexSession ||
      isLoadingConvexUser ||
      isLoadingAthenaUser
    ) {
      return;
    }

    const authenticatedAthenaUserId = authenticatedAthenaUser?._id ?? null;

    if (authenticatedAthenaUserId) {
      if (loggedInUserId !== authenticatedAthenaUserId) {
        localStorage.setItem(LOGGED_IN_USER_ID_KEY, authenticatedAthenaUserId);
        setLoggedInUserId(authenticatedAthenaUserId);
      }
      return;
    }

    if (loggedInUserId) {
      localStorage.removeItem(LOGGED_IN_USER_ID_KEY);
      setLoggedInUserId(null);
    }
  }, [
    authenticatedAthenaUser,
    isLoadingConvexAuth,
    isPendingAuthSync,
    isRecoveringConvexSession,
    isLoadingConvexUser,
    isLoadingAthenaUser,
    isStorageLoaded,
    loggedInUserId,
  ]);
  const isLoading =
    !isStorageLoaded ||
    isLoadingConvexAuth ||
    isPendingAuthSync ||
    isRecoveringConvexSession ||
    isLoadingConvexUser ||
    isLoadingAthenaUser;

  return {
    user: isLoading
      ? undefined
      : hasReadyConvexUser
        ? authenticatedAthenaUser
        : null,
    isLoading,
  };
};
