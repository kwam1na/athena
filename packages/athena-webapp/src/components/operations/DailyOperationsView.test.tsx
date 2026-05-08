import { render, screen, within } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DailyOperationsView,
  DailyOperationsViewContent,
  type DailyOperationsSnapshot,
} from "./DailyOperationsView";
import type { Id } from "~/convex/_generated/dataModel";

const mockedHooks = vi.hoisted(() => ({
  useProtectedAdminPageState: vi.fn(),
  useQuery: vi.fn(),
}));

const mockedApi = vi.hoisted(() => ({
  getDailyOperationsSnapshot: "getDailyOperationsSnapshot",
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    search,
    to,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    children: ReactNode;
    params?: Record<string, string>;
    search?: Record<string, string>;
    to?: string;
  }) => {
    const path = to
      ? Object.entries(params ?? {}).reduce(
          (currentPath, [key, value]) =>
            currentPath.replace(`$${key}`, String(value)),
          to,
        )
      : "#";
    const searchParams = search ? `?${new URLSearchParams(search)}` : "";

    return (
      <a href={`${path}${searchParams}`} {...props}>
        {children}
      </a>
    );
  },
  useParams: () => ({
    orgUrlSlug: "wigclub",
    storeUrlSlug: "osu",
  }),
}));

vi.mock("convex/react", () => ({
  useQuery: mockedHooks.useQuery,
}));

vi.mock("@/hooks/useProtectedAdminPageState", () => ({
  useProtectedAdminPageState: mockedHooks.useProtectedAdminPageState,
}));

vi.mock("~/convex/_generated/api", () => ({
  api: {
    operations: {
      dailyOperations: mockedApi,
    },
  },
}));

const operatingSnapshot: DailyOperationsSnapshot = {
  attentionItems: [],
  currency: "GHS",
  lanes: [
    {
      count: 0,
      description: "Opening handoff is complete.",
      key: "opening",
      label: "Opening",
      status: "ready",
      to: "/$orgUrlSlug/store/$storeUrlSlug/operations/opening",
    },
    {
      count: 0,
      description: "No close blockers are active.",
      key: "close",
      label: "Daily Close",
      status: "ready",
      to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
    },
    {
      count: 0,
      description: "No open queue work.",
      key: "queue",
      label: "Open work",
      status: "ready",
      to: "/$orgUrlSlug/store/$storeUrlSlug/operations/open-work",
    },
  ],
  lifecycle: {
    description: "Opening is complete and Daily Close has no blockers.",
    label: "Ready to close",
    status: "ready_to_close",
  },
  operatingDate: "2026-05-08",
  primaryAction: {
    label: "Start Daily Close",
    to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
  },
  storeId: "store-1" as Id<"store">,
  timeline: [],
};

const blockedSnapshot: DailyOperationsSnapshot = {
  ...operatingSnapshot,
  attentionItems: [
    {
      id: "register_session:register-1:open",
      label: "Register session is still open",
      message: "Close the register session before completing Daily Close.",
      owner: "daily_close",
      severity: "critical",
      source: {
        id: "register-1",
        label: "Register 1",
        type: "register_session",
      },
      to: "/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId",
      params: { sessionId: "register-1" },
    },
  ],
  lanes: [
    ...operatingSnapshot.lanes,
    {
      count: 1,
      description: "1 register needs attention before close.",
      key: "registers",
      label: "Registers",
      status: "blocked",
      to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
    },
  ],
  lifecycle: {
    description: "Resolve close blockers before ending the store day.",
    label: "Close blocked",
    status: "close_blocked",
  },
  primaryAction: {
    label: "Review close blockers",
    to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
  },
};

const closedSnapshot: DailyOperationsSnapshot = {
  ...operatingSnapshot,
  lifecycle: {
    description: "The store day has a saved close summary.",
    label: "Closed",
    status: "closed",
  },
  primaryAction: {
    label: "Review Daily Close",
    to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
  },
  timeline: [
    {
      createdAt: Date.UTC(2026, 4, 8, 22),
      id: "event-close",
      message: "Daily Close completed.",
      subject: {
        id: "close-1",
        type: "daily_close",
      },
      type: "daily_close.completed",
    },
    {
      createdAt: Date.UTC(2026, 4, 8, 8),
      id: "event-open",
      message: "Store day started.",
      subject: {
        id: "opening-1",
        type: "daily_opening",
      },
      type: "daily_opening.started",
    },
  ],
};

function renderContent(
  snapshot: DailyOperationsSnapshot | undefined,
  overrides: Partial<
    React.ComponentProps<typeof DailyOperationsViewContent>
  > = {},
) {
  return render(
    <DailyOperationsViewContent
      currency="GHS"
      hasFullAdminAccess
      isAuthenticated
      isLoadingAccess={false}
      isLoadingSnapshot={snapshot === undefined}
      orgUrlSlug="wigclub"
      snapshot={snapshot}
      storeUrlSlug="osu"
      {...overrides}
    />,
  );
}

describe("DailyOperationsViewContent", () => {
  beforeEach(() => {
    window.scrollTo = vi.fn();
  });

  it("renders store-day posture, primary action, and lanes", () => {
    renderContent(operatingSnapshot);

    expect(
      screen.getByRole("heading", { name: "Daily Operations" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Ready to close")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Start Daily Close" }),
    ).toHaveAttribute("href", "/wigclub/store/osu/operations/daily-close");
    expect(screen.getByText("Opening")).toBeInTheDocument();
    expect(screen.getByText("Daily Close")).toBeInTheDocument();
    expect(screen.getByText("Open work")).toBeInTheDocument();
  });

  it("keeps attention items source-owned and action-linked", () => {
    renderContent(blockedSnapshot);

    expect(screen.getByText("Close blocked")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Review close blockers" }),
    ).toHaveAttribute("href", "/wigclub/store/osu/operations/daily-close");

    const attention = screen.getByLabelText("Operator attention");
    expect(
      within(attention).getByText("Register session is still open"),
    ).toBeInTheDocument();
    expect(within(attention).getByText("Daily close")).toBeInTheDocument();
    expect(
      within(attention).getByRole("link", {
        name: "Open source for Register session is still open",
      }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/osu/cash-controls/registers/register-1",
    );
  });

  it("renders closed-day review timeline without mutation copy", () => {
    renderContent(closedSnapshot);

    expect(screen.getByText("Closed")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Review Daily Close" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Daily Close completed.")).toBeInTheDocument();
    expect(screen.getByText("Store day started.")).toBeInTheDocument();
    expect(screen.queryByText("Complete Daily Close")).not.toBeInTheDocument();
  });

  it("uses content-shaped loading state while the store-day snapshot loads", () => {
    const { container } = renderContent(undefined);

    expect(
      screen.getByRole("heading", { name: "Daily Operations" }),
    ).toBeInTheDocument();
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(4);
  });

  it("renders access states before showing protected operations data", () => {
    renderContent(undefined, {
      isAuthenticated: false,
      isLoadingSnapshot: false,
    });

    expect(screen.getByText("Sign in required")).toBeInTheDocument();

    renderContent(undefined, {
      hasFullAdminAccess: false,
      isLoadingSnapshot: false,
    });

    expect(screen.getByText("Access Denied")).toBeInTheDocument();
  });
});

describe("DailyOperationsView", () => {
  beforeEach(() => {
    (
      mockedApi as { getDailyOperationsSnapshot?: unknown }
    ).getDailyOperationsSnapshot = "getDailyOperationsSnapshot";
    window.scrollTo = vi.fn();
    mockedHooks.useProtectedAdminPageState.mockReturnValue({
      activeStore: { _id: "store-1", currency: "GHS" },
      canQueryProtectedData: true,
      hasFullAdminAccess: true,
      isAuthenticated: true,
      isLoadingAccess: false,
    });
    mockedHooks.useQuery.mockReturnValue(operatingSnapshot);
  });

  it("queries the daily operations snapshot for the active store", () => {
    render(<DailyOperationsView />);

    expect(mockedHooks.useQuery).toHaveBeenCalledWith(
      mockedApi.getDailyOperationsSnapshot,
      expect.objectContaining({
        storeId: "store-1",
      }),
    );
    expect(screen.getByText("Ready to close")).toBeInTheDocument();
  });

  it("skips the protected query when access is not ready", () => {
    mockedHooks.useProtectedAdminPageState.mockReturnValue({
      activeStore: { _id: "store-1", currency: "GHS" },
      canQueryProtectedData: false,
      hasFullAdminAccess: false,
      isAuthenticated: true,
      isLoadingAccess: false,
    });

    render(<DailyOperationsView />);

    expect(mockedHooks.useQuery).toHaveBeenCalledWith(
      mockedApi.getDailyOperationsSnapshot,
      "skip",
    );
    expect(screen.getByText("Access Denied")).toBeInTheDocument();
  });

  it("shows an operator-facing unavailable state while generated API wiring catches up", () => {
    (
      mockedApi as { getDailyOperationsSnapshot?: unknown }
    ).getDailyOperationsSnapshot = undefined;

    render(<DailyOperationsView />);

    expect(
      screen.getByText("Daily Operations unavailable"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("getDailyOperationsSnapshot"),
    ).not.toBeInTheDocument();
  });
});
