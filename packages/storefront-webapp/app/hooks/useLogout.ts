import { SESSION_STORAGE_KEY } from "@/lib/constants";
import { logoutFn } from "@/server-actions/auth";
import { useServerFn } from "@tanstack/start";

export const useLogout = () => {
  const logout = useServerFn(logoutFn);

  const handleLogout = async () => {
    await logout();

    if (typeof window === "object") {
      window.serverData = {};
    }

    sessionStorage.removeItem(SESSION_STORAGE_KEY);

    window.location.reload();
  };

  return handleLogout;
};
