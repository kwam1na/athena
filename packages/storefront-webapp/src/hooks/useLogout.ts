import { logout } from "@/api/auth";
import { SESSION_STORAGE_KEY } from "@/lib/constants";
import { useMutation } from "@tanstack/react-query";

export const useLogout = () => {
  const logoutMutaion = useMutation({
    mutationFn: logout,
  });

  const handleLogout = async () => {
    await logoutMutaion.mutateAsync();

    sessionStorage.removeItem(SESSION_STORAGE_KEY);

    window.location.reload();
  };

  return handleLogout;
};
