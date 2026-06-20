import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import PointOfSaleView from "./PointOfSaleView";

const useGetActiveOrganizationMock = vi.fn();
const useGetActiveStoreMock = vi.fn();
const useLocalPosEntryContextMock = vi.fn();
const usePermissionsMock = vi.fn();
const usePrewarmRegisterCatalogOfflineSnapshotsMock = vi.fn();
const useQueryMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    to,
    ...props
  }: {
    children?: React.ReactNode;
    params?: { orgUrlSlug: string; storeUrlSlug: string };
    to?: string;
  } & Record<string, unknown>) => (
    <a
      href={
        to
          ?.replace("$orgUrlSlug", params?.orgUrlSlug ?? "")
          .replace("$storeUrlSlug", params?.storeUrlSlug ?? "") ?? "#"
      }
      {...props}
    >
      {children}
    </a>
  ),
  useParams: () => ({ orgUrlSlug: "acme", storeUrlSlug: "downtown" }),
  useSearch: () => ({}),
}));

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

vi.mock("recharts", () => ({
  Area: () => <path data-testid="store-pulse-area" />,
  AreaChart: ({ children }: { children?: React.ReactNode }) => (
    <svg data-testid="store-pulse-chart">{children}</svg>
  ),
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

vi.mock("@/components/ui/chart", () => ({
  ChartContainer: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="store-pulse-chart-container">{children}</div>
  ),
  ChartTooltip: () => null,
  ChartTooltipContent: () => null,
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
      hasFinancialDetailsAccess: true,
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
      averageTransaction: 6_250,
      date: "2026-06-20",
      operatorSnapshot: {
        busiestHour: {
          hour: 14,
          label: "2 PM",
          totalSales: 12_500,
          transactionCount: 2,
        },
        comparison: {
          averageTransactionDeltaPercent: 25,
          currentAverageTransaction: 6_250,
          currentItemsSold: 3,
          currentSales: 12_500,
          currentTransactions: 2,
          itemsSoldDeltaPercent: 50,
          salesDeltaPercent: 25,
          transactionDeltaPercent: 0,
          yesterdayAverageTransaction: 5_000,
          yesterdayItemsSold: 2,
          yesterdaySales: 10_000,
          yesterdayTransactions: 2,
        },
        historyDays: 14,
        isLimited: false,
        paymentMix: [
          {
            count: 1,
            label: "Cash",
            method: "cash",
            share: 60,
            total: 7_500,
          },
          {
            count: 1,
            label: "Card",
            method: "card",
            share: 40,
            total: 5_000,
          },
        ],
        topItems: [
          {
            name: "Braiding hair",
            productSku: "BRAID-1",
            quantity: 2,
            totalSales: 8_000,
          },
        ],
        trend: [
          {
            averageTransaction: 0,
            date: "2026-06-19",
            label: "Jun 19",
            totalItemsSold: 0,
            totalSales: 0,
            transactionCount: 0,
          },
          {
            averageTransaction: 6_250,
            date: "2026-06-20",
            label: "Jun 20",
            totalItemsSold: 3,
            totalSales: 12_500,
            transactionCount: 2,
          },
        ],
        usableHistoryDays: 1,
      },
      totalItemsSold: 3,
      totalSales: 12_500,
      totalTransactions: 2,
    });
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

  it("embeds store pulse on the POS landing page instead of linking to a separate route", () => {
    render(<PointOfSaleView />);

    expect(
      screen.getByRole("region", { name: "Store pulse" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { level: 2, name: "Store pulse" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Sales Reports/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Review store pulse trends and operator sales insights"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Sales trend")).toBeInTheDocument();
    expect(screen.getByTestId("store-pulse-chart")).toBeInTheDocument();
    expect(useQueryMock).toHaveBeenCalledWith(expect.anything(), {
      pulseWindow: "today",
      storeId: "store-1",
    });
  });

  it("keeps POS entry points available while store pulse metrics load", () => {
    useQueryMock.mockReturnValue(undefined);

    render(<PointOfSaleView />);

    expect(
      screen.getByRole("link", {
        name: /^POS Transact in-store sales$/i,
      }),
    ).toHaveAttribute("href", "/acme/store/downtown/pos/register");
    expect(screen.getByRole("link", { name: /Transactions/i })).toHaveAttribute(
      "href",
      "/acme/store/downtown/pos/transactions",
    );
    expect(screen.getByLabelText("Store pulse loading")).toBeInTheDocument();
    expect(
      screen.getAllByText("-").length,
    ).toBeGreaterThanOrEqual(4);
  });

  it("links POS users to terminal health from the POS landing page", () => {
    render(<PointOfSaleView />);

    const link = screen.getByRole("link", { name: /Terminal Health/i });

    expect(link).toHaveAttribute("href", "/acme/store/downtown/pos/terminals");
    expect(link).toHaveAttribute(
      "data-remote-assist-control",
      "pos-workspace-feature",
    );
    expect(link).toHaveAttribute(
      "data-remote-assist-control-id",
      "pos-workspace-terminal-health",
    );
    expect(link).toHaveAttribute(
      "data-remote-assist-control-label",
      "Terminal Health",
    );
    expect(
      screen.getByText(
        "Review checkout station sync, staff authority, and support signals",
      ),
    ).toBeInTheDocument();
  });

  it("links POS-only users to POS settings from the POS landing page", () => {
    usePermissionsMock.mockReturnValue({
      canAccessPOS: () => true,
      hasFinancialDetailsAccess: false,
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
    expect(useQueryMock).toHaveBeenCalledWith(expect.anything(), {
      pulseWindow: "today",
      storeId: "store-1",
    });
    expect(screen.getAllByText("-").length).toBeGreaterThan(0);
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
