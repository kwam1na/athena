import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DailyCloseHistoryView,
  type DailyCloseHistoryRecord,
} from "./DailyCloseHistoryView";
import type { DailyCloseSnapshot } from "./DailyCloseView";

const mockedHooks = vi.hoisted(() => ({
  useProtectedAdminPageState: vi.fn(),
  useMutation: vi.fn(),
  useQuery: vi.fn(),
}));

const mockedApi = vi.hoisted(() => ({
  getCompletedDailyCloseHistoryDetail: "getCompletedDailyCloseHistoryDetail",
  listCompletedDailyCloseHistory: "listCompletedDailyCloseHistory",
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
  useMutation: mockedHooks.useMutation,
  useQuery: mockedHooks.useQuery,
}));

vi.mock("@/hooks/useProtectedAdminPageState", () => ({
  useProtectedAdminPageState: mockedHooks.useProtectedAdminPageState,
}));

vi.mock("~/convex/_generated/api", () => ({
  api: {
    operations: {
      dailyClose: mockedApi,
    },
  },
}));

const baseSummary = {
  carriedOverCashTotal: 0,
  carriedOverRegisterCount: 0,
  cashDeposited: 45000,
  cashExpected: 45000,
  carryForwardCount: 1,
  currentDayCashTransactionCount: 2,
  currentDayCashTotal: 45000,
  expenseTransactionCount: 1,
  expenseTotal: 12500,
  registerCount: 2,
  registerVarianceCount: 0,
  staffCount: 3,
  totalSales: 125500,
  transactionCount: 14,
  varianceTotal: 0,
};

function snapshot(
  overrides: Partial<DailyCloseSnapshot> = {},
): DailyCloseSnapshot {
  return {
    blockers: [],
    carryForwardItems: [
      {
        description: "Preserved for the next opening workflow.",
        id: "work-1",
        statusLabel: "Carry forward",
        title: "Follow up on register variance",
      },
    ],
    completedClose: {
      completedAt: Date.UTC(2026, 4, 8, 22, 30),
      completedByStaffName: "Ama Mensah",
      notes: "Close reviewed by owner.",
    },
    endAt: Date.UTC(2026, 4, 9, 4),
    operatingDate: "2026-05-08",
    readiness: {
      blockerCount: 0,
      carryForwardCount: 1,
      readyCount: 2,
      reviewCount: 1,
      status: "ready",
    },
    readyItems: [
      {
        category: "sale",
        description: "Completed sale is included in End-of-Day Review.",
        id: "sale-1",
        link: {
          label: "Open transaction",
          params: { transactionId: "txn-1" },
          to: "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/$transactionId",
        },
        metadata: {
          completedAt: Date.UTC(2026, 4, 8, 17),
          owner: "Kofi Mensah",
          paymentMethods: "Cash",
          total: 49500,
          transaction: "TXN-1",
        },
        subject: {
          id: "txn-1",
          label: "TXN-1",
          type: "pos_transaction",
        },
        title: "Completed sale",
      },
    ],
    reviewItems: [
      {
        description: "Reviewed before close.",
        id: "review-1",
        statusLabel: "Reviewed",
        title: "Small cash variance reviewed",
      },
    ],
    startAt: Date.UTC(2026, 4, 8, 4),
    status: "completed",
    summary: baseSummary,
    ...overrides,
  };
}

function storedReportSnapshot(snapshotValue: DailyCloseSnapshot) {
  return {
    closeMetadata: {
      completedAt: snapshotValue.completedClose?.completedAt,
      completedByStaffName: snapshotValue.completedClose?.completedByStaffName,
      endAt: snapshotValue.endAt,
      notes: snapshotValue.completedClose?.notes,
      operatingDate: snapshotValue.operatingDate,
      startAt: snapshotValue.startAt,
    },
    carryForwardItems: snapshotValue.carryForwardItems,
    readyItems: snapshotValue.readyItems,
    readiness: snapshotValue.readiness,
    reviewedItems: snapshotValue.reviewItems,
    sourceSubjects: [],
    summary: snapshotValue.summary,
  };
}

function historyRecord(
  overrides: Partial<DailyCloseHistoryRecord> = {},
): DailyCloseHistoryRecord {
  const snapshotOverrides =
    overrides.reportSnapshot && "operatingDate" in overrides.reportSnapshot
      ? overrides.reportSnapshot
      : undefined;
  const reportSnapshot = snapshot(snapshotOverrides);

  return {
    _id: "daily-close-2026-05-08",
    carryForwardCount: reportSnapshot.readiness?.carryForwardCount,
    completedAt: reportSnapshot.completedClose?.completedAt,
    completedByStaffName: reportSnapshot.completedClose?.completedByStaffName,
    operatingDate: reportSnapshot.operatingDate,
    readiness: reportSnapshot.readiness,
    reportSnapshot: storedReportSnapshot(reportSnapshot),
    status: "completed",
    summary: reportSnapshot.summary,
    ...overrides,
  };
}

const historyRecords = [
  historyRecord(),
  historyRecord({
    _id: "daily-close-2026-05-07",
    completedAt: Date.UTC(2026, 4, 7, 22),
    operatingDate: "2026-05-07",
    reportSnapshot: snapshot({
      completedClose: {
        completedAt: Date.UTC(2026, 4, 7, 22),
        completedByStaffName: "Kofi Mensah",
        notes: "Clean close.",
      },
      operatingDate: "2026-05-07",
      summary: {
        ...baseSummary,
        expenseTotal: 0,
        totalSales: 98000,
      },
    }),
  }),
  historyRecord({
    _id: "daily-close-open",
    operatingDate: "2026-05-06",
    reportSnapshot: snapshot({ operatingDate: "2026-05-06" }),
    status: "ready",
  }),
];

function mockProtectedState(overrides = {}) {
  mockedHooks.useProtectedAdminPageState.mockReturnValue({
    activeStore: {
      _id: "store-1",
      currency: "GHS",
    },
    canQueryProtectedData: true,
    hasFullAdminAccess: true,
    isAuthenticated: true,
    isLoadingAccess: false,
    ...overrides,
  });
}

function mockQueries(records = historyRecords) {
  mockedHooks.useQuery.mockImplementation((query, args) => {
    if (query === mockedApi.listCompletedDailyCloseHistory) {
      return { records };
    }

    if (
      query === mockedApi.getCompletedDailyCloseHistoryDetail &&
      args &&
      typeof args === "object" &&
      "dailyCloseId" in args
    ) {
      return records.find(
        (record) => String(record._id ?? record.id) === args.dailyCloseId,
      );
    }

    return undefined;
  });
}

describe("DailyCloseHistoryView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.scrollTo = vi.fn();
    window.history.pushState(
      {},
      "",
      "/wigclub/store/osu/operations/daily-close-history",
    );
    mockProtectedState();
    mockQueries();
  });

  it("renders a completed-only history list with scan summary fields", () => {
    render(<DailyCloseHistoryView />);

    const list = screen.getByRole("region", {
      name: "Completed Daily Close records",
    });

    expect(within(list).getByText("Friday, May 8, 2026")).toBeInTheDocument();
    expect(within(list).getByText("Thursday, May 7, 2026")).toBeInTheDocument();
    expect(within(list).getAllByText("Completed")).toHaveLength(2);
    expect(within(list).getAllByText("GH₵1,255")[0]).toBeInTheDocument();
    expect(within(list).queryByText("May 6, 2026")).not.toBeInTheDocument();
  });

  it("renders read-only historical detail with close metadata", () => {
    render(<DailyCloseHistoryView />);

    const detail = screen.getByRole("region", {
      name: "Historical Daily Close detail",
    });

    expect(within(detail).getByText("Historical close")).toBeInTheDocument();
    expect(within(detail).getAllByText("Friday, May 8, 2026")[0]).toBeInTheDocument();
    expect(within(detail).getByText(/Completed by Ama Mensah/)).toBeInTheDocument();
    expect(within(detail).queryByText("Read-only")).not.toBeInTheDocument();
    expect(within(detail).getByText("Close reviewed by owner.")).toBeInTheDocument();
    expect(within(detail).getByText("Completed sale")).toBeInTheDocument();
  });

  it("uses the history record staff name when the stored snapshot has no name", () => {
    const reportSnapshot = storedReportSnapshot(
      snapshot({
        completedClose: {
          completedAt: Date.UTC(2026, 4, 8, 22, 30),
          completedByStaffName: undefined,
          notes: "Close reviewed by owner.",
        },
      }),
    );

    mockQueries([
      historyRecord({
        completedByStaffName: "Kwamina Mensah",
        reportSnapshot,
      }),
    ]);

    render(<DailyCloseHistoryView />);

    expect(screen.getByText(/Completed by Kwamina Mensah/)).toBeInTheDocument();
  });

  it("opens another completed record from the list", async () => {
    const user = userEvent.setup();
    render(<DailyCloseHistoryView />);

    await user.click(screen.getByRole("button", { name: /May 7, 2026/ }));

    expect(screen.getByRole("region", { name: "Historical Daily Close detail" }))
      .toHaveTextContent("Clean close.");
    expect(screen.getByText(/Completed by Kofi Mensah/)).toBeInTheDocument();
  });

  it("renders the empty state when there are no completed records", () => {
    mockQueries([
      historyRecord({
        _id: "daily-close-open",
        operatingDate: "2026-05-08",
        status: "ready",
      }),
    ]);

    render(<DailyCloseHistoryView />);

    expect(screen.getByText("No completed Daily Close records")).toBeInTheDocument();
    expect(screen.queryByText("Historical close")).not.toBeInTheDocument();
  });

  it("does not render mutation controls in historical detail", () => {
    render(<DailyCloseHistoryView />);

    expect(
      screen.queryByRole("button", { name: "Complete End-of-Day Review" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Close notes")).not.toBeInTheDocument();
    expect(screen.queryByText(/manager approval/i)).not.toBeInTheDocument();
  });

  it("keeps source links as navigation with origin context", () => {
    render(<DailyCloseHistoryView />);

    const sourceLink = screen
      .getAllByRole("link", { name: /Open transaction/ })
      .find((link) => link.getAttribute("href")?.includes("/txn-1"));

    expect(sourceLink).toBeDefined();
    expect(sourceLink).toHaveAttribute(
      "href",
      expect.stringContaining("/wigclub/store/osu/pos/transactions/txn-1"),
    );
    expect(sourceLink).toHaveAttribute("href", expect.stringContaining("o="));
  });

  it("renders protected access states", () => {
    mockProtectedState({ isLoadingAccess: true });
    const { rerender } = render(<DailyCloseHistoryView />);

    expect(
      screen.queryByLabelText("Loading Daily Close history access"),
    ).not.toBeInTheDocument();

    mockProtectedState({ isAuthenticated: false });
    rerender(<DailyCloseHistoryView />);
    expect(
      screen.getByText(/session needs to reconnect before Daily Close history/i),
    ).toBeInTheDocument();

    mockProtectedState({ hasFullAdminAccess: false });
    rerender(<DailyCloseHistoryView />);
    expect(screen.getByText("Access Denied")).toBeInTheDocument();

    mockProtectedState({ activeStore: null });
    rerender(<DailyCloseHistoryView />);
    expect(screen.getByText("No active store")).toBeInTheDocument();
  });
});
