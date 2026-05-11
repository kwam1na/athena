import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CashControlsDashboardContent } from "./CashControlsDashboard";

const mockNavigate = vi.fn();

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
    window.scrollTo = vi.fn();
  });

  it("shows a loading state while the dashboard snapshot is loading", () => {
    render(
      <CashControlsDashboardContent
        currency="USD"
        dashboardSnapshot={baseSnapshot}
        isLoading
        orgUrlSlug="v26"
        storeUrlSlug="east-legon"
      />,
    );

    expect(
      screen.queryByLabelText("Loading cash controls workspace"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Loading cash controls..."),
    ).not.toBeInTheDocument();
  });

  it("renders overview metrics, register activity, and recent deposits", () => {
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
    expect(screen.getByText("Deposits recorded")).toBeInTheDocument();
    expect(screen.getByText("$104")).toBeInTheDocument();
    expect(screen.getAllByText("Still in drawers").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$320").length).toBeGreaterThan(0);
    expect(
      screen.getByText("Live and review drawers minus deposits"),
    ).toBeInTheDocument();
    expect(screen.getByText("Variance to review")).toBeInTheDocument();
    expect(screen.getAllByText("$5").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Recent deposits").length).toBeGreaterThan(0);
    expect(screen.queryByText("Review closeouts")).not.toBeInTheDocument();
    expect(screen.getByText("Needs action")).toBeInTheDocument();
    expect(screen.getByText("Live drawers")).toBeInTheDocument();
    expect(screen.getByText("Closed sessions")).toBeInTheDocument();
    expect(
      screen.getByText("Showing latest 3 of 4 closed sessions."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /View all register sessions/i }),
    ).toHaveAttribute(
      "href",
      "/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers?o=%252F",
    );
    expect(screen.getAllByText("Register 1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Register 3").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Back counter").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Needs review").length).toBeGreaterThan(0);
    expect(screen.getByText("Counted")).toBeInTheDocument();
    expect(screen.getAllByText("$171").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Deposited").length).toBeGreaterThan(0);
    const activeDrawerCard = screen
      .getAllByRole("link", { name: /Register 1/i })
      .find((link) => within(link).queryByText("Open drawer detail"));
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
    expect(screen.getByText("Midday safe drop")).toBeInTheDocument();
    expect(screen.getByText("BANK-339")).toBeInTheDocument();
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

  it("surfaces a drawer opened from POS in the cash-controls ledgers", () => {
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
      screen.getByText("First safe drop after POS drawer open"),
    ).toBeInTheDocument();
    expect(screen.getByText("SAFE-120")).toBeInTheDocument();
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
