import { useConvexAuth, useQuery } from "convex/react";
import { useAuthToken } from "@convex-dev/auth/react";
import { LOGGED_IN_USER_ID_KEY } from "../lib/constants";
import { api } from "~/convex/_generated/api";
import { Id } from "~/convex/_generated/dataModel";
import { useEffect, useState } from "react";

export const useAuth = () => {
  const [loggedInUserId, setLoggedInUserId] = useState<string | null>(null);
  const [isStorageLoaded, setIsStorageLoaded] = useState(false);
  const authToken = useAuthToken();
  const { isAuthenticated, isLoading: isLoadingConvexAuth } = useConvexAuth();
  const currentConvexUser = useQuery(api.app.getCurrentUser);
  const isRecoveringConvexSession = Boolean(authToken) && !isAuthenticated;
  const hasReadyConvexUser = Boolean(isAuthenticated && currentConvexUser);
  const isLoadingConvexUser =
    isAuthenticated && currentConvexUser === undefined;

  useEffect(() => {
    const id = localStorage.getItem(LOGGED_IN_USER_ID_KEY);
    setLoggedInUserId(id);
    setIsStorageLoaded(true);
  }, []);

  useEffect(() => {
    if (
      !isStorageLoaded ||
      isLoadingConvexAuth ||
      isRecoveringConvexSession ||
      isLoadingConvexUser ||
      hasReadyConvexUser ||
      !loggedInUserId
    ) {
      return;
    }

    localStorage.removeItem(LOGGED_IN_USER_ID_KEY);
    setLoggedInUserId(null);
  }, [
    isLoadingConvexAuth,
    isRecoveringConvexSession,
    isLoadingConvexUser,
    isStorageLoaded,
    loggedInUserId,
    hasReadyConvexUser,
  ]);

  const user = useQuery(api.inventory.athenaUser.getUserById, {
    id:
      isStorageLoaded && hasReadyConvexUser
        ? (loggedInUserId as Id<"athenaUser"> | null)
        : null,
  });
  const isLoading =
    !isStorageLoaded ||
    isLoadingConvexAuth ||
    isRecoveringConvexSession ||
    isLoadingConvexUser ||
    (hasReadyConvexUser && user === undefined);

  return {
    user: isLoading ? undefined : hasReadyConvexUser ? user : null,
    isLoading,
  };
};
