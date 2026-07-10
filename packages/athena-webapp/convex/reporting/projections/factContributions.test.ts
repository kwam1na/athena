import { describe, expect, it } from "vitest";

import { deriveFactMetricContributions } from "./factContributions";

describe("canonical fact metric contributions", () => {
  it("derives known merchandise sales and profit from immutable COGS", () => {
    expect(
      deriveFactMetricContributions({
        amountMinor: 8_000,
        cogsKnownMinor: 5_000,
        costStatus: "known",
        factType: "sale",
        quantity: 2,
        revenueKind: "merchandise",
      }),
    ).toEqual([
      { metric: "gross_sales", value: 8_000 },
      { metric: "net_sales", value: 8_000 },
      { metric: "units_sold", value: 2 },
      { metric: "known_cogs", value: 5_000 },
      { metric: "gross_profit", value: 3_000 },
    ]);
  });

  it("surfaces uncovered revenue instead of false profit", () => {
    expect(
      deriveFactMetricContributions({
        amountMinor: 8_000,
        costStatus: "unknown",
        factType: "sale",
        quantity: 1,
        revenueKind: "merchandise",
      }),
    ).toContainEqual({ metric: "uncosted_revenue", value: 8_000 });
    expect(
      deriveFactMetricContributions({
        amountMinor: 8_000,
        costStatus: "unknown",
        factType: "sale",
        quantity: 1,
        revenueKind: "merchandise",
      }).some((entry) => entry.metric === "gross_profit"),
    ).toBe(false);
  });

  it("retains one known unit of COGS while four units remain uncosted", () => {
    expect(
      deriveFactMetricContributions({
        amountMinor: 5_000,
        cogsKnownMinor: 400,
        costStatus: "partial",
        coveredRevenueMinor: 1_000,
        factType: "sale",
        quantity: 5,
        revenueKind: "merchandise",
      }),
    ).toEqual([
      { metric: "gross_sales", value: 5_000 },
      { metric: "net_sales", value: 5_000 },
      { metric: "units_sold", value: 5 },
      { metric: "known_cogs", value: 400 },
      { metric: "gross_profit", value: 600 },
      { metric: "uncosted_revenue", value: 4_000 },
    ]);
  });

  it("reverses commitments at receipt and sales/COGS on a return", () => {
    expect(
      deriveFactMetricContributions({
        amountMinor: 5_000,
        factType: "procurement_receipt",
        quantity: 2,
      }),
    ).toEqual([
      { metric: "purchase_commitment_units", value: -2 },
      { metric: "purchase_commitment_value", value: -5_000 },
    ]);
    expect(
      deriveFactMetricContributions({
        amountMinor: -8_000,
        cogsKnownMinor: -5_000,
        costStatus: "known",
        factType: "refund",
        quantity: -1,
        revenueKind: "refund",
      }),
    ).toEqual([
      { metric: "refunds", value: 8_000 },
      { metric: "net_sales", value: -8_000 },
      { metric: "units_returned", value: 1 },
      { metric: "units_sold", value: -1 },
      { metric: "known_cogs", value: -5_000 },
      { metric: "gross_profit", value: -3_000 },
    ]);
  });

  it("releases only the signed outstanding purchase commitment on close", () => {
    expect(
      deriveFactMetricContributions({
        amountMinor: -3_000,
        factType: "procurement_commitment",
        quantity: -3,
      }),
    ).toEqual([
      { metric: "purchase_commitment_units", value: -3 },
      { metric: "purchase_commitment_value", value: -3_000 },
    ]);
  });

  it("projects line-bearing voids and corrections as signed commerce deltas", () => {
    expect(
      deriveFactMetricContributions({
        amountMinor: -8_000,
        cogsKnownMinor: -5_000,
        costStatus: "known",
        factType: "void",
        quantity: -1,
        revenueKind: "merchandise",
      }),
    ).toEqual([
      { metric: "gross_sales", value: -8_000 },
      { metric: "net_sales", value: -8_000 },
      { metric: "units_sold", value: -1 },
      { metric: "known_cogs", value: -5_000 },
      { metric: "gross_profit", value: -3_000 },
    ]);
    expect(
      deriveFactMetricContributions({
        amountMinor: 500,
        costStatus: "unknown",
        factType: "correction",
        quantity: 1,
        revenueKind: "merchandise",
      }),
    ).toContainEqual({ metric: "uncosted_revenue", value: 500 });
  });

  it("does not treat tax corrections as sales", () => {
    expect(
      deriveFactMetricContributions({
        amountMinor: 500,
        factType: "correction",
        quantity: 0,
        revenueKind: "tax",
      }),
    ).toEqual([]);
  });

  it("moves unknown revenue into known gross profit when cost becomes known", () => {
    expect(
      deriveFactMetricContributions({
        adjustmentKind: "deficit_cogs_revaluation",
        cogsKnownMinor: 600,
        coveredRevenueMinor: 1_000,
        factType: "post_close_adjustment",
      }),
    ).toEqual([
      { metric: "known_cogs", value: 600 },
      { metric: "gross_profit", value: 400 },
      { metric: "uncosted_revenue", value: -1_000 },
    ]);
  });

  it("restores uncosted revenue when established cost is withheld", () => {
    expect(
      deriveFactMetricContributions({
        adjustmentKind: "deficit_cogs_revaluation",
        cogsKnownMinor: -600,
        coveredRevenueMinor: -1_000,
        factType: "post_close_adjustment",
      }),
    ).toEqual([
      { metric: "known_cogs", value: -600 },
      { metric: "gross_profit", value: -400 },
      { metric: "uncosted_revenue", value: 1_000 },
    ]);
  });

  it("withholds cross-currency revaluation profit while moving each owned metric", () => {
    expect(
      deriveFactMetricContributions({
        adjustmentKind: "deficit_cogs_revaluation",
        cogsKnownMinor: 600,
        coveredRevenueMinor: 1_000,
        factType: "post_close_adjustment",
        revenueCurrencyCode: "GHS",
        valuationCurrencyCode: "USD",
      }),
    ).toEqual([
      { metric: "known_cogs", value: 600 },
      { metric: "uncosted_revenue", value: -1_000 },
    ]);
  });

  it("projects payment collection and allocation without changing revenue", () => {
    const contributions = deriveFactMetricContributions({
      amountMinor: 5_000,
      factType: "payment",
    });

    expect(contributions).toEqual([
      { metric: "payments_collected", value: 5_000 },
      { metric: "payment_allocated", value: 5_000 },
    ]);
    expect(contributions.some((row) => row.metric === "net_sales")).toBe(false);
  });

  it("keeps linked payment reversal out of revenue until a financial refund", () => {
    const reversal = deriveFactMetricContributions({
      amountMinor: -2_000,
      factType: "payment",
      linkedBusinessEventKey: "payment:original",
    });
    expect(reversal).toEqual([
      { metric: "payments_reversed", value: -2_000 },
      { metric: "payment_allocated", value: -2_000 },
    ]);
    expect(reversal.some((row) => row.metric === "net_sales")).toBe(false);
    expect(
      deriveFactMetricContributions({
        amountMinor: -2_000,
        factType: "refund",
        quantity: 0,
        revenueKind: "refund",
      }),
    ).toContainEqual({ metric: "net_sales", value: -2_000 });
    expect(
      deriveFactMetricContributions({
        amountMinor: -2_000,
        factType: "refund",
        quantity: 0,
        revenueKind: "refund",
      }),
    ).toContainEqual({ metric: "gross_profit", value: -2_000 });
  });

  it("reconciles a revenue-only refund with its effect-owned COGS reversal", () => {
    const refund = deriveFactMetricContributions({
      amountMinor: -10_000,
      costStatus: "not_applicable",
      factType: "refund",
      quantity: 0,
      revenueKind: "refund",
    });
    const returnCost = deriveFactMetricContributions({
      cogsKnownMinor: -6_000,
      factType: "return",
      inventoryContributionKind: "sellable_return_cogs_reversal",
      quantity: -1,
      valuationCurrencyCode: "GHS",
    });
    const grossProfit = [...refund, ...returnCost]
      .filter((row) => row.metric === "gross_profit")
      .reduce((sum, row) => sum + row.value, 0);
    expect(grossProfit).toBe(-4_000);
  });

  it("treats a revenue-only merchandise correction as signed profit", () => {
    expect(
      deriveFactMetricContributions({
        amountMinor: 500,
        costStatus: "not_applicable",
        factType: "correction",
        quantity: 0,
        revenueKind: "merchandise",
      }),
    ).toContainEqual({ metric: "gross_profit", value: 500 });
  });

  it("withholds cross-currency gross profit while retaining revenue and known COGS", () => {
    const contributions = deriveFactMetricContributions({
      amountMinor: 8_000,
      cogsKnownMinor: 50,
      costStatus: "known",
      factType: "sale",
      quantity: 1,
      revenueCurrencyCode: "GHS",
      revenueKind: "merchandise",
      valuationCurrencyCode: "USD",
    });

    expect(contributions).toContainEqual({ metric: "net_sales", value: 8_000 });
    expect(contributions).toContainEqual({ metric: "known_cogs", value: 50 });
    expect(contributions.some((row) => row.metric === "gross_profit")).toBe(
      false,
    );
  });

  it("projects effect-owned return, exchange, and consumed-inventory cost once", () => {
    expect(
      deriveFactMetricContributions({
        cogsKnownMinor: -500,
        factType: "return",
        inventoryContributionKind: "sellable_return_cogs_reversal",
        quantity: -2,
        valuationCurrencyCode: "GHS",
      }),
    ).toEqual([
      { metric: "units_returned", value: 2 },
      { metric: "units_sold", value: -2 },
      { metric: "known_cogs", value: -500 },
      { metric: "gross_profit", value: 500 },
    ]);
    expect(
      deriveFactMetricContributions({
        cogsKnownMinor: 300,
        factType: "inventory_issue",
        inventoryContributionKind: "exchange_replacement_cogs",
        quantity: 1,
        valuationCurrencyCode: "GHS",
      }),
    ).toEqual([
      { metric: "known_cogs", value: 300 },
      { metric: "gross_profit", value: -300 },
    ]);
    expect(
      deriveFactMetricContributions({
        cogsKnownMinor: 200,
        factType: "inventory_issue",
        inventoryContributionKind: "inventory_consumed",
        quantity: 2,
        valuationCurrencyCode: "GHS",
      }),
    ).toEqual([
      { metric: "inventory_consumed_units", value: 2 },
      { metric: "inventory_consumed_value", value: 200 },
    ]);
    expect(
      deriveFactMetricContributions({
        cogsKnownMinor: -200,
        factType: "inventory_issue",
        inventoryContributionKind: "inventory_consumed_reversal",
        quantity: -2,
        valuationCurrencyCode: "GHS",
      }),
    ).toEqual([
      { metric: "inventory_consumed_units", value: -2 },
      { metric: "inventory_consumed_value", value: -200 },
    ]);
  });
});
