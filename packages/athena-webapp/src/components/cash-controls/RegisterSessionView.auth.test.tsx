import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "~/convex/_generated/dataModel";

import { RegisterSessionView } from "./RegisterSessionView";

const mockedHooks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useMutation: vi.fn(),
  useProtectedAdminPageState: vi.fn(),
  useQuery: vi.fn(),
  useParams: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useMutation: mockedHooks.useMutation,
  useQuery: mockedHooks.useQuery,
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params: _params,
    to,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    params?: unknown;
    to?: string;
  }) => (
    <a href={to ?? "#"} {...props}>
      {children}
    </a>
  ),
  useParams: mockedHooks.useParams,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: mockedHooks.useAuth,
}));

vi.mock("@/hooks/useProtectedAdminPageState", () => ({
  useProtectedAdminPageState: mockedHooks.useProtectedAdminPageState,
}));

vi.mock("../common/PageHeader", () => ({
  SimplePageHeader: ({ title }: { title: string }) => <div>{title}</div>,
}));

const readyProtectedState = {
  activeStore: { _id: "store-1" as Id<"store">, currency: "USD" },
  canQueryProtectedData: true,
  hasFullAdminAccess: true,
  isAuthenticated: true,
  isLoadingAccess: false,
};

describe("RegisterSessionView auth readiness", () => {
  beforeEach(() => {
    window.scrollTo = vi.fn();
    vi.clearAllMocks();
    mockedHooks.useAuth.mockReturnValue({
      isLoading: false,
      user: { _id: "user-1" as Id<"athenaUser"> },
    });
    mockedHooks.useProtectedAdminPageState.mockReturnValue(readyProtectedState);
    mockedHooks.useParams.mockReturnValue({
      orgUrlSlug: "v26",
      sessionId: "session-1",
      storeUrlSlug: "east-legon",
    });
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

    render(<RegisterSessionView />);

    expect(screen.getByText("Loading register session...")).toBeInTheDocument();
    expect(mockedHooks.useQuery.mock.calls.map(([, args]) => args)).toEqual([
      "skip",
    ]);
  });

  it("renders a sign-in fallback instead of subscribing when Convex auth is missing", () => {
    mockedHooks.useProtectedAdminPageState.mockReturnValue({
      ...readyProtectedState,
      canQueryProtectedData: false,
      isAuthenticated: false,
    });

    render(<RegisterSessionView />);

    expect(screen.getByText("Sign in required")).toBeInTheDocument();
    expect(mockedHooks.useQuery.mock.calls.map(([, args]) => args)).toEqual([
      "skip",
    ]);
  });

  it("subscribes to the register session once the shared admin gate is ready", () => {
    mockedHooks.useQuery.mockReturnValue(undefined);

    render(<RegisterSessionView />);

    expect(mockedHooks.useQuery.mock.calls.map(([, args]) => args)).toEqual([
      {
        registerSessionId: "session-1",
        storeId: "store-1",
      },
    ]);
  });
});
