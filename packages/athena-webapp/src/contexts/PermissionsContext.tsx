import { createContext, useContext, ReactNode } from "react";
import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import { useAuth } from "../hooks/useAuth";
import { useGetActiveOrganization } from "../hooks/useGetOrganizations";
import { Role } from "~/types";

interface PermissionsContextType {
  canAccessAdmin: boolean;
  canAccessPOS: boolean;
  role: Role | null;
  isLoading: boolean;
}

const PermissionsContext = createContext<PermissionsContextType | undefined>(
  undefined
);

interface PermissionsProviderProps {
  children: ReactNode;
}

export function PermissionsProvider({ children }: PermissionsProviderProps) {
  const { user } = useAuth();
  const { activeOrganization } = useGetActiveOrganization();

  const permissions = useQuery(
    api.inventory.organizationMembers.getUserPermissions,
    user && activeOrganization
      ? {
          userId: user._id,
          organizationId: activeOrganization._id,
        }
      : "skip"
  );

  const value: PermissionsContextType = {
    canAccessAdmin: permissions?.canAccessAdmin ?? false,
    canAccessPOS: permissions?.canAccessPOS ?? false,
    role: permissions?.role ?? null,
    isLoading: permissions === undefined && !!user && !!activeOrganization,
  };

  return (
    <PermissionsContext.Provider value={value}>
      {children}
    </PermissionsContext.Provider>
  );
}

export function usePermissionsContext() {
  const context = useContext(PermissionsContext);
  if (context === undefined) {
    throw new Error(
      "usePermissionsContext must be used within a PermissionsProvider"
    );
  }
  return context;
}
