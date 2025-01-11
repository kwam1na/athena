import { useQuery } from "convex/react";
import { LOGGED_IN_USER_ID_KEY } from "../lib/constants";
import { api } from "~/convex/_generated/api";
import { Id } from "~/convex/_generated/dataModel";
import { useEffect, useState } from "react";

export const useAuth = () => {
  const [loggedInUserId, setLoggedInUserId] = useState<string | null>(null);
  const [isStorageLoaded, setIsStorageLoaded] = useState(false);

  useEffect(() => {
    const id = localStorage.getItem(LOGGED_IN_USER_ID_KEY);
    setLoggedInUserId(id);
    setIsStorageLoaded(true);
  }, []);

  const user = useQuery(api.inventory.athenaUser.getUserById, {
    id: loggedInUserId as Id<"athenaUser">,
  });

  return {
    user,
    isLoading: !isStorageLoaded,
  };
};
