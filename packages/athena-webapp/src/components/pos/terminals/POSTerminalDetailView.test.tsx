import { render, screen } from "@testing-library/react";
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
  useQuery: vi.fn(() => null),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    to,
  }: {
    children?: React.ReactNode;
    params?: { orgUrlSlug: string; storeUrlSlug: string; transactionId?: string };
    to?: string;
  }) => (
    <a
      href={
        to
          ?.replace("$orgUrlSlug", params?.orgUrlSlug ?? "")
          .replace("$storeUrlSlug", params?.storeUrlSlug ?? "")
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
  useQuery: mocks.useQuery,
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
    expect(screen.getByText("Cloud sync evidence")).toBeInTheDocument();
    expect(screen.getByText("Staff authority changed before sync.")).toBeInTheDocument();
    expect(screen.getByText("IndexedDB blocked")).toBeInTheDocument();
    expect(screen.getByText("Upload failed")).toBeInTheDocument();
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
