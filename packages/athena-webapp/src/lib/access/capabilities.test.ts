import { describe, expect, it } from "vitest";

import {
  canAccessFullAdminSurface,
  canAccessStoreDaySurface,
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

  it("allows active manager elevation to unlock only store-day surfaces", () => {
    expect(
      canAccessStoreDaySurface({
        role: "pos_only",
        activeManagerElevation: activeElevation,
      }),
    ).toBe(true);
    expect(canAccessStoreDaySurface({ role: "full_admin" })).toBe(true);
    expect(canAccessStoreDaySurface({ role: "pos_only" })).toBe(false);
  });

  it("keeps excluded admin surfaces full-admin only", () => {
    const elevatedPosOnly = {
      role: "pos_only" as const,
      activeManagerElevation: activeElevation,
    };

    expect(getSurfaceAccess("cash_controls", elevatedPosOnly)).toBe(true);
    expect(getSurfaceAccess("daily_operations", elevatedPosOnly)).toBe(true);
    expect(getSurfaceAccess("open_work", elevatedPosOnly)).toBe(true);
    expect(getSurfaceAccess("approvals", elevatedPosOnly)).toBe(true);
    expect(getSurfaceAccess("stock_adjustments", elevatedPosOnly)).toBe(true);

    expect(getSurfaceAccess("procurement", elevatedPosOnly)).toBe(false);
    expect(getSurfaceAccess("analytics", elevatedPosOnly)).toBe(false);
    expect(getSurfaceAccess("configuration", elevatedPosOnly)).toBe(false);
    expect(getSurfaceAccess("members", elevatedPosOnly)).toBe(false);
    expect(getSurfaceAccess("storefront_admin", elevatedPosOnly)).toBe(false);
    expect(getSurfaceAccess("bulk_operations", elevatedPosOnly)).toBe(false);
    expect(getSurfaceAccess("promo_codes", elevatedPosOnly)).toBe(false);
    expect(getSurfaceAccess("reviews_admin", elevatedPosOnly)).toBe(false);
    expect(getSurfaceAccess("services_admin", elevatedPosOnly)).toBe(false);
  });
});
