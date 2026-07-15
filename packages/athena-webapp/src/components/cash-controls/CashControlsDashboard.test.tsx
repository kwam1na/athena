import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CashControlsDashboardContent,
  prioritizeCashControlsSessionsForTerminal,
} from "./CashControlsDashboard";

describe("prioritizeCashControlsSessionsForTerminal", () => {
  it("places this browser terminal's sessions first without reordering peers", () => {
    const sessions = [
      { _id: "other-1", terminalId: "terminal-other" },
      { _id: "browser-1", terminalId: "terminal-browser" },
      { _id: "other-2", terminalId: "terminal-other" },
      { _id: "browser-2", terminalId: "terminal-browser" },
    ] as never;

    expect(
      prioritizeCashControlsSessionsForTerminal(
        sessions,
        "terminal-browser",
      ).map((session) => session._id),
    ).toEqual(["browser-1", "browser-2", "other-1", "other-2"]);
  });

  it("preserves server order when this browser has no terminal", () => {
    const sessions = [{ _id: "session-1" }, { _id: "session-2" }] as never;

    expect(
      prioritizeCashControlsSessionsForTerminal(sessions).map(
        (session) => session._id,
      ),
    ).toEqual(["session-1", "session-2"]);
  });
});

const mockNavigate = vi.fn();
const mockHooks = vi.hoisted(() => ({
  useIsMobile: vi.fn(() => false),
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
    search?: Record<string, string>;
    to?: string;
  }) => {
    void params;
    const searchParams = search ? `?${new URLSearchParams(search)}` : "";

    return (
      <a href={`${to ?? "#"}${searchParams}`} {...props}>
        {children}
      </a>
    );
  },
  useNavigate: () => mockNavigate,
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
  NavigateBackButton: ({ label = "Back" }: { label?: string }) => (
    <button type="button">{label}</button>
  ),
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: mockHooks.useIsMobile,
}));

const baseSnapshot = {
  openSessions: [] as Array<{
    _id: string;
    countedCash?: number;
    expectedCash: number;
    openedAt: number;
    openingFloat: number;
    pendingApprovalRequest?: {
      _id: string;
      reason?: string | null;
      requestedByStaffName?: string | null;
      status: string;
    } | null;
    registerNumber?: string | null;
    status: string;
    totalDeposited: number;
    variance?: number;
    workflowTraceId?: string | null;
  }>,
  pendingCloseouts: [] as Array<{
    _id: string;
    countedCash?: number;
    expectedCash: number;
    openedAt: number;
    openingFloat: number;
    pendingApprovalRequest?: {
      _id: string;
      reason?: string | null;
      requestedByStaffName?: string | null;
      status: string;
    } | null;
    registerNumber?: string | null;
    status: string;
    totalDeposited: number;
    variance?: number;
    workflowTraceId?: string | null;
  }>,
  recentDeposits: [] as Array<{
    _id: string;
    amount: number;
    notes?: string | null;
    recordedAt: number;
    recordedByStaffName?: string | null;
    reference?: string | null;
    registerNumber?: string | null;
    registerSessionId?: string | null;
  }>,
  registerSessions: [] as Array<{
    _id: string;
    closedAt?: number;
    countedCash?: number;
    expectedCash: number;
    openedAt: number;
    openingFloat: number;
    pendingApprovalRequest?: {
      _id: string;
      reason?: string | null;
      requestedByStaffName?: string | null;
      status: string;
    } | null;
    registerNumber?: string | null;
    status: string;
    totalDeposited: number;
    variance?: number;
    workflowTraceId?: string | null;
  }>,
  unresolvedVariances: [] as Array<{
    _id: string;
    countedCash?: number;
    expectedCash: number;
    openedAt: number;
    openingFloat: number;
    pendingApprovalRequest?: {
      _id: string;
      reason?: string | null;
      requestedByStaffName?: string | null;
      status: string;
    } | null;
    registerNumber?: string | null;
    status: string;
    totalDeposited: number;
    variance?: number;
    workflowTraceId?: string | null;
  }>,
};

describe("CashControlsDashboardContent", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockHooks.useIsMobile.mockReset();
    mockHooks.useIsMobile.mockReturnValue(false);
    window.scrollTo = vi.fn();
  });

  it("shows only the cash controls header while the dashboard snapshot is loading", () => {
    render(
      <CashControlsDashboardContent
        currency="USD"
        dashboardSnapshot={baseSnapshot}
        isLoading
        orgUrlSlug="v26"
        storeUrlSlug="east-legon"
      />,
    );

    expect(screen.getByText("Cash controls")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Track live drawers, review deposited totals, and move into session detail before shifting work into closeouts.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Loading cash controls workspace"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Loading cash controls..."),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Current control snapshot")).not.toBeInTheDocument();
  });

  it("visually groups drawers linked to this browser's terminal", () => {
    render(
      <CashControlsDashboardContent
        browserTerminalId="terminal-browser"
        currency="USD"
        dashboardSnapshot={{
          ...baseSnapshot,
          registerSessions: [
            {
              _id: "session-other",
              expectedCash: 20000,
              openedAt: new Date("2026-04-21T09:00:00.000Z").getTime(),
              openingFloat: 10000,
              registerNumber: "200002",
              status: "active",
              terminalId: "terminal-other",
              totalDeposited: 0,
            },
            {
              _id: "session-browser",
              expectedCash: 30000,
              openedAt: new Date("2026-04-21T10:00:00.000Z").getTime(),
              openingFloat: 10000,
              registerNumber: "100001",
              status: "active",
              terminalId: "terminal-browser",
              totalDeposited: 0,
            },
          ],
        }}
        isLoading={false}
        orgUrlSlug="v26"
        storeUrlSlug="east-legon"
      />,
    );

    const browserDrawers = screen.getByRole("group", {
      name: "Drawers on this browser",
    });
    const otherDrawers = screen.getByRole("group", {
      name: "Other drawers",
    });

    expect(
      within(browserDrawers).getByText("Register 100001"),
    ).toBeInTheDocument();
    expect(within(browserDrawers).getByText("This browser")).toBeInTheDocument();
    expect(
      within(browserDrawers).queryByText("Drawers linked to this terminal"),
    ).not.toBeInTheDocument();
    expect(within(browserDrawers).queryByText("Register 200002")).toBeNull();
    expect(
      within(otherDrawers).getByText("Register 200002"),
    ).toBeInTheDocument();
  });

  it("renders overview metrics and register activity", () => {
    const closedAt = new Date("2026-04-20T19:45:00.000Z").getTime();
    const expectedClosedAt = new Date(closedAt).toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    });

    render(
      <CashControlsDashboardContent
        currency="USD"
        dashboardSnapshot={{
          openSessions: [
            {
              _id: "session-open",
              expectedCash: 24800,
              openedByStaffName: "Maame Serwaa",
              openedAt: new Date("2026-04-21T09:15:00.000Z").getTime(),
              openingFloat: 5000,
              registerNumber: "Register 1",
              status: "active",
              totalSales: 66400,
              totalDeposited: 8000,
              variance: 0,
              workflowTraceId: "register_session:reg-1",
            },
          ],
          pendingCloseouts: [
            {
              _id: "session-closeout",
              countedCash: 17100,
              expectedCash: 17600,
              openedByStaffName: "Ama Mensah",
              openedAt: new Date("2026-04-21T07:30:00.000Z").getTime(),
              openingFloat: 5000,
              pendingApprovalRequest: {
                _id: "approval-1",
                reason:
                  "Variance of -500 exceeded the closeout approval threshold.",
                requestedByStaffName: "Ama Mensah",
                status: "pending",
              },
              registerNumber: "Register 3",
              status: "closing",
              terminalName: "Back counter",
              totalDeposited: 2400,
              variance: -500,
              workflowTraceId: "register_session:reg-3",
            },
          ],
          recentDeposits: [
            {
              _id: "deposit-2",
              amount: 2400,
              notes: "Evening drop",
              recordedAt: new Date("2026-04-21T18:10:00.000Z").getTime(),
              recordedByStaffName: "Kojo Mensimah",
              reference: "BANK-339",
              registerNumber: "Register 3",
              registerSessionId: "session-closeout",
            },
            {
              _id: "deposit-1",
              amount: 8000,
              notes: "Midday safe drop",
              recordedAt: new Date("2026-04-21T13:00:00.000Z").getTime(),
              recordedByStaffName: "Maame Serwaa",
              reference: "BANK-117",
              registerNumber: "Register 1",
              registerSessionId: "session-open",
            },
          ],
          registerSessions: [
            {
              _id: "session-closing",
              countedCash: 17100,
              expectedCash: 17600,
              openedByStaffName: "Ama Mensah",
              openedAt: new Date("2026-04-21T07:30:00.000Z").getTime(),
              openingFloat: 5000,
              pendingApprovalRequest: {
                _id: "approval-1",
                reason:
                  "Variance of -500 exceeded the closeout approval threshold.",
                requestedByStaffName: "Ama Mensah",
                status: "pending",
              },
              registerNumber: "Register 3",
              status: "closing",
              terminalName: "Back counter",
              totalDeposited: 2400,
              variance: -500,
              workflowTraceId: "register_session:reg-3",
            },
            {
              _id: "session-open",
              expectedCash: 24800,
              openedByStaffName: "Maame Serwaa",
              openedAt: new Date("2026-04-21T09:15:00.000Z").getTime(),
              openingFloat: 5000,
              registerNumber: "Register 1",
              status: "active",
              totalSales: 66400,
              totalDeposited: 8000,
              variance: 0,
              workflowTraceId: "register_session:reg-1",
            },
            {
              _id: "session-closed",
              closedAt,
              closedByStaffName: "Kojo Mensimah",
              countedCash: 5000,
              expectedCash: 5000,
              openedByStaffName: "Adjoa Tetteh",
              openedAt: new Date("2026-04-20T09:15:00.000Z").getTime(),
              openingFloat: 5000,
              registerNumber: "Register 4",
              status: "closed",
              totalDeposited: 0,
              variance: 0,
              workflowTraceId: "register_session:reg-4",
            },
            {
              _id: "session-closed-older-1",
              closedAt: new Date("2026-04-19T19:45:00.000Z").getTime(),
              countedCash: 4200,
              expectedCash: 4200,
              openedAt: new Date("2026-04-19T09:15:00.000Z").getTime(),
              openingFloat: 4200,
              registerNumber: "Register 5",
              status: "closed",
              totalDeposited: 0,
              variance: 0,
            },
            {
              _id: "session-closed-older-2",
              closedAt: new Date("2026-04-18T19:45:00.000Z").getTime(),
              countedCash: 3900,
              expectedCash: 4000,
              openedAt: new Date("2026-04-18T09:15:00.000Z").getTime(),
              openingFloat: 4000,
              registerNumber: "Register 6",
              status: "closed",
              totalDeposited: 0,
              variance: -100,
            },
            {
              _id: "session-closed-older-3",
              closedAt: new Date("2026-04-17T19:45:00.000Z").getTime(),
              countedCash: 3200,
              expectedCash: 3200,
              openedAt: new Date("2026-04-17T09:15:00.000Z").getTime(),
              openingFloat: 3200,
              registerNumber: "Register 7",
              status: "closed",
              totalDeposited: 0,
              variance: 0,
            },
          ],
          unresolvedVariances: [
            {
              _id: "session-closeout",
              countedCash: 17100,
              expectedCash: 17600,
              openedByStaffName: "Ama Mensah",
              openedAt: new Date("2026-04-21T07:30:00.000Z").getTime(),
              openingFloat: 5000,
              pendingApprovalRequest: {
                _id: "approval-1",
                reason:
                  "Variance of -500 exceeded the closeout approval threshold.",
                requestedByStaffName: "Ama Mensah",
                status: "pending",
              },
              registerNumber: "Register 3",
              status: "closing",
              totalDeposited: 2400,
              variance: -500,
              workflowTraceId: "register_session:reg-3",
            },
          ],
        }}
        isLoading={false}
        orgUrlSlug="v26"
        storeUrlSlug="east-legon"
      />,
    );

    expect(screen.getByText("Cash Ops")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Cash controls" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Expected in drawers")).toBeInTheDocument();
    expect(screen.getByText("$424")).toBeInTheDocument();
    expect(screen.getByText("1 live drawer, 1 in review")).toBeInTheDocument();
    expect(screen.queryByText("Deposits recorded")).not.toBeInTheDocument();
    expect(screen.queryByText("$104")).not.toBeInTheDocument();
    expect(screen.getAllByText("Still in drawers").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$320").length).toBeGreaterThan(0);
    expect(
      screen.getByText("Live and review drawers minus deposits"),
    ).toBeInTheDocument();
    expect(screen.getByText("Variance to review")).toBeInTheDocument();
    expect(screen.getAllByText("$5").length).toBeGreaterThan(0);
    expect(screen.queryByText("Recent deposits")).not.toBeInTheDocument();
    expect(screen.queryByText("No deposits recorded yet")).not.toBeInTheDocument();
    expect(screen.queryByText("Review closeouts")).not.toBeInTheDocument();
    expect(screen.getByText("Needs action")).toBeInTheDocument();
    expect(screen.getByText("Live drawers")).toBeInTheDocument();
    expect(screen.getByText("Closed sessions")).toBeInTheDocument();
    expect(
      screen.getByText("Showing latest 3 of 4 closed sessions."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("closed-sessions-table")).toHaveClass(
      "bg-transparent",
    );
    expect(screen.getByTestId("closed-sessions-table")).not.toHaveClass(
      "bg-background",
    );
    expect(
      screen.getByRole("link", { name: /View all register sessions/i }),
    ).toHaveAttribute(
      "href",
      "/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers?o=%252F",
    );
    expect(screen.getAllByText("Register 1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Register 3").length).toBeGreaterThan(0);
    expect(screen.getByText("N-OPEN")).toBeInTheDocument();
    expect(screen.getByText("Back counter / LOSING")).toBeInTheDocument();
    expect(screen.getAllByText("Needs review").length).toBeGreaterThan(0);
    expect(screen.getByText("Counted")).toBeInTheDocument();
    expect(screen.getAllByText("$171").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Deposited").length).toBeGreaterThan(0);
    const activeDrawerCard = screen
      .getAllByRole("link", { name: /Register 1/i })
      .find((link) => within(link).queryByText("Open drawer detail"));
    const activeDrawerMetrics = within(activeDrawerCard as HTMLElement);
    const totalSalesLabel = activeDrawerMetrics.getByText("Total sales");
    const expectedCashLabel = activeDrawerMetrics.getByText("Expected cash");
    expect(activeDrawerMetrics.getByText("$664")).toBeInTheDocument();
    expect(
      totalSalesLabel.compareDocumentPosition(expectedCashLabel) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(activeDrawerCard).not.toHaveTextContent("Variance");
    expect(screen.getByText("Register 4")).toBeInTheDocument();
    expect(screen.getByText(expectedClosedAt)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Register 4" })).toHaveAttribute(
      "href",
      "/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId?o=%252F",
    );
    expect(
      screen.getByRole("link", {
        name: `Open Register 4 closed ${expectedClosedAt}`,
      }),
    ).toHaveAttribute(
      "href",
      "/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId?o=%252F",
    );
    expect(screen.getByText("Register 5")).toBeInTheDocument();
    expect(screen.getByText("Register 6")).toBeInTheDocument();
    expect(screen.queryByText("Register 7")).not.toBeInTheDocument();
    expect(screen.getAllByText(/Opened .* by Ama M\./).length).toBeGreaterThan(
      0,
    );
    expect(
      screen.queryByText(
        "Variance of -$5 exceeded the closeout approval threshold.",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "Variance of -500 exceeded the closeout approval threshold.",
      ),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Opened .* by Maame S\./)).toBeInTheDocument();
    expect(screen.queryByText("Midday safe drop")).not.toBeInTheDocument();
    expect(screen.queryByText("BANK-339")).not.toBeInTheDocument();
  });

  it("redacts cash amounts for POS-only users without manager access", () => {
    render(
      <CashControlsDashboardContent
        currency="USD"
        dashboardSnapshot={{
          ...baseSnapshot,
          openSessions: [
            {
              _id: "session-open",
              expectedCash: 24800,
              openedAt: new Date("2026-04-21T09:15:00.000Z").getTime(),
              openingFloat: 5000,
              registerNumber: "Register 1",
              status: "active",
              totalDeposited: 8000,
              variance: 0,
            },
          ],
          recentDeposits: [
            {
              _id: "deposit-1",
              amount: 8000,
              recordedAt: new Date("2026-04-21T13:00:00.000Z").getTime(),
              reference: "BANK-117",
              registerNumber: "Register 1",
              registerSessionId: "session-open",
            },
          ],
          registerSessions: [
            {
              _id: "session-open",
              expectedCash: 24800,
              openedAt: new Date("2026-04-21T09:15:00.000Z").getTime(),
              openingFloat: 5000,
              registerNumber: "Register 1",
              status: "active",
              totalDeposited: 8000,
              variance: 0,
            },
          ],
        }}
        hasFinancialDetailsAccess={false}
        isLoading={false}
        orgUrlSlug="v26"
        storeUrlSlug="east-legon"
      />,
    );

    expect(screen.queryByText("$248")).not.toBeInTheDocument();
    expect(screen.queryByText("$80")).not.toBeInTheDocument();
    expect(screen.getAllByText("Manager only")).not.toHaveLength(0);
    expect(screen.getAllByText("Register 1")).not.toHaveLength(0);
  });

  it("replaces the closed-session preview table with a store history snapshot when all drawers are closed", () => {
    render(
      <CashControlsDashboardContent
        currency="USD"
        dashboardSnapshot={{
          ...baseSnapshot,
          registerSessions: [
            {
              _id: "closed-short",
              closedAt: new Date("2026-04-21T09:30:00.000Z").getTime(),
              countedCash: 9500,
              expectedCash: 10000,
              openedAt: new Date("2026-04-21T07:30:00.000Z").getTime(),
              openingFloat: 5000,
              registerNumber: "Register 1",
              status: "closed",
              totalDeposited: 0,
              variance: -500,
            },
            {
              _id: "closed-over",
              closedAt: new Date("2026-04-21T12:00:00.000Z").getTime(),
              countedCash: 22000,
              expectedCash: 20000,
              openedAt: new Date("2026-04-21T09:45:00.000Z").getTime(),
              openingFloat: 5000,
              registerNumber: "Register 2",
              status: "closed",
              totalDeposited: 0,
              variance: 2000,
            },
            {
              _id: "closed-balanced",
              closedAt: new Date("2026-04-21T15:15:00.000Z").getTime(),
              countedCash: 5000,
              expectedCash: 5000,
              openedAt: new Date("2026-04-21T13:00:00.000Z").getTime(),
              openingFloat: 5000,
              registerNumber: "Register 3",
              status: "closed",
              totalDeposited: 1000,
              variance: 0,
            },
          ],
        }}
        isLoading={false}
        orgUrlSlug="v26"
        storeUrlSlug="east-legon"
      />,
    );

    expect(screen.getByText("Closed session history")).toBeInTheDocument();
    expect(screen.getByText("Closed sessions")).toBeInTheDocument();
    expect(screen.getByText("Expected cash")).toBeInTheDocument();
    expect(screen.getByText("$350")).toBeInTheDocument();
    expect(screen.getByText("Counted cash")).toBeInTheDocument();
    expect(screen.getByText("$365")).toBeInTheDocument();
    expect(screen.getByText("Net variance")).toBeInTheDocument();
    expect(screen.getByText("$15")).toBeInTheDocument();
    expect(screen.getByText("Balanced drawers")).toBeInTheDocument();
    expect(screen.getByText("1 of 3")).toBeInTheDocument();
    expect(screen.getByText("Short drawers")).toBeInTheDocument();
    expect(screen.getByText("1 / $5")).toBeInTheDocument();
    expect(screen.getByText("Over drawers")).toBeInTheDocument();
    expect(screen.getByText("1 / $20")).toBeInTheDocument();
    expect(
      screen.getByText("Deposited across closed sessions"),
    ).toBeInTheDocument();
    expect(screen.getByText("$10")).toBeInTheDocument();
    expect(screen.queryByText("Showing latest 3 of")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /View all register sessions/i }),
    ).toHaveAttribute(
      "href",
      "/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers?o=%252F",
    );
  });

  it("renders closed-session preview cards on mobile", () => {
    mockHooks.useIsMobile.mockReturnValue(true);

    render(
      <CashControlsDashboardContent
        currency="USD"
        dashboardSnapshot={{
          ...baseSnapshot,
          registerSessions: [
            {
              _id: "session-live-mobile",
              expectedCash: 15500,
              openedAt: new Date("2026-07-07T12:14:00.000Z").getTime(),
              openingFloat: 5000,
              registerNumber: "8",
              status: "active",
              totalDeposited: 0,
              variance: 0,
            },
            {
              _id: "session-closed-mobile",
              closedAt: new Date("2026-07-07T19:16:00.000Z").getTime(),
              countedCash: 10000,
              expectedCash: 10500,
              openedAt: new Date("2026-07-07T12:07:00.000Z").getTime(),
              openingFloat: 5000,
              registerNumber: "8",
              status: "closed",
              totalDeposited: 0,
              variance: -500,
            },
          ],
        }}
        isLoading={false}
        orgUrlSlug="v26"
        storeUrlSlug="east-legon"
      />,
    );

    expect(screen.queryByTestId("closed-sessions-table")).not.toBeInTheDocument();
    expect(screen.getByText("Opened")).toBeInTheDocument();
    expect(screen.getByText("Closed")).toBeInTheDocument();
    expect(screen.getByText("-$5")).toHaveClass("text-danger");
  });

  it("hides zero deposited value on variance session cards", () => {
    render(
      <CashControlsDashboardContent
        currency="USD"
        dashboardSnapshot={{
          ...baseSnapshot,
          pendingCloseouts: [
            {
              _id: "session-zero-deposit",
              countedCash: 1000,
              expectedCash: 1500,
              openedAt: new Date("2026-04-21T07:30:00.000Z").getTime(),
              openingFloat: 1500,
              registerNumber: "Register 8",
              status: "closing",
              totalDeposited: 0,
              variance: -500,
            },
          ],
          registerSessions: [
            {
              _id: "session-zero-deposit",
              countedCash: 1000,
              expectedCash: 1500,
              openedAt: new Date("2026-04-21T07:30:00.000Z").getTime(),
              openingFloat: 1500,
              registerNumber: "Register 8",
              status: "closing",
              totalDeposited: 0,
              variance: -500,
            },
          ],
          unresolvedVariances: [
            {
              _id: "session-zero-deposit",
              countedCash: 1000,
              expectedCash: 1500,
              openedAt: new Date("2026-04-21T07:30:00.000Z").getTime(),
              openingFloat: 1500,
              registerNumber: "Register 8",
              status: "closing",
              totalDeposited: 0,
              variance: -500,
            },
          ],
        }}
        isLoading={false}
        orgUrlSlug="v26"
        storeUrlSlug="east-legon"
      />,
    );

    const zeroDepositCard = screen
      .getAllByRole("link", { name: /Register 8/i })
      .find((link) => within(link).queryByText("Review variance"));

    expect(zeroDepositCard).toHaveTextContent("Expected");
    expect(zeroDepositCard).toHaveTextContent("$15");
    expect(zeroDepositCard).toHaveTextContent("Counted");
    expect(zeroDepositCard).toHaveTextContent("$10");
    expect(zeroDepositCard).toHaveTextContent("Variance");
    expect(zeroDepositCard).not.toHaveTextContent("Deposited");
  });

  it("shows pending cash void context on session cards", () => {
    const openedAt = new Date("2026-06-30T09:00:00.000Z").getTime();
    const session = {
      _id: "session-pending-cash-void",
      expectedCash: 610000,
      openedAt,
      openingFloat: 5000,
      pendingVoidApprovals: {
        cashAffectingCount: 1,
        cashAmount: 8000,
        count: 1,
        items: [
          {
            approvalRequestId: "void-approval-1",
            cashAmount: 8000,
            requestedAt: openedAt + 1000,
            transactionId: "transaction-1",
            transactionNumber: "TXN-0031",
          },
        ],
      },
      registerNumber: "Register 1",
      status: "closing" as const,
      totalDeposited: 0,
    };

    render(
      <CashControlsDashboardContent
        currency="GHS"
        dashboardSnapshot={{
          ...baseSnapshot,
          pendingCloseouts: [session],
          registerSessions: [session],
        }}
        hasFinancialDetailsAccess
        isLoading={false}
        orgUrlSlug="v26"
        storeUrlSlug="east-legon"
      />,
    );

    const card = screen
      .getAllByRole("link", { name: /Register 1/i })
      .find((link) => within(link).queryByText("Review register"));

    expect(card).toBeDefined();
    expect(card).toHaveTextContent("Expected now");
    expect(card).toHaveTextContent("GH₵6,100");
    expect(card).toHaveTextContent("After adjustments");
    expect(card).toHaveTextContent("GH₵6,020");
    expect(card).toHaveTextContent(
      "After adjustments applies 1 pending cash void",
    );
    expect(card).toHaveTextContent("GH₵80");
  });

  it("marks cash item adjustments as register-review attention", () => {
    const openedAt = new Date("2026-06-30T09:00:00.000Z").getTime();
    const session = {
      _id: "session-pending-cash-adjustment",
      expectedCash: 610000,
      openedAt,
      openingFloat: 5000,
      pendingVoidApprovals: {
        cashAdjustmentCount: 1,
        cashAdjustmentDelta: -5000,
        cashAmount: 0,
        count: 0,
        items: [],
      },
      registerNumber: "Register 1",
      status: "active" as const,
      totalDeposited: 0,
    };

    render(
      <CashControlsDashboardContent
        currency="GHS"
        dashboardSnapshot={{
          ...baseSnapshot,
          registerSessions: [session],
        }}
        hasFinancialDetailsAccess
        isLoading={false}
        orgUrlSlug="v26"
        storeUrlSlug="east-legon"
      />,
    );

    const card = screen
      .getAllByRole("link", { name: /Register 1/i })
      .find((link) => within(link).queryByText("Review register"));

    expect(card).toBeDefined();
    expect(card).toHaveTextContent("After adjustments");
    expect(card).toHaveTextContent("GH₵6,050");
    expect(card).toHaveTextContent(
      "After adjustments applies 1 pending cash item adjustment reducing cash",
    );
  });

  it("surfaces a drawer opened from POS in the cash-controls workspace", () => {
    render(
      <CashControlsDashboardContent
        currency="USD"
        dashboardSnapshot={{
          ...baseSnapshot,
          openSessions: [
            {
              _id: "session-pos-open",
              expectedCash: 6200,
              openedAt: new Date("2026-04-22T08:45:00.000Z").getTime(),
              openingFloat: 5000,
              registerNumber: "Register 2",
              status: "active",
              totalDeposited: 1200,
              variance: 0,
              workflowTraceId: "register_session:drawer-pos-open",
            },
          ],
          registerSessions: [
            {
              _id: "session-pos-open",
              expectedCash: 6200,
              openedAt: new Date("2026-04-22T08:45:00.000Z").getTime(),
              openingFloat: 5000,
              registerNumber: "Register 2",
              status: "active",
              totalDeposited: 1200,
              variance: 0,
              workflowTraceId: "register_session:drawer-pos-open",
            },
          ],
          recentDeposits: [
            {
              _id: "deposit-pos-open",
              amount: 1200,
              notes: "First safe drop after POS drawer open",
              recordedAt: new Date("2026-04-22T10:05:00.000Z").getTime(),
              recordedByStaffName: "Ama Mensah",
              reference: "SAFE-120",
              registerNumber: "Register 2",
              registerSessionId: "session-pos-open",
            },
          ],
        }}
        isLoading={false}
        orgUrlSlug="v26"
        storeUrlSlug="east-legon"
      />,
    );

    expect(screen.getAllByText("Register 2").length).toBeGreaterThan(0);
    expect(screen.queryByText("Needs action")).not.toBeInTheDocument();
    expect(screen.getByText("Live drawers")).toBeInTheDocument();
    expect(
      screen.queryByText("No drawer needs closeout or variance review"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("First safe drop after POS drawer open"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("SAFE-120")).not.toBeInTheDocument();
  });

  it("does not use closed register sessions for the live register workflow card", () => {
    render(
      <CashControlsDashboardContent
        currency="USD"
        dashboardSnapshot={{
          ...baseSnapshot,
          registerSessions: [
            {
              _id: "session-closed-register-2",
              closedAt: new Date("2026-04-29T20:06:00.000Z").getTime(),
              countedCash: 40000,
              expectedCash: 40000,
              openedAt: new Date("2026-04-29T07:40:00.000Z").getTime(),
              openingFloat: 40000,
              registerNumber: "Register 2",
              status: "closed",
              totalDeposited: 0,
              variance: 0,
            },
          ],
        }}
        isLoading={false}
        orgUrlSlug="v26"
        storeUrlSlug="east-legon"
      />,
    );

    expect(
      screen.queryByText("Register 2 is ready for review or deposit entry."),
    ).not.toBeInTheDocument();
    expect(screen.getByText("No drawers in cashroom flow")).toBeInTheDocument();
    expect(screen.queryByText("Needs action")).not.toBeInTheDocument();
    expect(screen.queryByText("Live drawers")).not.toBeInTheDocument();
    expect(
      screen.queryByText("No drawer needs closeout or variance review"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Closed session history")).toBeInTheDocument();
  });

  it("keeps rejected closeouts in the cashroom attention lane", () => {
    render(
      <CashControlsDashboardContent
        currency="USD"
        dashboardSnapshot={{
          ...baseSnapshot,
          registerSessions: [
            {
              _id: "session-rejected-register-2",
              countedCash: 9000,
              expectedCash: 10000,
              openedAt: new Date("2026-04-29T07:40:00.000Z").getTime(),
              openingFloat: 4000,
              registerNumber: "Register 2",
              status: "closeout_rejected",
              totalDeposited: 0,
              variance: -1000,
            },
          ],
        }}
        isLoading={false}
        orgUrlSlug="v26"
        storeUrlSlug="east-legon"
      />,
    );

    expect(screen.getByText("Register 2")).toBeInTheDocument();
    expect(screen.getByText("Needs action")).toBeInTheDocument();
    expect(screen.queryByText("Live drawers")).not.toBeInTheDocument();
    expect(screen.queryByText("Closed session history")).not.toBeInTheDocument();
  });

  it("separates pending sync from reconciliation issues", () => {
    render(
      <CashControlsDashboardContent
        currency="GHS"
        dashboardSnapshot={{
          ...baseSnapshot,
          pendingCloseouts: [
            {
              _id: "session-local-close",
              countedCash: 17100,
              expectedCash: 17600,
              openedAt: new Date("2026-04-21T07:30:00.000Z").getTime(),
              openingFloat: 5000,
              registerNumber: "Register 3",
              status: "closing",
              totalDeposited: 0,
              variance: 0,
              localSyncStatus: {
                status: "locally_closed_pending_sync",
                pendingEventCount: 4,
              },
            },
          ],
          unresolvedVariances: [
            {
              _id: "session-needs-review",
              countedCash: 17100,
              expectedCash: 17600,
              openedAt: new Date("2026-04-21T08:30:00.000Z").getTime(),
              openingFloat: 5000,
              registerNumber: "Register 4",
              status: "closing",
              totalDeposited: 0,
              variance: 0,
              localSyncStatus: {
                status: "needs_review",
                reconciliationItems: [
                  {
                    summary: "Mobile money payment record needs review.",
                    type: "payment_conflict",
                  },
                ],
              },
            },
          ],
          registerSessions: [
            {
              _id: "session-local-close",
              countedCash: 17100,
              expectedCash: 17600,
              openedAt: new Date("2026-04-21T07:30:00.000Z").getTime(),
              openingFloat: 5000,
              registerNumber: "Register 3",
              status: "closing",
              totalDeposited: 0,
              variance: 0,
              localSyncStatus: {
                status: "locally_closed_pending_sync",
                pendingEventCount: 4,
              },
            },
            {
              _id: "session-needs-review",
              countedCash: 17100,
              expectedCash: 17600,
              openedAt: new Date("2026-04-21T08:30:00.000Z").getTime(),
              openingFloat: 5000,
              registerNumber: "Register 4",
              status: "closing",
              totalDeposited: 0,
              variance: 0,
              localSyncStatus: {
                status: "needs_review",
                reconciliationItems: [
                  {
                    summary: "Mobile money payment record needs review.",
                    type: "payment_conflict",
                  },
                ],
              },
            },
          ],
        }}
        isLoading={false}
        orgUrlSlug="v26"
        storeUrlSlug="east-legon"
      />,
    );

    expect(screen.getByText("Pending reconciliation")).toBeInTheDocument();
    expect(
      screen.getByText(
        "This register was closed locally. Athena will reconcile the closeout after sync.",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Needs review").length).toBeGreaterThan(0);
    expect(
      screen.getByText(/Payment review: Mobile money payment record needs review./i),
    ).toBeInTheDocument();

    const pendingSyncCard = screen
      .getAllByRole("link", { name: /Register 3/i })
      .find((link) => within(link).queryByText("Pending reconciliation"));
    expect(pendingSyncCard).toHaveTextContent("Counted");
    expect(pendingSyncCard).toHaveTextContent("Variance");
    expect(pendingSyncCard).toHaveTextContent("GH₵0");

    const needsReviewCard = screen
      .getAllByRole("link", { name: /Register 4/i })
      .find((link) => within(link).queryByText("Needs review"));
    expect(needsReviewCard).toHaveTextContent("Counted");
    expect(needsReviewCard).toHaveTextContent("Variance");
    expect(needsReviewCard).toHaveTextContent("GH₵0");
  });

  it("labels synced closeout variance review without showing the drawer as simply active", () => {
    render(
      <CashControlsDashboardContent
        currency="GHS"
        dashboardSnapshot={{
          ...baseSnapshot,
          registerSessions: [
            {
              _id: "session-closeout-review",
              expectedCash: 17600,
              openedAt: new Date("2026-04-21T08:30:00.000Z").getTime(),
              openingFloat: 5000,
              registerNumber: "Register 4",
              status: "active",
              terminalName: "Front counter",
              totalDeposited: 0,
              variance: 0,
              localSyncStatus: {
                status: "needs_review",
                reconciliationItems: [
                  {
                    countedCash: 17100,
                    localEventId: "event-register-closeout-1",
                    summary:
                      "Register closeout variance requires manager review before synced closeout can be applied.",
                    type: "permission",
                    variance: -500,
                  },
                ],
              },
            },
          ],
          unresolvedVariances: [
            {
              _id: "session-closeout-review",
              expectedCash: 17600,
              openedAt: new Date("2026-04-21T08:30:00.000Z").getTime(),
              openingFloat: 5000,
              registerNumber: "Register 4",
              status: "active",
              terminalName: "Front counter",
              totalDeposited: 0,
              variance: 0,
              localSyncStatus: {
                status: "needs_review",
                reconciliationItems: [
                  {
                    countedCash: 17100,
                    localEventId: "event-register-closeout-1",
                    summary:
                      "Register closeout variance requires manager review before synced closeout can be applied.",
                    type: "permission",
                    variance: -500,
                  },
                ],
              },
            },
          ],
        }}
        isLoading={false}
        orgUrlSlug="v26"
        storeUrlSlug="east-legon"
      />,
    );

    expect(screen.getByText("Needs action")).toBeInTheDocument();
    expect(screen.queryByText("Live drawers")).not.toBeInTheDocument();
    expect(screen.getAllByText("Register 4")).toHaveLength(1);
    expect(screen.getAllByText("Closeout review pending").length).toBeGreaterThan(0);
    expect(screen.queryByText("Closeout review")).not.toBeInTheDocument();
    expect(screen.getAllByText("Review closeout").length).toBeGreaterThan(0);
    expect(screen.getByText("Counted")).toBeInTheDocument();
    expect(screen.getByText("Variance")).toBeInTheDocument();
    expect(screen.getByText("GH₵-5")).toHaveClass("text-danger");
    expect(
      screen.queryByText(
        "Synced register closeout has a variance. Review it before this closeout can be applied.",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        /Closeout variance review: Register closeout variance requires manager review before synced closeout can be applied./i,
      ),
    ).not.toBeInTheDocument();
  });

  it("keeps stale terminal health out of manager-review counts", () => {
    render(
      <CashControlsDashboardContent
        currency="GHS"
        dashboardSnapshot={{
          ...baseSnapshot,
          registerSessions: [
            {
              _id: "session-terminal-stale",
              expectedCash: 17600,
              openedAt: new Date("2026-04-21T07:30:00.000Z").getTime(),
              openingFloat: 5000,
              registerNumber: "Register 3",
              status: "active",
              terminalName: "Front counter",
              totalDeposited: 0,
              variance: 0,
              localSyncStatus: {
                description: "Terminal check-in is waiting for a fresh upload.",
                status: "terminal_stale",
              },
            },
          ],
        }}
        isLoading={false}
        orgUrlSlug="v26"
        storeUrlSlug="east-legon"
      />,
    );

    expect(screen.getByText("Front counter / -STALE")).toBeInTheDocument();
    expect(screen.getAllByText("Pending sync").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText("Terminal check-in is waiting for a fresh upload.")
        .length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("0 unresolved")).toBeInTheDocument();
    expect(screen.queryByText("Needs review")).not.toBeInTheDocument();
  });

  it("uses safe fallback copy for unknown reconciliation types", () => {
    render(
      <CashControlsDashboardContent
        currency="GHS"
        dashboardSnapshot={{
          ...baseSnapshot,
          registerSessions: [
            {
              _id: "session-unknown-review",
              countedCash: 17100,
              expectedCash: 17600,
              openedAt: new Date("2026-04-21T08:30:00.000Z").getTime(),
              openingFloat: 5000,
              registerNumber: "Register 4",
              status: "closing",
              totalDeposited: 0,
              variance: 0,
              localSyncStatus: {
                status: "needs_review",
                reconciliationItems: [
                  {
                    summary: "Review this synced register activity.",
                    type: "new_reconciliation_kind",
                  },
                ],
              },
            },
          ],
          unresolvedVariances: [
            {
              _id: "session-unknown-review",
              countedCash: 17100,
              expectedCash: 17600,
              openedAt: new Date("2026-04-21T08:30:00.000Z").getTime(),
              openingFloat: 5000,
              registerNumber: "Register 4",
              status: "closing",
              totalDeposited: 0,
              variance: 0,
              localSyncStatus: {
                status: "needs_review",
                reconciliationItems: [
                  {
                    summary: "Review this synced register activity.",
                    type: "new_reconciliation_kind",
                  },
                ],
              },
            },
          ],
        }}
        isLoading={false}
        orgUrlSlug="v26"
        storeUrlSlug="east-legon"
      />,
    );

    expect(
      screen.getByText(
        /Reconciliation review: Review this synced register activity./i,
      ),
    ).toBeInTheDocument();
  });

  it("shows counted cash and zero variance on closed review session cards", () => {
    render(
      <CashControlsDashboardContent
        currency="GHS"
        dashboardSnapshot={{
          ...baseSnapshot,
          registerSessions: [
            {
              _id: "session-closed-inventory-review",
              closedAt: new Date("2026-06-17T08:00:00.000Z").getTime(),
              countedCash: 231000,
              expectedCash: 231000,
              openedAt: new Date("2026-06-17T04:56:00.000Z").getTime(),
              openedByStaffName: "P O.",
              openingFloat: 15500,
              registerNumber: "Register 1",
              status: "closed",
              terminalName: "M Supplies",
              totalDeposited: 0,
              variance: 0,
              localSyncStatus: {
                status: "needs_review",
                reconciliationItems: [
                  {
                    summary:
                      "Inventory needs manager review for a synced offline sale.",
                    type: "inventory",
                  },
                ],
              },
            },
          ],
          unresolvedVariances: [
            {
              _id: "session-closed-inventory-review",
              closedAt: new Date("2026-06-17T08:00:00.000Z").getTime(),
              countedCash: 231000,
              expectedCash: 231000,
              openedAt: new Date("2026-06-17T04:56:00.000Z").getTime(),
              openedByStaffName: "P O.",
              openingFloat: 15500,
              registerNumber: "Register 1",
              status: "closed",
              terminalName: "M Supplies",
              totalDeposited: 0,
              variance: 0,
              localSyncStatus: {
                status: "needs_review",
                reconciliationItems: [
                  {
                    summary:
                      "Inventory needs manager review for a synced offline sale.",
                    type: "inventory",
                  },
                ],
              },
            },
          ],
        }}
        isLoading={false}
        orgUrlSlug="v26"
        storeUrlSlug="east-legon"
      />,
    );

    const closedReviewCard = screen
      .getAllByRole("link", { name: /Register 1/i })
      .find((link) => within(link).queryByText("View session"));

    expect(closedReviewCard).toHaveTextContent("Expected cash");
    expect(closedReviewCard).toHaveTextContent("GH₵2,310");
    expect(closedReviewCard).toHaveTextContent("Counted");
    expect(closedReviewCard).toHaveTextContent("Variance");
    expect(closedReviewCard).toHaveTextContent("GH₵0");
    expect(closedReviewCard).toHaveTextContent(
      "Inventory review: Inventory needs manager review for a synced offline sale.",
    );
  });

  it("links register session cards to the session route", () => {
    render(
      <CashControlsDashboardContent
        currency="USD"
        dashboardSnapshot={{
          ...baseSnapshot,
          openSessions: [
            {
              _id: "session-open",
              expectedCash: 24800,
              openedAt: new Date("2026-04-21T09:15:00.000Z").getTime(),
              openingFloat: 5000,
              registerNumber: "Register 1",
              status: "active",
              totalDeposited: 8000,
              variance: 0,
            },
          ],
          registerSessions: [
            {
              _id: "session-open",
              expectedCash: 24800,
              openedAt: new Date("2026-04-21T09:15:00.000Z").getTime(),
              openingFloat: 5000,
              registerNumber: "Register 1",
              status: "active",
              totalDeposited: 8000,
              variance: 0,
            },
          ],
        }}
        isLoading={false}
        orgUrlSlug="v26"
        storeUrlSlug="east-legon"
      />,
    );

    const registerLinks = screen.getAllByRole("link", { name: /register 1/i });

    expect(registerLinks[registerLinks.length - 1]).toHaveAttribute(
      "href",
      "/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId?o=%252F",
    );
  });
});
