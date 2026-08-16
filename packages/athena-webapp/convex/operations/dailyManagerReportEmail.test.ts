/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import schema from "../schema";
import {
  sendDailyManagerReportsForDateRangeOperationDefinition,
  sendMostRecentDailyManagerReportOperationDefinition,
} from "../operationAdmission/domains/u5_operations_definitions";
import {
  buildCashMetrics,
  buildDailyTopMoversUrl,
  buildPaymentTotals,
  buildPreparedBlockers,
  buildSummaryMetrics,
  formatCompletedAt,
  resolveAppUrl,
} from "./dailyManagerReportEmail";

// The manager-report actions are the only call site of this sender, so the
// module mock is scoped to exactly what the admission tests must observe:
// whether MailerSend was reached at all.
const mailerMocks = vi.hoisted(() => ({
  sendDailyManagerReportEmail: vi.fn(),
}));

vi.mock("../mailersend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../mailersend")>()),
  sendDailyManagerReportEmail: mailerMocks.sendDailyManagerReportEmail,
}));

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

describe("daily manager report completion timestamp", () => {
  it("keeps same-day closes time-only", () => {
    expect(
      formatCompletedAt(
        Date.parse("2026-08-08T20:47:00.000Z"),
        "Africa/Accra",
        "2026-08-08",
      ),
    ).toBe("8:47 PM");
  });

  it("includes the short completion date when a stale operating day closes later", () => {
    expect(
      formatCompletedAt(
        Date.parse("2026-08-12T20:47:00.000Z"),
        "Africa/Accra",
        "2026-08-08",
      ),
    ).toBe("Aug 12, 8:47 PM");
  });
});

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

    expect(resolveAppUrl()).toBe("https://athena-os.app");
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

  it("identifies the terminal and register for an open-session blocker", () => {
    expect(
      buildPreparedBlockers({
        blockers: [
          {
            category: "register_session",
            message:
              "Close the register session before completing the end of day review.",
            metadata: {
              register: "Register 3",
              terminal: "Front Counter",
            },
            severity: "blocker",
            title: "Register session is still open",
          },
        ],
      } as never),
    ).toEqual([
      {
        message:
          "Front Counter · Register 3. Close the register session before completing the end of day review.",
        title: "Register session is still open",
        tone: "danger",
      },
    ]);
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

  it("places units sold after sales and compares it with the prior day", () => {
    const money = (amount: number) => `GHS ${amount}`;
    const summary = {
      expenseTotal: 400,
      expenseTransactionCount: 3,
      salesTotal: 12000,
      transactionCount: 10,
      voidedTransactionCount: 0,
    };

    expect(
      buildSummaryMetrics(summary, money, undefined, {
        unitsSold: 1240,
        priorUnitsSold: 992,
      }).map((metric) => metric.label),
    ).toEqual(["Sales", "Units sold", "Expenses"]);
    expect(
      buildSummaryMetrics(summary, money, undefined, {
        unitsSold: 1240,
        priorUnitsSold: 992,
      }),
    ).toContainEqual({
      label: "Units sold",
      value: "1,240",
      comparison: "25% higher vs prior day",
    });
  });

  it("omits units sold entirely when the reports lane has not folded the day", () => {
    const money = (amount: number) => `GHS ${amount}`;
    const summary = {
      expenseTotal: 400,
      expenseTransactionCount: 3,
      salesTotal: 12000,
      transactionCount: 10,
      voidedTransactionCount: 0,
    };

    expect(
      buildSummaryMetrics(summary, money).map((metric) => metric.label),
    ).toEqual(["Sales", "Expenses"]);
    expect(
      buildSummaryMetrics(summary, money, undefined, {}).map(
        (metric) => metric.label,
      ),
    ).toEqual(["Sales", "Expenses"]);
  });

  it("drops the comparison rather than reading an unknown prior day as zero", () => {
    const money = (amount: number) => `GHS ${amount}`;

    expect(
      buildSummaryMetrics(
        {
          expenseTotal: 400,
          expenseTransactionCount: 3,
          salesTotal: 12000,
          transactionCount: 10,
          voidedTransactionCount: 0,
        },
        money,
        // A prior day the rest of the email can compare against, but whose
        // reportDay is missing or uncertified — "No activity on prior day"
        // would be a lie here.
        { salesTotal: 10000 },
        { unitsSold: 1240 },
      ),
    ).toContainEqual({
      label: "Units sold",
      value: "1,240",
      comparison: undefined,
    });
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

describe("getStaleDailyManagerReportPayloadForDate", () => {
  const OPERATING_DATE = "2026-07-16";

  async function seedStore(ctx: MutationCtx) {
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
    return { organizationId, storeId };
  }

  async function insertRun(
    ctx: MutationCtx,
    seeded: Awaited<ReturnType<typeof seedStore>>,
    outcome: "dry_run" | "skipped" | "failed",
    updatedAt: number,
    createdAt = updatedAt,
  ) {
    return ctx.db.insert("automationRun", {
      action: "eod.auto_complete",
      createdAt,
      domain: "daily_operations",
      eventIds: [],
      idempotencyKey: `stale:${outcome}:${updatedAt}`,
      mutationBoundary: "daily_close",
      operatingDate: OPERATING_DATE,
      organizationId: seeded.organizationId,
      outcome,
      policyMode: outcome === "dry_run" ? "dry_run" : "enabled",
      policyVersion: "daily-operations.v1",
      snapshotCounts: {},
      sourceSubjects: [],
      storeId: seeded.storeId,
      triggerType: "scheduled",
      updatedAt,
    });
  }

  const ask = (
    t: ReturnType<typeof convexTest>,
    storeId: Id<"store">,
  ) =>
    t.query(
      internal.operations.dailyManagerReportEmail
        .getStaleDailyManagerReportPayloadForDate,
      { operatingDate: OPERATING_DATE, storeId },
    );

  it("returns null without a qualifying run", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(seedStore);
    expect(await ask(t, seeded.storeId)).toBeNull();
    await t.run((ctx) => insertRun(ctx, seeded, "dry_run", 2));
    expect(await ask(t, seeded.storeId)).toBeNull();
  });

  for (const outcome of ["skipped", "failed"] as const) {
    it(`prepares the open report from a ${outcome} run`, async () => {
      const t = convexTest(schema, modules);
      const seeded = await t.run(seedStore);
      await t.run((ctx) => insertRun(ctx, seeded, outcome, 2));
      expect(await ask(t, seeded.storeId)).toMatchObject({ status: outcome });
    });
  }

  it("keeps the latest qualifying run when a later dry-run row exists", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(seedStore);
    await t.run(async (ctx) => {
      await insertRun(ctx, seeded, "failed", 2);
      await insertRun(ctx, seeded, "dry_run", 3);
    });
    expect(await ask(t, seeded.storeId)).toMatchObject({ status: "failed" });
  });

  it("selects qualifying runs by updated time rather than creation time", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(seedStore);
    await t.run(async (ctx) => {
      await insertRun(ctx, seeded, "failed", 10, 1);
      await insertRun(ctx, seeded, "skipped", 5, 2);
    });
    expect(await ask(t, seeded.storeId)).toMatchObject({
      status: "failed",
    });
  });

  it("suppresses when an active completed close exists", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(seedStore);
    await t.run(async (ctx) => {
      await insertRun(ctx, seeded, "failed", 2);
      await ctx.db.insert("dailyClose", {
        carryForwardWorkItemIds: [],
        completedAt: 3,
        createdAt: 3,
        isCurrent: false,
        lifecycleStatus: "active",
        operatingDate: OPERATING_DATE,
        organizationId: seeded.organizationId,
        readiness: {
          blockerCount: 0,
          carryForwardCount: 0,
          readyCount: 0,
          reviewCount: 0,
          status: "ready",
        },
        sourceSubjects: [],
        status: "completed",
        storeId: seeded.storeId,
        summary: {},
        updatedAt: 3,
      });
    });
    expect(await ask(t, seeded.storeId)).toBeNull();
  });
});

describe("units sold in the closed-day report payload", () => {
  const OPERATING_DATE = "2026-07-16";
  const PRIOR_OPERATING_DATE = "2026-07-15";

  async function seedStore(ctx: MutationCtx) {
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
    return { organizationId, storeId };
  }

  async function insertCompletedClose(
    ctx: MutationCtx,
    seeded: { organizationId: Id<"organization">; storeId: Id<"store"> },
    operatingDate: string,
    priorDaySummary?: Record<string, unknown>,
  ) {
    const readiness = {
      blockerCount: 0,
      carryForwardCount: 0,
      readyCount: 1,
      reviewCount: 0,
      status: "ready" as const,
    };
    const summary = { salesTotal: 12000, transactionCount: 10 };
    return ctx.db.insert("dailyClose", {
      carryForwardWorkItemIds: [],
      completedAt: 1,
      createdAt: 1,
      isCurrent: true,
      lifecycleStatus: "active",
      operatingDate,
      organizationId: seeded.organizationId,
      readiness,
      reportSnapshot: {
        carryForwardItems: [],
        closeMetadata: {
          actorType: "automation",
          carryForwardWorkItemIds: [],
          completedAt: 1,
          endAt: 2,
          operatingDate,
          organizationId: seeded.organizationId,
          startAt: 0,
          storeId: seeded.storeId,
        },
        readiness,
        readyItems: [],
        reviewedItems: [],
        sourceSubjects: [],
        ...(priorDaySummary ? { priorDaySummary } : {}),
        summary,
      },
      sourceSubjects: [],
      status: "completed",
      storeId: seeded.storeId,
      summary,
      updatedAt: 1,
    });
  }

  async function insertReportDay(
    ctx: MutationCtx,
    storeId: Id<"store">,
    operatingDate: string,
    unitsSold: number,
    options: { certified?: boolean } = {},
  ) {
    return ctx.db.insert("reportDay", {
      currency: "GHS",
      factCount: 1,
      flags: {
        hasUncostedRevenue: false,
        mixedCurrency: false,
        quarantinedFactCount: 0,
      },
      foldVersion: 1,
      grossProfitMinor: null,
      grossSalesMinor: 0,
      lastFactRecordedAt: 1,
      netSalesMinor: 0,
      operatingDate,
      paymentAllocatedMinor: 0,
      paymentsCollectedMinor: 0,
      paymentsRefundedMinor: 0,
      refundsMinor: 0,
      status: "reconciled",
      storeId,
      uncostedRevenueMinor: 0,
      unitsReturned: 40,
      unitsSold,
      ...(options.certified === false ? {} : { certifiedFoldRevision: 3 }),
    });
  }

  async function insertSkuDay(
    ctx: MutationCtx,
    seeded: { organizationId: Id<"organization">; storeId: Id<"store"> },
    name: string,
    sku: string,
    unitsSold: number,
  ) {
    const categoryId = await ctx.db.insert("category", {
      name: `${name} category`,
      slug: `${sku.toLowerCase()}-category`,
      storeId: seeded.storeId,
    });
    const subcategoryId = await ctx.db.insert("subcategory", {
      categoryId,
      name: `${name} subcategory`,
      slug: `${sku.toLowerCase()}-subcategory`,
      storeId: seeded.storeId,
    });
    const productId = await ctx.db.insert("product", {
      availability: "live",
      categoryId,
      createdByUserId: (await ctx.db.get("organization", seeded.organizationId))!
        .createdByUserId,
      currency: "GHS",
      inventoryCount: 10,
      name,
      organizationId: seeded.organizationId,
      slug: sku.toLowerCase(),
      storeId: seeded.storeId,
      subcategoryId,
    });
    const productSkuId = await ctx.db.insert("productSku", {
      images: [],
      inventoryCount: 10,
      price: 100,
      productId,
      quantityAvailable: 10,
      sku,
      storeId: seeded.storeId,
    });
    await ctx.db.insert("reportSkuDay", {
      grossProfitMinor: 0,
      grossSalesMinor: 0,
      netSalesMinor: 0,
      operatingDate: OPERATING_DATE,
      productSkuId,
      refundsMinor: 0,
      storeId: seeded.storeId,
      uncostedRevenueMinor: 0,
      unitsReturned: 0,
      unitsSold,
    });
  }

  const unitsMetric = (payloads: Array<{ summaryMetrics?: unknown }>) =>
    (
      (payloads[0].summaryMetrics ?? []) as Array<{
        label: string;
        value: string;
        comparison?: string;
      }>
    ).find((metric) => metric.label === "Units sold");

  const askForDay = (t: ReturnType<typeof convexTest>, storeId: Id<"store">) =>
    t.query(
      internal.operations.dailyManagerReportEmail
        .getDailyManagerReportPayloadsForDateRange,
      {
        endOperatingDate: OPERATING_DATE,
        startOperatingDate: OPERATING_DATE,
        storeId,
      },
    );

  it("reports gross units sold against the prior completed close", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(seedStore);
    await t.run(async (ctx) => {
      await insertCompletedClose(ctx, seeded, PRIOR_OPERATING_DATE);
      await insertCompletedClose(ctx, seeded, OPERATING_DATE, {
        salesTotal: 10000,
      });
      // Gross, not net: unitsReturned is 40 on both days and must not move
      // the reported figure.
      await insertReportDay(ctx, seeded.storeId, PRIOR_OPERATING_DATE, 800);
      await insertReportDay(ctx, seeded.storeId, OPERATING_DATE, 1000);
    });

    expect(unitsMetric(await askForDay(t, seeded.storeId))).toEqual({
      label: "Units sold",
      value: "1,000",
      comparison: "25% higher vs prior day",
    });
  });

  it("includes the three top items and links to Top movers for the report day", async () => {
    process.env.ATHENA_BASE_URL = "https://athena.example.com";
    const t = convexTest(schema, modules);
    const seeded = await t.run(seedStore);
    await t.run(async (ctx) => {
      await insertCompletedClose(ctx, seeded, OPERATING_DATE);
      await insertReportDay(ctx, seeded.storeId, OPERATING_DATE, 20);
      await insertSkuDay(ctx, seeded, "Silk Press", "SP-18", 8);
      await insertSkuDay(ctx, seeded, "Body Wave", "BW-20", 6);
      await insertSkuDay(ctx, seeded, "Lace Closure", "LC-14", 4);
      await insertSkuDay(ctx, seeded, "Deep Wave", "DW-22", 2);
    });

    const [payload] = await askForDay(t, seeded.storeId);
    expect(payload.topItems).toEqual([
      { name: "Silk Press", detail: "SP-18", unitsSold: 8 },
      { name: "Body Wave", detail: "BW-20", unitsSold: 6 },
      { name: "Lace Closure", detail: "LC-14", unitsSold: 4 },
    ]);
    expect(payload.topItemsUrl).toBe(
      buildDailyTopMoversUrl({
        operatingDate: OPERATING_DATE,
        storeSlug: "accra",
      }),
    );
    const url = new URL(payload.topItemsUrl!);
    expect(url.pathname).toBe("/accra/store/accra/reports");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      daysEnd: OPERATING_DATE,
      daysStart: OPERATING_DATE,
      daysTableEnd: OPERATING_DATE,
      daysTableStart: OPERATING_DATE,
      selectedDay: OPERATING_DATE,
      units: "true",
    });
    expect(url.searchParams.has("unitsTab")).toBe(false);
  });

  it("reports an unstamped legacy day — certification gates movement, not this", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(seedStore);
    await t.run(async (ctx) => {
      await insertCompletedClose(ctx, seeded, OPERATING_DATE);
      await insertReportDay(ctx, seeded.storeId, OPERATING_DATE, 1000, {
        certified: false,
      });
    });

    expect(unitsMetric(await askForDay(t, seeded.storeId))).toEqual({
      label: "Units sold",
      value: "1,000",
      comparison: undefined,
    });
  });

  it("omits the metric when the sweeper has not folded the day at all", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(seedStore);
    await t.run((ctx) => insertCompletedClose(ctx, seeded, OPERATING_DATE));

    expect(unitsMetric(await askForDay(t, seeded.storeId))).toBeUndefined();
  });

  it("reports units with no comparison when the prior day was never folded", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(seedStore);
    await t.run(async (ctx) => {
      await insertCompletedClose(ctx, seeded, PRIOR_OPERATING_DATE);
      await insertCompletedClose(ctx, seeded, OPERATING_DATE, {
        salesTotal: 10000,
      });
      // The prior close exists, but the reports lane has no row for it.
      await insertReportDay(ctx, seeded.storeId, OPERATING_DATE, 1000);
    });

    expect(unitsMetric(await askForDay(t, seeded.storeId))).toEqual({
      label: "Units sold",
      value: "1,000",
      comparison: undefined,
    });
  });
});

/**
 * Admission contract for the two exported manager-report actions.
 *
 * Before the migration both were completely unauthenticated: any caller could
 * reach MailerSend. They now run behind `admitPublicAction`, so an anonymous
 * caller is refused before the body runs, and the shared demo is denied at the
 * definition because `reporting.generate` is not a demo-granted capability.
 */
describe("daily manager report action admission", () => {
  const DENIED_ANONYMOUSLY = /Sign in again to continue\./;
  const mostRecentReport =
    api.operations.dailyManagerReportEmail.sendMostRecentDailyManagerReport;
  const reportsForDateRange =
    api.operations.dailyManagerReportEmail.sendDailyManagerReportsForDateRange;

  async function seedOperator(t: ReturnType<typeof convexTest>) {
    return t.run(async (ctx) => {
      const athenaUserId = await ctx.db.insert("athenaUser", {
        email: "operator@test",
        normalizedEmail: "operator@test",
      });
      const organizationId = await ctx.db.insert("organization", {
        createdByUserId: athenaUserId,
        name: "org",
        slug: "org",
      });
      const storeId = await ctx.db.insert("store", {
        createdByUserId: athenaUserId,
        currency: "GHS",
        name: "store",
        organizationId,
        slug: "store",
      });
      const authUserId = await ctx.db.insert("users", {
        email: "operator@test",
      });
      return { athenaUserId, authUserId, organizationId, storeId };
    });
  }

  afterEach(() => {
    mailerMocks.sendDailyManagerReportEmail.mockReset();
  });

  it("keeps report delivery out of shared-demo reach at the definition", () => {
    for (const definition of [
      sendMostRecentDailyManagerReportOperationDefinition,
      sendDailyManagerReportsForDateRangeOperationDefinition,
    ]) {
      expect(definition.kind).toBe("action");
      expect(definition.capability).toBe("reporting.generate");
      expect(definition.actors.normalUser).toBe("admit");
      expect(definition.actors.sharedDemo).toBe("deny");
      expect(definition.actors.public).toBe("deny");
      expect(definition.effects).toEqual({
        mode: "protected",
        gateways: ["order_notification.send"],
      });
    }
  });

  it("denies an unauthenticated caller before MailerSend is reached", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedOperator(t);

    await expect(
      t.action(mostRecentReport, {
        recipientEmail: "manager@test",
        storeId: seeded.storeId,
      }),
    ).rejects.toThrow(DENIED_ANONYMOUSLY);

    await expect(
      t.action(reportsForDateRange, {
        endOperatingDate: "2026-07-16",
        recipientEmail: "manager@test",
        startOperatingDate: "2026-07-15",
        storeId: seeded.storeId,
      }),
    ).rejects.toThrow(DENIED_ANONYMOUSLY);

    expect(mailerMocks.sendDailyManagerReportEmail).not.toHaveBeenCalled();
  });

  it("keeps the normal-user outcome unchanged once admitted", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedOperator(t);
    const as = t.withIdentity({ subject: `${seeded.authUserId}|session` });

    // No completed close in range: the body runs to its own empty result,
    // which is exactly what it returned before the wrapper existed.
    await expect(
      as.action(reportsForDateRange, {
        endOperatingDate: "2026-07-16",
        recipientEmail: "manager@test",
        startOperatingDate: "2026-07-15",
        storeId: seeded.storeId,
      }),
    ).resolves.toEqual([]);

    // And the single-report action reaches its own domain error rather than a
    // denial, which is the proof that admission let the body run.
    await expect(
      as.action(mostRecentReport, {
        recipientEmail: "manager@test",
        storeId: seeded.storeId,
      }),
    ).rejects.toThrow("No completed EOD report with a snapshot was found.");

    expect(mailerMocks.sendDailyManagerReportEmail).not.toHaveBeenCalled();
  });
});
