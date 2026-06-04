import { describe, expect, it } from "vitest";

import {
  canAccessFullAdminSurface,
  canAccessStoreDaySurface,
  canViewFinancialDetails,
  getSurfaceAccess,
  type ManagerElevationAccessState,
} from "./capabilities";

const activeElevation: ManagerElevationAccessState = {
  displayName: "Adjoa Mensah",
  staffProfileId: "staff-manager-1",
  startedAt: 1_000,
};

describe("surface capability access", () => {
  it("keeps full-admin access as the only full-admin surface capability", () => {
    expect(canAccessFullAdminSurface({ role: "full_admin" })).toBe(true);
    expect(
      canAccessFullAdminSurface({
        role: "pos_only",
        activeManagerElevation: activeElevation,
      }),
    ).toBe(false);
    expect(
      canAccessFullAdminSurface({
        role: null,
        activeManagerElevation: activeElevation,
      }),
    ).toBe(false);
  });

  it("allows POS-only accounts to open store-day surfaces", () => {
    expect(
      canAccessStoreDaySurface({
        role: "pos_only",
        activeManagerElevation: activeElevation,
      }),
    ).toBe(true);
    expect(canAccessStoreDaySurface({ role: "full_admin" })).toBe(true);
    expect(canAccessStoreDaySurface({ role: "pos_only" })).toBe(true);
    expect(canAccessStoreDaySurface({ role: null })).toBe(false);
  });

  it("keeps excluded admin surfaces full-admin only", () => {
    const posOnly = {
      role: "pos_only" as const,
    };

    expect(getSurfaceAccess("cash_controls", posOnly)).toBe(true);
    expect(getSurfaceAccess("daily_operations", posOnly)).toBe(true);
    expect(getSurfaceAccess("open_work", posOnly)).toBe(true);
    expect(getSurfaceAccess("approvals", posOnly)).toBe(true);
    expect(getSurfaceAccess("stock_adjustments", posOnly)).toBe(true);

    expect(getSurfaceAccess("procurement", posOnly)).toBe(false);
    expect(getSurfaceAccess("analytics", posOnly)).toBe(false);
    expect(getSurfaceAccess("configuration", posOnly)).toBe(false);
    expect(getSurfaceAccess("members", posOnly)).toBe(false);
    expect(getSurfaceAccess("storefront_admin", posOnly)).toBe(false);
    expect(getSurfaceAccess("bulk_operations", posOnly)).toBe(false);
    expect(getSurfaceAccess("promo_codes", posOnly)).toBe(false);
    expect(getSurfaceAccess("reviews_admin", posOnly)).toBe(false);
    expect(getSurfaceAccess("services_admin", posOnly)).toBe(false);
  });

  it("gates financial details to admins or active manager elevation", () => {
    expect(canViewFinancialDetails({ role: "full_admin" })).toBe(true);
    expect(canViewFinancialDetails({ role: "pos_only" })).toBe(false);
    expect(
      canViewFinancialDetails({
        role: "pos_only",
        activeManagerElevation: activeElevation,
      }),
    ).toBe(true);
    expect(canViewFinancialDetails({ role: null })).toBe(false);
  });
});
