import { ReactNode } from "react";
import { usePermissions } from "../hooks/usePermissions";
import { Role } from "~/types";

interface PermissionGateProps {
  children: ReactNode;
  requires: Role;
  fallback?: ReactNode;
}

export function PermissionGate({
  children,
  requires,
  fallback = null,
}: PermissionGateProps) {
  const { role, isLoading } = usePermissions();

  if (isLoading) {
    return null;
  }

  // Check if user has the required role
  if (requires === "full_admin" && role === "full_admin") {
    return <>{children}</>;
  }

  if (
    requires === "pos_only" &&
    (role === "pos_only" || role === "full_admin")
  ) {
    return <>{children}</>;
  }

  return <>{fallback}</>;
}
