import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildCashMetrics,
  buildPaymentTotals,
  buildSummaryMetrics,
  resolveAppUrl,
} from "./dailyManagerReportEmail";

const originalEnv = {
  ATHENA_APP_URL: process.env.ATHENA_APP_URL,
  ATHENA_BASE_URL: process.env.ATHENA_BASE_URL,
  APP_URL: process.env.APP_URL,
  SITE_URL: process.env.SITE_URL,
  STAGE: process.env.STAGE,
};

describe("daily manager report email URLs", () => {
  afterEach(() => {
    process.env.ATHENA_APP_URL = originalEnv.ATHENA_APP_URL;
    process.env.ATHENA_BASE_URL = originalEnv.ATHENA_BASE_URL;
    process.env.APP_URL = originalEnv.APP_URL;
    process.env.SITE_URL = originalEnv.SITE_URL;
    process.env.STAGE = originalEnv.STAGE;
    vi.unstubAllGlobals();
  });

  it("uses the Athena base URL instead of storefront env URLs", () => {
    process.env.ATHENA_BASE_URL = "";
    process.env.ATHENA_APP_URL = "";
    process.env.APP_URL = "https://wigclub.store";
    process.env.SITE_URL = "https://storefront.example.com";
    process.env.STAGE = "";

    expect(resolveAppUrl()).toBe("http://localhost:5173");
  });

  it("uses explicit Athena base URL without a trailing slash", () => {
    process.env.ATHENA_BASE_URL = "https://athena.example.com/";
    process.env.ATHENA_APP_URL = "";
    process.env.APP_URL = "https://wigclub.store";
    process.env.SITE_URL = "https://storefront.example.com";
    process.env.STAGE = "prod";

    expect(resolveAppUrl()).toBe("https://athena.example.com");
  });

  it("defaults prod links to Athena", () => {
    process.env.ATHENA_BASE_URL = "";
    process.env.ATHENA_APP_URL = "";
    process.env.APP_URL = "https://wigclub.store";
    process.env.SITE_URL = "https://storefront.example.com";
    process.env.STAGE = "prod";

    expect(resolveAppUrl()).toBe("https://athena.wigclub.store");
  });

  it("omits voids from operating summary when there are no voids", () => {
    const money = (amount: number) => `GHS ${amount}`;

    expect(
      buildSummaryMetrics(
        {
          expenseTotal: 500,
          expenseTransactionCount: 1,
          salesTotal: 12000,
          transactionCount: 4,
          voidedTransactionCount: 0,
        },
        money,
      ).map((metric) => metric.label),
    ).toEqual(["Sales", "Expenses"]);
    expect(
      buildSummaryMetrics(
        {
          expenseTotal: 500,
          expenseTransactionCount: 1,
          salesTotal: 12000,
          transactionCount: 4,
          voidedTransactionCount: 2,
        },
        money,
      ),
    ).toContainEqual({ label: "Voids", value: "2" });
  });

  it("builds cash metrics from register expected and counted totals", () => {
    const money = (amount: number) => `GHS ${amount}`;

    expect(
      buildCashMetrics(
        {
          countedCashTotal: 208000,
          currentDayCashTotal: 162500,
          expectedCashTotal: 178000,
          netCashVariance: 30000,
        },
        money,
      ),
    ).toEqual([
      { label: "Expected cash", value: "GHS 178000" },
      { label: "Counted cash", value: "GHS 208000" },
      { label: "Net variance", value: "GHS 30000" },
    ]);
  });

  it("compares every operating summary metric with the prior day", () => {
    const money = (amount: number) => `GHS ${amount}`;

    expect(
      buildSummaryMetrics(
        {
          expenseTotal: 400,
          expenseTransactionCount: 3,
          salesTotal: 12000,
          transactionCount: 10,
          voidedTransactionCount: 2,
        },
        money,
        {
          expenseTotal: 500,
          expenseTransactionCount: 2,
          salesTotal: 10000,
          transactionCount: 8,
          voidedTransactionCount: 1,
        },
      ),
    ).toEqual([
      {
        comparison: "20% higher vs prior day",
        detail: "10 transactions",
        detailComparison: "25% higher vs prior day",
        label: "Sales",
        value: "GHS 12000",
      },
      {
        comparison: "20% lower vs prior day",
        detail: "3 reports",
        detailComparison: "50% higher vs prior day",
        label: "Expenses",
        value: "GHS 400",
      },
      {
        comparison: "100% higher vs prior day",
        label: "Voids",
        value: "2",
      },
    ]);
  });

  it("compares cash variance by magnitude and handles a quiet prior day", () => {
    const money = (amount: number) => `GHS ${amount}`;

    expect(
      buildCashMetrics(
        {
          countedCashTotal: 208000,
          expectedCashTotal: 178000,
          netCashVariance: 30000,
        },
        money,
        {
          countedCashTotal: 200000,
          expectedCashTotal: 200000,
          netCashVariance: -60000,
        },
      ),
    ).toEqual([
      {
        comparison: "11% lower vs prior day",
        label: "Expected cash",
        value: "GHS 178000",
      },
      {
        comparison: "4% higher vs prior day",
        label: "Counted cash",
        value: "GHS 208000",
      },
      {
        comparison: "50% lower vs prior day",
        label: "Net variance",
        value: "GHS 30000",
      },
    ]);

    expect(
      buildCashMetrics(
        {
          countedCashTotal: 100,
          expectedCashTotal: 100,
          netCashVariance: 0,
        },
        money,
        {
          countedCashTotal: 0,
          expectedCashTotal: 0,
          netCashVariance: 0,
        },
      ).map((metric) => metric.comparison),
    ).toEqual([
      "No activity on prior day",
      "No activity on prior day",
      "No activity on prior day",
    ]);
  });

  it("compares payment amounts and transaction counts with the prior day", () => {
    const money = (amount: number) => `GHS ${amount}`;

    expect(
      buildPaymentTotals(
        {
          paymentTotals: [
            { amount: 1200, method: "mobile_money", transactionCount: 6 },
          ],
        },
        money,
        {
          paymentTotals: [
            { amount: 1000, method: "mobile-money", transactionCount: 4 },
          ],
        },
      ),
    ).toEqual([
      {
        amount: "GHS 1200",
        amountComparison: "20% higher vs prior day",
        method: "Mobile Money",
        transactionCount: 6,
        transactionCountComparison: "50% higher vs prior day",
      },
    ]);
  });
});
