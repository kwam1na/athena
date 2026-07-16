/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { internal } from "../_generated/api";
import { ADMIN_EMAILS } from "../constants/email";
import schema from "../schema";
import {
  buildCashMetrics,
  buildSummaryMetrics,
  resolveAppUrl,
  sendDailyManagerReportToAdminsForDateWithCtx,
} from "./dailyManagerReportEmail";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../")
      ? path.replace(/^\.\.\//, "./")
      : path.replace(/^\.\//, "./operations/"),
    loader,
  ]),
);

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

  it("sends prepared EOD reports with an EOD Review CTA", async () => {
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
      operatingDate: "Monday, June 8",
      operatingDateValue: "2026-06-08",
      paymentTotals: [],
      reportUrl:
        "https://athena.wigclub.store/accra/store/accra/operations/daily-close?operatingDate=2026-06-08",
      reviewedItems: [
        {
          message: "Manager should review the close before completion.",
          title: "Manager review",
          tone: "warning" as const,
        },
      ],
      status: "prepared",
      storeCurrency: "GHS",
      storeName: "Accra",
      summaryMetrics: [],
    };
    const runQuery = vi.fn(async () => report);

    const result = await sendDailyManagerReportToAdminsForDateWithCtx(
      { runQuery } as never,
      {
        operatingDate: "2026-06-08",
        status: "prepared",
        storeId: "store-1" as never,
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(ADMIN_EMAILS.length);
    const body = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit).body),
    );
    expect(body.html).toContain("Ready for manager review");
    expect(body.html).toContain("Prepared");
    expect(body.html).toContain("8:42 PM");
    expect(body.html).toContain(
      "https://athena.wigclub.store/accra/store/accra/operations/daily-close?operatingDate=2026-06-08",
    );
    expect(result[0]).toEqual({
      operatingDate: "2026-06-08",
      recipientEmail: ADMIN_EMAILS[0].email,
      status: 202,
      storeName: "Accra",
    });
  });

  it("sends one action-required EOD report per reserved admin delivery", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(null, { status: 202 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const report = {
      blockers: [],
      carryForwardItems: [],
      cashMetrics: [],
      completedAt: "10:00 PM",
      completedBy: "Athena",
      operatingDate: "Thursday, July 16",
      operatingDateValue: "2026-07-16",
      paymentTotals: [],
      reportUrl:
        "https://athena.wigclub.store/wigclub/store/wigclub/operations/daily-close?operatingDate=2026-07-16",
      reviewedItems: [],
      status: "skipped",
      storeCurrency: "GHS",
      storeName: "Wigclub",
      summaryMetrics: [],
    };
    const runQuery = vi.fn(async () => report);
    const runMutation = vi.fn(
      async (_functionRef: unknown, args: Record<string, unknown>) =>
        "recipientEmail" in args
          ? `delivery-${String(args.recipientEmail)}`
          : null,
    );

    const result = await sendDailyManagerReportToAdminsForDateWithCtx(
      { runMutation, runQuery } as never,
      {
        automationRunId: "automation-run-1" as never,
        operatingDate: "2026-07-16",
        status: "skipped",
        storeId: "store-1" as never,
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(ADMIN_EMAILS.length);
    const body = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit).body),
    );
    expect(body.subject).toBe(
      "Action required: Wigclub EOD Review - Thursday, July 16",
    );
    expect(body.html).toContain("Manager action required");
    expect(body.html).toContain("Athena EOD alert");
    expect(body.html).not.toContain("Athena daily report");
    expect(body.html).toContain(
      "Athena did not close this operating day.",
    );
    expect(body.html).toContain("Open EOD Review");
    expect(body.html).not.toContain(
      "No follow-up needed for this operating day.",
    );
    expect(runMutation).toHaveBeenCalledTimes(ADMIN_EMAILS.length * 2);
    expect(result).toHaveLength(ADMIN_EMAILS.length);
  });

  it("does not resend an action-required EOD report after delivery was claimed", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const runQuery = vi.fn(async () => ({
      completedAt: "10:00 PM",
      completedBy: "Athena",
      operatingDate: "Thursday, July 16",
      operatingDateValue: "2026-07-16",
      reportUrl:
        "https://athena.wigclub.store/wigclub/store/wigclub/operations/daily-close?operatingDate=2026-07-16",
      status: "failed",
      storeName: "Wigclub",
    }));
    const runMutation = vi.fn(async () => null);

    const result = await sendDailyManagerReportToAdminsForDateWithCtx(
      { runMutation, runQuery } as never,
      {
        automationRunId: "automation-run-1" as never,
        operatingDate: "2026-07-16",
        status: "failed",
        storeId: "store-1" as never,
      },
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it("deduplicates sent alerts and retries failed delivery reservations", async () => {
    const t = convexTest(schema, modules);
    const { firstRunId, secondRunId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("athenaUser", {
        email: "owner@example.com",
        normalizedEmail: "owner@example.com",
      });
      const organizationId = await ctx.db.insert("organization", {
        createdByUserId: userId,
        name: "Accra",
        slug: "accra",
      });
      const storeId = await ctx.db.insert("store", {
        createdByUserId: userId,
        currency: "GHS",
        name: "Accra",
        organizationId,
        slug: "accra",
      });
      const baseRun = {
        action: "eod.auto_complete",
        createdAt: 1,
        domain: "daily_operations",
        eventIds: [],
        idempotencyKey: `daily_operations:eod.auto_complete:${storeId}:2026-07-16`,
        mutationBoundary: "daily_close",
        operatingDate: "2026-07-16",
        organizationId,
        policyMode: "enabled" as const,
        policyVersion: "daily-operations.v1",
        snapshotCounts: {},
        sourceSubjects: [],
        storeId,
        triggerType: "scheduled",
        updatedAt: 1,
      };
      const firstRunId = await ctx.db.insert("automationRun", {
        ...baseRun,
        outcome: "skipped",
      });
      const secondRunId = await ctx.db.insert("automationRun", {
        ...baseRun,
        createdAt: 2,
        idempotencyKey: `${baseRun.idempotencyKey}:retry`,
        outcome: "failed",
        updatedAt: 2,
      });
      return { firstRunId, secondRunId };
    });

    const deliveryId = await t.mutation(
      internal.operations.dailyManagerReportEmail
        .reserveActionRequiredDailyManagerReportDelivery,
      {
        automationRunId: firstRunId,
        recipientEmail: "ADMIN@EXAMPLE.COM ",
      },
    );
    expect(deliveryId).not.toBeNull();

    await t.mutation(
      internal.operations.dailyManagerReportEmail
        .markActionRequiredDailyManagerReportDeliveryFailed,
      { deliveryId: deliveryId! },
    );
    await expect(
      t.mutation(
        internal.operations.dailyManagerReportEmail
          .reserveActionRequiredDailyManagerReportDelivery,
        {
          automationRunId: secondRunId,
          recipientEmail: "admin@example.com",
        },
      ),
    ).resolves.toBe(deliveryId);

    const delivery = await t.run((ctx) =>
      ctx.db.get("automationNotificationDelivery", deliveryId!),
    );
    expect(delivery).toMatchObject({
      attemptCount: 2,
      automationRunId: secondRunId,
      recipientEmail: "admin@example.com",
      status: "pending",
    });

    await t.mutation(
      internal.operations.dailyManagerReportEmail
        .markActionRequiredDailyManagerReportDeliverySent,
      { deliveryId: deliveryId! },
    );
    await expect(
      t.mutation(
        internal.operations.dailyManagerReportEmail
          .reserveActionRequiredDailyManagerReportDelivery,
        {
          automationRunId: firstRunId,
          recipientEmail: "admin@example.com",
        },
      ),
    ).resolves.toBeNull();
  });
});
