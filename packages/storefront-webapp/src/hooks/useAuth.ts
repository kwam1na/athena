import { useQuery } from "@tanstack/react-query";
import { getActiveUser, getGuest } from "@/api/storeFrontUser";

export const useAuth = () => {
  const { data: user, isLoading } = useQuery({
    queryKey: ["user"],
    queryFn: () => getActiveUser(),
  });

  const { data: guestData } = useQuery({
    queryKey: ["guest"],
    queryFn: () => getGuest(),
  });

  return {
    user,
    userId: user?._id,
    guestId: guestData?._id,
    isLoading,
  };
};
