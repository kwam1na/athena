import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReportsSkuDetailView } from "./ReportsSkuDetailView";

describe("ReportsSkuDetailView", () => {
  it("does not render item detail while the epoch materializes", () => {
    const loadEvidence = vi.fn();
    render(
      <ReportsSkuDetailView
        detail={{ status: "materializing" }}
        evidence={undefined}
        loadEvidence={loadEvidence}
        productSkuId="sku-1"
      />,
    );
    expect(screen.getByText("Preparing reports")).toBeInTheDocument();
    expect(
      screen.queryByText("Selected-period performance"),
    ).not.toBeInTheDocument();
    expect(loadEvidence).not.toHaveBeenCalled();
  });
  it("does not request evidence until detail is mounted, then exposes source destinations", () => {
    const loadEvidence = vi.fn();
    render(
      <ReportsSkuDetailView
        detail={{
          identity: {
            product: { name: "Silk Press Wig" },
            sku: { sku: "SP-1" },
          },
          periodSummary: { metrics: {} },
          status: "active",
        }}
        evidence={undefined}
        loadEvidence={loadEvidence}
        productSkuId="sku-1"
      />,
    );
    expect(loadEvidence).toHaveBeenCalledOnce();
    expect(screen.getByRole("status")).toHaveTextContent(
      /loading item evidence/i,
    );
  });

  it("keeps unavailable historical evidence explicit", () => {
    render(
      <ReportsSkuDetailView
        detail={{
          identity: { product: { name: "Archived item" } },
          periodSummary: { metrics: {} },
          status: "active",
        }}
        evidence={{
          isDone: true,
          page: [
            {
              identityKey: "e-1",
              evidenceKind: "fact",
              factType: "sale",
              occurrenceAt: 1,
              recognitionAt: 1,
              completeness: "complete",
              destinations: [{ kind: "unavailable" }],
            },
          ],
        }}
        loadEvidence={vi.fn()}
        productSkuId="sku-1"
      />,
    );
    expect(screen.getByText("Detail unavailable")).toBeInTheDocument();
  });

  it("formats period and inventory money only from explicit currency metadata", () => {
    render(
      <ReportsSkuDetailView
        detail={{
          identity: { product: { name: "Silk Press Wig" } },
          inventory: {
            metrics: { knownInventoryValueMinor: 2500 },
            valuationCurrencyCode: "USD",
            valuationCurrencyMinorUnitScale: 2,
          },
          periodSummary: {
            metrics: { knownGrossProfitMinor: 500, netRevenueMinor: 1250 },
            revenueCurrencyCode: "USD",
            revenueCurrencyMinorUnitScale: 2,
          },
          status: "active",
        }}
        evidence={{ isDone: true, page: [] }}
        loadEvidence={vi.fn()}
        productSkuId="sku-1"
      />,
    );
    expect(screen.getByText("$12.50")).toBeInTheDocument();
    expect(screen.getByText("$5.00")).toBeInTheDocument();
    expect(screen.getByText("$25.00")).toBeInTheDocument();
  });
});
