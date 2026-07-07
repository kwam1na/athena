import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useProtectedAdminPageState } from "./useProtectedAdminPageState";

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useGetActiveStore: vi.fn(),
  usePermissions: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: mocks.useAuth,
}));

vi.mock("@/hooks/useGetActiveStore", () => ({
  default: mocks.useGetActiveStore,
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: mocks.usePermissions,
}));

describe("useProtectedAdminPageState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useAuth.mockReturnValue({
      isLoading: false,
      user: { _id: "user-1" },
    });
    mocks.useGetActiveStore.mockReturnValue({
      activeStore: { _id: "store-1" },
      isLoadingStores: false,
    });
  });

  it("keeps full-admin as the default protected surface", () => {
    mocks.usePermissions.mockReturnValue({
      hasFullAdminAccess: false,
      hasStoreDaySurfaceAccess: true,
      isLoading: false,
    });

    const { result } = renderHook(() => useProtectedAdminPageState());

    expect(result.current.canAccessProtectedSurface).toBe(false);
    expect(result.current.canQueryProtectedData).toBe(false);
  });

  it("allows active manager elevation to query store-day protected surfaces", () => {
    mocks.usePermissions.mockReturnValue({
      hasFullAdminAccess: false,
      hasStoreDaySurfaceAccess: true,
      isLoading: false,
    });

    const { result } = renderHook(() =>
      useProtectedAdminPageState({ surface: "store_day" }),
    );

    expect(result.current.canAccessProtectedSurface).toBe(true);
    expect(result.current.canQueryProtectedData).toBe(true);
    expect(result.current.hasFullAdminAccess).toBe(false);
  });

  it("requires manager-level access for cash controls", () => {
    mocks.usePermissions.mockReturnValue({
      hasFinancialDetailsAccess: false,
      hasFullAdminAccess: false,
      hasStoreDaySurfaceAccess: true,
      isLoading: false,
    });

    const denied = renderHook(() =>
      useProtectedAdminPageState({ surface: "cash_controls" }),
    );

    expect(denied.result.current.canAccessProtectedSurface).toBe(false);
    expect(denied.result.current.canQueryProtectedData).toBe(false);

    mocks.usePermissions.mockReturnValue({
      hasFinancialDetailsAccess: true,
      hasFullAdminAccess: false,
      hasStoreDaySurfaceAccess: true,
      isLoading: false,
    });

    const elevated = renderHook(() =>
      useProtectedAdminPageState({ surface: "cash_controls" }),
    );

    expect(elevated.result.current.canAccessProtectedSurface).toBe(true);
    expect(elevated.result.current.canQueryProtectedData).toBe(true);
    expect(elevated.result.current.hasFullAdminAccess).toBe(false);
  });
});
