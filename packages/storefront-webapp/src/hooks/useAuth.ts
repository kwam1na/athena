import { useQuery } from "@tanstack/react-query";
import { useUserQueries } from "@/lib/queries/user";

export const useAuth = () => {
  const userQueries = useUserQueries();
  const { data: user, isLoading } = useQuery(userQueries.me());

  const { data: guestData } = useQuery(userQueries.guest());

  return {
    user,
    userId: user?._id,
    guestId: guestData?._id,
    isLoading,
  };
};
