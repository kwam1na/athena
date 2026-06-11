import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  POSTerminalDetailView,
  POSTerminalDetailViewContent,
} from "./POSTerminalDetailView";
import type { TerminalHealthDetail } from "./terminalHealthTypes";

const mocks = vi.hoisted(() => ({
  authState: {
    isLoading: false,
    user: { _id: "user-1" } as { _id: string } | null,
  },
  activeStoreState: {
    activeStore: { _id: "store-1" },
    isLoadingStores: false,
  },
  canAccessPOS: vi.fn(() => true),
  mutation: vi.fn(),
  useQuery: vi.fn(() => null),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    to,
  }: {
    children?: React.ReactNode;
    params?: {
      orgUrlSlug: string;
      sessionId?: string;
      storeUrlSlug: string;
      terminalId?: string;
      transactionId?: string;
    };
    to?: string;
  }) => (
    <a
      href={
        to
          ?.replace("$orgUrlSlug", params?.orgUrlSlug ?? "")
          .replace("$storeUrlSlug", params?.storeUrlSlug ?? "")
          .replace("$sessionId", params?.sessionId ?? "")
          .replace("$terminalId", params?.terminalId ?? "")
          .replace("$transactionId", params?.transactionId ?? "") ?? "#"
      }
    >
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
  useParams: () => ({
    orgUrlSlug: "acme",
    storeUrlSlug: "osu",
    terminalId: "terminal-1",
  }),
  useSearch: () => ({}),
}));

vi.mock("convex/react", () => ({
  useMutation: () => mocks.mutation,
  useQuery: mocks.useQuery,
}));

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => mocks.authState,
}));

vi.mock("@/hooks/useGetActiveStore", () => ({
  default: () => mocks.activeStoreState,
}));

vi.mock("@/hooks/usePermissions", () => ({
  usePermissions: () => ({
    canAccessPOS: mocks.canAccessPOS,
    isLoading: false,
  }),
}));

vi.mock("@/components/View", () => ({
  default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/common/FadeIn", () => ({
  FadeIn: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/common/PageLevelHeader", () => ({
  PageLevelHeader: ({
    title,
  }: {
    title: string;
  }) => <h1>{title}</h1>,
  PageWorkspace: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/components/states/no-permission/NoPermissionView", () => ({
  NoPermissionView: () => <div>No permission</div>,
}));

vi.mock("@/components/states/signed-out/ProtectedAdminSignInView", () => ({
  ProtectedAdminSignInView: ({ description }: { description: string }) => (
    <div>{description}</div>
  ),
}));

const detail: TerminalHealthDetail = {
  attentionReasons: [
    {
      actionTarget: { type: "pos_register" },
      count: 1,
      nextPendingUploadSequence: 14,
      source: "local_runtime",
      summary: "1 local review item is still on this terminal.",
      type: "local_review",
    },
    {
      actionTarget: {
        registerSessionId: "register-session-1",
        type: "cash_control_register_session",
      },
      count: 1,
      latestEventSequence: 14,
      latestEventStatus: "held",
      source: "cloud_sync",
      summary: "1 synced item is held before projection.",
      type: "cloud_held",
    },
  ],
  health: "needs_attention",
  runtimeStatus: {
    _id: "status-1",
    _creationTime: 1,
    browserInfo: { online: false, platform: "MacIntel" },
    localStore: {
      available: false,
      failureMessage: "IndexedDB blocked",
      terminalSeedReady: true,
    },
    receivedAt: Date.now(),
    reportedAt: Date.now(),
    snapshots: {
      availabilityAgeMs: 90_000,
      catalogAgeMs: 180_000,
      registerReadModelAgeMs: 60_000,
    },
    source: "support-diagnostics",
    staffAuthority: {
      expiresAt: Date.now() - 60_000,
      staffProfileId: "staff-1",
      status: "expired",
    },
    storeId: "store-1",
    sync: {
      failedEventCount: 1,
      lastFailureMessage: "Upload failed",
      localOnlyEventCount: 1,
      nextPendingUploadSequence: 14,
      pendingEventCount: 3,
      reviewEvents: [
        {
          createdAt: Date.now() - 6 * 60_000,
          localEventId: "local-review-1",
          localRegisterSessionId: "local-session-2",
          sequence: 5,
          status: "needs_review",
          type: "register.opened",
          uploaded: true,
          uploadSequence: 1,
        },
        {
          createdAt: Date.now() - 5 * 60_000,
          localEventId: "local-review-2",
          localPosSessionId: "local-sale-1",
          localRegisterSessionId: "local-session-2",
          sequence: 9,
          status: "needs_review",
          type: "cart.item_added",
        },
      ],
      reviewEventCount: 1,
      status: "failed",
      uploadableEventCount: 2,
    },
    terminalId: "terminal-1",
  },
  syncEvidence: {
    acceptedThroughSequence: 13,
    cursorUpdatedAt: Date.now() - 2 * 60_000,
    latestEvent:
      {
        _id: "event-1",
        eventType: "sale.completed",
        localEventId: "local-1",
        localRegisterSessionId: "local-session-1",
        occurredAt: Date.now() - 5 * 60_000,
        sequence: 14,
        status: "held",
        submittedAt: Date.now() - 4 * 60_000,
      },
    unresolvedConflictCount: 1,
    unresolvedConflicts: [
      {
        _id: "conflict-1",
        conflictType: "permission_drift",
        createdAt: Date.now() - 3 * 60_000,
        localEventId: "local-1",
        localRegisterSessionId: "local-session-1",
        sequence: 14,
        summary: "Staff authority changed before sync.",
      },
    ],
  },
  terminal: {
    _creationTime: 1,
    _id: "terminal-1",
    browserInfo: { platform: "MacIntel", userAgent: "test" },
    displayName: "Front counter",
    registeredAt: Date.now() - 10 * 24 * 60 * 60_000,
    registeredByUserId: "user-1",
    registerNumber: "1",
    status: "active",
    storeId: "store-1",
  },
};

describe("POSTerminalDetailViewContent", () => {
  beforeEach(() => {
    mocks.authState.isLoading = false;
    mocks.authState.user = { _id: "user-1" };
    mocks.activeStoreState.activeStore = { _id: "store-1" };
    mocks.activeStoreState.isLoadingStores = false;
    mocks.canAccessPOS.mockReturnValue(true);
    mocks.mutation.mockResolvedValue({
      data: { action: "resolved", resolvedCount: 1 },
      kind: "ok",
    });
    mocks.toastError.mockClear();
    mocks.toastSuccess.mockClear();
    mocks.useQuery.mockReturnValue(null);
    mocks.useQuery.mockClear();
  });

  it("renders identity, check-in, sync, conflict, and support notes", () => {
    render(
      <POSTerminalDetailViewContent
        detail={detail}
        isLoading={false}
      />,
    );

    expect(screen.getByRole("heading", { name: "Front counter" })).toBeInTheDocument();
    expect(screen.getAllByText("Register 1").length).toBeGreaterThan(0);
    expect(screen.getByText("Latest check-in")).toBeInTheDocument();
    expect(
      screen.getByText("Why this terminal needs attention"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("1 local review item is still on this terminal."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("1 synced item is held before projection."),
    ).toBeInTheDocument();
    expect(screen.getByText("Local runtime review / next upload #14")).toBeInTheDocument();
    expect(screen.getAllByText("Cloud sync evidence").length).toBeGreaterThan(0);
    expect(screen.getByText("Staff authority changed before sync.")).toBeInTheDocument();
    expect(screen.getByText("register.opened")).toBeInTheDocument();
    expect(screen.getByText("cart.item_added")).toBeInTheDocument();
    expect(screen.getByText("Uploaded")).toBeInTheDocument();
    expect(screen.getByText("Local only")).toBeInTheDocument();
    expect(screen.getByText("IndexedDB blocked")).toBeInTheDocument();
    expect(screen.getByText("Upload failed")).toBeInTheDocument();
  });

  it("renders the support recovery panel with safe cloud and terminal actions", () => {
    render(
      <POSTerminalDetailViewContent
        detail={{
          ...detail,
          attentionReasons: [
            {
              source: "cloud_sync",
              summary:
                "duplicate register_opened event failed: A register session is already open for this terminal.",
              type: "cloud_conflict",
            },
            {
              source: "terminal_runtime",
              summary: "authorization_failed: stale terminal sync secret rejected",
              type: "terminal_authorization_failed",
            },
          ],
          recovery: {
            commandStatus: {
              label: "Terminal repair command waiting for checkout station.",
              status: "pending",
              verificationStatus: "waiting_for_check_in",
            },
            readiness: {
              status: "needs_cloud_repair",
            },
            verification: {
              status: "waiting_for_check_in",
              summary:
                "Waiting for a fresh terminal check-in before marking recovery complete.",
            },
          },
        }}
        isLoading={false}
        orgUrlSlug="wigclub"
        storeUrlSlug="osu"
      />,
    );

    expect(screen.getByText("Support recovery")).toBeInTheDocument();
    expect(screen.getByText("Needs cloud repair")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Cloud repair is available for stale terminal evidence. No sale, payment, or inventory facts will be changed.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(
        "Duplicate drawer-open attempts can be resolved. No sales, payments, or inventory will be changed.",
      ).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(
        "Terminal authorization needs refresh. This checkout station must reconnect before Athena can verify it.",
      ).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: /resolve duplicate drawer attempts/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /send terminal repair command/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/pending/i)).toBeInTheDocument();
    expect(screen.getAllByText("Waiting For Check In").length).toBeGreaterThan(0);
    expect(
      screen.queryByText(/register_opened|already open|authorization_failed|sync secret/i),
    ).not.toBeInTheDocument();
  });

  it("does not render auto-repair buttons for manual payment or inventory review blockers", () => {
    render(
      <POSTerminalDetailViewContent
        detail={{
          ...detail,
          attentionReasons: [],
          recovery: {
            blockers: [
              {
                action: {
                  kind: "manual_review",
                  label: "Repair payment conflict",
                  status: "available",
                },
                actionTarget: { type: "open_work" },
                category: "manual_review",
                id: "payment-review",
                summary:
                  "Payment or inventory review is required before support takes action.",
                title: "Manual review required",
              },
            ],
            readiness: {
              status: "needs_manual_review",
            },
          },
        }}
        isLoading={false}
        orgUrlSlug="wigclub"
        storeUrlSlug="osu"
      />,
    );

    expect(screen.getByText("Needs manual review")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Payment or inventory review is required before support takes action.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /repair payment conflict/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /review open work/i }),
    ).toHaveAttribute("href", "/wigclub/store/osu/operations/open-work");
  });

  it("routes attention reasons to the available action surfaces", () => {
    render(
      <POSTerminalDetailViewContent
        detail={{
          ...detail,
          attentionReasons: [
            ...(detail.attentionReasons ?? []),
            {
              actionTarget: { type: "pos_settings" },
              source: "terminal_runtime",
              summary: "Terminal setup data is not ready on this checkout station.",
              type: "terminal_seed_missing",
            },
          ],
        }}
        isLoading={false}
        orgUrlSlug="wigclub"
        storeUrlSlug="osu"
      />,
    );

    expect(
      screen.getByText(
        "This needs a fresh check-in or terminal-side repair before support can clear it remotely.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /review register session/i }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/osu/cash-controls/registers/register-session-1",
    );
    expect(
      screen.getByText(
        "Terminal setup repair must run from this checkout station or through a terminal repair command when available.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /^open register$/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /open register setup/i }),
    ).not.toBeInTheDocument();
  });

  it("resolves mapped register reviews inline from terminal health", async () => {
    const onResolveRegisterSessionReview = vi.fn().mockResolvedValue({
      data: { action: "resolved", resolvedCount: 1 },
      kind: "ok",
    });

    render(
      <POSTerminalDetailViewContent
        detail={{
          ...detail,
          attentionReasons: [
            {
              actionTarget: {
                registerSessionId: "register-session-1",
                type: "cash_control_register_session",
              },
              count: 14,
              latestEventSequence: 1,
              latestEventStatus: "conflicted",
              source: "cloud_sync",
              summary: "14 cloud sync conflicts need review.",
              type: "cloud_conflict",
            },
          ],
        }}
        isLoading={false}
        onResolveRegisterSessionReview={onResolveRegisterSessionReview}
        orgUrlSlug="wigclub"
        storeUrlSlug="osu"
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /resolve eligible review/i }),
    );

    await waitFor(() =>
      expect(onResolveRegisterSessionReview).toHaveBeenCalledWith({
        registerSessionId: "register-session-1",
      }),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "Eligible register review resolved",
    );
    expect(
      screen.queryByRole("link", { name: /review register session/i }),
    ).not.toBeInTheDocument();
  });

  it("does not render attention reasons for a healthy terminal", () => {
    render(
      <POSTerminalDetailViewContent
        detail={{
          ...detail,
          attentionReasons: [],
          health: "online",
          runtimeStatus: {
            ...detail.runtimeStatus!,
            localStore: { available: true, terminalSeedReady: true },
            sync: {
              ...detail.runtimeStatus!.sync,
              failedEventCount: 0,
              pendingEventCount: 0,
              reviewEventCount: 0,
              status: "idle",
              uploadableEventCount: 0,
            },
          },
          syncEvidence: {
            acceptedCount: 4,
            acceptedThroughSequence: 9,
            conflictedCount: 0,
            heldCount: 0,
            latestEvent: null,
            projectedCount: 3,
            rejectedCount: 0,
            sampledEventCount: 5,
            unresolvedConflictCount: 0,
            unresolvedConflicts: [],
          },
        }}
        isLoading={false}
      />,
    );

    expect(
      screen.queryByText("Why this terminal needs attention"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "No unresolved cloud sync conflicts are currently reported. Local runtime review, pending sync, or stale check-ins may still need attention above.",
      ),
    ).toBeInTheDocument();
  });

  it("renders no-data and query unavailable states", () => {
    const { rerender } = render(
      <POSTerminalDetailViewContent
        detail={null}
        isLoading={false}
      />,
    );

    expect(screen.getByText("Terminal not found")).toBeInTheDocument();

    rerender(
      <POSTerminalDetailViewContent
        detail={null}
        isLoading={false}
        queryUnavailable
      />,
    );

    expect(
      screen.getByText("Terminal detail is not available right now"),
    ).toBeInTheDocument();
  });

  it("renders the current aggregate sync evidence query shape", () => {
    render(
      <POSTerminalDetailViewContent
        detail={{
          ...detail,
          syncEvidence: {
            acceptedCount: 4,
            acceptedThroughSequence: 9,
            conflictedCount: 1,
            cursorUpdatedAt: Date.now(),
            heldCount: 1,
            latestEvent: {
              eventType: "sale.completed",
              localEventId: "local-aggregate-1",
              localRegisterSessionId: "local-session-1",
              occurredAt: Date.now(),
              sequence: 10,
              status: "held",
              submittedAt: Date.now(),
            },
            projectedCount: 3,
            rejectedCount: 0,
            sampledEventCount: 5,
          },
        }}
        isLoading={false}
      />,
    );

    expect(screen.getByText("5 sampled")).toBeInTheDocument();
    expect(screen.getByText("sale.completed")).toBeInTheDocument();
    expect(
      screen.getByText(
        "2 sync items need review; detailed conflict records were not returned.",
      ),
    ).toBeInTheDocument();
  });
});

describe("POSTerminalDetailView", () => {
  beforeEach(() => {
    mocks.authState.isLoading = false;
    mocks.authState.user = { _id: "user-1" };
    mocks.activeStoreState.activeStore = { _id: "store-1" };
    mocks.activeStoreState.isLoadingStores = false;
    mocks.canAccessPOS.mockReturnValue(true);
    mocks.mutation.mockResolvedValue({
      data: { action: "resolved", resolvedCount: 1 },
      kind: "ok",
    });
    mocks.useQuery.mockReturnValue(null);
    mocks.useQuery.mockClear();
  });

  it("does not query terminal detail when the user is signed out", () => {
    mocks.authState.user = null;

    render(<POSTerminalDetailView />);

    expect(
      screen.getByText(
        "Your Athena session needs to reconnect before POS terminal health can load.",
      ),
    ).toBeInTheDocument();
    expect(mocks.useQuery).toHaveBeenCalledWith(expect.anything(), "skip");
  });

  it("does not query terminal detail when POS access is denied", () => {
    mocks.canAccessPOS.mockReturnValue(false);

    render(<POSTerminalDetailView />);

    expect(screen.getByText("No permission")).toBeInTheDocument();
    expect(mocks.useQuery).toHaveBeenCalledWith(expect.anything(), "skip");
  });
});
