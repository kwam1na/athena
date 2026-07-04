import { afterEach, describe, expect, it, vi } from "vitest";

import { ADMIN_EMAILS } from "../constants/email";
import {
  buildSummaryMetrics,
  resolveAppUrl,
  sendDailyManagerReportToAdminsForDateWithCtx,
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

  it("sends the completed daily report to every configured admin email", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(null, { status: 202 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const report = {
      blockers: [],
      carryForwardItems: [],
      cashMetrics: [],
      completedAt: "8:42 PM",
      completedBy: "Athena",
      dailyCloseId: "daily-close-1",
      operatingDate: "Monday, June 8",
      operatingDateValue: "2026-06-08",
      paymentTotals: [],
      reportUrl:
        "https://athena.wigclub.store/accra/store/accra/operations/daily-close",
      reviewedItems: [],
      status: "applied",
      storeCurrency: "GHS",
      storeName: "Accra",
      summaryMetrics: [],
    };
    const runQuery = vi.fn(async () => [report]);

    const result = await sendDailyManagerReportToAdminsForDateWithCtx(
      { runQuery } as never,
      {
        operatingDate: "2026-06-08",
        storeId: "store-1" as never,
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(ADMIN_EMAILS.length);
    expect(
      fetchMock.mock.calls.map((call) => {
        const body = JSON.parse(String((call[1] as RequestInit).body));
        return body.to[0];
      }),
    ).toEqual(ADMIN_EMAILS);
    expect(result).toEqual(
      ADMIN_EMAILS.map((recipient) => ({
        dailyCloseId: "daily-close-1",
        operatingDate: "2026-06-08",
        recipientEmail: recipient.email,
        status: 202,
        storeName: "Accra",
      })),
    );
  });
});
