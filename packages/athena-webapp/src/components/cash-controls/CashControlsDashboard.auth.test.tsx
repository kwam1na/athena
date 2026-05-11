import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "~/convex/_generated/dataModel";

import { CashControlsDashboard } from "./CashControlsDashboard";

const mockedHooks = vi.hoisted(() => ({
  useProtectedAdminPageState: vi.fn(),
  useQuery: vi.fn(),
  useParams: vi.fn(),
}));

vi.mock("convex/react", () => ({
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
  useParams: mockedHooks.useParams,
}));

vi.mock("@/hooks/useProtectedAdminPageState", () => ({
  useProtectedAdminPageState: mockedHooks.useProtectedAdminPageState,
}));

vi.mock("../common/PageHeader", () => ({
  ComposedPageHeader: ({
    leadingContent,
    trailingContent,
  }: {
    leadingContent: React.ReactNode;
    trailingContent?: React.ReactNode;
  }) => (
    <div>
      <div>{leadingContent}</div>
      <div>{trailingContent}</div>
    </div>
  ),
}));

const readyProtectedState = {
  activeStore: { _id: "store-1" as Id<"store">, currency: "USD" },
  canQueryProtectedData: true,
  hasFullAdminAccess: true,
  isAuthenticated: true,
  isLoadingAccess: false,
};

describe("CashControlsDashboard auth readiness", () => {
  beforeEach(() => {
    window.scrollTo = vi.fn();
    vi.clearAllMocks();
    mockedHooks.useProtectedAdminPageState.mockReturnValue(readyProtectedState);
    mockedHooks.useParams.mockReturnValue({
      orgUrlSlug: "v26",
      storeUrlSlug: "east-legon",
    });
    mockedHooks.useQuery.mockReturnValue(undefined);
  });

  it("skips protected queries while protected auth is still loading", () => {
    mockedHooks.useProtectedAdminPageState.mockReturnValue({
      ...readyProtectedState,
      canQueryProtectedData: false,
      isAuthenticated: false,
      isLoadingAccess: true,
    });

    render(<CashControlsDashboard />);

    expect(
      screen.queryByLabelText("Loading cash controls workspace"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Loading cash controls..."),
    ).not.toBeInTheDocument();
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

    render(<CashControlsDashboard />);

    expect(screen.getByText("Sign in required")).toBeInTheDocument();
    expect(mockedHooks.useQuery.mock.calls.map(([, args]) => args)).toEqual([
      "skip",
    ]);
  });

  it("subscribes to cash-controls data once the shared admin gate is ready", () => {
    render(<CashControlsDashboard />);

    expect(mockedHooks.useQuery.mock.calls.map(([, args]) => args)).toEqual([
      { storeId: "store-1" },
    ]);
  });
});
