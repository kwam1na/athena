import { render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useQuery = vi.fn();
vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => useQuery(...args),
}));
vi.mock("@/hooks/useGetActiveStore", () => ({
  default: () => ({
    activeStore: { _id: "store-1", currency: "USD" },
    isLoadingStores: false,
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    ...props
  }: React.ComponentProps<"a"> & {
    params?: unknown;
    search?: unknown;
    to: string;
  }) => {
    delete props.params;
    delete props.search;
    return (
      <a href={to} {...props}>
        {children}
      </a>
    );
  },
  useParams: () => ({ orgUrlSlug: "acme", storeUrlSlug: "downtown" }),
}));

import { ReportsOverviewView } from "./ReportsOverviewView";

describe("ReportsOverviewView", () => {
  beforeEach(() => useQuery.mockReset());

  it("announces loading and pre-cutover states without presenting zeros", () => {
    useQuery.mockReturnValueOnce(undefined);
    const { rerender } = render(<ReportsOverviewView periodKey="wtd" />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading report");

    useQuery.mockReturnValueOnce({ data: null, status: "pre_cutover" });
    rerender(<ReportsOverviewView periodKey="wtd" />);
    expect(screen.getByText("Reporting starts here")).toBeInTheDocument();
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
  });

  it("keeps Overview in a preparation state while the reporting epoch materializes", () => {
    useQuery.mockReturnValue({ data: null, status: "materializing" });
    render(<ReportsOverviewView periodKey="wtd" />);
    expect(screen.getByText("Preparing reports")).toBeInTheDocument();
    expect(screen.queryByText("Reports are current")).not.toBeInTheDocument();
  });

  it("renders a balanced money and inventory pulse with explicit cost coverage", () => {
    useQuery.mockReturnValue({
      status: "active",
      data: {
        completeness: "partial",
        limitingReason: "uncosted",
        metrics: {
          net_sales: 125_00,
          comparison_net_sales: 100_00,
          units_sold: 14,
          comparison_units_sold: 10,
          known_gross_profit: 45_00,
          cost_coverage_basis_points: 9000,
          inventory_value: 810_00,
          uncosted_on_hand_quantity: 3,
        },
        attention: [],
      },
    });
    render(<ReportsOverviewView periodKey="wtd" />);

    expect(
      screen.getByText("Some costs are not available"),
    ).toBeInTheDocument();
    expect(screen.getByText("$125.00")).toBeInTheDocument();
    expect(screen.getByText("$810.00")).toBeInTheDocument();
    expect(screen.getByText(/90% cost coverage/i)).toBeInTheDocument();
    expect(screen.getByText("+25.0%")).toBeInTheDocument();
  });

  it("does not fabricate a percentage when the comparison denominator is zero", () => {
    useQuery.mockReturnValue({
      status: "active",
      data: {
        completeness: "complete",
        metrics: { net_sales: 500, comparison_net_sales: 0 },
      },
    });
    render(<ReportsOverviewView periodKey="wtd" />);
    expect(screen.getByText("+$5.00 vs prior period")).toBeInTheDocument();
    expect(screen.queryByText(/Infinity|NaN/)).not.toBeInTheDocument();
  });

  it("withholds money while preserving non-money metrics for mixed currencies", () => {
    useQuery.mockReturnValue({
      status: "active",
      data: {
        completeness: "partial",
        limitingReason: "mixed_currency",
        metrics: {
          net_sales: 12500,
          units_sold: 14,
          known_gross_profit: 5000,
          inventory_value: 20000,
        },
      },
    });
    render(<ReportsOverviewView periodKey="wtd" />);
    expect(
      screen.getAllByText("Currencies cannot be combined").length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("14")).toBeInTheDocument();
    expect(screen.queryByText("$125.00")).not.toBeInTheDocument();
    expect(screen.queryByText("$200.00")).not.toBeInTheDocument();
  });

  it("routes attention to its owning workflow and labels unavailable evidence", () => {
    useQuery.mockReturnValue({
      status: "active",
      data: {
        completeness: "complete",
        metrics: {},
        attention: [
          {
            id: "a1",
            title: "Terminal activity is still syncing",
            detail: "Wednesday may change.",
            destination: { kind: "terminal_health" },
          },
          {
            id: "a2",
            title: "Historical source unavailable",
            detail: "The summary remains available.",
            destination: { kind: "unavailable" },
          },
        ],
      },
    });
    render(<ReportsOverviewView periodKey="wtd" />);
    expect(
      screen.getByRole("link", { name: /review terminal activity/i }),
    ).toHaveAttribute("href", expect.stringContaining("pos/terminals"));
    expect(screen.getByText("Source detail unavailable")).toBeInTheDocument();
  });
});
