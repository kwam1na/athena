import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import PointOfSaleView from "./PointOfSaleView";
import { PosTerminalAppSessionRecoveryProvider } from "@/lib/pos/infrastructure/terminal/posTerminalAppSessionRecoveryContext";

const useGetActiveOrganizationMock = vi.fn();
const useGetActiveStoreMock = vi.fn();
const useLocalPosEntryContextMock = vi.fn();
const usePermissionsMock = vi.fn();
const usePrewarmRegisterCatalogOfflineSnapshotsMock = vi.fn();
const usePosLocalSyncRuntimeStatusMock = vi.fn();
const useMutationMock = vi.fn();
const useQueryMock = vi.fn();
const useActionMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    to,
  }: {
    children?: React.ReactNode;
    params?: { orgUrlSlug: string; storeUrlSlug: string };
    to?: string;
  }) => (
    <a
      href={
        to
          ?.replace("$orgUrlSlug", params?.orgUrlSlug ?? "")
          .replace("$storeUrlSlug", params?.storeUrlSlug ?? "") ?? "#"
      }
    >
      {children}
    </a>
  ),
  useParams: () => ({ orgUrlSlug: "acme", storeUrlSlug: "downtown" }),
  useSearch: () => ({}),
}));

vi.mock("convex/react", () => ({
  useAction: () => useActionMock,
  useMutation: () => useMutationMock,
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

vi.mock("@/hooks/useGetActiveStore", () => ({
  default: function UseGetActiveStoreMockAdapter() {
    return useGetActiveStoreMock();
  },
}));

vi.mock("@/hooks/useGetOrganizations", () => ({
  useGetActiveOrganization: () => useGetActiveOrganizationMock(),
}));

vi.mock("~/src/hooks/useGetCurrencyFormatter", () => ({
  useGetCurrencyFormatter: () =>
    new Intl.NumberFormat("en-US", { currency: "GHS", style: "currency" }),
}));

vi.mock("~/src/hooks/useGetTerminal", () => ({
  useGetTerminal: () => ({ terminal: null }),
}));

vi.mock("@/lib/pos/infrastructure/local/localPosEntryContext", () => ({
  useLocalPosEntryContext: () => useLocalPosEntryContextMock(),
}));

vi.mock("@/lib/pos/infrastructure/local/usePosLocalSyncRuntime", () => ({
  usePosLocalSyncRuntimeStatus: (input: Record<string, unknown>) =>
    usePosLocalSyncRuntimeStatusMock(input),
}));

vi.mock("@/lib/pos/infrastructure/convex/catalogGateway", () => ({
  usePrewarmRegisterCatalogOfflineSnapshots: (
    input: Record<string, unknown>,
  ) => usePrewarmRegisterCatalogOfflineSnapshotsMock(input),
}));

vi.mock("~/src/hooks/usePermissions", () => ({
  usePermissions: () => usePermissionsMock(),
}));

vi.mock("../View", () => ({
  default: ({
    children,
    header,
  }: {
    children?: React.ReactNode;
    header?: React.ReactNode;
  }) => (
    <div>
      {header}
      {children}
    </div>
  ),
}));

vi.mock("../common/FadeIn", () => ({
  FadeIn: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

describe("PointOfSaleView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useActionMock.mockResolvedValue({
      data: null,
      kind: "ok",
    });
    useGetActiveStoreMock.mockReturnValue({
      activeStore: {
        _id: "store-1",
        currency: "GHS",
        slug: "downtown",
      },
    });
    useGetActiveOrganizationMock.mockReturnValue({
      activeOrganization: {
        _id: "org-1",
        slug: "acme",
      },
    });
    usePermissionsMock.mockReturnValue({
      canAccessPOS: () => true,
      hasFullAdminAccess: true,
    });
    useLocalPosEntryContextMock.mockReturnValue({
      status: "ready",
      orgUrlSlug: "acme",
      storeUrlSlug: "downtown",
      storeId: "store-1",
      terminalSeed: null,
      source: "live",
    });
    useQueryMock.mockReturnValue({
      totalItemsSold: 3,
      totalSales: 12_500,
      totalTransactions: 2,
    });
    useMutationMock.mockResolvedValue(null);
    usePosLocalSyncRuntimeStatusMock.mockReturnValue(null);
  });

  it("renders the POS landing header as the page title", () => {
    render(<PointOfSaleView />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Point of Sale" }),
    ).toBeInTheDocument();
  });

  it("prewarms POS register offline snapshots from the POS landing page", () => {
    render(<PointOfSaleView />);

    expect(usePrewarmRegisterCatalogOfflineSnapshotsMock).toHaveBeenCalledWith({
      storeId: "store-1",
    });
  });

  it("prewarms POS register offline snapshots from local entry context when live store context is unavailable", () => {
    useGetActiveStoreMock.mockReturnValue({
      activeStore: null,
    });
    useLocalPosEntryContextMock.mockReturnValue({
      status: "ready",
      orgUrlSlug: "acme",
      storeUrlSlug: "downtown",
      storeId: "local-store-1",
      terminalSeed: null,
      source: "local",
    });

    render(<PointOfSaleView />);

    expect(usePrewarmRegisterCatalogOfflineSnapshotsMock).toHaveBeenCalledWith({
      storeId: "local-store-1",
    });
  });

  it("links managers to active POS session operations from the POS landing page", () => {
    render(<PointOfSaleView />);

    const link = screen.getByRole("link", { name: /Active Sessions/i });

    expect(link).toHaveAttribute("href", "/acme/store/downtown/pos/sessions");
    expect(
      screen.getByText("Review active and held sales reserving inventory"),
    ).toBeInTheDocument();
  });

  it("links POS users to terminal health from the POS landing page", () => {
    render(<PointOfSaleView />);

    const link = screen.getByRole("link", { name: /Terminal Health/i });

    expect(link).toHaveAttribute("href", "/acme/store/downtown/pos/terminals");
    expect(
      screen.getByText(
        "Review checkout station sync, staff authority, and support signals",
      ),
    ).toBeInTheDocument();
  });

  it("links POS-only users to POS settings from the POS landing page", () => {
    usePermissionsMock.mockReturnValue({
      canAccessPOS: () => true,
      hasFullAdminAccess: false,
    });

    render(<PointOfSaleView />);

    const link = screen.getByRole("link", { name: /POS Settings/i });

    expect(link).toHaveAttribute("href", "/acme/store/downtown/pos/settings");
    expect(screen.queryByRole("link", { name: /Active Sessions/i })).toBeNull();
  });

  it("renders the POS launcher from local entry context when live summary and store context are unavailable", () => {
    useGetActiveStoreMock.mockReturnValue({
      activeStore: null,
    });
    useGetActiveOrganizationMock.mockReturnValue({
      activeOrganization: null,
    });
    useLocalPosEntryContextMock.mockReturnValue({
      status: "ready",
      orgUrlSlug: "acme",
      storeUrlSlug: "downtown",
      storeId: "store-1",
      terminalSeed: {
        terminalId: "local-terminal-1",
        cloudTerminalId: "terminal-cloud-1",
        syncSecretHash: "secret-hash",
        storeId: "store-1",
        displayName: "Front register",
        provisionedAt: 1_700,
        schemaVersion: 2,
      },
      source: "local",
    });
    useQueryMock.mockReturnValue(undefined);

    render(<PointOfSaleView />);

    expect(screen.getByRole("link", { name: /^POS/i })).toHaveAttribute(
      "href",
      "/acme/store/downtown/pos/register",
    );
    expect(
      screen.queryByRole("link", { name: /Active Sessions/i }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText("--").length).toBeGreaterThan(0);
  });

  it("owns drain-enabled local sync when a provisioned terminal seed is present on the POS hub", () => {
    useLocalPosEntryContextMock.mockReturnValue({
      status: "ready",
      orgUrlSlug: "acme",
      storeUrlSlug: "downtown",
      storeId: "store-1",
      terminalSeed: {
        terminalId: "local-terminal-1",
        cloudTerminalId: "terminal-cloud-1",
        syncSecretHash: "secret-hash",
        storeId: "store-1",
        displayName: "Front register",
        provisionedAt: 1_700,
        schemaVersion: 2,
      },
      source: "live",
    });

    render(<PointOfSaleView />);

    expect(usePosLocalSyncRuntimeStatusMock).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "drain-enabled",
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );
  });

  it("passes POS shell app-session recovery diagnostics into runtime status", () => {
    useLocalPosEntryContextMock.mockReturnValue({
      status: "ready",
      orgUrlSlug: "acme",
      storeUrlSlug: "downtown",
      storeId: "store-1",
      terminalSeed: {
        terminalId: "local-terminal-1",
        cloudTerminalId: "terminal-cloud-1",
        syncSecretHash: "secret-hash",
        storeId: "store-1",
        displayName: "Front register",
        provisionedAt: 1_700,
        schemaVersion: 2,
      },
      source: "live",
    });

    render(
      <PosTerminalAppSessionRecoveryProvider
        value={{
          assertion: "present",
          reason: null,
          status: "recoverable",
        }}
      >
        <PointOfSaleView />
      </PosTerminalAppSessionRecoveryProvider>,
    );

    expect(usePosLocalSyncRuntimeStatusMock).toHaveBeenCalledWith(
      expect.objectContaining({
        appSessionRecovery: {
          assertion: "present",
          reason: null,
          status: "recoverable",
        },
        mode: "drain-enabled",
        storeId: "store-1",
        terminalId: "terminal-cloud-1",
      }),
    );
  });

  it("shows a Remote Assist runtime banner and disconnects with terminal proof", () => {
    useLocalPosEntryContextMock.mockReturnValue({
      status: "ready",
      orgUrlSlug: "acme",
      storeUrlSlug: "downtown",
      storeId: "store-1",
      terminalSeed: {
        terminalId: "local-terminal-1",
        cloudTerminalId: "terminal-cloud-1",
        syncSecretHash: "secret-hash",
        storeId: "store-1",
        displayName: "Front register",
        provisionedAt: 1_700,
        schemaVersion: 2,
      },
      source: "live",
    });
    useQueryMock
      .mockReturnValueOnce({
        _id: "remote-session-1",
        effectiveMode: "unattended",
        sensitiveModeActive: false,
        status: "active",
      })
      .mockReturnValue({
        totalItemsSold: 3,
        totalSales: 12_500,
        totalTransactions: 2,
      });

    render(<PointOfSaleView />);

    expect(screen.getByLabelText("Remote assist runtime")).toBeInTheDocument();
    expect(screen.getByText("Control on")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /disconnect remote assist/i }),
    );

    expect(useMutationMock).toHaveBeenCalledWith({
      sessionId: "remote-session-1",
      storeId: "store-1",
      syncSecretHash: "secret-hash",
      terminalId: "terminal-cloud-1",
    });
  });

  it("shows setup guidance instead of blanking when local POS authority is missing", () => {
    useGetActiveStoreMock.mockReturnValue({
      activeStore: null,
    });
    useGetActiveOrganizationMock.mockReturnValue({
      activeOrganization: null,
    });
    useLocalPosEntryContextMock.mockReturnValue({ status: "missing_seed" });
    useQueryMock.mockReturnValue(undefined);

    render(<PointOfSaleView />);

    expect(screen.getByText("POS")).toBeInTheDocument();
    expect(screen.getByText("Setup required")).toBeInTheDocument();
    expect(
      screen.getByText("Connect this terminal before starting sales"),
    ).toBeInTheDocument();
  });
});
