import { useQuery } from "@tanstack/react-query";
import { GUEST_ID_KEY, LOGGED_IN_USER_ID_KEY } from "../lib/constants";
import { useEffect, useState } from "react";
import { createGuest, getActiveUser, getGuest } from "@/api/storeFrontUser";
import { useGetStore } from "./useGetStore";

export const useAuth = () => {
  const [loggedInUserId, setLoggedInUserId] = useState<string | null>(null);
  const [guestId, setGuestId] = useState<string | null>(null);

  const { data: store } = useGetStore();

  const organizationId = store?.organizationId as string;
  const storeId = store?._id as string;

  useEffect(() => {
    const createNewGuest = async () => {
      const res = await createGuest(organizationId, storeId);
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
  }, [organizationId, storeId]);

  const {
    data: user,
    isLoading,
    error: userError,
  } = useQuery({
    queryKey: ["user"],
    queryFn: () =>
      getActiveUser({
        storeId,
        organizationId,
        userId: loggedInUserId!,
      }),
    enabled: Boolean(loggedInUserId && organizationId && storeId),
    retry: false,
  });

  useEffect(() => {
    if (userError) {
      localStorage.removeItem(LOGGED_IN_USER_ID_KEY);
      setLoggedInUserId(null);
    }
  }, [userError]);

  const { error: guestError } = useQuery({
    queryKey: ["guest"],
    queryFn: () =>
      getGuest({
        storeId,
        organizationId,
        guestId: guestId!,
      }),
    enabled: Boolean(guestId && organizationId && storeId),
    retry: false,
  });

  useEffect(() => {
    if (guestError) {
      localStorage.removeItem(GUEST_ID_KEY);
      setGuestId(null);
    }
  }, [guestError]);

  return {
    user,
    userId: loggedInUserId,
    guestId,
    isLoading,
  };
};
