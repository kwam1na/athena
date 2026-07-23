import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import PointOfSaleView from "./PointOfSaleView";

const useGetActiveOrganizationMock = vi.fn();
const useGetActiveStoreMock = vi.fn();
const useLocalPosEntryContextMock = vi.fn();
const usePermissionsMock = vi.fn();
const usePrewarmRegisterCatalogOfflineSnapshotsMock = vi.fn();
const useQueryMock = vi.fn();
const useSharedDemoContextMock = vi.fn();

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

vi.mock("~/convex/_generated/api", () => ({
  api: {
    inventory: {
      pos: {
        getTodaySummary: "getTodaySummary",
      },
      storeSchedule: {
        getStoreScheduleSummary: "getStoreScheduleSummary",
      },
    },
  },
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

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
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
  usePrewarmRegisterCatalogOfflineSnapshots: (input: Record<string, unknown>) =>
    usePrewarmRegisterCatalogOfflineSnapshotsMock(input),
}));

vi.mock("~/src/hooks/usePermissions", () => ({
  usePermissions: () => usePermissionsMock(),
}));

vi.mock("@/hooks/useSharedDemoContext", () => ({
  useSharedDemoContext: () => useSharedDemoContextMock(),
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
    useSharedDemoContextMock.mockReturnValue(null);
    useLocalPosEntryContextMock.mockReturnValue({
      status: "ready",
      orgUrlSlug: "acme",
      storeUrlSlug: "downtown",
      storeId: "store-1",
      terminalSeed: null,
      source: "live",
    });
    useQueryMock.mockImplementation((query) => {
      if (query === "getStoreScheduleSummary") {
        return {
          context: {
            nextWindow: {
              localDate: "2026-07-08",
              localStartLabel: "09:00",
            },
            timezone: "America/New_York",
          },
          schedule: {
            timezone: "America/New_York",
          },
        };
      }

      return {
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
      };
    });
  });

  it("renders the POS landing header as the page title", () => {
    render(<PointOfSaleView />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Point of Sale" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Store time")).toBeInTheDocument();
    expect(screen.getByText("Next opening")).toBeInTheDocument();
    expect(screen.getByText("Wed, Jul 8 9:00 AM")).toBeInTheDocument();
    expect(useQueryMock).toHaveBeenCalledWith("getStoreScheduleSummary", {
      storeId: "store-1",
    });
  });

  it("prewarms register metadata without refreshing full availability from the POS landing page", () => {
    render(<PointOfSaleView />);

    expect(usePrewarmRegisterCatalogOfflineSnapshotsMock).toHaveBeenCalledWith({
      refreshAvailabilitySnapshot: false,
      storeId: "store-1",
    });
  });

  it("prewarms register metadata from local entry context when live store context is unavailable", () => {
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
      refreshAvailabilitySnapshot: false,
      storeId: "local-store-1",
    });
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
      screen.queryByText(
        "Review store pulse trends and operator sales insights",
      ),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Sales trend")).toBeInTheDocument();
    expect(screen.getByTestId("store-pulse-chart")).toBeInTheDocument();
    expect(useQueryMock).toHaveBeenCalledWith(expect.anything(), {
      pulseWindow: "today",
      storeId: "store-1",
    });
  });

  it("keeps non-full-admin store pulse queries on today", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<PointOfSaleView />);

    await user.click(screen.getByRole("tab", { name: "This month" }));
    expect(useQueryMock).toHaveBeenCalledWith("getTodaySummary", {
      pulseWindow: "this_month",
      storeId: "store-1",
    });

    usePermissionsMock.mockReturnValue({
      canAccessPOS: () => true,
      hasFinancialDetailsAccess: false,
      hasFullAdminAccess: false,
    });
    useQueryMock.mockClear();

    rerender(<PointOfSaleView />);

    expect(useQueryMock).toHaveBeenCalledWith("getTodaySummary", {
      pulseWindow: "today",
      storeId: "store-1",
    });
    expect(
      screen.queryByRole("tab", { name: "This month" }),
    ).not.toBeInTheDocument();
  });

  it("uses live POS pulse data for shared-demo today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 23, 12));
    useSharedDemoContextMock.mockReturnValue({
      kind: "shared_demo",
      storeId: "store-1",
    });

    try {
      render(<PointOfSaleView />);

      expect(useQueryMock).toHaveBeenCalledWith("getTodaySummary", {
        pulseWindow: "today",
        storeId: "store-1",
      });
      expect(screen.getByText("Braiding Hair")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses shared-demo fixture history for POS non-today windows", async () => {
    const user = userEvent.setup();
    useSharedDemoContextMock.mockReturnValue({
      kind: "shared_demo",
      storeId: "store-1",
    });

    render(<PointOfSaleView />);
    useQueryMock.mockClear();

    await user.click(screen.getByRole("tab", { name: "This week" }));

    expect(useQueryMock).toHaveBeenCalledWith("getTodaySummary", "skip");
    expect(screen.queryAllByText("No sales yesterday")).toHaveLength(0);
    expect(screen.getAllByText(/last week/).length).toBeGreaterThan(0);
    expect(screen.getByText("Raw Shea Butter 250g")).toBeInTheDocument();
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
    expect(screen.getAllByText("-").length).toBeGreaterThanOrEqual(4);
  });

  it("links manager-level users to terminal health from the POS landing page", () => {
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

  it("hides manager-only POS launchers for POS-only sessions", () => {
    usePermissionsMock.mockReturnValue({
      canAccessPOS: () => true,
      hasFinancialDetailsAccess: false,
      hasFullAdminAccess: false,
    });

    render(<PointOfSaleView />);

    expect(
      screen.queryByRole("link", { name: /Product Lookup/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Terminal Health/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /POS Settings/i }),
    ).not.toBeInTheDocument();
  });

  it("links manager-level users to POS settings from the POS landing page", () => {
    render(<PointOfSaleView />);

    const link = screen.getByRole("link", { name: /POS Settings/i });
    expect(link).toHaveAttribute("href", "/acme/store/downtown/pos/settings");
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
