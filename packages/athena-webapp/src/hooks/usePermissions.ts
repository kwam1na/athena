import { usePermissionsContext } from "../contexts/PermissionsContext";
import { Role } from "~/types";

interface UsePermissionsReturn {
  canAccessPOS: () => boolean;
  canAccessAdmin: () => boolean;
  hasFullAdminAccess: boolean;
  role: Role | null;
  isLoading: boolean;
}

export function usePermissions(): UsePermissionsReturn {
  const { canAccessAdmin, canAccessPOS, role, isLoading } =
    usePermissionsContext();

  return {
    canAccessPOS: () => canAccessPOS,
    canAccessAdmin: () => canAccessAdmin,
    hasFullAdminAccess: role === "full_admin",
    role,
    isLoading,
  };
}
