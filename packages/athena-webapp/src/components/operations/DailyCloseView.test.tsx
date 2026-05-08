import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DailyCloseView,
  DailyCloseViewContent,
  type DailyCloseSnapshot,
} from "./DailyCloseView";
import type { Id } from "~/convex/_generated/dataModel";
import { ok, userError } from "~/shared/commandResult";

const mockedHooks = vi.hoisted(() => ({
  useMutation: vi.fn(),
  useProtectedAdminPageState: vi.fn(),
  useQuery: vi.fn(),
}));

const mockedApi = vi.hoisted(() => ({
  authenticateStaffCredentialForApproval: "authenticateStaffCredentialForApproval",
  completeDailyClose: "completeDailyClose",
  getDailyCloseSnapshot: "getDailyCloseSnapshot",
}));

const mockedRouter = vi.hoisted(() => ({
  navigate: vi.fn(),
  search: {} as Record<string, unknown>,
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
  useNavigate: () => mockedRouter.navigate,
  useSearch: () => mockedRouter.search,
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
      staffCredentials: {
        authenticateStaffCredentialForApproval:
          mockedApi.authenticateStaffCredentialForApproval,
      },
    },
  },
}));

const baseSummary = {
  carriedOverCashTotal: 0,
  carriedOverRegisterCount: 0,
  cashDeposited: 45000,
  cashExpected: 45000,
  carryForwardCount: 0,
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

const readySnapshot: DailyCloseSnapshot = {
  blockers: [],
  carryForwardItems: [],
  completedClose: null,
  endAt: Date.UTC(2026, 4, 8, 4),
  operatingDate: "2026-05-07",
  readyItems: [
    {
      description: "2 register sessions reconciled.",
      id: "ready-1",
      metadata: {
        closedAt: Date.UTC(2026, 4, 7, 19),
        closedBy: "Ama Boateng",
        countedCash: 95500,
        expectedCash: 95500,
        openedAt: Date.UTC(2026, 4, 5, 9),
        openedBy: "Ama Boateng",
        operatingScope: "Carried over from prior day",
        status: "closed",
        terminal: "Back counter terminal",
        variance: 0,
      },
      subject: {
        id: "session-2",
        label: "Register 2",
        type: "register_session",
      },
      statusLabel: "Ready",
      title: "Register closeouts complete",
    },
    {
      category: "sale",
      description: "Completed sale is included in Daily Close.",
      id: "ready-2",
      metadata: {
        completedAt: Date.UTC(2026, 4, 7, 14),
        owner: "Kofi Mensah",
        paymentMethods: "Cash, Mobile Money",
        terminal: "Front counter terminal / Register A1",
        total: 49500,
        totalPaid: 50000,
        transaction: "TXN-1",
      },
      subject: {
        id: "txn-1",
        label: "TXN-1",
        type: "pos_transaction",
      },
      title: "Completed sale",
    },
    {
      category: "expense",
      description: "Completed expense is included in Daily Close.",
      id: "ready-3",
      link: {
        label: "View expense",
        params: { reportId: "expense-1" },
        to: "/$orgUrlSlug/store/$storeUrlSlug/pos/expense-reports/$reportId",
      },
      metadata: {
        completedAt: Date.UTC(2026, 4, 7, 16),
        notes: "Bought packing supplies.",
        owner: "Akosua Mensah",
        report: "EXP-1",
        terminal: "Front counter terminal / Register A1",
        total: 12500,
      },
      subject: {
        id: "expense-1",
        label: "EXP-1",
        type: "expense_transaction",
      },
      title: "Completed expense",
    },
  ],
  reviewItems: [
    {
      description: "Reviewed by manager before close.",
      id: "review-1",
      statusLabel: "Reviewed",
      title: "Small cash variance reviewed",
    },
  ],
  status: "ready",
  startAt: Date.UTC(2026, 4, 7, 4),
  summary: baseSummary,
};

const blockedSnapshot: DailyCloseSnapshot = {
  ...readySnapshot,
  blockers: [
    {
      category: "register_session",
      description: "Close the register session before completing Daily Close.",
      id: "blocker-1",
      link: {
        label: "View session",
        params: { sessionId: "session-1" },
        to: "/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId",
      },
      metadata: {
        expectedCash: 40000,
        openedAt: Date.UTC(2026, 4, 6, 20),
        operatingScope: "Carried over from prior day",
        status: "open",
        terminal: "Front counter terminal",
        variance: -20000,
      },
      subject: {
        id: "session-1",
        label: "Register 1",
        type: "register_session",
      },
      statusLabel: "Blocks close",
      title: "Register session is still open",
    },
    {
      category: "approval",
      description:
        "Resolve pending closeout approval before completing Daily Close.",
      id: "approval-1",
      link: {
        label: "View approvals",
        to: "/$orgUrlSlug/store/$storeUrlSlug/operations/approvals",
      },
      metadata: {
        amount: 49500,
        approval: "Payment method correction",
        currentMethod: "Mobile Money",
        notes: "Customer paid cash after mobile money failed.",
        reason: "Variance of -20000 exceeded the closeout approval threshold.",
        register: "Register 3",
        requestedAt: Date.UTC(2026, 4, 7, 16),
        requestedBy: "Ato Kwamina",
        requestedMethod: "Cash",
        terminal: "Codex",
        transaction: "354477",
        transactionId: "txn-approval-1",
      },
      subject: {
        id: "approval-1",
        type: "approval_request",
      },
      title: "Payment method correction pending",
    },
    {
      category: "pos_session",
      description:
        "Complete, void, or release held POS sessions before Daily Close.",
      id: "blocker-2",
      metadata: {
        customer: "Ama Mensah",
        expiresAt: 1,
        owner: "Kofi Mensah",
        session: "SES-194",
        status: "held",
        terminal: "Safari QA / Register 6",
        total: 33500,
      },
      subject: {
        id: "pos-1",
        label: "SES-194",
        type: "pos_session",
      },
      title: "POS session is still unresolved",
    },
  ],
  readyItems: [],
  status: "blocked",
};

function renderContent(
  snapshot: DailyCloseSnapshot | undefined,
  overrides: Partial<React.ComponentProps<typeof DailyCloseViewContent>> = {},
) {
  return render(
    <DailyCloseViewContent
      currency="GHS"
      hasFullAdminAccess
      isAuthenticated
      isCompleting={false}
      isLoadingAccess={false}
      isLoadingSnapshot={snapshot === undefined}
      onComplete={vi.fn(async () => ok({ closeId: "close-1" }))}
      orgUrlSlug="wigclub"
      snapshot={snapshot}
      storeId={"store-1" as Id<"store">}
      storeUrlSlug="osu"
      {...overrides}
    />,
  );
}

describe("DailyCloseViewContent", () => {
  beforeEach(() => {
    window.scrollTo = vi.fn();
    global.ResizeObserver = class ResizeObserver {
      disconnect() {}
      observe() {}
      unobserve() {}
    };
    mockedRouter.search = {};
    vi.clearAllMocks();
  });

  it("renders the workspace frame while loading", () => {
    renderContent(undefined);

    expect(screen.getByText("Daily Close")).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Loading daily close workspace"),
    ).not.toBeInTheDocument();
  });

  it("shows blocked items, links to source workflows, and disables completion", () => {
    renderContent(blockedSnapshot);

    expect(
      screen.getByText("Register session is still open"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view session/i })).toHaveAttribute(
      "href",
      "/wigclub/store/osu/cash-controls/registers/session-1?o=%252F",
    );
    expect(screen.getByText("Register Session")).toBeInTheDocument();
    expect(screen.queryByText("Register 1")).not.toBeInTheDocument();
    expect(
      screen.getByText("Front counter terminal / Register 1"),
    ).toBeInTheDocument();
    expect(screen.getByText("Operating Scope")).toBeInTheDocument();
    expect(screen.getByText("Carried over from prior day")).toBeInTheDocument();
    expect(screen.getByText("Opened At")).toBeInTheDocument();
    expect(screen.getByText("GH₵400")).toBeInTheDocument();
    expect(screen.getByText("GH₵-200")).toHaveClass("text-danger");
    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(
      screen.getByText("Payment method correction pending"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /view approvals/i }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/osu/operations/approvals?o=%252F",
    );
    expect(screen.getByText("Payment method correction")).toBeInTheDocument();
    expect(screen.getByText("Ato Kwamina")).toBeInTheDocument();
    expect(
      screen.getAllByText((_, element) =>
        Boolean(element?.textContent?.includes("Codex / Register 3")),
      ).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText(
        "Variance of GH₵-200 exceeded the closeout approval threshold",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/-20000/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "#354477" })).toHaveAttribute(
      "href",
      "/wigclub/store/osu/pos/transactions/txn-approval-1?o=%252F",
    );
    expect(screen.getByText("Mobile Money")).toBeInTheDocument();
    expect(screen.getByText("Cash")).toBeInTheDocument();
    expect(
      screen.getByText("POS session is still unresolved"),
    ).toBeInTheDocument();
    expect(screen.getByText("SES-194")).toBeInTheDocument();
    expect(screen.getByText("Safari QA / Register 6")).toBeInTheDocument();
    expect(screen.getByText("Kofi Mensah")).toBeInTheDocument();
    expect(screen.getByText("Ama Mensah")).toBeInTheDocument();
    expect(screen.getByText("GH₵335")).toBeInTheDocument();
    expect(screen.getByText("Held")).toBeInTheDocument();
    expect(screen.getByText("Expired At")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /complete daily close/i }),
    ).toBeDisabled();
  });

  it("shows ready summary totals and enables completion", () => {
    renderContent(readySnapshot);

    expect(screen.getByText("Ready to close")).toBeInTheDocument();
    expect(screen.getByText("14 transactions")).toBeInTheDocument();
    expect(screen.getByText("2 cash transactions")).toBeInTheDocument();
    expect(
      screen.getByText("No registers from prior days"),
    ).toBeInTheDocument();
    expect(screen.getByText("No register variances")).toBeInTheDocument();
    expect(screen.getByText("Register closeouts complete")).toBeInTheDocument();
    const closedRegisterItem = screen
      .getByText("Register closeouts complete")
      .closest("article");
    expect(closedRegisterItem).not.toBeNull();
    expect(
      within(closedRegisterItem as HTMLElement).getAllByText("GH₵955"),
    ).toHaveLength(2);
    expect(
      within(closedRegisterItem as HTMLElement).queryByText("Variance"),
    ).not.toBeInTheDocument();
    expect(
      within(closedRegisterItem as HTMLElement).queryByText("GH₵0"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Completed sale")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "#TXN-1" })).toHaveAttribute(
      "href",
      "/wigclub/store/osu/pos/transactions/txn-1?o=%252F",
    );
    const saleItem = screen.getByText("Completed sale").closest("article");
    expect(saleItem).not.toBeNull();
    expect(
      within(saleItem as HTMLElement).getByText(
        "Front counter terminal / Register A1",
      ),
    ).toBeInTheDocument();
    expect(
      within(saleItem as HTMLElement).getByText("Kofi Mensah"),
    ).toBeInTheDocument();
    expect(
      within(saleItem as HTMLElement).getByText("Staff"),
    ).toBeInTheDocument();
    expect(
      within(saleItem as HTMLElement).queryByText("Owner"),
    ).not.toBeInTheDocument();
    expect(
      within(saleItem as HTMLElement).getByText("Cash, Mobile Money"),
    ).toBeInTheDocument();
    expect(
      within(saleItem as HTMLElement).getByText("Completed At"),
    ).toBeInTheDocument();
    expect(
      within(saleItem as HTMLElement).getByText("GH₵495"),
    ).toBeInTheDocument();
    expect(
      within(saleItem as HTMLElement).getByText("GH₵500"),
    ).toBeInTheDocument();
    expect(screen.getByText("Completed expense")).toBeInTheDocument();
    const expenseItem = screen.getByText("Completed expense").closest("article");
    expect(expenseItem).not.toBeNull();
    expect(
      within(expenseItem as HTMLElement).getByRole("link", {
        name: "#EXP-1",
      }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/osu/pos/expense-reports/expense-1?o=%252F",
    );
    expect(
      within(expenseItem as HTMLElement).getByText("Akosua Mensah"),
    ).toBeInTheDocument();
    expect(
      within(expenseItem as HTMLElement).getByText("Staff"),
    ).toBeInTheDocument();
    expect(
      within(expenseItem as HTMLElement).queryByText("Owner"),
    ).not.toBeInTheDocument();
    expect(
      within(expenseItem as HTMLElement).getByText(
        "Front counter terminal / Register A1",
      ),
    ).toBeInTheDocument();
    expect(
      within(expenseItem as HTMLElement).getByText("Bought packing supplies."),
    ).toBeInTheDocument();
    expect(
      within(expenseItem as HTMLElement).getByText("GH₵125"),
    ).toBeInTheDocument();
    expect(
      within(expenseItem as HTMLElement).getByRole("link", {
        name: /view expense/i,
      }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/osu/pos/expense-reports/expense-1?o=%252F",
    );
    expect(
      screen.getByRole("button", { name: /complete daily close/i }),
    ).toBeEnabled();
    const checklist = screen.getByText("Close checklist").closest("div");
    expect(checklist).not.toBeNull();
    within(checklist as HTMLElement)
      .getAllByText("Clear")
      .forEach((value) => {
        expect(value).not.toHaveClass("text-success");
        expect(value).not.toHaveClass("text-warning-foreground");
      });
    expect(within(checklist as HTMLElement).getByText("None")).not.toHaveClass(
      "text-action-workflow",
    );
  });

  it("labels a ready zero-activity day explicitly", () => {
    renderContent({
      ...readySnapshot,
      readyItems: [],
      reviewItems: [],
      summary: {
        carriedOverCashTotal: 0,
        carriedOverRegisterCount: 0,
        cashDeposited: 0,
        cashExpected: 0,
        carryForwardCount: 0,
        currentDayCashTransactionCount: 0,
        currentDayCashTotal: 0,
        expenseStaffCount: 0,
        expenseTotal: 0,
        registerCount: 0,
        registerVarianceCount: 0,
        staffCount: 0,
        totalSales: 0,
        transactionCount: 0,
        varianceTotal: 0,
      },
    });

    expect(screen.getByText("No activity to close")).toBeInTheDocument();
    expect(
      screen.getByText(
        "No sales, register activity, expenses, or follow-ups were recorded for this operating day.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No activity was recorded for this operating day."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /complete daily close/i }),
    ).toBeEnabled();
  });

  it("uses explicit register metadata instead of also appending the subject register", () => {
    renderContent({
      ...readySnapshot,
      readyItems: [
        {
          ...readySnapshot.readyItems[0],
          metadata: {
            ...readySnapshot.readyItems[0].metadata,
            register: "Register 3",
            terminal: "Codex",
          },
          subject: {
            id: "session-3",
            label: "Register 3",
            type: "register_session",
          },
        },
      ],
    });

    expect(screen.getByText("Codex / Register 3")).toBeInTheDocument();
    expect(
      screen.queryByText("Codex / Register 3 / Register 3"),
    ).not.toBeInTheDocument();
  });

  it("uses natural count grammar in summary helpers", () => {
    renderContent({
      ...readySnapshot,
      summary: {
        ...baseSummary,
        carryForwardCount: 0,
        carriedOverRegisterCount: 1,
        currentDayCashTransactionCount: 0,
        expenseTransactionCount: 1,
        registerVarianceCount: 1,
        staffCount: 1,
        transactionCount: 1,
      },
    });

    expect(screen.getByText("1 transaction")).toBeInTheDocument();
    expect(screen.getByText("No cash transactions")).toBeInTheDocument();
    expect(screen.getByText("1 register from a prior day")).toBeInTheDocument();
    expect(screen.getByText("1 register variance")).toBeInTheDocument();
    expect(screen.getByText("1 expense transaction")).toBeInTheDocument();
  });

  it("reports expense transaction counts without falling back to staff or approvals", () => {
    renderContent({
      ...readySnapshot,
      summary: {
        ...baseSummary,
        expenseTransactionCount: undefined,
        expenseStaffCount: undefined,
        expenseTotal: 0,
        pendingApprovalCount: 1,
        staffCount: undefined,
      },
    });

    expect(screen.getByText("No expense transactions")).toBeInTheDocument();
    expect(
      screen.queryByText("1 expense transaction"),
    ).not.toBeInTheDocument();
  });

  it("keeps review context available from the ready state", () => {
    mockedRouter.search = { tab: "review" };

    renderContent(readySnapshot);

    const reviewSection = screen.getByRole("region", {
      name: /review before close/i,
    });

    expect(
      within(reviewSection).getByText("Small cash variance reviewed"),
    ).toBeInTheDocument();
    expect(
      within(reviewSection).getByText("Reviewed by manager before close."),
    ).toBeInTheDocument();
    expect(
      within(reviewSection).queryByText("Reviewed"),
    ).not.toBeInTheDocument();
  });

  it("restores the selected bucket from the URL and preserves search params when changing tabs", async () => {
    const user = userEvent.setup();
    mockedRouter.search = {
      o: "%2Fwigclub%2Fstore%2Fwigclub%2Foperations",
      tab: "ready",
    };

    renderContent(blockedSnapshot);

    expect(screen.getByRole("tab", { name: /ready/i })).toHaveAttribute(
      "data-state",
      "active",
    );

    await user.click(screen.getByRole("tab", { name: /blocked/i }));

    expect(mockedRouter.navigate).toHaveBeenCalledWith({
      search: expect.any(Function),
    });

    const searchUpdater = mockedRouter.navigate.mock.calls[0]?.[0]
      ?.search as (current: Record<string, unknown>) => Record<string, unknown>;

    expect(
      searchUpdater({
        o: "%2Fwigclub%2Fstore%2Fwigclub%2Foperations",
        tab: "ready",
      }),
    ).toEqual({
      o: "%2Fwigclub%2Fstore%2Fwigclub%2Foperations",
      tab: "blocked",
    });
  });

  it("includes selected carry-forward items in completion args", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn(async () => ok({ closeId: "close-1" }));
    const snapshot: DailyCloseSnapshot = {
      ...readySnapshot,
      carryForwardItems: [
        {
          description: "Check missing receipt during opening.",
          id: "carry-1",
          statusLabel: "Carry forward",
          title: "Receipt follow-up",
        },
      ],
      status: "carry_forward",
      summary: {
        ...baseSummary,
        carryForwardCount: 1,
      },
    };

    renderContent(snapshot, { onComplete });

    await user.click(
      screen.getByRole("button", { name: /complete daily close/i }),
    );

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith({
        carryForwardWorkItemIds: ["carry-1"],
        endAt: readySnapshot.endAt,
        notes: "",
        operatingDate: "2026-05-07",
        reviewedItemKeys: ["review-1"],
        startAt: readySnapshot.startAt,
      });
    });
  });

  it("opens manager approval when completion requires it", async () => {
    const user = userEvent.setup();

    renderContent(readySnapshot, {
      onComplete: vi.fn(async () => ({
        kind: "approval_required" as const,
        approval: {
          action: {
            key: "operations.daily_close.complete",
            label: "Complete Daily Close",
          },
          copy: {
            message:
              "A manager needs to approve this Daily Close before the operating day is saved.",
            primaryActionLabel: "Approve and complete",
            secondaryActionLabel: "Cancel",
            title: "Manager approval required",
          },
          reason: "Manager approval is required to complete Daily Close.",
          requiredRole: "manager" as const,
          resolutionModes: [{ kind: "inline_manager_proof" as const }],
          selfApproval: "allowed" as const,
          subject: {
            id: "store-1:2026-05-07",
            label: "Daily Close 2026-05-07",
            type: "daily_close",
          },
        },
      })),
    });

    await user.click(
      screen.getByRole("button", { name: /complete daily close/i }),
    );

    expect(
      await screen.findByRole("heading", {
        name: "Manager approval required",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Enter manager credentials")).toBeInTheDocument();
  });

  it("renders command-result user errors inline with operator-safe copy", async () => {
    const user = userEvent.setup();

    renderContent(readySnapshot, {
      onComplete: vi.fn(async () =>
        userError({
          code: "precondition_failed",
          message: "Open the cash drawer before completing this sale.",
        }),
      ),
    });

    await user.click(
      screen.getByRole("button", { name: /complete daily close/i }),
    );

    expect(
      await screen.findByText(
        "Drawer closed. Open the drawer before completing this sale.",
      ),
    ).toBeInTheDocument();
  });

  it("renders completed Daily Close summary after reload", () => {
    renderContent({
      ...readySnapshot,
      completedClose: {
        completedAt: Date.UTC(2026, 4, 7, 23, 15),
        completedByStaffName: "Ama Mensah",
        notes: "Clean close.",
      },
      status: "completed",
    });

    expect(screen.getByText("Daily close completed")).toBeInTheDocument();
    expect(screen.getByText(/Ama Mensah/)).toBeInTheDocument();
    expect(screen.getByText("Clean close.")).toBeInTheDocument();
  });

  it("renders protected access states consistently with operations pages", () => {
    renderContent(readySnapshot, { hasFullAdminAccess: false });

    expect(screen.getByText("Access Denied")).toBeInTheDocument();
  });
});

describe("DailyCloseView", () => {
  beforeEach(() => {
    window.scrollTo = vi.fn();
    vi.clearAllMocks();
    mockedHooks.useProtectedAdminPageState.mockReturnValue({
      activeStore: {
        _id: "store-1",
        currency: "GHS",
      },
      canQueryProtectedData: true,
      hasFullAdminAccess: true,
      isAuthenticated: true,
      isLoadingAccess: false,
    });
    mockedHooks.useQuery.mockReturnValue(readySnapshot);
    mockedHooks.useMutation.mockReturnValue(vi.fn(async () => ok({})));
  });

  it("queries Daily Close with the active store and route params", () => {
    render(<DailyCloseView />);

    expect(mockedHooks.useQuery).toHaveBeenCalledWith(
      mockedApi.getDailyCloseSnapshot,
      {
        endAt: expect.any(Number),
        operatingDate: expect.any(String),
        startAt: expect.any(Number),
        storeId: "store-1",
      },
    );
    expect(screen.getByText("Daily Close")).toBeInTheDocument();
  });
});
