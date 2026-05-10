import { usePermissionsContext } from "../contexts/PermissionsContext";
import { useOptionalManagerElevation } from "../contexts/ManagerElevationContext";
import {
  canAccessFullAdminSurface,
  canAccessStoreDaySurface,
} from "@/lib/access/capabilities";
import { Role } from "~/types";

interface UsePermissionsReturn {
  canAccessOperations: () => boolean;
  canAccessPOS: () => boolean;
  canAccessAdmin: () => boolean;
  canAccessStoreDaySurfaces: () => boolean;
  canAccessFullAdminSurfaces: () => boolean;
  hasFullAdminAccess: boolean;
  hasStoreDaySurfaceAccess: boolean;
  role: Role | null;
  isLoading: boolean;
}

export function usePermissions(): UsePermissionsReturn {
  const { canAccessAdmin, canAccessPOS, role, isLoading } =
    usePermissionsContext();
  const managerElevation = useOptionalManagerElevation();
  const activeManagerElevation = managerElevation?.activeElevation ?? null;
  const hasFullAdminAccess = canAccessFullAdminSurface({ role });
  const hasStoreDaySurfaceAccess = canAccessStoreDaySurface({
    activeManagerElevation,
    role,
  });

  return {
    canAccessOperations: () => hasStoreDaySurfaceAccess,
    canAccessPOS: () => canAccessPOS,
    canAccessAdmin: () => canAccessAdmin,
    canAccessStoreDaySurfaces: () => hasStoreDaySurfaceAccess,
    canAccessFullAdminSurfaces: () => hasFullAdminAccess,
    hasFullAdminAccess,
    hasStoreDaySurfaceAccess,
    role,
    isLoading,
  };
}
