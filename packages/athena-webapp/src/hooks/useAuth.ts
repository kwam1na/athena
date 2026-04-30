import { useConvexAuth, useQuery } from "convex/react";
import { useAuthToken } from "@convex-dev/auth/react";
import { LOGGED_IN_USER_ID_KEY } from "../lib/constants";
import { api } from "~/convex/_generated/api";
import { useEffect, useState } from "react";

export const useAuth = () => {
  const [loggedInUserId, setLoggedInUserId] = useState<string | null>(null);
  const [isStorageLoaded, setIsStorageLoaded] = useState(false);
  const authToken = useAuthToken();
  const { isAuthenticated, isLoading: isLoadingConvexAuth } = useConvexAuth();
  const cachedAthenaUser = useQuery(
    api.inventory.athenaUser.getUserById,
    loggedInUserId ? { id: loggedInUserId } : "skip"
  );
  const currentConvexUser = useQuery(api.app.getCurrentUser);
  const isRecoveringConvexSession = Boolean(authToken) && !isAuthenticated;
  const isLoadingCachedAthenaUser =
    isRecoveringConvexSession &&
    Boolean(loggedInUserId) &&
    cachedAthenaUser === undefined;
  const hasReadyConvexUser = Boolean(isAuthenticated && currentConvexUser);
  const isLoadingConvexUser =
    isAuthenticated && currentConvexUser === undefined;
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
    if (
      !isStorageLoaded ||
      isLoadingConvexAuth ||
      isLoadingCachedAthenaUser ||
      (isRecoveringConvexSession && !loggedInUserId) ||
      isLoadingConvexUser ||
      isLoadingAthenaUser
    ) {
      return;
    }

    const authenticatedAthenaUserId = authenticatedAthenaUser?._id ?? null;

    if (isRecoveringConvexSession && cachedAthenaUser) {
      return;
    }

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
    cachedAthenaUser,
    isLoadingConvexAuth,
    isLoadingCachedAthenaUser,
    isRecoveringConvexSession,
    isLoadingConvexUser,
    isLoadingAthenaUser,
    isStorageLoaded,
    loggedInUserId,
  ]);
  const isLoading =
    !isStorageLoaded ||
    isLoadingConvexAuth ||
    isLoadingCachedAthenaUser ||
    (isRecoveringConvexSession && !loggedInUserId) ||
    isLoadingConvexUser ||
    isLoadingAthenaUser;

  return {
    user: isLoading
      ? undefined
      : hasReadyConvexUser
        ? authenticatedAthenaUser
        : isRecoveringConvexSession
          ? (cachedAthenaUser ?? null)
        : null,
    isLoading,
  };
};
