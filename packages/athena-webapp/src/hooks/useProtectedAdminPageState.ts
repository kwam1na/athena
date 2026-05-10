import { useAuth } from "@/hooks/useAuth";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { usePermissions } from "@/hooks/usePermissions";

type ProtectedSurfaceAccess = "full_admin" | "store_day";

export function useProtectedAdminPageState(
  options: { surface?: ProtectedSurfaceAccess } = {},
) {
  const { isLoading: isLoadingUser, user } = useAuth();
  const { activeStore, isLoadingStores } = useGetActiveStore();
  const {
    canAccessOperations,
    hasFullAdminAccess,
    hasStoreDaySurfaceAccess,
    isLoading: isLoadingPermissions,
  } = usePermissions();

  const fullAdminAccess = hasFullAdminAccess ?? canAccessOperations();
  const storeDaySurfaceAccess =
    hasStoreDaySurfaceAccess ?? canAccessOperations();
  const canAccessSurface =
    options.surface === "store_day"
      ? storeDaySurfaceAccess
      : fullAdminAccess;
  const hasReadyAuthenticatedUser = Boolean(user);
  const isLoadingAccess = isLoadingPermissions || isLoadingUser || isLoadingStores;
  const canQueryProtectedData = Boolean(
    activeStore?._id &&
      canAccessSurface &&
      hasReadyAuthenticatedUser &&
      !isLoadingAccess
  );

  return {
    activeStore,
    canAccessProtectedSurface: canAccessSurface,
    canQueryProtectedData,
    hasFullAdminAccess: fullAdminAccess,
    hasStoreDaySurfaceAccess: storeDaySurfaceAccess,
    isAuthenticated: hasReadyAuthenticatedUser,
    isLoadingAccess,
  };
}
