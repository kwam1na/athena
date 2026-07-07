import { useAuth } from "@/hooks/useAuth";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { usePermissions } from "@/hooks/usePermissions";

type ProtectedSurfaceAccess = "cash_controls" | "full_admin" | "store_day";

export function useProtectedAdminPageState(
  options: { surface?: ProtectedSurfaceAccess } = {},
) {
  const { isLoading: isLoadingUser, user } = useAuth();
  const { activeStore, isLoadingStores } = useGetActiveStore();
  const {
    canAccessOperations,
    hasFinancialDetailsAccess,
    hasFullAdminAccess,
    hasStoreDaySurfaceAccess,
    isLoading: isLoadingPermissions,
  } = usePermissions();

  const fullAdminAccess = hasFullAdminAccess ?? canAccessOperations();
  const storeDaySurfaceAccess =
    hasStoreDaySurfaceAccess ?? canAccessOperations();
  const cashControlsAccess = hasFinancialDetailsAccess ?? fullAdminAccess;
  const canAccessSurface =
    options.surface === "cash_controls"
      ? cashControlsAccess
      : options.surface === "store_day"
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
    hasFinancialDetailsAccess,
    hasFullAdminAccess: fullAdminAccess,
    hasStoreDaySurfaceAccess: storeDaySurfaceAccess,
    isAuthenticated: hasReadyAuthenticatedUser,
    isLoadingAccess,
  };
}
