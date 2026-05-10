import type { Role } from "~/types";

export type ManagerElevationAccessState = {
  displayName?: string;
  staffProfileId: string;
  startedAt: number;
} | null;

export type StoreDaySurface =
  | "cash_controls"
  | "daily_operations"
  | "open_work"
  | "approvals"
  | "stock_adjustments";

export type FullAdminSurface =
  | "procurement"
  | "analytics"
  | "configuration"
  | "members"
  | "storefront_admin"
  | "bulk_operations"
  | "promo_codes"
  | "reviews_admin"
  | "services_admin";

export type SurfaceCapability = StoreDaySurface | FullAdminSurface;

type SurfaceAccessContext = {
  activeManagerElevation?: ManagerElevationAccessState;
  role: Role | null;
};

const STORE_DAY_SURFACES = new Set<SurfaceCapability>([
  "cash_controls",
  "daily_operations",
  "open_work",
  "approvals",
  "stock_adjustments",
]);

export function canAccessFullAdminSurface({
  role,
}: SurfaceAccessContext): boolean {
  return role === "full_admin";
}

export function canAccessStoreDaySurface({
  activeManagerElevation,
  role,
}: SurfaceAccessContext): boolean {
  return canAccessFullAdminSurface({ role }) || Boolean(activeManagerElevation);
}

export function getSurfaceAccess(
  surface: SurfaceCapability,
  context: SurfaceAccessContext,
): boolean {
  if (STORE_DAY_SURFACES.has(surface)) {
    return canAccessStoreDaySurface(context);
  }

  return canAccessFullAdminSurface(context);
}
