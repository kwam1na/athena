import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CashControlsDashboardContent } from "./CashControlsDashboard";

const mockNavigate = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    to,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    params?: unknown;
    to?: string;
  }) => {
    void params;

    return (
      <a href={to ?? "#"} {...props}>
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

    expect(screen.getByText("Loading cash controls...")).toBeInTheDocument();
  });

  it("renders overview metrics, register activity, and recent deposits", () => {
    render(
      <CashControlsDashboardContent
        currency="USD"
        dashboardSnapshot={{
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
              workflowTraceId: "register_session:reg-1",
            },
          ],
          pendingCloseouts: [
            {
              _id: "session-closeout",
              countedCash: 17100,
              expectedCash: 17600,
              openedAt: new Date("2026-04-21T07:30:00.000Z").getTime(),
              openingFloat: 5000,
              pendingApprovalRequest: {
                _id: "approval-1",
                reason: "Variance review required.",
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
          unresolvedVariances: [
            {
              _id: "session-closeout",
              countedCash: 17100,
              expectedCash: 17600,
              openedAt: new Date("2026-04-21T07:30:00.000Z").getTime(),
              openingFloat: 5000,
              pendingApprovalRequest: {
                _id: "approval-1",
                reason: "Variance review required.",
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

    expect(screen.getByText("Cash controls workspace")).toBeInTheDocument();
    expect(screen.getByText("Open sessions")).toBeInTheDocument();
    expect(screen.getByText("Expected cash")).toBeInTheDocument();
    expect(screen.getAllByText("Deposited").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Recent deposits").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Register 1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Register 3").length).toBeGreaterThan(0);
    expect(screen.getByText("Midday safe drop")).toBeInTheDocument();
    expect(screen.getByText("BANK-339")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Cash Controls" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Closeouts" })).toBeInTheDocument();
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
    expect(screen.getByText("First safe drop after POS drawer open")).toBeInTheDocument();
    expect(screen.getByText("SAFE-120")).toBeInTheDocument();
  });

  it("opens the register session route when a session row is clicked", () => {
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
        }}
        isLoading={false}
        orgUrlSlug="v26"
        storeUrlSlug="east-legon"
      />,
    );

    fireEvent.click(screen.getByRole("link", { name: /register 1/i }));

    expect(mockNavigate).toHaveBeenCalledWith({
      params: {
        orgUrlSlug: "v26",
        sessionId: "session-open",
        storeUrlSlug: "east-legon",
      },
      search: { o: "%2F" },
      to: "/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId",
    });
  });
});
