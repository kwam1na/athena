import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const trendPoint = {
  axisLabel: "Sat, Jul 11",
  chartIndex: 0,
  label: "Sat, Jul 11, 2026",
  netSalesMinor: 75_00,
  operatingDate: "2026-07-11",
  status: "reconciled" as const,
  transactionCount: undefined as number | undefined,
  unitsSold: 6,
};

/**
 * The recharts mock renders whatever point the test under way is exercising;
 * the real chart hands the hovered datum to the tooltip, and mocking a fixed
 * payload would let the tooltip pass no matter what the props said.
 */
let activePoint: typeof trendPoint = trendPoint;

beforeEach(() => {
  activePoint = trendPoint;
});

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("recharts", () => ({
  Area: ({
    activeDot,
  }: {
    activeDot?: (props: Record<string, unknown>) => React.ReactNode;
  }) =>
    typeof activeDot === "function"
      ? activeDot({ cx: 40, cy: 30, payload: activePoint })
      : null,
  AreaChart: ({ children }: { children?: React.ReactNode }) => (
    <svg>{children}</svg>
  ),
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));
vi.mock("@/components/ui/chart", () => ({
  ChartContainer: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ChartTooltip: ({ content }: { content?: React.ReactNode }) => content,
  ChartTooltipContent: ({
    formatter,
    labelFormatter,
  }: {
    formatter: (
      value: number,
      name: string,
      item: { payload: typeof trendPoint },
    ) => React.ReactNode;
    labelFormatter: (
      label: string,
      payload: Array<{ payload: typeof trendPoint }>,
    ) => React.ReactNode;
  }) => (
    <div>
      {labelFormatter("", [{ payload: activePoint }])}
      {formatter(activePoint.netSalesMinor, "Net sales", {
        payload: activePoint,
      })}
    </div>
  ),
}));

import { ReportTrendChart } from "./ReportTrendChart";

describe("ReportTrendChart", () => {
  function renderTrend(point: typeof trendPoint) {
    activePoint = point;
    render(
      <ReportTrendChart
        currency="USD"
        dailyTrend={[
          {
            operatingDate: point.operatingDate,
            netSalesMinor: point.netSalesMinor,
            status: point.status,
            transactionCount: point.transactionCount,
            unitsSold: point.unitsSold,
          },
        ]}
        onDaySelect={vi.fn()}
      />,
    );
  }

  it("pairs the transaction count with units on one line when the day has closed", () => {
    renderTrend({ ...trendPoint, transactionCount: 12 });

    expect(screen.getByText("12 transactions · 6 units")).toBeInTheDocument();
  });

  it("singularizes a lone transaction", () => {
    renderTrend({ ...trendPoint, transactionCount: 1, unitsSold: 1 });

    expect(screen.getByText("1 transaction · 1 unit")).toBeInTheDocument();
  });

  it("falls back to units alone when the day has no settled count", () => {
    renderTrend({ ...trendPoint, transactionCount: undefined });

    expect(screen.getByText("6 units")).toBeInTheDocument();
  });

  it("shows units sold and opens the selected day from its active point", () => {
    const onDaySelect = vi.fn();

    render(
      <ReportTrendChart
        currency="USD"
        dailyTrend={[
          {
            operatingDate: trendPoint.operatingDate,
            netSalesMinor: trendPoint.netSalesMinor,
            status: trendPoint.status,
            unitsSold: trendPoint.unitsSold,
          },
        ]}
        onDaySelect={onDaySelect}
      />,
    );

    expect(screen.getByText("6 units")).toBeInTheDocument();
    expect(screen.getByText("Reconciled")).toBeInTheDocument();

    const point = screen.getByRole("link", {
      name: "View item sales for Sat, Jul 11, 2026",
    });
    fireEvent.click(point);
    expect(onDaySelect).toHaveBeenCalledWith("2026-07-11");
  });
});
