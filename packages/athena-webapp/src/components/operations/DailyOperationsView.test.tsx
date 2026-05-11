import { fireEvent, render, screen, within } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DailyOperationsView,
  DailyOperationsViewContent,
  type DailyOperationsSnapshot,
} from "./DailyOperationsView";
import type { Id } from "~/convex/_generated/dataModel";

const mockedHooks = vi.hoisted(() => ({
  navigate: vi.fn(),
  useSearch: vi.fn(),
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
  useNavigate: () => mockedHooks.navigate,
  useSearch: mockedHooks.useSearch,
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

const weekMetrics = [
  {
    currentDayCashTotal: 0,
    currentDayCashTransactionCount: 0,
    expenseTotal: 0,
    expenseTransactionCount: 0,
    isClosed: true,
    isSelected: false,
    operatingDate: "2026-05-03",
    salesTotal: 70000,
    transactionCount: 1,
  },
  {
    currentDayCashTotal: 0,
    currentDayCashTransactionCount: 0,
    expenseTotal: 0,
    expenseTransactionCount: 0,
    isClosed: true,
    isSelected: false,
    operatingDate: "2026-05-04",
    salesTotal: 0,
    transactionCount: 0,
  },
  {
    currentDayCashTotal: 0,
    currentDayCashTransactionCount: 0,
    expenseTotal: 0,
    expenseTransactionCount: 0,
    isClosed: true,
    isSelected: false,
    operatingDate: "2026-05-05",
    salesTotal: 98000,
    transactionCount: 2,
  },
  {
    currentDayCashTotal: 0,
    currentDayCashTransactionCount: 0,
    expenseTotal: 0,
    expenseTransactionCount: 0,
    isClosed: false,
    isSelected: false,
    operatingDate: "2026-05-06",
    salesTotal: 0,
    transactionCount: 0,
  },
  {
    currentDayCashTotal: 0,
    currentDayCashTransactionCount: 0,
    expenseTotal: 0,
    expenseTransactionCount: 0,
    isClosed: false,
    isSelected: false,
    operatingDate: "2026-05-07",
    salesTotal: 45000,
    transactionCount: 1,
  },
  {
    currentDayCashTotal: 349100,
    currentDayCashTransactionCount: 2,
    expenseTotal: 19800,
    expenseTransactionCount: 1,
    isClosed: false,
    isSelected: true,
    operatingDate: "2026-05-08",
    salesTotal: 1533100,
    transactionCount: 3,
  },
  {
    currentDayCashTotal: 0,
    currentDayCashTransactionCount: 0,
    expenseTotal: 0,
    expenseTransactionCount: 0,
    isClosed: false,
    isSelected: false,
    operatingDate: "2026-05-09",
    salesTotal: 0,
    transactionCount: 0,
  },
] satisfies DailyOperationsSnapshot["weekMetrics"];

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
      label: "EOD Review",
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
      "Opening Handoff is complete and the end of day review has no blockers.",
    label: "Ready to close",
    status: "ready_to_close",
  },
  operatingDate: "2026-05-08",
  primaryAction: {
    label: "Start EOD Review",
    to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
  },
  storeId: "store-1" as Id<"store">,
  timeline: [],
  weekMetrics,
};

const blockedSnapshot: DailyOperationsSnapshot = {
  ...operatingSnapshot,
  attentionItems: [
    {
      id: "register_session:register-1:open",
      label: "Register session is still open",
      message: "Close the register session before completing the end of day review.",
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

const notOpenedSnapshot: DailyOperationsSnapshot = {
  ...operatingSnapshot,
  lifecycle: {
    description: "Start Opening Handoff before running the store day.",
    label: "Not opened",
    status: "not_opened",
  },
  primaryAction: {
    label: "Start Opening Handoff",
    to: "/$orgUrlSlug/store/$storeUrlSlug/operations/opening",
  },
};

const closedSnapshot: DailyOperationsSnapshot = {
  ...operatingSnapshot,
  lanes: operatingSnapshot.lanes.map((lane) =>
    lane.key === "close"
      ? {
          ...lane,
          description: "The end of day review is saved for this store day.",
          status: "closed",
        }
      : lane,
  ),
  lifecycle: {
    description: "The store day has a saved close summary.",
    label: "Closed",
    status: "closed",
  },
  primaryAction: {
    label: "Review EOD Review",
    to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
  },
  timeline: [
    {
      createdAt: Date.UTC(2026, 4, 8, 22),
      id: "event-close",
      message: "EOD Review completed.",
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

function getCurrentLocalOperatingDate() {
  const date = new Date();
  const localDate = new Date(
    date.getTime() - date.getTimezoneOffset() * 60_000,
  );

  return localDate.toISOString().slice(0, 10);
}

function getCurrentSaturdayWeekEndOperatingDate() {
  const date = new Date();
  const weekEndDate = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + (6 - date.getDay()),
  );
  const localDate = new Date(
    weekEndDate.getTime() - weekEndDate.getTimezoneOffset() * 60_000,
  );

  return localDate.toISOString().slice(0, 10);
}

function shiftTestOperatingDate(operatingDate: string, offsetDays: number) {
  const [year, month, day] = operatingDate.split("-").map(Number);
  const date = new Date(year, month - 1, day + offsetDays);
  const localDate = new Date(
    date.getTime() - date.getTimezoneOffset() * 60_000,
  );

  return localDate.toISOString().slice(0, 10);
}

function formatTestOperatingDate(operatingDate: string) {
  const [year, month, day] = operatingDate.split("-").map(Number);

  return new Date(year, month - 1, day).toLocaleDateString([], {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

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
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 10, 12));
    window.scrollTo = vi.fn();
    window.history.pushState({}, "", "/wigclub/store/osu/operations");
    mockedHooks.navigate.mockReset();
    mockedHooks.useSearch.mockReturnValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders historical metrics with view-only workflow messaging", () => {
    renderContent(operatingSnapshot);

    expect(
      screen.getByRole("heading", { name: "Daily Operations" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Net sales")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open transactions" }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/osu/pos/transactions?o=%252Fwigclub%252Fstore%252Fosu%252Foperations&operatingDate=2026-05-08",
    );
    expect(screen.getAllByText("GH₵15,331")).not.toHaveLength(0);
    expect(screen.getAllByText("3 transactions")).not.toHaveLength(0);
    expect(screen.getByText("Cash")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open cash transactions" }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/osu/pos/transactions?o=%252Fwigclub%252Fstore%252Fosu%252Foperations&operatingDate=2026-05-08&paymentMethod=cash",
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
      screen.getByRole("heading", { name: "Week at a glance" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Week sales")).toBeInTheDocument();
    expect(screen.getByText("GH₵17,461")).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: "Previous week, seven days ending May 2, 2026",
      }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/osu/operations?operatingDate=2026-04-26&weekEndOperatingDate=2026-05-02",
    );
    expect(
      screen.getByRole("link", {
        name: "Next week, seven days ending May 16, 2026",
      }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/osu/operations?weekEndOperatingDate=2026-05-16",
    );
    expect(
      screen.getByRole("link", { name: "View May 7, 2026 operations" }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/osu/operations?operatingDate=2026-05-07&weekEndOperatingDate=2026-05-09",
    );
    expect(
      screen.getByRole("link", { name: "View May 6, 2026 operations" }),
    ).not.toContainHTML("width:");
    expect(
      screen.getByRole("link", { name: "View May 8, 2026 operations" }),
    ).toHaveAttribute("aria-current", "date");
    expect(
      screen.getByRole("button", {
        name: "Change operating date, currently Friday, May 8, 2026",
      }),
    ).toBeDisabled();
    expect(
      screen.queryByRole("link", { name: "Start EOD Review" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Historical store-day view" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "This historical operating date is view-only. Workflow actions are available only on the current operating date.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Metrics and timeline remain available for this historical day.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Workflow status")).not.toBeInTheDocument();
    expect(screen.queryByText("Current day only")).not.toBeInTheDocument();
    expect(screen.queryByText("Needs attention")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Open Opening" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Open EOD Review" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Open Open work" }),
    ).not.toBeInTheDocument();
  });

  it("uses today labels and current-day transaction links for the current operating date", () => {
    renderContent({
      ...operatingSnapshot,
      operatingDate: getCurrentLocalOperatingDate(),
    });

    expect(screen.getByText("Today's net sales")).toBeInTheDocument();
    expect(screen.getByText("Today's cash")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open transactions" }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/osu/pos/transactions?o=%252Fwigclub%252Fstore%252Fosu%252Foperations",
    );
    expect(
      screen.getByRole("link", { name: "Open cash transactions" }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/osu/pos/transactions?o=%252Fwigclub%252Fstore%252Fosu%252Foperations&paymentMethod=cash",
    );
    expect(
      screen.getByRole("link", { name: "Start EOD Review" }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/osu/operations/daily-close?o=%252Fwigclub%252Fstore%252Fosu%252Foperations",
    );
    expect(screen.queryByText("Current day only")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Opening ready")).toBeInTheDocument();
    expect(
      screen.getByLabelText("EOD Review ready"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Open work ready")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Opening" })).toHaveAttribute(
      "href",
      "/wigclub/store/osu/operations/opening?o=%252Fwigclub%252Fstore%252Fosu%252Foperations",
    );
    expect(
      screen.getByRole("link", { name: "Open EOD Review" }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/osu/operations/daily-close?o=%252Fwigclub%252Fstore%252Fosu%252Foperations",
    );
    expect(screen.getByRole("link", { name: "Open Open work" })).toHaveAttribute(
      "href",
      "/wigclub/store/osu/operations/open-work?o=%252Fwigclub%252Fstore%252Fosu%252Foperations",
    );
  });

  it("incorporates workflow lane counts into the description", () => {
    renderContent({
      ...operatingSnapshot,
      lanes: [
        ...operatingSnapshot.lanes,
        {
          count: 2,
          countLabel: "2 registers",
          description: "2 registers need attention before close.",
          key: "registers",
          label: "Registers",
          status: "blocked",
          to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
        },
      ],
      operatingDate: getCurrentLocalOperatingDate(),
    });

    const workflowSection = screen
      .getByRole("heading", { name: "Workflow status" })
      .closest("section");

    expect(workflowSection).not.toBeNull();
    const workflow = within(workflowSection!);

    expect(workflow.queryByText("0")).not.toBeInTheDocument();
    expect(workflow.queryByText("2 registers")).not.toBeInTheDocument();
    expect(
      workflow.getByText("2 registers need attention before close."),
    ).toBeInTheDocument();
  });

  it("uses compact icons for workflow lanes that need attention or are blocked", () => {
    renderContent({
      ...operatingSnapshot,
      lanes: [
        {
          ...operatingSnapshot.lanes[0],
          status: "ready",
        },
        {
          ...operatingSnapshot.lanes[1],
          description: "EOD Review was reopened and needs a revised close.",
          status: "needs_attention",
        },
        {
          count: 2,
          description: "2 registers need attention before close.",
          key: "registers",
          label: "Registers",
          status: "blocked",
          to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
        },
      ],
      operatingDate: getCurrentLocalOperatingDate(),
    });

    expect(screen.getByLabelText("Opening ready")).toBeInTheDocument();
    expect(
      screen.getByLabelText("EOD Review needs attention"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Registers blocked")).toBeInTheDocument();
    expect(screen.queryByText("Needs attention")).not.toBeInTheDocument();
    expect(screen.queryByText("Blocked")).not.toBeInTheDocument();
  });

  it("marks reopened operating days in the week strip", () => {
    renderContent({
      ...operatingSnapshot,
      operatingDate: getCurrentLocalOperatingDate(),
      weekMetrics: [
        {
          ...weekMetrics[0],
          isClosed: false,
          isReopened: true,
          isSelected: true,
          operatingDate: getCurrentLocalOperatingDate(),
        },
      ],
    });

    expect(screen.getByText("Reopened")).toBeInTheDocument();
    expect(screen.queryByText("Closed")).not.toBeInTheDocument();
  });

  it("disables future dates in the week strip", () => {
    const currentOperatingDate = getCurrentLocalOperatingDate();
    const futureOperatingDate = shiftTestOperatingDate(currentOperatingDate, 1);
    const futureDateLabel = formatTestOperatingDate(futureOperatingDate);

    renderContent({
      ...operatingSnapshot,
      operatingDate: currentOperatingDate,
      weekMetrics: [
        {
          ...weekMetrics[0],
          isClosed: false,
          isSelected: true,
          operatingDate: currentOperatingDate,
          salesTotal: 748500,
          transactionCount: 1,
        },
        {
          ...weekMetrics[1],
          isClosed: false,
          isSelected: false,
          operatingDate: futureOperatingDate,
          salesTotal: 0,
          transactionCount: 0,
        },
      ],
    });

    expect(
      screen.queryByRole("link", {
        name: `View ${futureDateLabel} operations`,
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByLabelText(`${futureDateLabel} operations unavailable`),
    ).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("-")).toBeInTheDocument();
    expect(screen.getByText("Upcoming")).toBeInTheDocument();
  });

  it("disables historical start actions that would mutate the store day", () => {
    renderContent(notOpenedSnapshot);

    expect(
      screen.queryByRole("link", { name: "Start Opening Handoff" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Historical store-day view" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "This historical operating date is view-only. Workflow actions are available only on the current operating date.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Needs attention")).not.toBeInTheDocument();
    expect(screen.queryByText("Workflow status")).not.toBeInTheDocument();
  });

  it("keeps current-day opening actions available", () => {
    renderContent({
      ...notOpenedSnapshot,
      operatingDate: getCurrentLocalOperatingDate(),
    });

    expect(
      screen.getByRole("link", { name: "Start Opening Handoff" }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/osu/operations/opening?o=%252Fwigclub%252Fstore%252Fosu%252Foperations",
    );
  });

  it("passes origin context to current-day blocker review actions", () => {
    renderContent({
      ...blockedSnapshot,
      operatingDate: getCurrentLocalOperatingDate(),
    });

    expect(
      screen.getByRole("link", { name: "Review close blockers" }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/osu/operations/daily-close?o=%252Fwigclub%252Fstore%252Fosu%252Foperations",
    );
    expect(
      screen.getByRole("link", { name: "Open Registers" }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/osu/operations/daily-close?o=%252Fwigclub%252Fstore%252Fosu%252Foperations",
    );
  });

  it("keeps attention items out of the right rail", () => {
    renderContent(blockedSnapshot);

    expect(
      screen.queryByRole("link", { name: "Review close blockers" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Historical store-day view" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Operator attention")).not.toBeInTheDocument();
    expect(screen.queryByText("Register session is still open")).not.toBeInTheDocument();
  });

  it("keeps historical EOD Review links on the selected operating date", () => {
    renderContent(closedSnapshot);

    expect(
      screen.getByRole("heading", { name: "Closed store-day record" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        "This operating date is closed. The saved The end of day review is available for this store-day record.",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "Metrics and timeline remain available for this historical day.",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Review EOD Review" }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/osu/operations/daily-close?o=%252Fwigclub%252Fstore%252Fosu%252Foperations&operatingDate=2026-05-08",
    );
    expect(screen.queryByText("Workflow status")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Open EOD Review" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "Open EOD Review unavailable for May 8, 2026",
      }),
    ).not.toBeInTheDocument();
  });

  it("renders closed-day review timeline without mutation copy", () => {
    renderContent(closedSnapshot);

    expect(
      screen.getByRole("link", { name: "Review EOD Review" }),
    ).toBeInTheDocument();
    expect(screen.getByText("EOD Review completed.")).toBeInTheDocument();
    expect(
      screen.getByText("Store day acknowledged for May 8, 2026."),
    ).toBeInTheDocument();
    expect(screen.queryByText("2026-05-08")).not.toBeInTheDocument();
    expect(screen.queryByText("Complete EOD Review")).not.toBeInTheDocument();
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
    expect(
      screen.getByText("All recorded events for Friday, May 8, 2026."),
    ).toBeInTheDocument();
    expect(screen.getByText("Timeline event 6")).toBeInTheDocument();
    expect(screen.getByText("Timeline event 12")).toBeInTheDocument();
  });

  it("leaves content empty while the store-day snapshot loads", () => {
    const { container } = renderContent(undefined);

    expect(
      screen.getByRole("heading", { name: "Daily Operations" }),
    ).toBeInTheDocument();
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(0);
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
    mockedHooks.navigate.mockReset();
    mockedHooks.useSearch.mockReturnValue({});
  });

  it("queries the daily operations snapshot for the active store", () => {
    render(<DailyOperationsView />);

    expect(mockedHooks.useQuery).toHaveBeenCalledWith(
      mockedApi.getDailyOperationsSnapshot,
      expect.objectContaining({
        operatingTimezoneOffsetMinutes: expect.any(Number),
        storeId: "store-1",
        weekEndOperatingDate: getCurrentSaturdayWeekEndOperatingDate(),
      }),
    );
    expect(
      screen.getByRole("heading", { name: "Historical store-day view" }),
    ).toBeInTheDocument();
  });

  it("queries the daily operations snapshot for the route operating date", () => {
    mockedHooks.useSearch.mockReturnValue({
      operatingDate: "2026-05-07",
      weekEndOperatingDate: "2026-05-08",
    });

    render(<DailyOperationsView />);

    expect(mockedHooks.useQuery).toHaveBeenCalledWith(
      mockedApi.getDailyOperationsSnapshot,
      expect.objectContaining({
        operatingDate: "2026-05-07",
        operatingTimezoneOffsetMinutes: new Date(2026, 4, 7).getTimezoneOffset(),
        storeId: "store-1",
        weekEndOperatingDate: "2026-05-09",
      }),
    );
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
