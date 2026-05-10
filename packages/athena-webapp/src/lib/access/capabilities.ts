import type { ManagerElevation } from "@/contexts/ManagerElevationContext";
import type { Role } from "~/types";

export function canAccessFullAdminSurface({ role }: { role: Role | null }) {
  return role === "full_admin";
}

export function canAccessStoreDaySurface({
  activeManagerElevation,
  role,
}: {
  activeManagerElevation: ManagerElevation | null;
  role: Role | null;
}) {
  return role === "full_admin" || Boolean(activeManagerElevation);
}
