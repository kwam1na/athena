import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  hasFullAdminAccess: true,
  action: vi.fn(),
  mutation: vi.fn(),
  sharedDemoContext: null as { storeId: string } | null,
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
  useAction: () => mocks.action,
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
    hasFullAdminAccess: mocks.hasFullAdminAccess,
    isLoading: false,
  }),
}));

vi.mock("@/hooks/useSharedDemoContext", () => ({
  useSharedDemoContext: () => mocks.sharedDemoContext,
}));

vi.mock("@/components/View", () => ({
  default: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/components/common/FadeIn", () => ({
  FadeIn: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/common/PageLevelHeader", () => ({
  PageLevelHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
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
    activeRegisterSession: {
      cloudRegisterSessionId: "register-session-1",
      localRegisterSessionId: "local-register-session-1",
      observedAt: Date.now() - 4 * 60_000,
      openedAt: Date.now() - 60 * 60_000,
      registerNumber: "1",
      status: "closing",
    },
    appUpdate: {
      canApply: false,
      detectorStatus: "ok",
      observedAt: Date.now() - 4 * 60_000,
      stagingStatus: "unknown",
      status: "current",
    },
    appVersion: "gentle-lion-climbs (20260608193135)",
    buildSha: "b463caa2d36dabcdef",
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
      serviceCatalogAgeMs: 240_000,
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
    latestEvent: {
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
    heartbeatEnabled: true,
    registeredAt: Date.now() - 10 * 24 * 60 * 60_000,
    registeredByUserId: "user-1",
    registerNumber: "1",
    status: "active",
    storeId: "store-1",
  },
};

describe("POSTerminalDetailViewContent", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          fun_name: "gentle-lion-climbs",
          git_sha: "b463caa2d36dabcdef",
          version: "20260608193135",
        }),
      ),
    );
    mocks.authState.isLoading = false;
    mocks.authState.user = { _id: "user-1" };
    mocks.activeStoreState.activeStore = { _id: "store-1" };
    mocks.activeStoreState.isLoadingStores = false;
    mocks.canAccessPOS.mockReturnValue(true);
    mocks.hasFullAdminAccess = true;
    mocks.sharedDemoContext = null;
    mocks.action.mockResolvedValue({
      data: null,
      kind: "ok",
    });
    mocks.mutation.mockResolvedValue({
      data: { action: "resolved", resolvedCount: 1 },
      kind: "ok",
    });
    mocks.toastError.mockClear();
    mocks.toastSuccess.mockClear();
    mocks.useQuery.mockReturnValue(null);
    mocks.useQuery.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders identity, check-in, sync, conflict, and support notes", async () => {
    render(<POSTerminalDetailViewContent detail={detail} isLoading={false} />);

    expect(
      screen.getByRole("heading", { name: "Front counter" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Register 1").length).toBeGreaterThan(0);
    expect(screen.getByText("Latest check-in")).toBeInTheDocument();
    expect(screen.getByText("Athena webapp")).toBeInTheDocument();
    expect(
      await screen.findByRole("button", {
        name: "Athena webapp Latest version. Version details.",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("gentle-lion-climbs (20260608193135) / b463caa2d36d"),
    ).not.toBeInTheDocument();

    expect(
      screen.getByRole("button", {
        name: "Athena webapp Latest version. Version details.",
      }),
    ).not.toHaveAttribute("title");
    expect(screen.getByText("Readiness evidence")).toBeInTheDocument();
    expect(screen.getByText("Runtime report")).toBeInTheDocument();
    expect(screen.getByText("Latest terminal report")).toBeInTheDocument();
    expect(screen.getByText("Active drawer")).toBeInTheDocument();
    expect(screen.getByText("Register 1 Closing")).toBeInTheDocument();
    expect(screen.getByText("Upload queue")).toBeInTheDocument();
    expect(screen.getByText("2 uploadable / 3 pending")).toBeInTheDocument();
    expect(screen.getByText("Local review")).toBeInTheDocument();
    expect(screen.getByText("1 item")).toBeInTheDocument();
    expect(screen.getAllByText("App update").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Current").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Availability").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Catalog").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Service catalog").length).toBeGreaterThan(0);
    expect(screen.getByText("Register model")).toBeInTheDocument();
    expect(screen.getByText("Drawer authority")).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByText("Expired")).toBeInTheDocument();
    expect(screen.getByText("2 minutes old")).toBeInTheDocument();
    expect(screen.getByText("3 minutes old")).toBeInTheDocument();
    expect(screen.getByText("4 minutes old")).toBeInTheDocument();
    expect(
      screen.getByText("Why this terminal needs attention"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("1 local review item is still on this terminal."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("1 synced item is held before projection."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Local runtime review / next upload #14"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Cloud sync evidence" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Staff authority changed before sync."),
    ).toBeInTheDocument();
    expect(screen.getByText("register.opened")).toBeInTheDocument();
    expect(screen.getByText("cart.item_added")).toBeInTheDocument();
    expect(screen.getByText("Uploaded")).toBeInTheDocument();
    expect(screen.getByText("Local only")).toBeInTheDocument();
    expect(screen.getByText("IndexedDB blocked")).toBeInTheDocument();
    expect(screen.getByText("Upload failed")).toBeInTheDocument();
  });

  it("shows when the terminal is not on the latest webapp version", async () => {
    render(
      <POSTerminalDetailViewContent
        detail={{
          ...detail,
          health: "offline",
          runtimeStatus: {
            ...detail.runtimeStatus!,
            buildSha: "old-build-sha",
          },
        }}
        isLoading={false}
      />,
    );

    expect(
      await screen.findByRole("button", {
        name: "Athena webapp Update available. Version details.",
      }),
    ).toBeInTheDocument();
  });

  it("treats a matching git sha with an older deploy version as not latest", async () => {
    render(
      <POSTerminalDetailViewContent
        detail={{
          ...detail,
          runtimeStatus: {
            ...detail.runtimeStatus!,
            appVersion: "gentle-lion-climbs (20260607120000)",
          },
        }}
        isLoading={false}
      />,
    );

    expect(
      await screen.findByRole("button", {
        name: "Athena webapp Update available. Version details.",
      }),
    ).toBeInTheDocument();
  });

  it("renders ready staff authority as a compact checked state", () => {
    render(
      <POSTerminalDetailViewContent
        detail={{
          ...detail,
          runtimeStatus: {
            ...detail.runtimeStatus!,
            staffAuthority: {
              expiresAt: Date.now() + 60_000,
              staffProfileId: "staff-1",
              status: "ready",
            },
          },
        }}
        isLoading={false}
      />,
    );

    const staffAuthorityLabel = screen.getByText("Staff authority");
    expect(staffAuthorityLabel).toBeInTheDocument();
    expect(screen.getAllByText("Ready").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("Staff authority ready")).not.toBeInTheDocument();
  });

  it("renders expired staff authority as a compact warning state", () => {
    render(<POSTerminalDetailViewContent detail={detail} isLoading={false} />);

    expect(screen.getByText("Staff authority")).toBeInTheDocument();
    expect(screen.getByText("Expired").parentElement).toHaveClass(
      "text-warning",
    );
  });

  it("starts Remote Assist from an enrolled online terminal", async () => {
    const onStartRemoteAssist = vi.fn(async () => ({
      data: {
        _id: "session-1",
        effectiveMode: "unattended",
        status: "connecting",
      },
      kind: "ok" as const,
    }));

    render(
      <POSTerminalDetailViewContent
        canStartRemoteAssist
        detail={detail}
        isLoading={false}
        onStartRemoteAssist={onStartRemoteAssist}
        remoteAssistClient={{
          _id: "remote-client-1",
          accessPolicy: "unattended_allowed",
          displayName: "Front counter",
          enrollmentStatus: "active",
          lastPresenceAt: Date.now(),
          presenceStatus: "online",
        }}
      />,
    );

    expect(screen.getByText("Remote Assist")).toBeInTheDocument();
    expect(screen.getByText("Ready for support session")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Reason"), {
      target: { value: "Drawer repair support" },
    });
    fireEvent.click(screen.getByRole("button", { name: /start session/i }));

    await waitFor(() => {
      expect(onStartRemoteAssist).toHaveBeenCalledWith({
        clientId: "remote-client-1",
        reason: "Drawer repair support",
      });
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "Remote Assist session requested.",
    );
  });

  it("renders hydrated Remote Assist session state and ends the current session", async () => {
    const onStartRemoteAssist = vi.fn();
    const onEndRemoteAssist = vi.fn(async () => ({
      data: {
        _id: "session-1",
        effectiveMode: "unattended",
        endedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
        reason: "Drawer repair support",
        sensitiveModeActive: false,
        status: "ended",
        terminationReason: "Support ended the Remote Assist session.",
      },
      kind: "ok" as const,
    }));

    render(
      <POSTerminalDetailViewContent
        canStartRemoteAssist
        detail={detail}
        isLoading={false}
        onEndRemoteAssist={onEndRemoteAssist}
        onStartRemoteAssist={onStartRemoteAssist}
        remoteAssistClient={{
          _id: "remote-client-1",
          accessPolicy: "unattended_allowed",
          displayName: "Front counter",
          enrollmentStatus: "active",
          lastPresenceAt: Date.now(),
          presenceStatus: "online",
        }}
        remoteAssistSession={{
          _id: "session-1",
          effectiveMode: "unattended",
          expiresAt: Date.now() + 60_000,
          reason: "Drawer repair support",
          sensitiveModeActive: false,
          startedAt: Date.now(),
          status: "active",
        }}
      />,
    );

    expect(
      screen.getByText("Remote Assist session active"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Support controls stay inside Athena/),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Reason"), {
      target: { value: "Another support request" },
    });
    const startButton = screen.getByRole("button", { name: /start session/i });
    expect(startButton).toBeDisabled();
    fireEvent.click(startButton);
    expect(onStartRemoteAssist).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /end session/i }));

    await waitFor(() => {
      expect(onEndRemoteAssist).toHaveBeenCalledWith({
        reason: "Support ended the Remote Assist session.",
        sessionId: "session-1",
      });
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "Remote Assist session ended.",
    );
  });

  it("shows approval-required Remote Assist responses", async () => {
    const onStartRemoteAssist = vi.fn(async () => ({
      approval: {
        action: {
          key: "remote_assist.start",
          label: "Start Remote Assist",
        },
        copy: {
          message: "Cashier approval is required before support can connect.",
          title: "Approval required",
        },
        reason: "Local approval required",
        requiredRole: "cashier" as const,
        resolutionModes: [
          {
            approvalRequestId: "approval-1",
            kind: "async_request" as const,
            requestType: "remote_assist_attended_session",
          },
        ],
        subject: {
          id: "remote-client-1",
          label: "Front counter",
          type: "remote_assist_client",
        },
      },
      kind: "approval_required" as const,
    }));

    render(
      <POSTerminalDetailViewContent
        canStartRemoteAssist
        detail={detail}
        isLoading={false}
        onStartRemoteAssist={onStartRemoteAssist}
        remoteAssistClient={{
          _id: "remote-client-1",
          accessPolicy: "unattended_allowed",
          displayName: "Front counter",
          enrollmentStatus: "active",
          lastPresenceAt: Date.now(),
          presenceStatus: "online",
        }}
      />,
    );

    fireEvent.change(screen.getByLabelText("Reason"), {
      target: { value: "Drawer repair support" },
    });
    fireEvent.click(screen.getByRole("button", { name: /start session/i }));

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Cashier approval is required before support can connect.",
      );
    });
  });

  it("keeps Remote Assist unavailable until the runtime enrolls", () => {
    render(
      <POSTerminalDetailViewContent
        canStartRemoteAssist
        detail={detail}
        isLoading={false}
        remoteAssistClient={null}
      />,
    );

    expect(
      screen.getByText("Waiting for runtime enrollment"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /start session/i }),
    ).toBeDisabled();
  });

  it("keeps Remote Assist unavailable when presence is stale", () => {
    render(
      <POSTerminalDetailViewContent
        canStartRemoteAssist
        detail={detail}
        isLoading={false}
        remoteAssistClient={{
          _id: "remote-client-1",
          accessPolicy: "unattended_allowed",
          displayName: "Front counter",
          enrollmentStatus: "active",
          lastPresenceAt: Date.now() - 3 * 60_000,
          presenceStatus: "online",
        }}
      />,
    );

    expect(screen.getByText("Runtime not online")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /start session/i }),
    ).toBeDisabled();
  });

  it("keeps Remote Assist unavailable for users who cannot start support sessions", () => {
    render(
      <POSTerminalDetailViewContent
        canStartRemoteAssist={false}
        detail={detail}
        isLoading={false}
        remoteAssistClient={{
          _id: "remote-client-1",
          accessPolicy: "unattended_allowed",
          displayName: "Front counter",
          enrollmentStatus: "active",
          lastPresenceAt: Date.now(),
          presenceStatus: "online",
        }}
      />,
    );

    expect(screen.getByText("Support permission required")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /start session/i }),
    ).toBeDisabled();
  });

  it("keeps attended-required Remote Assist unavailable until runtime approval exists", () => {
    render(
      <POSTerminalDetailViewContent
        canStartRemoteAssist
        detail={detail}
        isLoading={false}
        remoteAssistClient={{
          _id: "remote-client-1",
          accessPolicy: "attended_required",
          displayName: "Front counter",
          enrollmentStatus: "active",
          lastPresenceAt: Date.now(),
          presenceStatus: "online",
        }}
      />,
    );

    expect(screen.getByText("Local approval required")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /start session/i }),
    ).toBeDisabled();
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
              summary:
                "authorization_failed: stale terminal sync secret rejected",
              type: "terminal_authorization_failed",
            },
          ],
          recovery: {
            cloudRepair: {
              preconditionHash: "terminal-cloud-repair:abc",
              safeConflictIds: ["conflict-1"],
              skippedConflictIds: [],
            },
            commandStatus: {
              label: "Terminal repair command waiting for checkout station.",
              status: "available",
              verificationStatus: "waiting_for_check_in",
            },
            readiness: {
              status: "needs_cloud_repair",
            },
            terminalActions: [
              {
                commandContext: {
                  expectedBlockerType: "authorization_failed",
                  reason: "Terminal integrity requires repair.",
                },
                commandType: "repair_terminal_seed",
                expectedEvidence: {
                  terminalIntegrityStatus: "healthy",
                },
                reason: "Terminal integrity requires local repair.",
              },
            ],
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
      screen.getByRole("button", {
        name: /resolve duplicate drawer attempts/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /send terminal setup repair/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Terminal repair command waiting for checkout station. / Available",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Waiting For Check In").length).toBeGreaterThan(
      0,
    );
    expect(
      screen.queryByText(
        /register_opened|already open|authorization_failed|sync secret/i,
      ),
    ).not.toBeInTheDocument();
  });

  it("renders server operational explanation with bounded evidence and hides raw review payloads", () => {
    render(
      <POSTerminalDetailViewContent
        detail={{
          ...detail,
          attentionReasons: [],
          operationalExplanation: {
            blockingDomain: "sync_review",
            detail:
              "M Supplies conflict-raw-001 includes payment payload and customer payload details.",
            evidenceReferences: [
              {
                count: 17,
                source: "cloud_sync",
                summary: "M Supplies conflict-raw-001 payment payload",
                type: "synced_sale_inventory_review",
              },
            ],
            headline: "M Supplies review needed",
            lane: "sale_ready_with_review_backlog",
            nextStep:
              "Review the open work queue before support repairs anything.",
            primaryOwner: "operations",
            saleImpact: "can_transact_now",
            secondaryActions: [
              {
                label: "Safe cloud repair available",
                primaryOwner: "support",
                supportAction: "safe_cloud_repair",
              },
            ],
            severity: "warning",
            summaryMeta: {
              hasSecondarySafeRepair: true,
              reviewBacklogCount: 17,
              targetResolutionIncomplete: false,
            },
            supportAction: "manual_review",
          },
          recovery: {
            readiness: {
              status: "able_to_transact_now",
              summary:
                "Able to transact now. Drawer, cashier, and sale authority are active.",
            },
          },
          syncEvidence: {
            ...detail.syncEvidence,
            unresolvedConflicts: [
              {
                _id: "conflict-raw-001",
                conflictType: "payment",
                createdAt: Date.now() - 3 * 60_000,
                localEventId: "local-secret-payment",
                localRegisterSessionId: "local-session-secret",
                sequence: 44,
                summary: "A synced payment event needs manager review.",
              },
            ],
          },
        }}
        isLoading={false}
        orgUrlSlug="wigclub"
        storeUrlSlug="osu"
      />,
    );

    expect(screen.getAllByText("Review needed").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Sales can continue.").length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByText("Sales can continue").length).toBeGreaterThan(0);
    expect(screen.getByText("Operations")).toBeInTheDocument();
    expect(screen.getByText("Manual review")).toBeInTheDocument();
    expect(
      screen.getAllByText(
        "Review the open work queue before support repairs anything.",
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("Review evidence")).toBeInTheDocument();
    expect(screen.getByText("17")).toBeInTheDocument();
    expect(
      screen.getByText("Synced Sale Inventory Review"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: /resolve safe cloud repair/i,
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        /M Supplies|conflict-raw-001|payment payload|customer payload|sync secret|backend exception/i,
      ),
    ).not.toBeInTheDocument();
  });

  it("keeps detailed conflict and local review rows visible with an operational explanation", () => {
    render(
      <POSTerminalDetailViewContent
        detail={{
          ...detail,
          operationalExplanation: {
            blockingDomain: "sync_review",
            detail:
              "Review-owned sync work needs attention, but this terminal has fresh sale authority.",
            evidenceReferences: [
              {
                count: 1,
                source: "cloud_sync",
                summary: "1 cloud sync conflict needs review.",
                type: "cloud_conflict",
              },
            ],
            headline: "Review needed. Sales can continue.",
            lane: "sale_ready_with_review_backlog",
            nextStep: "Use the linked review workspace to clear the backlog.",
            primaryOwner: "cash_controls",
            saleImpact: "can_transact_now",
            secondaryActions: [],
            severity: "warning",
            summaryMeta: {
              hasSecondarySafeRepair: false,
              reviewBacklogCount: 1,
              targetResolutionIncomplete: false,
            },
            supportAction: "manual_review",
          },
          syncEvidence: {
            ...detail.syncEvidence,
            unresolvedConflicts: [
              {
                _id: "conflict-visible",
                conflictType: "permission",
                createdAt: Date.now() - 3 * 60_000,
                localEventId: "local-visible",
                localRegisterSessionId: "local-session-visible",
                sequence: 44,
                summary: "A synced register event needs permission review.",
              },
            ],
          },
        }}
        isLoading={false}
        orgUrlSlug="wigclub"
        storeUrlSlug="osu"
      />,
    );

    expect(screen.getAllByText("Review needed").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Sales can continue.").length).toBeGreaterThan(
      0,
    );
    expect(
      screen.getByText("A synced register event needs permission review."),
    ).toBeInTheDocument();
    expect(screen.getByText("register.opened")).toBeInTheDocument();
    expect(screen.getByText("cart.item_added")).toBeInTheDocument();
  });

  it("issues cloud and terminal recovery actions from displayed metadata", async () => {
    const onResolveTerminalCloudRepair = vi.fn(async () => ({
      data: { resolvedCount: 1 },
      kind: "ok" as const,
    }));
    const onIssueTerminalRecoveryCommand = vi.fn(async () => ({
      data: { _id: "command-1" },
      kind: "ok" as const,
    }));

    render(
      <POSTerminalDetailViewContent
        detail={{
          ...detail,
          attentionReasons: [],
          recovery: {
            cloudRepair: {
              preconditionHash: "terminal-cloud-repair:abc",
              safeConflictIds: ["conflict-1"],
              skippedConflictIds: [],
            },
            readiness: "needs_terminal_action",
            terminalActions: [
              {
                commandContext: {
                  expectedBlockerType: "authorization_failed",
                  reason: "Terminal integrity requires repair.",
                },
                commandType: "repair_terminal_seed",
                expectedEvidence: {
                  terminalIntegrityStatus: "healthy",
                },
                reason: "Terminal integrity requires local repair.",
              },
              {
                commandContext: {
                  cloudRegisterSessionId: "cloud-session-1",
                  expectedBlockerType: "cloud_closed",
                  localRegisterSessionId: "local-session-1",
                  reason: "Drawer authority requires terminal-local repair.",
                },
                commandType: "clear_stale_drawer_authority",
                expectedEvidence: {
                  drawerAuthorityStatus: "healthy",
                  localRegisterSessionId: "local-session-1",
                },
                reason: "Drawer authority requires terminal-local repair.",
              },
            ],
          },
        }}
        isLoading={false}
        onIssueTerminalRecoveryCommand={onIssueTerminalRecoveryCommand}
        onResolveTerminalCloudRepair={onResolveTerminalCloudRepair}
        orgUrlSlug="wigclub"
        storeUrlSlug="osu"
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /resolve duplicate drawer attempts/i,
      }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: /send terminal setup repair/i,
      }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: /send drawer authority repair/i,
      }),
    );

    await waitFor(() => {
      expect(onResolveTerminalCloudRepair).toHaveBeenCalledWith({
        action: expect.objectContaining({
          expectedPreconditionHash: "terminal-cloud-repair:abc",
          kind: "cloud_repair",
        }),
        terminalId: "terminal-1",
      });
      expect(onIssueTerminalRecoveryCommand).toHaveBeenCalledWith({
        action: expect.objectContaining({
          commandType: "repair_terminal_seed",
          expectedEvidence: { terminalIntegrityStatus: "healthy" },
          kind: "terminal_command",
        }),
        terminalId: "terminal-1",
      });
      expect(onIssueTerminalRecoveryCommand).toHaveBeenCalledWith({
        action: expect.objectContaining({
          commandContext: expect.objectContaining({
            cloudRegisterSessionId: "cloud-session-1",
            localRegisterSessionId: "local-session-1",
          }),
          commandType: "clear_stale_drawer_authority",
          expectedEvidence: {
            drawerAuthorityStatus: "healthy",
            localRegisterSessionId: "local-session-1",
          },
          kind: "terminal_command",
        }),
        terminalId: "terminal-1",
      });
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Cloud repair requested.");
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Terminal command queued.");
  });

  it("lets operators collect local review items from a local runtime review row", async () => {
    const onIssueTerminalRecoveryCommand = vi.fn(async () => ({
      data: { _id: "command-retry" },
      kind: "ok" as const,
    }));

    render(
      <POSTerminalDetailViewContent
        detail={{
          ...detail,
          attentionReasons: [
            {
              actionTarget: { type: "pos_register" },
              count: 84,
              nextPendingUploadSequence: 1,
              source: "local_runtime",
              summary: "84 local review items are still on this terminal.",
              type: "local_review",
            },
          ],
          recovery: {
            readiness: "needs_terminal_action",
            terminalActions: [
              {
                commandContext: {
                  expectedBlockerType: "local_review",
                  reason:
                    "Local review items need terminal-local evidence collection.",
                },
                commandType: "collect_local_review",
                expectedEvidence: {
                  localReviewDetailsCollected: true,
                },
                reason:
                  "Local review items need terminal-local evidence collection.",
              },
            ],
          },
        }}
        isLoading={false}
        onIssueTerminalRecoveryCommand={onIssueTerminalRecoveryCommand}
        orgUrlSlug="wigclub"
        storeUrlSlug="osu"
      />,
    );

    const attentionSection = screen
      .getByRole("heading", { name: /why this terminal needs attention/i })
      .closest("section");
    expect(attentionSection).not.toBeNull();

    fireEvent.click(
      within(attentionSection as HTMLElement).getByRole("button", {
        name: /collect local review items/i,
      }),
    );

    await waitFor(() => {
      expect(onIssueTerminalRecoveryCommand).toHaveBeenCalledWith({
        action: expect.objectContaining({
          commandContext: expect.objectContaining({
            expectedBlockerType: "local_review",
          }),
          commandType: "collect_local_review",
          expectedEvidence: {
            localReviewDetailsCollected: true,
          },
          kind: "terminal_command",
        }),
        terminalId: "terminal-1",
      });
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Terminal command queued.");
  });

  it("lets support send the dangerous clear-all local review command from the review table", async () => {
    const onIssueTerminalRecoveryCommand = vi.fn(async () => ({
      data: { _id: "command-clear-all" },
      kind: "ok" as const,
    }));

    render(
      <POSTerminalDetailViewContent
        detail={{
          ...detail,
          runtimeStatus: {
            ...detail.runtimeStatus!,
            sync: {
              ...detail.runtimeStatus!.sync,
              reviewEventCount: 2,
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
                  localRegisterSessionId: "local-session-2",
                  sequence: 9,
                  status: "needs_review",
                  type: "register.opened",
                  uploaded: true,
                  uploadSequence: 2,
                },
              ],
              status: "needs_review",
            },
          },
          recovery: {
            readiness: "needs_terminal_action",
            terminalActions: [
              {
                commandContext: {
                  expectedBlockerType: "local_review_clear_all",
                  localReviewClearAll: true,
                  localReviewClearLimit: 2,
                  localReviewEventIds: ["local-review-1", "local-review-2"],
                  reason: "Dangerous cleanup for local review items.",
                },
                commandType: "clear_local_review_items",
                expectedEvidence: {
                  localReviewClearedEventIds: [
                    "local-review-1",
                    "local-review-2",
                  ],
                  localReviewEventCount: 0,
                },
                reason:
                  "Dangerous cleanup can clear all local review items from this terminal.",
              },
            ],
          },
        }}
        isLoading={false}
        onIssueTerminalRecoveryCommand={onIssueTerminalRecoveryCommand}
      />,
    );

    expect(screen.getByText("Dangerous action")).toBeInTheDocument();
    expect(
      screen.getByText(
        /Clears all local review items reported by this terminal\.\s+Use only after confirming the review state is safe to discard\./i,
      ),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /clear all review items/i }),
    );

    await waitFor(() => {
      expect(onIssueTerminalRecoveryCommand).toHaveBeenCalledWith({
        action: expect.objectContaining({
          commandContext: expect.objectContaining({
            expectedBlockerType: "local_review_clear_all",
            localReviewClearAll: true,
            localReviewClearLimit: 2,
            localReviewEventIds: ["local-review-1", "local-review-2"],
          }),
          commandType: "clear_local_review_items",
          expectedEvidence: {
            localReviewClearedEventIds: ["local-review-1", "local-review-2"],
            localReviewEventCount: 0,
          },
          kind: "terminal_command",
        }),
        terminalId: "terminal-1",
      });
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Terminal command queued.");
  });

  it("surfaces dangerous clear-all from the current recovery preview when legacy recovery is present", () => {
    render(
      <POSTerminalDetailViewContent
        detail={{
          ...detail,
          operationalExplanation: {
            blockingDomain: "sync_review",
            detail:
              "Manual review must finish before support repairs this terminal.",
            evidenceReferences: [
              {
                count: 2,
                source: "local_runtime",
                summary: "2 local review items are still on this terminal.",
                type: "local_review",
              },
            ],
            headline: "Manager review needed",
            lane: "needs_manual_review",
            nextStep:
              "Use the linked review workspace before running support repair.",
            primaryOwner: "manager",
            saleImpact: "not_ready",
            secondaryActions: [],
            severity: "critical",
            summaryMeta: {
              hasSecondarySafeRepair: false,
              reviewBacklogCount: 2,
              targetResolutionIncomplete: false,
            },
            supportAction: "manual_review",
          },
          recovery: {
            readiness: "needs_terminal_action",
            terminalActions: [
              {
                commandContext: {
                  expectedBlockerType: "local_review",
                  reason:
                    "Local review items need terminal-local evidence collection.",
                },
                commandType: "collect_local_review",
                expectedEvidence: {
                  localReviewDetailsCollected: true,
                },
                reason:
                  "Local review items need terminal-local evidence collection.",
              },
            ],
          },
          recoveryPreview: {
            readiness: "needs_manual_review",
            terminalActions: [
              {
                commandContext: {
                  expectedBlockerType: "local_review_clear_all",
                  localReviewClearAll: true,
                  localReviewClearLimit: 2,
                  localReviewEventIds: ["local-review-1", "local-review-2"],
                  reason: "Dangerous cleanup for local review items.",
                },
                commandType: "clear_local_review_items",
                expectedEvidence: {
                  localReviewClearedEventIds: [
                    "local-review-1",
                    "local-review-2",
                  ],
                  localReviewEventCount: 0,
                },
                reason:
                  "Dangerous cleanup can clear all local review items from this terminal.",
              },
            ],
          },
          runtimeStatus: {
            ...detail.runtimeStatus!,
            sync: {
              ...detail.runtimeStatus!.sync,
              reviewEventCount: 2,
              reviewEvents: [
                {
                  createdAt: Date.now() - 6 * 60_000,
                  localEventId: "local-review-1",
                  localRegisterSessionId: "local-session-2",
                  sequence: 4535,
                  status: "needs_review",
                  type: "transaction.completed",
                  uploaded: true,
                  uploadSequence: 1,
                },
                {
                  createdAt: Date.now() - 5 * 60_000,
                  localEventId: "local-review-2",
                  localRegisterSessionId: "local-session-2",
                  sequence: 4484,
                  status: "needs_review",
                  type: "transaction.completed",
                  uploaded: true,
                  uploadSequence: 2,
                },
              ],
              status: "needs_review",
            },
          },
        }}
        isLoading={false}
        onIssueTerminalRecoveryCommand={vi.fn()}
        orgUrlSlug="wigclub"
        storeUrlSlug="osu"
      />,
    );

    expect(screen.getAllByText("Manager review needed").length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText("#4535")).toBeInTheDocument();
    expect(screen.getByText("Dangerous action")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /clear all review items/i }),
    ).toBeInTheDocument();
  });

  it("hides dangerous clear-all when the action lacks evidenced review ids", () => {
    render(
      <POSTerminalDetailViewContent
        detail={{
          ...detail,
          runtimeStatus: {
            ...detail.runtimeStatus!,
            sync: {
              ...detail.runtimeStatus!.sync,
              reviewEventCount: 2,
              reviewEvents: [],
              status: "needs_review",
            },
          },
          recovery: {
            readiness: "needs_terminal_action",
            terminalActions: [
              {
                commandContext: {
                  expectedBlockerType: "local_review_clear_all",
                  localReviewClearAll: true,
                  localReviewClearLimit: 2,
                  reason: "Dangerous cleanup for local review items.",
                },
                commandType: "clear_local_review_items",
                expectedEvidence: {
                  localReviewEventCount: 0,
                },
                reason:
                  "Dangerous cleanup can clear all local review items from this terminal.",
              },
            ],
          },
        }}
        isLoading={false}
        onIssueTerminalRecoveryCommand={vi.fn()}
      />,
    );

    expect(screen.queryByText("Dangerous action")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /clear all review items/i }),
    ).not.toBeInTheDocument();
  });

  it("hides dangerous clear-all when evidenced review ids do not match", () => {
    render(
      <POSTerminalDetailViewContent
        detail={{
          ...detail,
          runtimeStatus: {
            ...detail.runtimeStatus!,
            sync: {
              ...detail.runtimeStatus!.sync,
              reviewEventCount: 2,
              reviewEvents: [],
              status: "needs_review",
            },
          },
          recovery: {
            readiness: "needs_terminal_action",
            terminalActions: [
              {
                commandContext: {
                  expectedBlockerType: "local_review_clear_all",
                  localReviewClearAll: true,
                  localReviewClearLimit: 2,
                  localReviewEventIds: ["local-review-1", "local-review-1"],
                  reason: "Dangerous cleanup for local review items.",
                },
                commandType: "clear_local_review_items",
                expectedEvidence: {
                  localReviewClearedEventIds: [
                    "local-review-1",
                    "local-review-2",
                  ],
                  localReviewEventCount: 0,
                },
                reason:
                  "Dangerous cleanup can clear all local review items from this terminal.",
              },
            ],
          },
        }}
        isLoading={false}
        onIssueTerminalRecoveryCommand={vi.fn()}
      />,
    );

    expect(screen.queryByText("Dangerous action")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /clear all review items/i }),
    ).not.toBeInTheDocument();
  });

  it("issues Update app from active terminals even when update readiness is unknown", async () => {
    const onIssueTerminalRecoveryCommand = vi.fn(async () => ({
      data: { _id: "command-update" },
      kind: "ok" as const,
    }));

    render(
      <POSTerminalDetailViewContent
        detail={{
          ...detail,
          attentionReasons: [],
          recoveryPreview: {
            appUpdate: {
              evidenceFresh: false,
              status: "unknown",
            },
            readiness: "healthy_idle",
          },
        }}
        isLoading={false}
        onIssueTerminalRecoveryCommand={onIssueTerminalRecoveryCommand}
      />,
    );

    const updateButton = screen.getByRole("button", { name: "Update app" });
    expect(updateButton).toBeEnabled();
    expect(screen.getByText("Update status unknown")).toBeInTheDocument();

    fireEvent.click(updateButton);

    await waitFor(() => {
      expect(onIssueTerminalRecoveryCommand).toHaveBeenCalledWith({
        action: expect.objectContaining({
          commandContext: expect.objectContaining({
            expectedBlockerType: "app_update",
          }),
          commandType: "update_app",
          expectedEvidence: {},
          kind: "terminal_command",
        }),
        terminalId: "terminal-1",
      });
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "Update app command queued.",
    );
  });

  it("disables duplicate Update app actions while an equivalent command is active", () => {
    const onIssueTerminalRecoveryCommand = vi.fn();

    render(
      <POSTerminalDetailViewContent
        detail={{
          ...detail,
          attentionReasons: [],
          recoveryPreview: {
            appUpdate: {
              evidenceFresh: true,
              status: "current",
            },
            commandStatus: {
              commandType: "update_app",
              label: "Update app",
              status: "pending",
              verificationStatus: "waiting_for_acknowledgement",
            },
            readiness: "healthy_idle",
          },
        }}
        isLoading={false}
        onIssueTerminalRecoveryCommand={onIssueTerminalRecoveryCommand}
      />,
    );

    expect(screen.getByRole("button", { name: "Update app" })).toBeDisabled();
    expect(
      screen.getByText(
        "Update app command is queued for this checkout station.",
      ),
    ).toBeInTheDocument();
  });

  it("disables Update app for inactive terminals", () => {
    render(
      <POSTerminalDetailViewContent
        detail={{
          ...detail,
          attentionReasons: [],
          recoveryPreview: {
            appUpdate: {
              evidenceFresh: false,
              status: "unknown",
            },
            readiness: "healthy_idle",
          },
          terminal: {
            ...detail.terminal,
            status: "revoked",
          },
        }}
        isLoading={false}
        onIssueTerminalRecoveryCommand={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Update app" })).toBeDisabled();
  });

  it("surfaces a next step when drawer repair verification fails and sync retry is available", () => {
    render(
      <POSTerminalDetailViewContent
        detail={{
          ...detail,
          attentionReasons: [
            {
              actionTarget: { type: "pos_register" },
              count: 66,
              nextPendingUploadSequence: 1,
              source: "local_runtime",
              summary: "66 local review items are still on this terminal.",
              type: "local_review",
            },
          ],
          recovery: {
            commandStatus: {
              commandType: "clear_stale_drawer_authority",
              label: "Drawer authority repair",
              latestAcknowledgement:
                "Drawer repair expected a blocked drawer authority record, but this terminal no longer reported that same block.",
              status: "precondition_failed",
              verificationStatus: "verification_failed",
            },
            readiness: "needs_manual_review",
            terminalActions: [
              {
                commandContext: {
                  cloudRegisterSessionId: "cloud-session-1",
                  expectedBlockerType: "cloud_closed",
                  localRegisterSessionId: "local-session-1",
                  reason: "Drawer authority requires terminal-local repair.",
                },
                commandType: "clear_stale_drawer_authority",
                expectedEvidence: {
                  drawerAuthorityStatus: "healthy",
                  localRegisterSessionId: "local-session-1",
                },
                reason: "Drawer authority requires terminal-local repair.",
              },
              {
                commandContext: {
                  expectedBlockerType: "local_review",
                  reason:
                    "Local review items need terminal-local evidence collection.",
                },
                commandType: "collect_local_review",
                expectedEvidence: {
                  localReviewDetailsCollected: true,
                },
                reason:
                  "Local review items need terminal-local evidence collection.",
              },
            ],
          },
        }}
        isLoading={false}
        orgUrlSlug="wigclub"
        storeUrlSlug="osu"
      />,
    );

    expect(
      screen.getByText("Drawer authority repair / Precondition Failed"),
    ).toBeInTheDocument();
    expect(screen.getByText("Verification Failed")).toBeInTheDocument();
    expect(screen.getByText("1 safe action")).toBeInTheDocument();
    expect(
      screen.getByText(
        "collect local review items from this checkout station, then use the next check-in to review the terminal-local evidence.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Drawer repair expected a blocked drawer authority record, but this terminal no longer reported that same block.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Command did not complete. Use the available terminal action before sending drawer repair again.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: /collect local review items/i })
        .length,
    ).toBeGreaterThan(0);
  });

  it("does not foreground old failed recovery commands when no support work remains", () => {
    render(
      <POSTerminalDetailViewContent
        detail={{
          ...detail,
          attentionReasons: [],
          recovery: {
            commandStatus: {
              commandType: "clear_stale_drawer_authority",
              label: "Drawer authority repair",
              latestAcknowledgement:
                "Drawer repair expected a blocked drawer authority record, but this terminal no longer reported that same block.",
              status: "precondition_failed",
              verificationStatus: "verification_failed",
            },
            readiness: "drawer_open",
            terminalActions: [],
          },
        }}
        isLoading={false}
        orgUrlSlug="wigclub"
        storeUrlSlug="osu"
      />,
    );

    expect(screen.getByText("No support action needed")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Current terminal evidence has no repair or review blockers.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Drawer authority repair / Precondition Failed"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Verification Failed")).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "Recovery verification did not match the latest terminal check-in.",
      ),
    ).not.toBeInTheDocument();
  });

  it("disables duplicate recovery command clicks while a command is pending", () => {
    const onIssueTerminalRecoveryCommand = vi.fn();

    render(
      <POSTerminalDetailViewContent
        detail={{
          ...detail,
          attentionReasons: [],
          recovery: {
            commandStatus: {
              label: "Terminal command queued.",
              status: "pending",
              verificationStatus: "waiting_for_acknowledgement",
            },
            terminalActions: [
              {
                commandContext: {
                  expectedBlockerType: "authorization_failed",
                },
                commandType: "repair_terminal_seed",
                expectedEvidence: {
                  terminalIntegrityStatus: "healthy",
                },
                reason: "Terminal integrity requires local repair.",
              },
            ],
          },
        }}
        isLoading={false}
        onIssueTerminalRecoveryCommand={onIssueTerminalRecoveryCommand}
        orgUrlSlug="wigclub"
        storeUrlSlug="osu"
      />,
    );

    const commandButton = screen.getByRole("button", {
      name: /send terminal setup repair/i,
    });

    expect(commandButton).toBeDisabled();
    expect(
      screen.getByText("Command is queued for this checkout station."),
    ).toBeInTheDocument();
    fireEvent.click(commandButton);
    expect(onIssueTerminalRecoveryCommand).not.toHaveBeenCalled();
  });

  it("omits verified drawer command attention once support work is clear", () => {
    render(
      <POSTerminalDetailViewContent
        detail={{
          ...detail,
          attentionReasons: [
            {
              actionTarget: { type: "pos_register" },
              source: "terminal_runtime",
              summary:
                "Drawer authority needs repair. This checkout station must run the repair before selling.",
              type: "drawer_authority_blocked",
            },
          ],
          recovery: {
            commandStatus: {
              label: "Drawer authority repair",
              status: "completed",
              verificationStatus: "verified",
            },
            readiness: "needs_manual_review",
            terminalActions: [
              {
                commandContext: {
                  cloudRegisterSessionId: "cloud-session-1",
                  expectedBlockerType: "cloud_closed",
                  localRegisterSessionId: "local-session-1",
                  reason: "Drawer authority requires terminal-local repair.",
                },
                commandType: "clear_stale_drawer_authority",
                expectedEvidence: {
                  drawerAuthorityStatus: "healthy",
                  localRegisterSessionId: "local-session-1",
                },
                reason: "Drawer authority requires terminal-local repair.",
              },
            ],
          },
        }}
        isLoading={false}
        orgUrlSlug="wigclub"
        storeUrlSlug="osu"
      />,
    );

    expect(screen.getByText("No support action needed")).toBeInTheDocument();
    expect(
      screen.queryByText("Drawer authority repair / Completed"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Verification")).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "Recovery was verified by the latest terminal check-in.",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "Drawer repair command was completed and verified by terminal check-in. This row will clear when the terminal list receives the next check-in.",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "Drawer repair command verified; waiting for the next terminal check-in.",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "This needs a fresh check-in or terminal-side repair before support can clear it remotely.",
      ),
    ).not.toBeInTheDocument();
  });

  it("shows normalized recovery action failures", async () => {
    const onResolveTerminalCloudRepair = vi.fn(async () => ({
      error: {
        message:
          "Terminal recovery evidence changed. Preview the repair again.",
      },
      kind: "user_error" as const,
    }));

    render(
      <POSTerminalDetailViewContent
        detail={{
          ...detail,
          attentionReasons: [],
          recovery: {
            cloudRepair: {
              preconditionHash: "terminal-cloud-repair:abc",
              safeConflictIds: ["conflict-1"],
              skippedConflictIds: [],
            },
          },
        }}
        isLoading={false}
        onResolveTerminalCloudRepair={onResolveTerminalCloudRepair}
        orgUrlSlug="wigclub"
        storeUrlSlug="osu"
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /resolve duplicate drawer attempts/i,
      }),
    );

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Terminal recovery evidence changed. Refresh terminal health before retrying.",
      );
    });
    expect(
      screen.getByText(
        "Terminal recovery evidence changed. Refresh terminal health before retrying.",
      ),
    ).toBeInTheDocument();
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

  it("limits long recovery blocker groups until expanded", () => {
    const blockers = Array.from({ length: 8 }, (_, index) => ({
      actionTarget: { type: "open_work" as const },
      category: "manual_review" as const,
      id: `manual-review-${index + 1}`,
      summary: `Manual review summary ${index + 1}`,
      title: "Manual review required",
    }));

    render(
      <POSTerminalDetailViewContent
        detail={{
          ...detail,
          attentionReasons: [],
          recovery: {
            blockers,
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

    expect(screen.getByText("Manual review summary 5")).toBeInTheDocument();
    expect(
      screen.queryByText("Manual review summary 6"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show 3 more" }));

    expect(screen.getByText("Manual review summary 8")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show fewer" }));

    expect(
      screen.queryByText("Manual review summary 6"),
    ).not.toBeInTheDocument();
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
              summary:
                "Terminal setup data is not ready on this checkout station.",
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

  it("routes mapped register reviews to cash controls by default", () => {
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

    expect(
      screen.getByRole("link", { name: /review register session/i }),
    ).toHaveAttribute(
      "href",
      "/wigclub/store/osu/cash-controls/registers/register-session-1",
    );
    expect(
      screen.queryByRole("button", { name: /resolve eligible review/i }),
    ).not.toBeInTheDocument();
    expect(onResolveRegisterSessionReview).not.toHaveBeenCalled();
  });

  it("does not render inventory review work as terminal attention", () => {
    render(
      <POSTerminalDetailViewContent
        detail={{
          ...detail,
          attentionReasons: [
            {
              actionTarget: {
                label: "Review inventory work",
                type: "open_work",
              },
              count: 1,
              latestEventSequence: 26,
              latestEventStatus: "conflicted",
              source: "cloud_sync",
              summary: "1 inventory review item needs attention.",
              type: "synced_sale_inventory_review",
            },
          ],
          operationalExplanation: {
            blockingDomain: "manual_review",
            detail:
              "Manual review must finish before support repairs this terminal.",
            evidenceReferences: [
              {
                count: 1,
                source: "cloud_sync",
                summary: "Inventory review work",
                type: "synced_sale_inventory_review",
              },
            ],
            headline: "Manager review needed",
            lane: "needs_manual_review",
            nextStep: "Use the linked review workspace.",
            primaryOwner: "manager",
            saleImpact: "can_transact_now",
            secondaryActions: [],
            severity: "warning",
            summaryMeta: {
              hasSecondarySafeRepair: false,
              reviewBacklogCount: 1,
              targetResolutionIncomplete: false,
            },
            supportAction: "manual_review",
          },
          recoveryPreview: {
            manualReview: [
              {
                reason: "Inventory review work",
                source: "cloud_sync",
                type: "synced_sale_inventory_review",
              },
            ],
            readiness: "needs_manual_review",
          },
          runtimeStatus: {
            ...detail.runtimeStatus!,
            sync: {
              ...detail.runtimeStatus!.sync,
              failedEventCount: 0,
              localOnlyEventCount: 0,
              pendingEventCount: 0,
              reviewEventCount: 0,
              reviewEvents: [],
              status: "idle",
              uploadableEventCount: 0,
            },
          },
          syncEvidence: {
            unresolvedConflictCount: 1,
            unresolvedConflicts: [
              {
                _id: "inventory-conflict-1",
                conflictType: "inventory",
                createdAt: Date.now(),
                localEventId: "inventory-event-1",
                localRegisterSessionId: "local-register-1",
                sequence: 26,
                summary:
                  "Inventory needs manager review for a synced offline sale.",
              },
            ],
          },
        }}
        isLoading={false}
        orgUrlSlug="wigclub"
        storeUrlSlug="osu"
      />,
    );

    expect(
      screen.queryByText("1 inventory review item needs attention."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Why this terminal needs attention"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Manager review needed")).not.toBeInTheDocument();
    expect(screen.queryByText("Needs review")).not.toBeInTheDocument();
    expect(screen.queryByText("Conflicts and review")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Cloud sync evidence" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "Inventory needs manager review for a synced offline sale.",
      ),
    ).not.toBeInTheDocument();
  });

  it("hides unresolved legacy inventory review reasons", () => {
    render(
      <POSTerminalDetailViewContent
        detail={{
          ...detail,
          attentionReasons: [
            {
              count: 2,
              latestEventSequence: 26,
              latestEventStatus: "conflicted",
              source: "cloud_sync",
              summary: "2 inventory review items need attention.",
              type: "synced_sale_inventory_review",
            },
          ],
        }}
        isLoading={false}
        orgUrlSlug="wigclub"
        storeUrlSlug="osu"
      />,
    );

    expect(
      screen.queryByText("2 inventory review items need attention."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Why this terminal needs attention"),
    ).not.toBeInTheDocument();
  });

  it("resolves explicitly eligible register reviews inline from terminal health", async () => {
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
                automaticRepairEligible: true,
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

  it("offers local review collection when local review counts arrive without item details", async () => {
    const onIssueTerminalRecoveryCommand = vi.fn(async () => ({
      data: { _id: "command-retry" },
      kind: "ok" as const,
    }));

    render(
      <POSTerminalDetailViewContent
        detail={{
          ...detail,
          runtimeStatus: {
            ...detail.runtimeStatus!,
            sync: {
              ...detail.runtimeStatus!.sync,
              reviewEventCount: 33,
              reviewEvents: [],
              status: "needs_review",
            },
          },
          recovery: {
            readiness: "needs_terminal_action",
            terminalActions: [
              {
                commandContext: {
                  expectedBlockerType: "local_review",
                  reason:
                    "Local review items need terminal-local evidence collection.",
                },
                commandType: "collect_local_review",
                expectedEvidence: {
                  localReviewDetailsCollected: true,
                },
                reason:
                  "Local review items need terminal-local evidence collection.",
              },
            ],
          },
          syncEvidence: {
            ...detail.syncEvidence,
            unresolvedConflicts: [],
            unresolvedConflictCount: 0,
          },
        }}
        isLoading={false}
        onIssueTerminalRecoveryCommand={onIssueTerminalRecoveryCommand}
      />,
    );

    expect(
      screen.getByText("33 local review items need local collection."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Details are missing from the latest check-in. Collect local review items from this checkout station.",
      ),
    ).toBeInTheDocument();

    const conflictSection = screen
      .getByRole("heading", { name: /conflicts and review/i })
      .closest("section");
    expect(conflictSection).not.toBeNull();
    fireEvent.click(
      within(conflictSection as HTMLElement).getByRole("button", {
        name: /collect local review items/i,
      }),
    );

    await waitFor(() => {
      expect(onIssueTerminalRecoveryCommand).toHaveBeenCalledWith({
        action: expect.objectContaining({
          commandContext: expect.objectContaining({
            expectedBlockerType: "local_review",
          }),
          commandType: "collect_local_review",
          expectedEvidence: {
            localReviewDetailsCollected: true,
          },
          kind: "terminal_command",
        }),
        terminalId: "terminal-1",
      });
    });
  });

  it("keeps local review collection available when verified collection did not clear the latest check-in", async () => {
    const onIssueTerminalRecoveryCommand = vi.fn(async () => ({
      data: { _id: "command-retry" },
      kind: "ok" as const,
    }));

    render(
      <POSTerminalDetailViewContent
        detail={{
          ...detail,
          runtimeStatus: {
            ...detail.runtimeStatus!,
            sync: {
              ...detail.runtimeStatus!.sync,
              reviewEventCount: 33,
              reviewEvents: [],
              status: "needs_review",
            },
          },
          recovery: {
            commandStatus: {
              commandType: "collect_local_review",
              label: "Collect local review items",
              status: "completed",
              verificationStatus: "verified",
            },
            readiness: "needs_terminal_action",
            terminalActions: [
              {
                commandContext: {
                  expectedBlockerType: "local_review",
                  reason:
                    "Local review items need terminal-local evidence collection.",
                },
                commandType: "collect_local_review",
                expectedEvidence: {
                  localReviewDetailsCollected: true,
                },
                reason:
                  "Local review items need terminal-local evidence collection.",
              },
            ],
          },
          syncEvidence: {
            ...detail.syncEvidence,
            unresolvedConflicts: [],
            unresolvedConflictCount: 0,
          },
        }}
        isLoading={false}
        onIssueTerminalRecoveryCommand={onIssueTerminalRecoveryCommand}
      />,
    );

    const conflictSection = screen
      .getByRole("heading", { name: /conflicts and review/i })
      .closest("section");
    expect(conflictSection).not.toBeNull();
    fireEvent.click(
      within(conflictSection as HTMLElement).getByRole("button", {
        name: /collect local review items/i,
      }),
    );

    await waitFor(() => {
      expect(onIssueTerminalRecoveryCommand).toHaveBeenCalledWith({
        action: expect.objectContaining({
          commandContext: expect.objectContaining({
            expectedBlockerType: "local_review",
          }),
          commandType: "collect_local_review",
          expectedEvidence: {
            localReviewDetailsCollected: true,
          },
          kind: "terminal_command",
        }),
        terminalId: "terminal-1",
      });
    });
  });

  it("shows collected local review evidence and replay action when collection matches the latest count", async () => {
    const onIssueTerminalRecoveryCommand = vi.fn(async () => ({
      data: { _id: "command-replay" },
      kind: "ok" as const,
    }));

    render(
      <POSTerminalDetailViewContent
        detail={{
          ...detail,
          runtimeStatus: {
            ...detail.runtimeStatus!,
            sync: {
              ...detail.runtimeStatus!.sync,
              reviewEventCount: 2,
              reviewEvents: [],
              status: "needs_review",
            },
          },
          recovery: {
            commandStatus: {
              commandType: "collect_local_review",
              label: "Collect local review items",
              localReviewEvents: [
                {
                  createdAt: Date.now() - 1_000,
                  localEventId: "event-review-1",
                  sequence: 12,
                  status: "needs_review",
                  type: "transaction.completed",
                  uploaded: true,
                  uploadSequence: 3,
                },
                {
                  createdAt: Date.now() - 500,
                  localEventId: "event-review-2",
                  sequence: 13,
                  status: "needs_review",
                  type: "register.closeout_started",
                  uploaded: true,
                  uploadSequence: 4,
                },
              ],
              status: "completed",
              verificationStatus: "verified",
            },
            readiness: "needs_terminal_action",
            terminalActions: [
              {
                commandContext: {
                  expectedBlockerType: "local_review_replay",
                  reason:
                    "Uploaded local review items should be replayed against current cloud rules.",
                },
                commandType: "retry_sync",
                expectedEvidence: {
                  syncStatus: "idle",
                },
                reason:
                  "Uploaded local review items should be replayed against current cloud rules.",
              },
            ],
          },
          syncEvidence: {
            ...detail.syncEvidence,
            unresolvedConflicts: [],
            unresolvedConflictCount: 0,
          },
        }}
        isLoading={false}
        onIssueTerminalRecoveryCommand={onIssueTerminalRecoveryCommand}
      />,
    );

    expect(screen.getByText("transaction.completed")).toBeInTheDocument();
    expect(screen.getByText("register.closeout_started")).toBeInTheDocument();
    expect(
      screen.queryByText("2 local review items need local collection."),
    ).not.toBeInTheDocument();

    const conflictSection = screen
      .getByRole("heading", { name: /conflicts and review/i })
      .closest("section");
    expect(conflictSection).not.toBeNull();
    fireEvent.click(
      within(conflictSection as HTMLElement).getByRole("button", {
        name: /retry terminal sync/i,
      }),
    );

    await waitFor(() => {
      expect(onIssueTerminalRecoveryCommand).toHaveBeenCalledWith({
        action: expect.objectContaining({
          commandContext: expect.objectContaining({
            expectedBlockerType: "local_review_replay",
          }),
          commandType: "retry_sync",
          expectedEvidence: {
            syncStatus: "idle",
          },
          kind: "terminal_command",
        }),
        terminalId: "terminal-1",
      });
    });
  });

  it("does not show stale collected local review evidence after the latest check-in is clear", () => {
    render(
      <POSTerminalDetailViewContent
        detail={{
          ...detail,
          attentionReasons: [],
          health: "online",
          runtimeStatus: {
            ...detail.runtimeStatus!,
            sync: {
              ...detail.runtimeStatus!.sync,
              failedEventCount: 0,
              pendingEventCount: 0,
              reviewEventCount: 0,
              reviewEvents: [],
              status: "idle",
              uploadableEventCount: 0,
            },
          },
          recovery: {
            commandStatus: {
              commandType: "collect_local_review",
              label: "Collect local review items",
              localReviewEvents: [
                {
                  createdAt: Date.now() - 1_000,
                  localEventId: "event-review-1",
                  sequence: 4535,
                  status: "needs_review",
                  type: "transaction.completed",
                  uploaded: true,
                  uploadSequence: 3,
                },
              ],
              status: "completed",
              verificationStatus: "verified",
            },
            readiness: "needs_manual_review",
            terminalActions: [],
          },
          syncEvidence: {
            ...detail.syncEvidence,
            unresolvedConflicts: [],
            unresolvedConflictCount: 0,
          },
        }}
        isLoading={false}
      />,
    );

    expect(screen.queryByText("#4535")).not.toBeInTheDocument();
    expect(screen.queryByText("transaction.completed")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Local review item"),
    ).not.toBeInTheDocument();
  });

  it("renders no-data and query unavailable states", () => {
    const { rerender } = render(
      <POSTerminalDetailViewContent detail={null} isLoading={false} />,
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

  it("limits long conflict review lists until expanded", () => {
    const conflicts = Array.from({ length: 8 }, (_, index) => ({
      _id: `conflict-${index + 1}`,
      conflictType: "inventory_review",
      createdAt: Date.now() - index * 60_000,
      localEventId: `local-conflict-${index + 1}`,
      localRegisterSessionId: "local-session-1",
      sequence: index + 1,
      summary: `Inventory review summary ${index + 1}`,
    }));

    render(
      <POSTerminalDetailViewContent
        detail={{
          ...detail,
          syncEvidence: {
            ...detail.syncEvidence,
            unresolvedConflictCount: conflicts.length,
            unresolvedConflicts: conflicts,
          },
        }}
        isLoading={false}
      />,
    );

    expect(screen.getByText("Inventory review summary 5")).toBeInTheDocument();
    expect(
      screen.queryByText("Inventory review summary 6"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show 3 more" }));

    expect(screen.getByText("Inventory review summary 8")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show fewer" }));

    expect(
      screen.queryByText("Inventory review summary 6"),
    ).not.toBeInTheDocument();
  });

  it("keeps aggregate sync telemetry out of the terminal support page", () => {
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

    expect(screen.queryByText("5 sampled")).not.toBeInTheDocument();
    expect(screen.queryByText("sale.completed")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Cloud sync evidence" }),
    ).not.toBeInTheDocument();
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
    mocks.hasFullAdminAccess = true;
    mocks.sharedDemoContext = null;
    mocks.action.mockResolvedValue({
      data: null,
      kind: "ok",
    });
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

  it("does not query full-admin Remote Assist session state for POS-only users", async () => {
    mocks.hasFullAdminAccess = false;
    (
      mocks.activeStoreState as { activeStore: Record<string, unknown> }
    ).activeStore = {
      _id: "store-1",
      organizationId: "org-1",
    };
    (mocks.useQuery as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(detail)
      .mockReturnValueOnce({
        _id: "remote-client-1",
        accessPolicy: "unattended_allowed",
        displayName: "Front counter",
        enrollmentStatus: "active",
        lastPresenceAt: Date.now(),
        presenceStatus: "online",
      });

    render(<POSTerminalDetailView />);

    await screen.findByRole("button", {
      name: /Athena webapp .* Version details\./,
    });

    expect((mocks.useQuery.mock.calls as unknown[][])[2]?.[1]).toBe("skip");
  });

  it("keeps terminal health observational in the demo", () => {
    mocks.sharedDemoContext = { storeId: "store-1" };
    (
      mocks.activeStoreState as { activeStore: Record<string, unknown> }
    ).activeStore = {
      _id: "store-1",
      organizationId: "org-1",
    };
    render(<POSTerminalDetailView />);

    expect((mocks.useQuery.mock.calls as unknown[][])[1]?.[1]).toBe("skip");
    expect((mocks.useQuery.mock.calls as unknown[][])[2]?.[1]).toBe("skip");
  });

  it("updates the terminal heartbeat setting from the detail page", async () => {
    mocks.mutation.mockResolvedValue({
      ...detail.terminal,
      heartbeatEnabled: false,
    });
    (mocks.useQuery as ReturnType<typeof vi.fn>).mockReturnValueOnce(detail);

    render(<POSTerminalDetailView />);

    fireEvent.click(
      await screen.findByRole("switch", { name: "Send terminal heartbeat" }),
    );

    await waitFor(() =>
      expect(mocks.mutation).toHaveBeenCalledWith({
        heartbeatEnabled: false,
        terminalId: "terminal-1",
      }),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "Terminal heartbeat paused.",
    );
  });
});
