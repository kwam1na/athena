import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { POSStorePulseSection } from "./POSSalesPulseView";

vi.mock("recharts", () => ({
  Area: () => <path data-testid="store-pulse-area" />,
  AreaChart: ({
    children,
    data = [],
  }: {
    children?: React.ReactNode;
    data?: Array<{ displayDate?: string; displayLabel?: string }>;
  }) => (
    <svg
      data-testid="store-pulse-chart"
      data-display-dates={data.map((day) => day.displayDate).join("|")}
      data-display-labels={data.map((day) => day.displayLabel).join("|")}
    >
      {children}
    </svg>
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

function buildTodaySummary({
  topItems = [
    {
      name: "Braiding hair",
      productSku: "BRAID-1",
      quantity: 2,
      totalSales: 8_000,
    },
  ],
} = {}) {
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
      topItems,
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
}

const currencyFormatter = new Intl.NumberFormat("en-US", {
  currency: "GHS",
  style: "currency",
});

type RenderStorePulseOptions = {
  hasFullAdminAccess?: boolean;
  onPulseWindowChange?: (
    pulseWindow: "today" | "this_week" | "this_month" | "all_time",
  ) => void;
  pulseWindow?: "today" | "this_week" | "this_month" | "all_time";
  todaySummary?: ReturnType<typeof buildTodaySummary>;
};

function renderStorePulse(options: RenderStorePulseOptions = {}) {
  const {
    hasFullAdminAccess = true,
    onPulseWindowChange = vi.fn(),
    pulseWindow = "today",
  } = options;
  const todaySummary =
    "todaySummary" in options ? options.todaySummary : buildTodaySummary();

  render(
    <POSStorePulseSection
      currencyFormatter={currencyFormatter}
      hasFullAdminAccess={hasFullAdminAccess}
      onPulseWindowChange={onPulseWindowChange}
      pulseWindow={pulseWindow}
      todaySummary={todaySummary}
    />,
  );
}

describe("POSStorePulseSection", () => {
  it("renders store pulse as an embedded POS hub section", () => {
    renderStorePulse();

    expect(
      screen.getByRole("region", { name: "Store pulse" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { level: 2, name: "Store pulse" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Sales")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Today" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "All time" })).toBeInTheDocument();
    expect(
      screen.queryByText(/Compared with/),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Sales trend")).toBeInTheDocument();
    expect(screen.queryByText("Busiest hour")).not.toBeInTheDocument();
    expect(screen.getByText("How customers paid")).toBeInTheDocument();
    expect(screen.getByText("Braiding Hair")).toBeInTheDocument();
    expect(screen.getByTestId("store-pulse-chart")).toBeInTheDocument();
    expect(screen.getByTestId("store-pulse-area")).toBeInTheDocument();
    expect(screen.queryByText("Transaction review")).not.toBeInTheDocument();
  });

  it("shows ten top items across five-row pages", async () => {
    const user = userEvent.setup();
    const topItems = Array.from({ length: 10 }, (_, index) => ({
      name: `item ${index + 1}`,
      productSku: `ITEM-${index + 1}`,
      quantity: 10 - index,
      totalSales: 1_000 * (index + 1),
    }));

    renderStorePulse({ todaySummary: buildTodaySummary({ topItems }) });

    expect(screen.getByText("Item 1")).toBeInTheDocument();
    expect(screen.getByText("Item 5")).toBeInTheDocument();
    expect(screen.queryByText("Item 6")).not.toBeInTheDocument();
    expect(screen.getByText("Showing 1-5 of 10")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Go to next page" }));

    expect(screen.getByText("Item 6")).toBeInTheDocument();
    expect(screen.getByText("Item 10")).toBeInTheDocument();
    expect(screen.queryByText("Item 1")).not.toBeInTheDocument();
    expect(screen.getByText("Showing 6-10 of 10")).toBeInTheDocument();
  });

  it("reports period filter changes to the POS hub", async () => {
    const user = userEvent.setup();
    const onPulseWindowChange = vi.fn();

    renderStorePulse({ onPulseWindowChange });

    await user.click(screen.getByRole("tab", { name: "This month" }));

    expect(onPulseWindowChange).toHaveBeenCalledWith("this_month");
  });

  it("uses a no-comparison helper for all time", () => {
    renderStorePulse({ pulseWindow: "all_time" });

    expect(screen.getByText("All synced POS sales.")).toBeInTheDocument();
    expect(screen.queryByText(/vs /)).not.toBeInTheDocument();
    expect(screen.getAllByText("-").length).toBeGreaterThanOrEqual(4);
  });

  it("shows the comparison basis for the selected sales window", () => {
    renderStorePulse({ pulseWindow: "this_week" });

    expect(screen.getByRole("tab", { name: "This week" })).toBeInTheDocument();
    expect(screen.getAllByText(/vs last week/).length).toBeGreaterThan(0);
  });

  it("uses operator-friendly labels for the sales trend chart", () => {
    renderStorePulse({ pulseWindow: "today" });

    expect(screen.getByTestId("store-pulse-chart")).toHaveAttribute(
      "data-display-labels",
      "Yesterday|Today",
    );
    expect(screen.getByTestId("store-pulse-chart")).toHaveAttribute(
      "data-display-dates",
      "Friday, Jun 19, 2026|Saturday, Jun 20, 2026",
    );
  });

  it("hides financial sales cards when full admin access is not active", () => {
    renderStorePulse({ hasFullAdminAccess: false });

    expect(screen.queryByText("Manager only")).not.toBeInTheDocument();
    expect(screen.queryByText("Revenue hidden")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "Today" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "All time" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Sales")).not.toBeInTheDocument();
    expect(screen.queryByText("Average sale")).not.toBeInTheDocument();
    expect(screen.getByText("Transactions")).toBeInTheDocument();
    expect(screen.getByText("Items sold")).toBeInTheDocument();
    expect(screen.queryByText(/vs yesterday/)).not.toBeInTheDocument();
    expect(screen.queryByText("Sales trend")).not.toBeInTheDocument();
    expect(screen.queryByText("Top items")).not.toBeInTheDocument();
    expect(screen.queryByText("How customers paid")).not.toBeInTheDocument();
    expect(screen.queryByTestId("store-pulse-chart")).not.toBeInTheDocument();
  });

  it("keeps the store pulse layout stable while data loads", () => {
    renderStorePulse({ todaySummary: undefined });

    expect(screen.getByLabelText("Store pulse loading")).toBeInTheDocument();
    expect(screen.getByText("Sales")).toBeInTheDocument();
    expect(screen.getByText("Sales trend")).toBeInTheDocument();
    expect(screen.getByText("Top items")).toBeInTheDocument();
    expect(screen.getByText("How customers paid")).toBeInTheDocument();
    expect(screen.getAllByText("-").length).toBeGreaterThanOrEqual(4);
  });

  it("does not show detail skeletons to non-full-admin users while data loads", () => {
    renderStorePulse({ hasFullAdminAccess: false, todaySummary: undefined });

    expect(screen.getByLabelText("Store pulse loading")).toBeInTheDocument();
    expect(screen.queryByText("Sales")).not.toBeInTheDocument();
    expect(screen.queryByText("Average sale")).not.toBeInTheDocument();
    expect(screen.getByText("Transactions")).toBeInTheDocument();
    expect(screen.getByText("Items sold")).toBeInTheDocument();
    expect(screen.queryByText("Sales trend")).not.toBeInTheDocument();
    expect(screen.queryByText("Top items")).not.toBeInTheDocument();
    expect(screen.queryByText("How customers paid")).not.toBeInTheDocument();
  });
});
