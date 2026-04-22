import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "~/convex/_generated/dataModel";

import { ServiceIntakeView } from "./ServiceIntakeView";

const mockedHooks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useMutation: vi.fn(),
  useProtectedAdminPageState: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useMutation: mockedHooks.useMutation,
  useQuery: mockedHooks.useQuery,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: mockedHooks.useAuth,
}));

vi.mock("@/hooks/useProtectedAdminPageState", () => ({
  useProtectedAdminPageState: mockedHooks.useProtectedAdminPageState,
}));

const readyProtectedState = {
  activeStore: { _id: "store-1" as Id<"store"> },
  canQueryProtectedData: true,
  hasFullAdminAccess: true,
  isAuthenticated: true,
  isLoadingAccess: false,
};

describe("ServiceIntakeView auth readiness", () => {
  beforeEach(() => {
    window.scrollTo = vi.fn();
    vi.clearAllMocks();
    mockedHooks.useAuth.mockReturnValue({
      isLoading: false,
      user: { _id: "user-1" as Id<"athenaUser"> },
    });
    mockedHooks.useProtectedAdminPageState.mockReturnValue(readyProtectedState);
    mockedHooks.useMutation.mockReturnValue(vi.fn());
    mockedHooks.useQuery.mockReturnValue(undefined);
  });

  it("skips protected queries while protected auth is still loading", () => {
    mockedHooks.useProtectedAdminPageState.mockReturnValue({
      ...readyProtectedState,
      canQueryProtectedData: false,
      isAuthenticated: false,
      isLoadingAccess: true,
    });

    render(<ServiceIntakeView />);

    expect(screen.getByText("Loading service intake...")).toBeInTheDocument();
    expect(mockedHooks.useQuery.mock.calls.map(([, args]) => args)).toEqual([
      "skip",
      "skip",
    ]);
  });

  it("renders a sign-in fallback instead of subscribing when Convex auth is missing", () => {
    mockedHooks.useProtectedAdminPageState.mockReturnValue({
      ...readyProtectedState,
      canQueryProtectedData: false,
      isAuthenticated: false,
    });

    render(<ServiceIntakeView />);

    expect(screen.getByText("Sign in required")).toBeInTheDocument();
    expect(mockedHooks.useQuery.mock.calls.map(([, args]) => args)).toEqual([
      "skip",
      "skip",
    ]);
  });

  it("subscribes to protected service intake data once the shared admin gate is ready", () => {
    mockedHooks.useQuery
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(undefined);

    render(<ServiceIntakeView />);

    expect(mockedHooks.useQuery.mock.calls.map(([, args]) => args)).toEqual([
      "skip",
      { storeId: "store-1" },
    ]);
  });
});
