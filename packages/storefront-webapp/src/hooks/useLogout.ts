import { LOGGED_IN_USER_ID_KEY, SESSION_STORAGE_KEY } from "@/lib/constants";

export const useLogout = () => {
  const handleLogout = () => {
    localStorage.removeItem(LOGGED_IN_USER_ID_KEY);

    if (typeof window === "object") {
      window.serverData = {};
    }

    sessionStorage.removeItem(SESSION_STORAGE_KEY);

    window.location.reload();
  };

  return handleLogout;
};
