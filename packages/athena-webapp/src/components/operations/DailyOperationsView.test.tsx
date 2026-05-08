import { fireEvent, render, screen, within } from "@testing-library/react";
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
  closeSummary: {
    carriedOverCashTotal: 0,
    carriedOverRegisterCount: 0,
    currentDayCashTotal: 349100,
    currentDayCashTransactionCount: 2,
    expenseTotal: 19800,
    expenseTransactionCount: 1,
    netCashVariance: 0,
    registerVarianceCount: 0,
    salesTotal: 1533100,
    transactionCount: 3,
  },
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
      label: "End-of-Day Review",
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
    description:
      "Opening Handoff is complete and End-of-Day Review has no blockers.",
    label: "Ready to close",
    status: "ready_to_close",
  },
  operatingDate: "2026-05-08",
  primaryAction: {
    label: "Start End-of-Day Review",
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
      message: "Close the register session before completing End-of-Day Review.",
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
    label: "Close has blockers",
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
    label: "Review End-of-Day Review",
    to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
  },
  timeline: [
    {
      createdAt: Date.UTC(2026, 4, 8, 22),
      id: "event-close",
      message: "End-of-Day Review completed.",
      subject: {
        id: "close-1",
        type: "daily_close",
      },
      type: "daily_close.completed",
    },
    {
      createdAt: Date.UTC(2026, 4, 8, 8),
      id: "event-open",
      message: "Store day acknowledged for 2026-05-08.",
      subject: {
        id: "opening-1",
        type: "daily_opening",
      },
      type: "daily_opening.started",
    },
  ],
};

const timelineOverflowSnapshot: DailyOperationsSnapshot = {
  ...operatingSnapshot,
  timeline: Array.from({ length: 12 }, (_, index) => ({
    createdAt: Date.UTC(2026, 4, 8, 12, index),
    id: `event-${index + 1}`,
    message: `Timeline event ${index + 1}`,
    subject: {
      id: `subject-${index + 1}`,
      type: "operations",
    },
    type: "operations.event",
  })),
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
    window.history.pushState({}, "", "/wigclub/store/osu/operations");
  });

  it("renders store-day posture, primary action, and lanes", () => {
    renderContent(operatingSnapshot);

    expect(
      screen.getByRole("heading", { name: "Daily Operations" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Today's net sales")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open transactions" })).toHaveAttribute(
      "href",
      "/wigclub/store/osu/pos/transactions?o=%252Fwigclub%252Fstore%252Fosu%252Foperations",
    );
    expect(screen.getByText("GH₵15,331")).toBeInTheDocument();
    expect(screen.getByText("3 transactions")).toBeInTheDocument();
    expect(screen.getByText("Today's cash")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open cash transactions" }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/osu/pos/transactions?o=%252Fwigclub%252Fstore%252Fosu%252Foperations&paymentMethod=cash",
    );
    expect(screen.getByText("GH₵3,491")).toBeInTheDocument();
    expect(screen.getByText("2 cash transactions")).toBeInTheDocument();
    expect(screen.getByText("Carried-over cash")).toBeInTheDocument();
    expect(screen.getAllByText("GH₵0")).not.toHaveLength(0);
    expect(screen.getByText("No registers from prior days")).toBeInTheDocument();
    expect(screen.getByText("Expenses")).toBeInTheDocument();
    expect(screen.getByText("GH₵198")).toBeInTheDocument();
    expect(screen.getByText("1 expense transaction")).toBeInTheDocument();
    expect(screen.getByText("Variance")).toBeInTheDocument();
    expect(screen.getByText("No register variances")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Start End-of-Day Review" }),
    ).toHaveAttribute("href", "/wigclub/store/osu/operations/daily-close");
    expect(screen.getByText("Opening")).toBeInTheDocument();
    expect(screen.getByText("End-of-Day Review")).toBeInTheDocument();
    expect(screen.getByText("Open work")).toBeInTheDocument();
  });

  it("keeps attention items out of the right rail", () => {
    renderContent(blockedSnapshot);

    expect(
      screen.getByRole("link", { name: "Review close blockers" }),
    ).toHaveAttribute("href", "/wigclub/store/osu/operations/daily-close");
    expect(screen.queryByLabelText("Operator attention")).not.toBeInTheDocument();
    expect(screen.queryByText("Register session is still open")).not.toBeInTheDocument();
  });

  it("renders closed-day review timeline without mutation copy", () => {
    renderContent(closedSnapshot);

    expect(
      screen.getByRole("link", { name: "Review End-of-Day Review" }),
    ).toBeInTheDocument();
    expect(screen.getByText("End-of-Day Review completed.")).toBeInTheDocument();
    expect(
      screen.getByText("Store day acknowledged for May 8, 2026."),
    ).toBeInTheDocument();
    expect(screen.queryByText("2026-05-08")).not.toBeInTheDocument();
    expect(screen.queryByText("Complete End-of-Day Review")).not.toBeInTheDocument();
  });

  it("previews the five most recent timeline events and opens the full list in a sheet", () => {
    renderContent(timelineOverflowSnapshot);

    const timeline = screen.getByRole("region", {
      name: "Store-day timeline",
    });

    expect(within(timeline).getByText("Timeline event 1")).toBeInTheDocument();
    expect(within(timeline).getByText("Timeline event 5")).toBeInTheDocument();
    expect(
      within(timeline).queryByText("Timeline event 6"),
    ).not.toBeInTheDocument();

    fireEvent.click(within(timeline).getByRole("button", { name: "Show more" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getAllByText("Store-day timeline")).not.toHaveLength(0);
    expect(screen.getByText("Timeline event 6")).toBeInTheDocument();
    expect(screen.getByText("Timeline event 12")).toBeInTheDocument();
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
    expect(
      screen.getByRole("link", { name: "Start End-of-Day Review" }),
    ).toBeInTheDocument();
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
