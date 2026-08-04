import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    search,
    to,
    ...props
  }: {
    children?: React.ReactNode;
    params?: Record<string, string>;
    search?: Record<string, string>;
    to: string;
  }) => (
    <a
      data-params={JSON.stringify(params)}
      data-search={JSON.stringify(search)}
      href={to}
      {...props}
    >
      {children}
    </a>
  ),
}));

import { ReportSkuMixChart } from "./ReportSkuMixChart";
import { formatReportDateRange } from "./reportFormat";
import type { ReportSkuMixData } from "~/shared/reportsContract";

const mixData: ReportSkuMixData = {
  totalUnitsSold: 10,
  skuCount: 7,
  rows: [
    {
      key: "sku-1",
      productSkuId: "sku-1",
      label: "WIG-A",
      unitsSold: 6,
      shareBasisPoints: 6_000,
      identity: { displayName: "Oshe", sku: "WIG-A" },
    },
    {
      key: "other",
      label: "Other SKUs",
      unitsSold: 4,
      shareBasisPoints: 4_000,
    },
  ],
};

const detailLink = {
  orgUrlSlug: "acme",
  search: { startDate: "2026-07-26", endDate: "2026-07-28", o: "/reports" },
  storeUrlSlug: "downtown",
};

describe("ReportSkuMixChart lifecycle states", () => {
  it("renders nothing while undefined and not pending (sync-path tolerance)", () => {
    render(<ReportSkuMixChart data={undefined} isRefreshing={false} />);

    expect(
      screen.queryByTestId("report-sku-mix-content"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("report-sku-mix-pending"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("report-sku-mix-chart")).toBeInTheDocument();
  });

  it("shows a calm pending status when a snapshot is preparing with nothing settled", () => {
    render(
      <ReportSkuMixChart data={undefined} isPending isRefreshing={false} />,
    );

    const pending = screen.getByTestId("report-sku-mix-pending");
    expect(pending).toHaveAttribute("role", "status");
    expect(screen.getByText("Preparing product mix")).toBeInTheDocument();
    expect(
      screen.getByText("Organizing product sales for this period."),
    ).toBeInTheDocument();
    // Never partial content alongside the status.
    expect(
      screen.queryByTestId("report-sku-mix-content"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Product sales legend"),
    ).not.toBeInTheDocument();
  });

  it("keeps retained data on screen during a pending refresh, without a competing skeleton", () => {
    const { rerender } = render(
      <ReportSkuMixChart data={mixData} isRefreshing={false} />,
    );
    expect(screen.getByText("Oshe")).toBeInTheDocument();

    // The next range's snapshot is pending; the settled rows hold.
    rerender(<ReportSkuMixChart data={mixData} isPending isRefreshing />);

    expect(screen.getByText("Oshe")).toBeInTheDocument();
    expect(
      screen.queryByTestId("report-sku-mix-pending"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("report-sku-mix-chart")).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  it("mutes the donut in place while a multi-day snapshot builds", () => {
    const building = {
      startDate: "2026-07-01",
      endDate: "2026-08-04",
      state: "updating" as const,
    };
    render(
      <ReportSkuMixChart
        building={building}
        data={mixData}
        isPending
        isRefreshing
      />,
    );

    // The settled rows hold — never a skeleton or the empty pending block.
    expect(screen.getByText("Oshe")).toBeInTheDocument();
    expect(
      screen.queryByTestId("report-sku-mix-pending"),
    ).not.toBeInTheDocument();

    // The announcement is polite and takes no layout: sr-only, naming the
    // incoming range while the legend keeps describing the settled data.
    const status = screen.getByTestId("report-sku-mix-building");
    expect(status).toHaveAttribute("role", "status");
    expect(status).toHaveClass("sr-only");
    expect(status).toHaveTextContent(
      `Updating product mix for ${formatReportDateRange(building.startDate, building.endDate)}`,
    );

    // Zero layout shift: the building state adds no in-flow siblings around
    // the chart container — the sr-only node is the only addition, and the
    // content grid renders with its usual two in-flow children.
    const content = screen.getByTestId("report-sku-mix-content");
    expect(status.nextElementSibling).toBe(content);
    expect(content.children).toHaveLength(2);

    // The donut itself is the loading variant: same geometry, desaturated
    // segments and a secondary label beneath the retained total.
    const graphic = screen.getByTestId("report-sku-mix-graphic");
    expect(graphic).toHaveClass("saturate-50");
    expect(graphic).toHaveClass("opacity-80");
    expect(graphic).toHaveClass("transition-[filter,opacity]");
    expect(graphic).toHaveClass("duration-300");
    expect(graphic).toHaveClass("motion-reduce:transition-none");
    const buildingLabel = screen.getByTestId("report-sku-mix-building-label");
    expect(buildingLabel).toHaveClass(
      "absolute",
      "inset-0",
      "pointer-events-none",
      "items-center",
      "justify-center",
    );
    expect(buildingLabel).toHaveTextContent("Updating…");
    expect(buildingLabel.firstElementChild).toHaveClass("translate-y-12");
    const total = screen.getByTestId("report-sku-mix-total");
    expect(total).not.toHaveClass("invisible");
    expect(total).toHaveAttribute("aria-label", "10 units across products");

    expect(screen.getByTestId("report-sku-mix-chart")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.getByTestId("report-sku-mix-chart")).toHaveAttribute(
      "data-building",
      "true",
    );
  });

  it("describes capacity backpressure in operator-friendly language", () => {
    const building = {
      startDate: "2026-07-01",
      endDate: "2026-08-04",
      state: "waiting_for_capacity" as const,
    };

    render(
      <ReportSkuMixChart
        building={building}
        data={mixData}
        isPending
        isRefreshing
      />,
    );

    expect(
      screen.getByTestId("report-sku-mix-building-label"),
    ).toHaveTextContent("Taking a little longer…");
    expect(screen.getByTestId("report-sku-mix-building")).toHaveTextContent(
      `Product mix for ${formatReportDateRange(building.startDate, building.endDate)} is taking a little longer to prepare`,
    );
    expect(screen.queryByText("Updating…")).not.toBeInTheDocument();
    expect(screen.queryByText(/capacity/i)).not.toBeInTheDocument();
  });

  it("keeps the retained chart label-free during initial preparation", () => {
    render(
      <ReportSkuMixChart
        building={{
          startDate: "2026-07-01",
          endDate: "2026-08-04",
          state: "preparing",
        }}
        data={mixData}
        isPending
        isRefreshing
      />,
    );

    expect(
      screen.queryByTestId("report-sku-mix-building-label"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("report-sku-mix-graphic")).toHaveClass(
      "saturate-50",
    );
    expect(screen.getByTestId("report-sku-mix-total")).not.toHaveClass(
      "invisible",
    );
  });

  it("keeps the empty card stable while a range mix is still building", () => {
    const building = {
      startDate: "2026-07-01",
      endDate: "2026-08-04",
      state: "updating" as const,
    };
    const emptyData: ReportSkuMixData = {
      totalUnitsSold: 0,
      skuCount: 0,
      rows: [],
    };

    render(
      <ReportSkuMixChart
        building={building}
        data={emptyData}
        isPending
        isRefreshing
      />,
    );

    const emptyBuilding = screen.getByTestId("report-sku-mix-empty-building");
    expect(emptyBuilding).toHaveClass(
      "absolute",
      "inset-0",
      "items-center",
      "justify-center",
    );
    expect(emptyBuilding).toHaveAttribute("data-transition-duration", "180");
    expect(emptyBuilding).toHaveTextContent("Preparing product mix");
    expect(
      screen.getByText("Organizing product sales for this period."),
    ).toBeInTheDocument();
    expect(screen.queryByText("No products sold")).not.toBeInTheDocument();
    expect(
      screen.queryByText("No product sales were recorded in this date range."),
    ).not.toBeInTheDocument();

    // The status remains an overlay over the normal chart slots.
    const content = screen.getByTestId("report-sku-mix-content");
    expect(content.children).toHaveLength(3);
    expect(screen.getByTestId("report-sku-mix-graphic")).toHaveClass(
      "invisible",
    );
    expect(
      screen.queryByTestId("report-sku-mix-building-label"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("report-sku-mix-chart")).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  it("announces the building transition once across lifecycle polls", () => {
    const building = {
      startDate: "2026-07-01",
      endDate: "2026-08-04",
      state: "updating" as const,
    };
    const { rerender } = render(
      <ReportSkuMixChart
        building={building}
        data={mixData}
        isPending
        isRefreshing
      />,
    );
    const status = screen.getByTestId("report-sku-mix-building");
    const initialText = status.textContent;

    // Each poll re-renders the panel with a new (equal) range object; the
    // status node and its text must not churn, or the live region re-announces.
    rerender(
      <ReportSkuMixChart
        building={{ ...building }}
        data={mixData}
        isPending
        isRefreshing
      />,
    );

    expect(screen.getAllByTestId("report-sku-mix-building")).toHaveLength(1);
    expect(screen.getByTestId("report-sku-mix-building")).toBe(status);
    expect(status.textContent).toBe(initialText);
  });

  it("animates the loading label out as the snapshot restores full color", async () => {
    const building = {
      startDate: "2026-07-01",
      endDate: "2026-08-04",
      state: "updating" as const,
    };
    const { rerender } = render(
      <ReportSkuMixChart
        building={building}
        data={mixData}
        isPending
        isRefreshing
      />,
    );
    expect(screen.getByTestId("report-sku-mix-building")).toBeInTheDocument();
    expect(
      screen.getByTestId("report-sku-mix-building-label"),
    ).toBeInTheDocument();

    const nextData: ReportSkuMixData = {
      ...mixData,
      totalUnitsSold: 24,
      rows: [
        { ...mixData.rows[0]!, unitsSold: 20, shareBasisPoints: 8_000 },
        { ...mixData.rows[1]!, unitsSold: 4, shareBasisPoints: 2_000 },
      ],
    };
    rerender(<ReportSkuMixChart data={nextData} isRefreshing={false} />);

    expect(
      screen.queryByTestId("report-sku-mix-building"),
    ).not.toBeInTheDocument();
    const graphic = screen.getByTestId("report-sku-mix-graphic");
    expect(graphic).not.toHaveClass("saturate-50");
    expect(graphic).not.toHaveClass("opacity-80");
    expect(screen.getByTestId("report-sku-mix-total")).not.toHaveClass(
      "invisible",
    );
    await waitFor(() =>
      expect(
        screen.queryByTestId("report-sku-mix-building-label"),
      ).not.toBeInTheDocument(),
    );
    // The eases stay on the elements so the release starts from the current
    // on-screen values instead of snapping.
    expect(graphic).toHaveClass("transition-[filter,opacity]");
    expect(screen.getByTestId("report-sku-mix-chart")).toHaveAttribute(
      "aria-busy",
      "false",
    );
  });

  it("defers to the pending block when nothing has settled yet", () => {
    render(
      <ReportSkuMixChart
        building={{
          startDate: "2026-07-01",
          endDate: "2026-08-04",
          state: "updating",
        }}
        data={undefined}
        isPending
        isRefreshing={false}
      />,
    );

    // With no settled rows the dedicated pending state owns the story; a
    // second affordance would compete with it.
    expect(screen.getByTestId("report-sku-mix-pending")).toBeInTheDocument();
    expect(
      screen.queryByTestId("report-sku-mix-building"),
    ).not.toBeInTheDocument();
  });

  it("replaces content with a sanitized terminal error carrying the reference", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <ReportSkuMixChart
        data={mixData}
        errorCorrelationId="corr-42"
        hasError
        isRefreshing={false}
        onRetry={onRetry}
      />,
    );

    const alert = screen.getByTestId("report-sku-mix-error");
    expect(alert).toHaveAttribute("role", "alert");
    expect(
      screen.getByText("Product mix could not be prepared"),
    ).toBeInTheDocument();
    expect(screen.getByText("Reference: corr-42")).toBeInTheDocument();
    // A terminal error never lets stale rows read as this range's result.
    expect(
      screen.queryByTestId("report-sku-mix-content"),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("omits the retry action when no durable request exists to retry", () => {
    render(
      <ReportSkuMixChart data={undefined} hasError isRefreshing={false} />,
    );

    expect(screen.getByTestId("report-sku-mix-error")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Retry" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Reference:/)).not.toBeInTheDocument();
  });

  it("shows a calm not-available message", () => {
    render(
      <ReportSkuMixChart
        data={undefined}
        isNotAvailable
        isRefreshing={false}
      />,
    );

    const status = screen.getByTestId("report-sku-mix-status");
    expect(status).toHaveAttribute("role", "status");
    expect(
      screen.getByText("Product mix is not available for this store."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Retry" }),
    ).not.toBeInTheDocument();
  });

  it("renders completed-empty data as the empty state, not as pending", () => {
    render(
      <ReportSkuMixChart
        data={{ rows: [], totalUnitsSold: 0, skuCount: 0 }}
        isRefreshing={false}
      />,
    );

    expect(screen.getByTestId("report-sku-mix-empty")).toBeInTheDocument();
    expect(screen.getByText("No products sold")).toBeInTheDocument();
    expect(
      screen.queryByTestId("report-sku-mix-pending"),
    ).not.toBeInTheDocument();
  });

  it("links identified rows to detail while the Other bucket stays plain", () => {
    render(
      <ReportSkuMixChart
        data={mixData}
        detailLink={detailLink}
        isRefreshing={false}
      />,
    );

    const skuLink = screen.getByRole("link", { name: /Oshe/ });
    expect(JSON.parse(skuLink.dataset.search ?? "{}")).toEqual(
      detailLink.search,
    );
    expect(screen.getByText("Other SKUs").closest("a")).toBeNull();
  });
});
