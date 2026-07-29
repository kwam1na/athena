/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import schema from "../schema";
import {
  buildCashMetrics,
  buildPaymentTotals,
  buildSummaryMetrics,
  resolveAppUrl,
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

describe("wasActionRequiredNotifiedBeforeRail", () => {
  const OPERATING_DATE = "2026-07-16";

  async function seedStoreAndRun(ctx: MutationCtx) {
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
    const automationRunId = await ctx.db.insert("automationRun", {
      action: "eod.auto_complete",
      createdAt: 1,
      domain: "daily_operations",
      eventIds: [],
      idempotencyKey: `daily_operations:eod.auto_complete:${storeId}:${OPERATING_DATE}`,
      mutationBoundary: "daily_close",
      operatingDate: OPERATING_DATE,
      organizationId,
      outcome: "skipped",
      policyMode: "enabled",
      policyVersion: "daily-operations.v1",
      snapshotCounts: {},
      sourceSubjects: [],
      storeId,
      triggerType: "scheduled",
      updatedAt: 1,
    });
    return { automationRunId, organizationId, storeId };
  }

  async function insertLegacyDelivery(
    ctx: MutationCtx,
    seeded: { automationRunId: Id<"automationRun">; storeId: Id<"store"> },
    overrides: Partial<{
      action: string;
      operatingDate: string;
      status: "pending" | "sent" | "failed";
      recipientEmail: string;
    }> = {},
  ) {
    return ctx.db.insert("automationNotificationDelivery", {
      action: overrides.action ?? "eod.auto_complete",
      attemptCount: 1,
      automationRunId: seeded.automationRunId,
      createdAt: 1,
      dedupeKey: `legacy:${overrides.recipientEmail ?? "admin@example.com"}:${overrides.status ?? "sent"}:${overrides.action ?? "eod.auto_complete"}:${overrides.operatingDate ?? OPERATING_DATE}`,
      domain: "daily_operations",
      notificationKind: "eod_action_required",
      operatingDate: overrides.operatingDate ?? OPERATING_DATE,
      recipientEmail: overrides.recipientEmail ?? "admin@example.com",
      status: overrides.status ?? "sent",
      storeId: seeded.storeId,
      updatedAt: 1,
    });
  }

  it("reports true only for a sent eod.auto_complete row on that store-day", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(seedStoreAndRun);
    const ask = (operatingDate = OPERATING_DATE) =>
      t.query(
        internal.operations.dailyManagerReportEmail
          .wasActionRequiredNotifiedBeforeRail,
        { operatingDate, storeId: seeded.storeId },
      );

    expect(await ask()).toBe(false);

    // Attempted but not delivered: the pre-rail send never reached anyone, so
    // the rail must still alert.
    await t.run((ctx) =>
      insertLegacyDelivery(ctx, seeded, { status: "pending" }),
    );
    await t.run((ctx) =>
      insertLegacyDelivery(ctx, seeded, { status: "failed" }),
    );
    expect(await ask()).toBe(false);

    // A sent row for another action or another store-day is not this alert.
    await t.run((ctx) =>
      insertLegacyDelivery(ctx, seeded, { action: "opening.auto_start" }),
    );
    await t.run((ctx) =>
      insertLegacyDelivery(ctx, seeded, { operatingDate: "2026-07-15" }),
    );
    expect(await ask()).toBe(false);
    expect(await ask("2026-07-14")).toBe(false);

    await t.run((ctx) => insertLegacyDelivery(ctx, seeded, { status: "sent" }));
    expect(await ask()).toBe(true);
    // Scoping stays intact: only the matching store-day flips.
    expect(await ask("2026-07-13")).toBe(false);
  });
});
