import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReportsInventoryView } from "./ReportsInventoryView";

describe("ReportsInventoryView", () => {
  it("does not render empty inventory while the epoch materializes", () => {
    render(
      <ReportsInventoryView
        data={{
          continueCursor: "",
          isDone: true,
          page: [],
          status: "materializing",
        }}
      />,
    );
    expect(screen.getByText("Preparing reports")).toBeInTheDocument();
    expect(
      screen.queryByText("No inventory exposure is available."),
    ).not.toBeInTheDocument();
  });
  it("separates current position from period movement and exposes mobile summaries", () => {
    render(
      <ReportsInventoryView
        data={{
          continueCursor: "",
          isDone: true,
          movementSummary: {
            metrics: {
              receiptsQuantity: 10,
              salesQuantity: 4,
              returnsQuantity: 1,
              consumedQuantity: 2,
              adjustmentsQuantity: 0,
              commitmentQuantity: 6,
            },
          },
          page: [
            {
              productSkuId: "sku-1",
              asOf: 1000,
              completeness: "partial",
              identity: {
                product: { name: "Silk Press Wig" },
                sku: { sku: "SP-01" },
              },
              metrics: {
                onHandQuantity: 8,
                sellableQuantity: 5,
                knownInventoryValueMinor: 20000,
                uncostedOnHandQuantity: 2,
              },
              valuationCurrencyCode: "USD",
              valuationCurrencyMinorUnitScale: 2,
              movement: {
                receiptsQuantity: 3,
                salesQuantity: 2,
                returnsQuantity: 1,
                consumedQuantity: 1,
                adjustmentsQuantity: 0,
                commitmentQuantity: 4,
              },
            },
          ],
          status: "active",
        }}
      />,
    );
    expect(
      screen.getByRole("heading", { name: /current inventory position/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /selected-period movement/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/2 units uncosted/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText("$200.00").length).toBeGreaterThan(0);
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(
      screen.getByTestId("reports-inventory-table-mobile-cards"),
    ).toBeInTheDocument();
  });
});
