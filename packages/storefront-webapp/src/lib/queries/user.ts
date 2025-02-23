import { getActiveUser, getGuest } from "@/api/storeFrontUser";
import { queryOptions } from "@tanstack/react-query";
import { useQueryEnabled } from "@/hooks/useQueryEnabled";

export const useUserQueries = () => {
  const queryEnabled = useQueryEnabled();

  return {
    me: () =>
      queryOptions({
        queryKey: ["user"],
        queryFn: () => getActiveUser(),
        enabled: queryEnabled,
      }),
    guest: () =>
      queryOptions({
        queryKey: ["guest"],
        queryFn: () => getGuest(),
        enabled: queryEnabled,
      }),
  };
};
