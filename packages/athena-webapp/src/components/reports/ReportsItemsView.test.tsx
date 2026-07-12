import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReportsItemsView } from "./ReportsItemsView";

describe("ReportsItemsView", () => {
  it("does not render an empty item result while the epoch materializes", () => {
    render(
      <ReportsItemsView
        classification="all"
        data={{
          continueCursor: "",
          isDone: true,
          page: [],
          status: "materializing",
        }}
        onClassificationChange={vi.fn()}
        onOpenItem={vi.fn()}
        onSortChange={vi.fn()}
        sort="revenue"
      />,
    );
    expect(screen.getByText("Preparing reports")).toBeInTheDocument();
    expect(
      screen.queryByText("No item activity matches this view."),
    ).not.toBeInTheDocument();
  });
  it("renders coverage, classifications, and mobile row summaries", () => {
    const onClassificationChange = vi.fn();
    render(
      <ReportsItemsView
        classification="all"
        data={{
          continueCursor: "",
          facets: [{ value: "fast_mover", count: 1 }],
          isDone: true,
          page: [
            {
              productSkuId: "sku-1",
              identity: {
                product: { name: "Silk Press Wig", slug: "silk-press" },
                sku: { sku: "SP-01" },
              },
              classifications: ["fast_mover"],
              completeness: "complete",
              metrics: {
                netRevenueMinor: 12500,
                netSoldUnits: 4,
                knownGrossProfitMinor: 5000,
                costCoverageBasisPoints: 8000,
                onHandQuantity: 6,
                projectedDaysOfCover: 5,
              },
              revenueCurrencyCode: "USD",
              revenueCurrencyMinorUnitScale: 2,
              revenueSort: 12500,
              marginSort: 0,
              unitsSort: 4,
              coverSort: 5,
              inventoryValueSort: 0,
              attentionSort: 0,
            },
          ],
          rollups: [],
          status: "active",
        }}
        onClassificationChange={onClassificationChange}
        onOpenItem={vi.fn()}
        onSortChange={vi.fn()}
        sort="revenue"
      />,
    );
    expect(screen.getAllByText("Silk Press Wig").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/80% cost coverage/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText("$125.00").length).toBeGreaterThan(0);
    screen.getByRole("button", { name: /fast mover \(1\)/i }).click();
    expect(onClassificationChange).toHaveBeenCalledWith("fast_mover");
    expect(
      screen.getByRole("button", { name: /sort by net sales, descending/i }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByTestId("reports-items-table-mobile-cards"),
    ).toBeInTheDocument();
  });

  it("omits a count suffix when the server does not provide one", () => {
    render(
      <ReportsItemsView
        classification="all"
        data={{
          continueCursor: "",
          facets: [{ value: "slow_mover" }],
          isDone: true,
          page: [],
          status: "verified",
        }}
        onClassificationChange={vi.fn()}
        onOpenItem={vi.fn()}
        onSortChange={vi.fn()}
        sort="revenue"
      />,
    );
    expect(
      screen.getByRole("button", { name: "slow mover" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /slow mover \(/ }),
    ).not.toBeInTheDocument();
  });
});
