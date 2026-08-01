import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const trendPoint = {
  axisLabel: "Sat, Jul 11",
  chartIndex: 0,
  label: "Sat, Jul 11, 2026",
  netSalesMinor: 75_00,
  operatingDate: "2026-07-11",
  status: "reconciled" as const,
  unitsSold: 6,
};

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("recharts", () => ({
  Area: ({
    activeDot,
  }: {
    activeDot?: (props: Record<string, unknown>) => React.ReactNode;
  }) =>
    typeof activeDot === "function"
      ? activeDot({ cx: 40, cy: 30, payload: trendPoint })
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
      {labelFormatter("", [{ payload: trendPoint }])}
      {formatter(trendPoint.netSalesMinor, "Net sales", {
        payload: trendPoint,
      })}
    </div>
  ),
}));

import { ReportTrendChart } from "./ReportTrendChart";

describe("ReportTrendChart", () => {
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

    expect(screen.getByText("6 units sold")).toBeInTheDocument();
    expect(screen.getByText("Reconciled")).toBeInTheDocument();

    const point = screen.getByRole("link", {
      name: "View item sales for Sat, Jul 11, 2026",
    });
    fireEvent.click(point);
    expect(onDaySelect).toHaveBeenCalledWith("2026-07-11");
  });
});
