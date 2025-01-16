import { useQuery } from "@tanstack/react-query";
import {
  GUEST_ID_KEY,
  LOGGED_IN_USER_ID_KEY,
  OG_ORGANIZTION_ID,
  OG_STORE_ID,
} from "../lib/constants";
import { useEffect, useState } from "react";
import { createGuest, getActiveUser } from "@/api/storeFrontUser";

export const useAuth = () => {
  const [loggedInUserId, setLoggedInUserId] = useState<string | null>(null);
  const [guestId, setGuestId] = useState<string | null>(null);

  useEffect(() => {
    const createNewGuest = async () => {
      const res = await createGuest(OG_ORGANIZTION_ID, OG_STORE_ID);
      localStorage.setItem(GUEST_ID_KEY, res.id);
      setGuestId(res.id);
    };

    const id = localStorage.getItem(LOGGED_IN_USER_ID_KEY);
    const guestId = localStorage.getItem(GUEST_ID_KEY);

    setLoggedInUserId(id);
    setGuestId(guestId);

    if (!id && !guestId) {
      // no userId and guestId found, create guest
      createNewGuest();
    }
  }, []);

  const {
    data: user,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["user"],
    queryFn: () =>
      getActiveUser({
        storeId: OG_STORE_ID,
        organizationId: OG_ORGANIZTION_ID,
        userId: loggedInUserId!,
      }),
    enabled: !!loggedInUserId,
    retry: false,
  });

  useEffect(() => {
    if (error) {
      localStorage.removeItem(LOGGED_IN_USER_ID_KEY);
      setLoggedInUserId(null);
    }
  }, [error]);

  return {
    user,
    userId: loggedInUserId,
    guestId,
    isLoading,
  };
};
