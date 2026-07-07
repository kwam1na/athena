import { ReactNode } from "react";
import { usePermissions } from "../hooks/usePermissions";
import { Role } from "~/types";
import { NoPermissionView } from "./states/no-permission/NoPermissionView";

interface ProtectedRouteProps {
  children: ReactNode;
  requires: Role | "manager";
}

export function ProtectedRoute({ children, requires }: ProtectedRouteProps) {
  const { hasFinancialDetailsAccess, role, isLoading } = usePermissions();

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

  if (requires === "manager" && hasFinancialDetailsAccess) {
    return <>{children}</>;
  }

  // Show no permission view instead of redirecting
  return <NoPermissionView />;
}
