import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DailyOpeningView,
  DailyOpeningViewContent,
  type DailyOpeningSnapshot,
} from "./DailyOpeningView";
import type { Id } from "~/convex/_generated/dataModel";
import { ok, userError } from "~/shared/commandResult";

const mockedHooks = vi.hoisted(() => ({
  useMutation: vi.fn(),
  useProtectedAdminPageState: vi.fn(),
  useQuery: vi.fn(),
}));

const mockedApi = vi.hoisted(() => ({
  authenticateStaffCredentialForApproval:
    "authenticateStaffCredentialForApproval",
  getDailyOpeningSnapshot: "getDailyOpeningSnapshot",
  startStoreDay: "startStoreDay",
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
  useNavigate: () => mockedRouter.navigate,
  useParams: () => ({
    orgUrlSlug: "wigclub",
    storeUrlSlug: "osu",
  }),
  useSearch: () => mockedRouter.search,
}));

vi.mock("convex/react", () => ({
  useMutation: mockedHooks.useMutation,
  useQuery: mockedHooks.useQuery,
}));

vi.mock("@/hooks/useProtectedAdminPageState", () => ({
  useProtectedAdminPageState: mockedHooks.useProtectedAdminPageState,
}));

vi.mock("./CommandApprovalDialog", () => ({
  CommandApprovalDialog: ({
    approval,
    onApproved,
    onAuthenticateForApproval,
    onDismiss,
    open,
  }: {
    approval: {
      action: { key: string };
      reason: string;
      requiredRole: "manager";
      subject: { id: string; label?: string; type: string };
    };
    onApproved: (result: {
      approvalProofId: Id<"approvalProof">;
      approvedByStaffProfileId: Id<"staffProfile">;
      expiresAt: number;
    }) => void;
    onAuthenticateForApproval: (args: {
      actionKey: string;
      pinHash: string;
      reason: string;
      requiredRole: "manager";
      storeId: Id<"store">;
      subject: { id: string; label?: string; type: string };
      username: string;
    }) => Promise<{
      data?: {
        approvalProofId: Id<"approvalProof">;
        approvedByStaffProfileId: Id<"staffProfile">;
        expiresAt: number;
      };
      kind: string;
    }>;
    onDismiss: () => void;
    open: boolean;
  }) =>
    open ? (
      <div aria-label="Manager sign-in required" role="dialog">
        <p>Manager sign-in required</p>
        <button
          onClick={async () => {
            const result = await onAuthenticateForApproval({
              actionKey: approval.action.key,
              pinHash: "pin-hash",
              reason: approval.reason,
              requiredRole: approval.requiredRole,
              storeId: "store-1" as Id<"store">,
              subject: approval.subject,
              username: "manager",
            });

            if (result.kind === "ok" && result.data) {
              onApproved(result.data);
            }
          }}
          type="button"
        >
          Confirm manager
        </button>
        <button onClick={onDismiss} type="button">
          Cancel
        </button>
      </div>
    ) : null,
}));

vi.mock("~/convex/_generated/api", () => ({
  api: {
    operations: {
      dailyOpening: mockedApi,
      staffCredentials: {
        authenticateStaffCredentialForApproval:
          mockedApi.authenticateStaffCredentialForApproval,
      },
    },
  },
}));

const readySnapshot: DailyOpeningSnapshot = {
  blockers: [],
  carryForwardItems: [],
  endAt: Date.UTC(2026, 4, 9, 4),
  operatingDate: "2026-05-08",
  priorClose: {
    completedAt: Date.UTC(2026, 4, 8, 23, 15),
    completedByStaffName: "Ama Mensah",
    operatingDate: "2026-05-07",
  },
  readyItems: [
    {
      description: "End-of-Day Review for 7 May is complete.",
      id: "ready-1",
      link: {
        label: "View End-of-Day Review",
        search: {
          operatingDate: "2026-05-07",
        },
        to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
      },
      metadata: {
        completedAt: Date.UTC(2026, 4, 8, 23, 15),
        operatingDate: "2026-05-07",
      },
      statusLabel: "Ready",
      title: "Prior close complete",
    },
  ],
  reviewItems: [],
  startAt: Date.UTC(2026, 4, 8, 4),
  status: "ready",
  summary: {
    blockerCount: 0,
    carryForwardCount: 0,
    readyCount: 1,
    reviewCount: 0,
  },
};

function formatExpectedTimestamp(timestamp: number) {
  return new Date(timestamp).toLocaleString([], {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  });
}

const blockedSnapshot: DailyOpeningSnapshot = {
  ...readySnapshot,
  blockers: [
    {
      category: "register_session",
      description: "Close the carried-over register session in Cash Controls.",
      id: "blocker-1",
      link: {
        label: "Open Cash Controls",
        params: { sessionId: "session-1" },
        to: "/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId",
      },
      metadata: {
        register: "Register 1",
        terminal: "Front counter terminal",
      },
      statusLabel: "Blocks opening",
      title: "Register session still needs closeout",
    },
  ],
  readyItems: [],
  status: "blocked",
  summary: {
    blockerCount: 1,
    carryForwardCount: 0,
    readyCount: 0,
    reviewCount: 0,
  },
};

const attentionSnapshot: DailyOpeningSnapshot = {
  ...readySnapshot,
  carryForwardItems: [
    {
      category: "operational_work_item",
      description: "Check the receipt batch before noon.",
      id: "carry-1",
      key: "work-1",
      link: {
        label: "View open work",
        to: "/$orgUrlSlug/store/$storeUrlSlug/operations/open-work",
      },
      statusLabel: "Open",
      title: "Receipt follow-up",
    },
  ],
  reviewItems: [
    {
      description: "Manager accepted a small cash variance during close.",
      id: "review-1",
      key: "review-1",
      statusLabel: "Needs acknowledgement",
      title: "Cash variance reviewed at close",
    },
  ],
  status: "needs_attention",
  summary: {
    blockerCount: 0,
    carryForwardCount: 1,
    readyCount: 1,
    reviewCount: 1,
  },
};

function renderContent(
  snapshot: DailyOpeningSnapshot | undefined,
  overrides: Partial<React.ComponentProps<typeof DailyOpeningViewContent>> = {},
) {
  return render(
    <DailyOpeningViewContent
      currency="GHS"
      hasFullAdminAccess
      isAuthenticated
      isLoadingAccess={false}
      isLoadingSnapshot={snapshot === undefined}
      isStarting={false}
      onStartDay={vi.fn(async () => ok({ openingId: "opening-1" }))}
      orgUrlSlug="wigclub"
      snapshot={snapshot}
      storeId={"store-1" as Id<"store">}
      storeUrlSlug="osu"
      {...overrides}
    />,
  );
}

describe("DailyOpeningViewContent", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/");
    window.scrollTo = vi.fn();
    global.ResizeObserver = class ResizeObserver {
      disconnect() {}
      observe() {}
      unobserve() {}
    };
    mockedRouter.search = {};
    vi.clearAllMocks();
  });

  it("renders a loading workspace while the snapshot loads", () => {
    renderContent(undefined);

    expect(screen.getByText("Opening Handoff")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Loading daily opening workspace"),
    ).toBeInTheDocument();
  });

  it("shows ready state and enables Start Day without drawer controls", () => {
    renderContent(readySnapshot);

    expect(screen.getByText("Ready to start")).toBeInTheDocument();
    expect(screen.getByText("Prior close complete")).toBeInTheDocument();
    expect(screen.getByText("Completed At")).toBeInTheDocument();
    expect(
      screen.getByText(
        formatExpectedTimestamp(readySnapshot.priorClose!.completedAt!),
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("GHS 17,783,033,180.02")).not.toBeInTheDocument();
    expect(screen.getByText("No hard blockers")).toBeInTheDocument();
    expect(screen.getByText("No carry-forward items")).toBeInTheDocument();
    expect(screen.queryByText(/opening float/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /view end-of-day review/i }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/osu/operations/daily-close?o=%252F&operatingDate=2026-05-07",
    );
    expect(screen.queryByRole("button", { name: /open drawer/i })).toBeNull();
    expect(screen.getByRole("button", { name: /start day/i })).toBeEnabled();
  });

  it("shows blockers, links to source workflows, and disables Start Day", () => {
    renderContent(blockedSnapshot);

    expect(screen.getByText("Opening blocked")).toBeInTheDocument();
    expect(
      screen.getByText("Register session still needs closeout"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /open cash controls/i }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/osu/cash-controls/registers/session-1?o=%252F",
    );
    expect(screen.getByText("Front counter terminal")).toBeInTheDocument();
    expect(screen.getByText("Register 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start day/i })).toBeDisabled();
  });

  it("hides stale blocker detail once the store day has started", () => {
    renderContent({
      ...blockedSnapshot,
      startedOpening: {
        notes: "Opening completed after manager review.",
        startedAt: Date.UTC(2026, 4, 9, 10, 51),
        startedByStaffName: "Kwamina Mensah",
      },
      status: "started",
      summary: {
        ...blockedSnapshot.summary,
        blockerCount: 1,
      },
    });

    expect(screen.getByText("Store day started")).toBeInTheDocument();
    expect(screen.getByText("No hard blockers")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /blocked/i })).toBeNull();
    expect(
      screen.queryByText("Register session still needs closeout"),
    ).toBeNull();
    expect(screen.queryByText("1 blocker")).toBeNull();
  });

  it("renders pending approval metadata as operator-facing detail", async () => {
    const user = userEvent.setup();

    window.history.pushState(
      {},
      "",
      "/wigclub/store/osu/operations/opening?tab=blocked",
    );
    mockedRouter.search = { tab: "blocked" };

    renderContent({
      ...blockedSnapshot,
      blockers: [
        {
          category: "approval",
          description:
            "A pending register or closeout approval must be resolved before Opening can be acknowledged.",
          id: "approval-1",
          key: "approval_request:approval-1:pending",
          link: {
            label: "View approvals",
            to: "/$orgUrlSlug/store/$storeUrlSlug/operations/approvals",
          },
          metadata: [
            {
              label: "Request",
              value: "Payment correction",
            },
            {
              label: "Transaction",
              value: "298944",
            },
            {
              label: "transactionId",
              value: "txn-1",
            },
            {
              label: "Current method",
              value: "Mobile Money",
            },
            {
              label: "Requested method",
              value: "Cash",
            },
            {
              label: "Amount",
              value: 171500,
            },
            {
              label: "Requester note",
              value: "Customer paid cash, not mobile money.",
            },
          ],
          title: "Payment correction approval pending",
        },
      ],
    });

    expect(
      screen.getByText("Payment correction approval pending"),
    ).toBeInTheDocument();
    expect(screen.getByText("Request")).toBeInTheDocument();
    expect(screen.getByText("Payment correction")).toBeInTheDocument();
    expect(screen.getByText("Transaction")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /#298944/i })).toHaveAttribute(
      "href",
      "/wigclub/store/osu/pos/transactions/txn-1?o=%252Fwigclub%252Fstore%252Fosu%252Foperations%252Fopening%253Ftab%253Dblocked",
    );
    expect(screen.queryByText("transactionId")).toBeNull();
    expect(screen.queryByText("txn-1")).toBeNull();
    expect(screen.getByText("Current method")).toBeInTheDocument();
    expect(screen.getByText("Mobile Money")).toBeInTheDocument();
    expect(screen.getByText("Requested method")).toBeInTheDocument();
    expect(screen.getByText("Cash")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /show details/i }));
    expect(screen.getByText("Amount")).toBeInTheDocument();
    expect(screen.getByText("GHS 1,715.00")).toBeInTheDocument();
    expect(screen.getByText("Requester note")).toBeInTheDocument();
    expect(
      screen.getByText("Customer paid cash, not mobile money."),
    ).toBeInTheDocument();
    expect(screen.queryByText("payment_method_correction")).toBeNull();
    expect(screen.queryByText("pos_transaction")).toBeNull();
    expect(
      screen.getByRole("link", { name: /view approvals/i }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/osu/operations/approvals?o=%252Fwigclub%252Fstore%252Fosu%252Foperations%252Fopening%253Ftab%253Dblocked",
    );
  });

  it("explains the store day when prior End-of-Day Review is missing", () => {
    renderContent({
      ...readySnapshot,
      blockers: [],
      priorClose: null,
      readyItems: [],
      reviewItems: [
        {
          category: "prior_close",
          id: "missing-prior-close",
          key: "daily_close:prior:missing",
          metadata: {
            operatingDate: "2026-05-08",
          },
          statusLabel: "Needs review",
          title: "Prior End-of-Day Review not found",
        },
      ],
      status: "needs_attention",
      summary: {
        blockerCount: 0,
        carryForwardCount: 0,
        readyCount: 0,
        reviewCount: 1,
      },
    });

    const storeDayLabel = screen.getByText("Store day being opened");
    expect(storeDayLabel).toBeInTheDocument();
    expect(
      within(storeDayLabel.closest("div")!).getByText("May 8, 2026"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Operating Date")).not.toBeInTheDocument();
  });

  it("requires review and carry-forward acknowledgements before starting", async () => {
    const user = userEvent.setup();
    const onStartDay = vi.fn(async () => ok({ openingId: "opening-1" }));

    renderContent(attentionSnapshot, { onStartDay });

    const startButton = screen.getByRole("button", { name: /start day/i });
    expect(screen.getByText("Ready with attention")).toBeInTheDocument();
    expect(startButton).toBeDisabled();

    await user.click(
      screen.getByRole("checkbox", {
        name: /acknowledge cash variance reviewed at close/i,
      }),
    );
    expect(startButton).toBeDisabled();

    await user.click(screen.getByRole("tab", { name: /carry forward/i }));
    await user.click(
      screen.getByRole("checkbox", {
        name: /acknowledge receipt follow-up/i,
      }),
    );
    expect(startButton).toBeEnabled();

    await user.click(startButton);

    await waitFor(() => {
      expect(onStartDay).toHaveBeenCalledWith({
        acknowledgedItemKeys: ["review-1", "work-1"],
        endAt: attentionSnapshot.endAt,
        notes: "",
        operatingDate: "2026-05-08",
        startAt: attentionSnapshot.startAt,
      });
    });
  });

  it("renders command-result user errors inline with operator-safe copy", async () => {
    const user = userEvent.setup();

    renderContent(readySnapshot, {
      onStartDay: vi.fn(async () =>
        userError({
          code: "precondition_failed",
          message: "Open the cash drawer before starting the store day.",
        }),
      ),
    });

    await user.click(screen.getByRole("button", { name: /start day/i }));

    expect(
      await screen.findByText(
        "Drawer closed. Open the drawer before starting the store day.",
      ),
    ).toBeInTheDocument();
  });

  it("presents manager approval before starting the store day", async () => {
    const user = userEvent.setup();
    const onAuthenticateForApproval = vi.fn(async () =>
      ok({
        approvalProofId: "proof-1" as Id<"approvalProof">,
        approvedByStaffProfileId: "staff-manager" as Id<"staffProfile">,
        expiresAt: 1_800_000_000_000,
      }),
    );
    const onStartDay = vi.fn(async () => ok({ openingId: "opening-1" }));

    renderContent(readySnapshot, {
      onAuthenticateForApproval,
      onStartDay,
    });

    await user.click(screen.getByRole("button", { name: /start day/i }));

    expect(
      screen.getByRole("dialog", { name: /manager sign-in required/i }),
    ).toBeInTheDocument();
    expect(onStartDay).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /confirm manager/i }));

    await waitFor(() => {
      expect(onAuthenticateForApproval).toHaveBeenCalledWith({
        actionKey: "operations.daily_opening.start_day",
        pinHash: "pin-hash",
        reason: "Manager approval is required to start the store day.",
        requiredRole: "manager",
        storeId: "store-1",
        subject: {
          id: "store-1:2026-05-08",
          label: "Opening May 8, 2026",
          type: "daily_opening",
        },
        username: "manager",
      });
      expect(onStartDay).toHaveBeenCalledWith({
        acknowledgedItemKeys: [],
        actorStaffProfileId: "staff-manager",
        endAt: readySnapshot.endAt,
        notes: "",
        operatingDate: "2026-05-08",
        startAt: readySnapshot.startAt,
      });
    });
  });

  it("shows already-started state without offering a duplicate start", () => {
    renderContent({
      ...readySnapshot,
      startedOpening: {
        notes: "Morning handoff reviewed.",
        startedAt: Date.UTC(2026, 4, 8, 8, 30),
        startedByStaffName: "Kofi Mensah",
      },
      status: "started",
    });

    expect(screen.getByText("Store day started")).toBeInTheDocument();
    expect(
      screen.getAllByText(
        "Opening handoff is complete. The store day is ready to run.",
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("Opening handoff complete")).toBeInTheDocument();
    expect(screen.getByText("Started by")).toBeInTheDocument();
    expect(screen.getByText("Kofi Mensah")).toBeInTheDocument();
    expect(screen.getByText("Started at")).toBeInTheDocument();
    expect(screen.getByText("Morning handoff reviewed.")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /start day/i }),
    ).not.toBeInTheDocument();
  });

  it("renders protected access states consistently with operations pages", () => {
    renderContent(readySnapshot, { hasFullAdminAccess: false });

    expect(screen.getByText("Access Denied")).toBeInTheDocument();
  });
});

describe("DailyOpeningView", () => {
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
    mockedHooks.useMutation.mockReturnValue(vi.fn(async () => ok({})));
    mockedHooks.useQuery.mockReturnValue(readySnapshot);
  });

  it("queries Opening Handoff with the active store and route params", () => {
    render(<DailyOpeningView />);

    expect(mockedHooks.useQuery).toHaveBeenCalledWith(
      mockedApi.getDailyOpeningSnapshot,
      {
        endAt: expect.any(Number),
        operatingDate: expect.any(String),
        startAt: expect.any(Number),
        storeId: "store-1",
      },
    );
    expect(screen.getByText("Opening Handoff")).toBeInTheDocument();
  });
});
