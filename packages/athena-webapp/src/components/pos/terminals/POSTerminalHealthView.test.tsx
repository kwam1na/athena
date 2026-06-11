import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  POSTerminalHealthView,
  POSTerminalHealthViewContent,
} from "./POSTerminalHealthView";
import type { TerminalHealthSummary } from "./terminalHealthTypes";

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
  useQuery: vi.fn(() => []),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    to,
  }: {
    children?: React.ReactNode;
    params?: { orgUrlSlug: string; storeUrlSlug: string; terminalId?: string };
    to?: string;
  }) => (
    <a
      href={
        to
          ?.replace("$orgUrlSlug", params?.orgUrlSlug ?? "")
          .replace("$storeUrlSlug", params?.storeUrlSlug ?? "")
          .replace("$terminalId", params?.terminalId ?? "") ?? "#"
      }
    >
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
  useParams: () => ({ orgUrlSlug: "acme", storeUrlSlug: "osu" }),
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

const baseSummary: TerminalHealthSummary = {
  runtimeStatus: {
    _id: "status-1",
    _creationTime: 1,
    browserInfo: { online: true, platform: "MacIntel" },
    localStore: { available: true, terminalSeedReady: true },
    receivedAt: Date.now(),
    reportedAt: Date.now(),
    snapshots: {
      availabilityAgeMs: 120_000,
      catalogAgeMs: 240_000,
      registerReadModelAgeMs: 60_000,
      serviceCatalogAgeMs: 180_000,
    },
    source: "pos-hub",
    staffAuthority: {
      expiresAt: Date.now() + 60_000,
      staffProfileId: "staff-1",
      status: "ready",
    },
    storeId: "store-1",
    sync: {
      failedEventCount: 0,
      localOnlyEventCount: 1,
      pendingEventCount: 0,
      reviewEventCount: 0,
      status: "idle",
      uploadableEventCount: 0,
    },
    terminalId: "terminal-1",
  },
  syncEvidence: {
    acceptedThroughSequence: 12,
    cursorUpdatedAt: Date.now(),
    unresolvedConflictCount: 0,
    unresolvedConflicts: [],
  },
  terminal: {
    _creationTime: 1,
    _id: "terminal-1",
    browserInfo: { userAgent: "test" },
    displayName: "Front counter",
    registeredAt: Date.now(),
    registeredByUserId: "user-1",
    registerNumber: "1",
    status: "active",
    storeId: "store-1",
  },
};

describe("POSTerminalHealthViewContent", () => {
  beforeEach(() => {
    mocks.authState.isLoading = false;
    mocks.authState.user = { _id: "user-1" };
    mocks.activeStoreState.activeStore = { _id: "store-1" };
    mocks.activeStoreState.isLoadingStores = false;
    mocks.canAccessPOS.mockReturnValue(true);
    mocks.useQuery.mockReturnValue([]);
    mocks.useQuery.mockClear();
  });

  it("renders terminal roster signals and links to terminal detail", () => {
    render(
      <POSTerminalHealthViewContent
        healthSummaries={[
          baseSummary,
          {
            ...baseSummary,
            runtimeStatus: {
              ...baseSummary.runtimeStatus!,
              sync: {
                ...baseSummary.runtimeStatus!.sync,
                pendingEventCount: 2,
                status: "pending",
                uploadableEventCount: 2,
              },
            },
            terminal: {
              ...baseSummary.terminal,
              _id: "terminal-2",
              displayName: "Back counter",
              registerNumber: "2",
            },
          },
          {
            ...baseSummary,
            attentionReasons: [
              {
                count: 1,
                source: "local_runtime",
                summary: "1 local review item is still on this terminal.",
                type: "local_review",
              },
            ],
            runtimeStatus: null,
            health: "needs_attention",
            terminal: {
              ...baseSummary.terminal,
              _id: "terminal-3",
              displayName: "Spare laptop",
              registerNumber: null,
            },
          },
          {
            ...baseSummary,
            attentionReasons: [
              {
                count: 1,
                latestEventSequence: 8,
                latestEventStatus: "held",
                source: "cloud_sync",
                summary: "1 synced item is held before projection.",
                type: "cloud_held",
              },
              {
                source: "terminal_runtime",
                summary:
                  "Terminal setup data is not ready on this checkout station.",
                type: "terminal_seed_missing",
              },
            ],
            health: "needs_attention",
            runtimeStatus: {
              ...baseSummary.runtimeStatus!,
              localStore: {
                ...baseSummary.runtimeStatus!.localStore,
                terminalSeedReady: false,
              },
            },
            terminal: {
              ...baseSummary.terminal,
              _id: "terminal-4",
              displayName: "Review kiosk",
              registerNumber: "4",
            },
          },
        ]}
        isLoading={false}
        orgUrlSlug="acme"
        storeUrlSlug="osu"
      />,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "Terminal Health" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Healthy")).toBeInTheDocument();
    expect(screen.getAllByText("Pending sync").length).toBeGreaterThan(0);
    expect(screen.queryByText("No check-in")).not.toBeInTheDocument();
    expect(screen.getAllByText("Needs review").length).toBeGreaterThan(0);
    expect(
      screen.getByText("1 local review item is still on this terminal."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("1 synced item is held before projection."),
    ).toBeInTheDocument();
    expect(screen.getByText("Review kiosk")).toBeInTheDocument();
    expect(screen.getAllByText("Staff authority ready").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText("Register session evidence is shown in cash controls").length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("Offline diagnostics need attention").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(
        "Service catalog data is available locally. Last refreshed 3 minutes ago.",
      ).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(
        "App shell status has not reported to this page yet.",
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /Front counter/i })).toHaveAttribute(
      "href",
      "/acme/store/osu/pos/terminals/terminal-1",
    );
  });

  it("renders operational empty and query unavailable states", () => {
    const { rerender } = render(
      <POSTerminalHealthViewContent
        healthSummaries={[]}
        isLoading={false}
        orgUrlSlug="acme"
        storeUrlSlug="osu"
      />,
    );

    expect(screen.getByText("No POS terminals registered")).toBeInTheDocument();

    rerender(
      <POSTerminalHealthViewContent
        healthSummaries={[]}
        isLoading={false}
        orgUrlSlug="acme"
        queryUnavailable
        storeUrlSlug="osu"
      />,
    );

    expect(
      screen.getByText("Terminal health is not available right now"),
    ).toBeInTheDocument();
  });

  it("shows redacted app-session reconciliation posture without marking cashier continuation as review", () => {
    render(
      <POSTerminalHealthViewContent
        healthSummaries={[
          {
            ...baseSummary,
            health: "online",
            runtimeStatus: {
              ...baseSummary.runtimeStatus!,
              appSessionRecovery: {
                status: "waiting_for_network",
              },
              sync: {
                ...baseSummary.runtimeStatus!.sync,
                localOnlyEventCount: 2,
                pendingEventCount: 2,
                status: "pending",
                uploadableEventCount: 0,
              },
            },
          },
        ]}
        isLoading={false}
        orgUrlSlug="acme"
        storeUrlSlug="osu"
      />,
    );

    expect(screen.getByText("Local continuation")).toBeInTheDocument();
    expect(screen.getAllByText("Needs review")).toHaveLength(1);
    expect(screen.getByText("App-session posture")).toBeInTheDocument();
    expect(
      screen.getByText(
        "App session unverified; local sales stay on this terminal until cloud validation returns.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/assertion|token|secret|password|otp/i),
    ).not.toBeInTheDocument();
  });

  it("shows recovery readiness so healthy idle is distinct from able to transact now", () => {
    render(
      <POSTerminalHealthViewContent
        healthSummaries={[
          {
            ...baseSummary,
            recovery: {
              readiness: {
                status: "healthy_idle",
                summary: "Healthy idle. Open a drawer and sign in before selling.",
              },
            },
          },
          {
            ...baseSummary,
            recovery: {
              readiness: {
                status: "able_to_transact_now",
                summary:
                  "Able to transact now. Drawer, cashier, and sale authority are active.",
              },
            },
            terminal: {
              ...baseSummary.terminal,
              _id: "terminal-2",
              displayName: "Checkout two",
            },
          },
        ]}
        isLoading={false}
        orgUrlSlug="acme"
        storeUrlSlug="osu"
      />,
    );

    expect(screen.getByText("Healthy idle")).toBeInTheDocument();
    expect(
      screen.getByText("Healthy idle. Open a drawer and sign in before selling."),
    ).toBeInTheDocument();
    expect(screen.getByText("Able to transact now")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Able to transact now. Drawer, cashier, and sale authority are active.",
      ),
    ).toBeInTheDocument();
  });
});

describe("POSTerminalHealthView", () => {
  beforeEach(() => {
    mocks.authState.isLoading = false;
    mocks.authState.user = { _id: "user-1" };
    mocks.activeStoreState.activeStore = { _id: "store-1" };
    mocks.activeStoreState.isLoadingStores = false;
    mocks.canAccessPOS.mockReturnValue(true);
    mocks.useQuery.mockReturnValue([]);
    mocks.useQuery.mockClear();
  });

  it("does not query terminal health when the user is signed out", () => {
    mocks.authState.user = null;

    render(<POSTerminalHealthView />);

    expect(
      screen.getByText(
        "Your Athena session needs to reconnect before POS terminal health can load.",
      ),
    ).toBeInTheDocument();
    expect(mocks.useQuery).toHaveBeenCalledWith(expect.anything(), "skip");
  });

  it("does not query terminal health when POS access is denied", () => {
    mocks.canAccessPOS.mockReturnValue(false);

    render(<POSTerminalHealthView />);

    expect(screen.getByText("No permission")).toBeInTheDocument();
    expect(mocks.useQuery).toHaveBeenCalledWith(expect.anything(), "skip");
  });
});
