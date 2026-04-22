import { useAuth } from "@/hooks/useAuth";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { usePermissions } from "@/hooks/usePermissions";

export function useProtectedAdminPageState() {
  const { isLoading: isLoadingUser, user } = useAuth();
  const { activeStore } = useGetActiveStore();
  const { canAccessOperations, isLoading: isLoadingPermissions } =
    usePermissions();

  const hasFullAdminAccess = canAccessOperations();
  const hasReadyAuthenticatedUser = Boolean(user);
  const isLoadingAccess = isLoadingPermissions || isLoadingUser;
  const canQueryProtectedData = Boolean(
    activeStore?._id &&
      hasFullAdminAccess &&
      hasReadyAuthenticatedUser &&
      !isLoadingAccess
  );

  return {
    activeStore,
    canQueryProtectedData,
    hasFullAdminAccess,
    isAuthenticated: hasReadyAuthenticatedUser,
    isLoadingAccess,
  };
}
