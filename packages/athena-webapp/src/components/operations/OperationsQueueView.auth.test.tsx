import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "~/convex/_generated/dataModel";

import { OperationsQueueView } from "./OperationsQueueView";

const mockedHooks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useMutation: vi.fn(),
  useProtectedAdminPageState: vi.fn(),
  usePermissions: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useMutation: mockedHooks.useMutation,
  useQuery: mockedHooks.useQuery,
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    search,
    to,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    params?: unknown;
    search?: unknown;
    to?: string;
  }) => {
    void params;
    void search;

    return (
      <a href={to ?? "#"} {...props}>
        {children}
      </a>
    );
  },
  useParams: () => ({
    orgUrlSlug: "wigclub",
    storeUrlSlug: "wigclub",
  }),
  useSearch: () => ({}),
}));

vi.mock("@/hooks/useProtectedAdminPageState", () => ({
  useProtectedAdminPageState: mockedHooks.useProtectedAdminPageState,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: mockedHooks.useAuth,
}));

const readyProtectedState = {
  activeStore: { _id: "store-1" as Id<"store"> },
  canQueryProtectedData: true,
  hasFullAdminAccess: true,
  isAuthenticated: true,
  isLoadingAccess: false,
};

describe("OperationsQueueView auth readiness", () => {
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

    const { container } = render(<OperationsQueueView />);

    expect(container.firstChild).toBeNull();
    expect(screen.queryByText("Loading operations queue...")).not.toBeInTheDocument();
    expect(mockedHooks.useQuery.mock.calls.map(([, args]) => args)).toEqual([
      "skip",
      "skip",
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

    render(<OperationsQueueView />);

    expect(screen.getByText("Sign in required")).toBeInTheDocument();
    expect(mockedHooks.useQuery.mock.calls.map(([, args]) => args)).toEqual([
      "skip",
      "skip",
      "skip",
      "skip",
    ]);
  });

  it("subscribes to protected queries once the shared admin gate is ready", () => {
    mockedHooks.useQuery
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(undefined);

    render(<OperationsQueueView />);

    expect(mockedHooks.useQuery.mock.calls.map(([, args]) => args)).toEqual([
      { storeId: "store-1" },
      { storeId: "store-1" },
      "skip",
      { storeId: "store-1" },
    ]);
  });
});
