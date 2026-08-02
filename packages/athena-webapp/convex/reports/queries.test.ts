/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import { descendingSortKey } from "../../shared/reportsContract";
import {
  getOverview,
  listDays,
  listRangeSkuMix,
  listPeriodSkus,
  getSkuDetail,
  listSkuDayTransactions,
  getRangeResult,
  getActiveWeeklyBriefing,
  listAcceptedWeeklyHistory,
  getAcceptedWeeklyDetail,
} from "./queries";
import { emptySnapshot } from "./overview";

const modules = import.meta.glob("../**/*.ts");

vi.mock("./access", () => ({
  requireReportsStoreAccess: vi.fn(),
}));
import { requireReportsStoreAccess } from "./access";

vi.mock("../platform/capabilityCatalog", () => ({
  hasCompletedWeeklyObservedAtVerification: vi.fn(() => true),
  isWeeklyReportingEnabledForStore: vi.fn(),
}));
import { isWeeklyReportingEnabledForStore } from "../platform/capabilityCatalog";

function handlerOf(fn: unknown): (...args: any[]) => Promise<any> {
  return (fn as unknown as { _handler: (...args: any[]) => Promise<any> })
    ._handler;
}

beforeEach(() => {
  vi.mocked(requireReportsStoreAccess).mockResolvedValue({} as never);
  vi.mocked(isWeeklyReportingEnabledForStore).mockReturnValue(true);
});

async function seedStore(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("athenaUser", {
      email: "reports-queries@example.test",
    });
    const organizationId = await ctx.db.insert("organization", {
      createdByUserId: userId,
      name: "Queries",
      slug: "queries",
    });
    const storeId = await ctx.db.insert("store", {
      createdByUserId: userId,
      currency: "GHS",
      name: "Queries",
      organizationId,
      slug: "queries",
    });
    return { organizationId, storeId };
  });
}

async function seedSku(
  t: ReturnType<typeof convexTest>,
  storeId: Id<"store">,
  images: string[] = [],
  netPrice?: number,
  unitCost?: number,
) {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("athenaUser", {
      email: `sku-${Math.random()}@example.test`,
    });
    const organizationId = await ctx.db.insert("organization", {
      createdByUserId: userId,
      name: "Sku org",
      slug: `sku-org-${Math.random()}`,
    });
    const categoryId = await ctx.db.insert("category", {
      name: "Wigs",
      slug: `wigs-${Math.random()}`,
      storeId,
    });
    const subcategoryId = await ctx.db.insert("subcategory", {
      categoryId,
      name: "Lace",
      slug: `lace-${Math.random()}`,
      storeId,
    });
    const productId = await ctx.db.insert("product", {
      availability: "live",
      categoryId,
      createdByUserId: userId,
      currency: "GHS",
      inventoryCount: 10,
      name: "Wig",
      organizationId,
      slug: `wig-${Math.random()}`,
      storeId,
      subcategoryId,
    });
    return ctx.db.insert("productSku", {
      images,
      inventoryCount: 10,
      ...(netPrice !== undefined ? { netPrice } : {}),
      price: 100,
      productId,
      quantityAvailable: 10,
      sku: `SKU-${Math.random()}`,
      storeId,
      ...(unitCost !== undefined ? { unitCost } : {}),
    });
  });
}

const dayFlags = {
  mixedCurrency: false,
  hasUncostedRevenue: false,
  quarantinedFactCount: 0,
};

function dayMetrics(overrides: Partial<Record<string, number | null>> = {}) {
  return {
    grossSalesMinor: 1000,
    netSalesMinor: 900,
    refundsMinor: 0,
    unitsSold: 10,
    unitsReturned: 0,
    uncostedRevenueMinor: 0,
    grossProfitMinor: 300,
    paymentsCollectedMinor: 900,
    paymentsRefundedMinor: 0,
    paymentAllocatedMinor: 900,
    ...overrides,
  };
}

describe("getOverview", () => {
  it("returns null when no overview doc exists", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    const result = await t.run((ctx) =>
      handlerOf(getOverview)(ctx, { storeId }),
    );
    expect(result).toBeNull();
  });

  it("returns the singleton's data portion, checking access first", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    const snapshot = {
      ...dayMetrics(),
      dayCount: 1,
      unsettledDayCount: 0,
    };
    await t.run((ctx) =>
      ctx.db.insert("reportOverview", {
        storeId,
        updatedAt: 1000,
        currency: "GHS",
        today: snapshot,
        weekToDate: snapshot,
        priorWeek: snapshot,
        trailing30: snapshot,
        comparisons: {
          netSalesVsPriorWeekBp: 500,
          unitsSoldVsPriorWeekBp: null,
        },
        dailyTrend: [
          { operatingDate: "2026-07-28", netSalesMinor: 900, status: "open" },
        ],
        trust: {
          reconciledDays: 1,
          provisionalDays: 0,
          amendedDays: 0,
        },
      }),
    );
    await t.run((ctx) =>
      ctx.db.insert("reportDay", {
        storeId,
        operatingDate: "2026-07-28",
        currency: "GHS",
        status: "open",
        ...dayMetrics({ unitsSold: 10 }),
        foldVersion: 1,
        factCount: 3,
        lastFactRecordedAt: 1000,
        flags: dayFlags,
      }),
    );

    const result = await t.run((ctx) =>
      handlerOf(getOverview)(ctx, { storeId }),
    );

    expect(requireReportsStoreAccess).toHaveBeenCalledWith(
      expect.anything(),
      storeId,
    );
    expect(result).toMatchObject({ updatedAt: 1000, currency: "GHS" });
    expect(result?.yesterday).toEqual(emptySnapshot());
    expect(result?.trailing3Months.netSalesMinor).toBe(900);
    expect(result?.dailyTrend[0]?.unitsSold).toBe(10);
    expect(result).not.toHaveProperty("storeId");
  });

  it("propagates the access check's rejection", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    vi.mocked(requireReportsStoreAccess).mockRejectedValueOnce(
      new Error("Reports access unavailable."),
    );
    await expect(
      t.run((ctx) => handlerOf(getOverview)(ctx, { storeId })),
    ).rejects.toThrow("Reports access unavailable.");
  });
});

describe("listDays", () => {
  async function seedDay(
    t: ReturnType<typeof convexTest>,
    storeId: Id<"store">,
    operatingDate: string,
  ) {
    await t.run((ctx) =>
      ctx.db.insert("reportDay", {
        storeId,
        operatingDate,
        currency: "GHS",
        status: "reconciled",
        ...dayMetrics(),
        foldVersion: 1,
        factCount: 3,
        lastFactRecordedAt: 1000,
        flags: dayFlags,
      }),
    );
  }

  it("returns rows within the range, mapped to the contract shape", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    await seedDay(t, storeId, "2026-07-26");
    await seedDay(t, storeId, "2026-07-27");
    await seedDay(t, storeId, "2026-07-28");

    const rows = await t.run((ctx) =>
      handlerOf(listDays)(ctx, {
        storeId,
        startDate: "2026-07-27",
        endDate: "2026-07-28",
      }),
    );

    expect(rows.map((r: any) => r.operatingDate)).toEqual([
      "2026-07-27",
      "2026-07-28",
    ]);
    expect(rows[0]).not.toHaveProperty("storeId");
    expect(rows[0]).toMatchObject({ status: "reconciled", currency: "GHS" });
  });

  it("rejects an inverted range", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    await expect(
      t.run((ctx) =>
        handlerOf(listDays)(ctx, {
          storeId,
          startDate: "2026-07-28",
          endDate: "2026-07-01",
        }),
      ),
    ).rejects.toThrow();
  });

  it("rejects a range spanning more than 92 days", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    await expect(
      t.run((ctx) =>
        handlerOf(listDays)(ctx, {
          storeId,
          startDate: "2026-01-01",
          endDate: "2026-05-01", // 121 days inclusive
        }),
      ),
    ).rejects.toThrow();
  });

  it("accepts an exactly-92-day span", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    const rows = await t.run((ctx) =>
      handlerOf(listDays)(ctx, {
        storeId,
        startDate: "2026-01-01",
        endDate: "2026-04-02", // 92 days inclusive
      }),
    );
    expect(rows).toEqual([]);
  });
});

describe("listRangeSkuMix", () => {
  it("returns the five leading SKUs by units and groups the remainder", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    const skuIds = await Promise.all(
      Array.from({ length: 7 }, () => seedSku(t, storeId)),
    );

    await t.run(async (ctx) => {
      await Promise.all(
        skuIds.map((productSkuId, index) =>
          ctx.db.insert("reportSkuDay", {
            storeId,
            productSkuId,
            operatingDate: "2026-07-28",
            unitsSold: 7 - index,
            unitsReturned: 0,
            grossSalesMinor: (7 - index) * 100,
            netSalesMinor: (7 - index) * 100,
            refundsMinor: 0,
            uncostedRevenueMinor: 0,
            grossProfitMinor: (7 - index) * 50,
          }),
        ),
      );
      await ctx.db.insert("reportSkuDay", {
        storeId,
        productSkuId: skuIds[0],
        operatingDate: "2026-07-14",
        unitsSold: 100,
        unitsReturned: 0,
        grossSalesMinor: 10_000,
        netSalesMinor: 10_000,
        refundsMinor: 0,
        uncostedRevenueMinor: 0,
        grossProfitMinor: 5_000,
      });
    });

    const result = await t.run((ctx) =>
      handlerOf(listRangeSkuMix)(ctx, {
        storeId,
        startDate: "2026-07-15",
        endDate: "2026-07-28",
      }),
    );

    expect(result.totalUnitsSold).toBe(28);
    expect(result.skuCount).toBe(7);
    expect(result.rows).toHaveLength(6);
    expect(result.rows.slice(0, 5).map((row: any) => row.unitsSold)).toEqual([
      7, 6, 5, 4, 3,
    ]);
    expect(result.rows[0].identity).toMatchObject({ displayName: "Wig" });
    expect(result.rows[5]).toMatchObject({
      key: "other",
      label: "Other SKUs",
      unitsSold: 3,
      shareBasisPoints: 1071,
    });
  });
});

describe("listPeriodSkus", () => {
  async function seedReportDay(
    t: ReturnType<typeof convexTest>,
    organizationId: Id<"organization">,
    storeId: Id<"store">,
    operatingDate: string,
    unitsSold: number,
    transactionCount: number,
  ) {
    await t.run(async (ctx) => {
      const closeId = await ctx.db.insert("dailyClose", {
        storeId,
        organizationId,
        operatingDate,
        status: "completed",
        isCurrent: true,
        readiness: {
          status: "ready",
          blockerCount: 0,
          reviewCount: 0,
          carryForwardCount: 0,
          readyCount: 0,
        },
        summary: { transactionCount },
        sourceSubjects: [],
        carryForwardWorkItemIds: [],
        createdAt: 1,
        updatedAt: 1,
        completedAt: 1,
      });
      return ctx.db.insert("reportDay", {
        storeId,
        operatingDate,
        currency: "GHS",
        status: "reconciled",
        ...dayMetrics({ unitsSold }),
        closeId,
        foldVersion: 1,
        factCount: unitsSold,
        lastFactRecordedAt: 1000,
        flags: dayFlags,
      });
    });
  }

  async function seedRollup(
    t: ReturnType<typeof convexTest>,
    storeId: Id<"store">,
    productSkuId: Id<"productSku">,
    periodKey: string,
    netSalesMinor: number,
  ) {
    await t.run((ctx) =>
      ctx.db.insert("reportPeriodSkuRollup", {
        storeId,
        periodKey,
        productSkuId,
        unitsSold: 1,
        unitsReturned: 0,
        grossSalesMinor: netSalesMinor,
        netSalesMinor,
        refundsMinor: 0,
        uncostedRevenueMinor: 0,
        grossProfitMinor: netSalesMinor / 2,
        revenueSortKey: descendingSortKey(netSalesMinor),
        unitsSortKey: descendingSortKey(1),
      }),
    );
  }

  it("returns period totals independently of SKU pagination", async () => {
    const t = convexTest(schema, modules);
    const { organizationId, storeId } = await seedStore(t);
    await seedReportDay(t, organizationId, storeId, "2026-07-28", 10, 4);
    await seedReportDay(t, organizationId, storeId, "2026-07-29", 6, 3);
    await seedReportDay(t, organizationId, storeId, "2026-08-03", 99, 99);

    const result = await t.run((ctx) =>
      handlerOf(listPeriodSkus)(ctx, {
        storeId,
        periodKey: "w:2026-W31",
        sortBy: "revenue",
      }),
    );

    expect(result.totalNetSalesMinor).toBe(1_800);
    expect(result.totalUnitsSold).toBe(16);
    expect(result.totalTransactions).toBe(7);
    expect(result.isTodayInProgress).toBe(false);
  });

  it("returns prior day, week, and month totals for metric comparisons", async () => {
    const t = convexTest(schema, modules);
    const { organizationId, storeId } = await seedStore(t);
    await seedReportDay(t, organizationId, storeId, "2026-06-30", 3, 1);
    await seedReportDay(t, organizationId, storeId, "2026-07-21", 5, 2);
    await seedReportDay(t, organizationId, storeId, "2026-07-28", 10, 4);
    await seedReportDay(t, organizationId, storeId, "2026-07-29", 6, 3);

    const dayResult = await t.run((ctx) =>
      handlerOf(listPeriodSkus)(ctx, {
        storeId,
        periodKey: "d:2026-07-29",
        sortBy: "revenue",
      }),
    );
    const weekResult = await t.run((ctx) =>
      handlerOf(listPeriodSkus)(ctx, {
        storeId,
        periodKey: "w:2026-W31",
        sortBy: "revenue",
      }),
    );
    const monthResult = await t.run((ctx) =>
      handlerOf(listPeriodSkus)(ctx, {
        storeId,
        periodKey: "m:2026-07",
        sortBy: "revenue",
      }),
    );

    expect(dayResult.priorPeriodTotals).toEqual({
      netSalesMinor: 900,
      unitsSold: 10,
      transactions: 4,
    });
    expect(weekResult.priorPeriodTotals).toEqual({
      netSalesMinor: 900,
      unitsSold: 5,
      transactions: 2,
    });
    expect(monthResult.priorPeriodTotals).toEqual({
      netSalesMinor: 900,
      unitsSold: 3,
      transactions: 1,
    });
  });

  it("counts live POS transactions when an open day has no close yet", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("reportDay", {
        storeId,
        operatingDate: "2026-07-29",
        currency: "GHS",
        status: "open",
        ...dayMetrics({ unitsSold: 3 }),
        foldVersion: 1,
        factCount: 3,
        lastFactRecordedAt: 1000,
        flags: dayFlags,
      });
      for (const [sourceId, lineId] of [
        ["transaction-1", "line-1"],
        ["transaction-1", "line-2"],
        ["transaction-2", "line-1"],
      ] as const) {
        await ctx.db.insert("reportFact", {
          storeId,
          sourceDomain: "pos",
          sourceId,
          lineId,
          factKind: "sale",
          fingerprint: `${sourceId}-${lineId}`,
          fingerprintVersion: 1,
          occurredAt: 1000,
          recordedAt: 1000,
          operatingDate: "2026-07-29",
          currency: "GHS",
          grossAmountMinor: 100,
          netAmountMinor: 100,
          taxAmountMinor: 0,
          discountAmountMinor: 0,
          quantity: 1,
        });
      }
    });

    const result = await t.run((ctx) =>
      handlerOf(listPeriodSkus)(ctx, {
        storeId,
        periodKey: "d:2026-07-29",
        sortBy: "revenue",
      }),
    );

    expect(result.totalUnitsSold).toBe(3);
    expect(result.totalTransactions).toBe(2);
    expect(result.isTodayInProgress).toBe(true);
  });

  it("uses the linked product name when the SKU has no denormalized product name", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    const skuId = await seedSku(t, storeId);
    await seedRollup(t, storeId, skuId, "d:2026-07-28", 500);
    const updatedAt = 1_700_000_000_000;
    const overviewSnapshot = {
      ...dayMetrics(),
      dayCount: 1,
      unsettledDayCount: 1,
    };
    await t.run((ctx) =>
      ctx.db.insert("reportOverview", {
        storeId,
        updatedAt,
        currency: "GHS",
        today: overviewSnapshot,
        weekToDate: overviewSnapshot,
        priorWeek: overviewSnapshot,
        trailing30: overviewSnapshot,
        comparisons: {
          netSalesVsPriorWeekBp: null,
          unitsSoldVsPriorWeekBp: null,
        },
        dailyTrend: [],
        trust: {
          reconciledDays: 0,
          provisionalDays: 1,
          amendedDays: 0,
        },
      }),
    );

    const result = await t.run((ctx) =>
      handlerOf(listPeriodSkus)(ctx, {
        storeId,
        periodKey: "d:2026-07-28",
        sortBy: "revenue",
      }),
    );

    expect(result.rows[0].identity).toMatchObject({
      displayName: "Wig",
      productId: expect.any(String),
    });
    expect(result.rows[0].identity).not.toHaveProperty("netPriceMinor");
    expect(result.updatedAt).toBe(updatedAt);
  });

  it("pages 10 at a time in descending revenue order, then exhausts with continueCursor null", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    const skuIds: Id<"productSku">[] = [];
    for (let i = 0; i < 15; i += 1) {
      skuIds.push(await seedSku(t, storeId));
      await seedRollup(t, storeId, skuIds[i], "d:2026-07-28", 1000 - i);
    }

    const page1 = await t.run((ctx) =>
      handlerOf(listPeriodSkus)(ctx, {
        storeId,
        periodKey: "d:2026-07-28",
        sortBy: "revenue",
      }),
    );
    expect(page1.rows).toHaveLength(10);
    expect(page1.continueCursor).not.toBeNull();
    // Descending revenue: sku 0 (netSales 1000) first.
    expect(page1.rows[0].productSkuId).toBe(skuIds[0]);
    expect(page1.rows[9].productSkuId).toBe(skuIds[9]);

    const page2 = await t.run((ctx) =>
      handlerOf(listPeriodSkus)(ctx, {
        storeId,
        periodKey: "d:2026-07-28",
        sortBy: "revenue",
        cursor: page1.continueCursor,
      }),
    );
    expect(page2.rows).toHaveLength(5);
    expect(page2.continueCursor).toBeNull();
    expect(page2.rows.map((r: any) => r.productSkuId)).toEqual(
      skuIds.slice(10, 15),
    );
  });

  it("disambiguates exact sort-key ties by productSkuId across the cursor boundary", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    const skuIds: Id<"productSku">[] = [];
    // 27 SKUs tied at the same revenue -> same sortKey, forcing tie-break
    // logic to page correctly across three 10-row pages.
    for (let i = 0; i < 27; i += 1) {
      skuIds.push(await seedSku(t, storeId));
      await seedRollup(t, storeId, skuIds[i], "d:2026-07-28", 500);
    }

    const page1 = await t.run((ctx) =>
      handlerOf(listPeriodSkus)(ctx, {
        storeId,
        periodKey: "d:2026-07-28",
        sortBy: "revenue",
      }),
    );
    expect(page1.rows).toHaveLength(10);
    expect(page1.continueCursor).not.toBeNull();

    const page2 = await t.run((ctx) =>
      handlerOf(listPeriodSkus)(ctx, {
        storeId,
        periodKey: "d:2026-07-28",
        sortBy: "revenue",
        cursor: page1.continueCursor,
      }),
    );
    expect(page2.rows).toHaveLength(10);
    expect(page2.continueCursor).not.toBeNull();

    const page3 = await t.run((ctx) =>
      handlerOf(listPeriodSkus)(ctx, {
        storeId,
        periodKey: "d:2026-07-28",
        sortBy: "revenue",
        cursor: page2.continueCursor!,
      }),
    );
    expect(page3.rows).toHaveLength(7);
    expect(page3.continueCursor).toBeNull();

    const seenIds = new Set([
      ...page1.rows.map((r: any) => r.productSkuId),
      ...page2.rows.map((r: any) => r.productSkuId),
      ...page3.rows.map((r: any) => r.productSkuId),
    ]);
    expect(seenIds.size).toBe(27); // no duplicates, none skipped
  });

  it("rejects a cursor whose context no longer matches the request", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    const skuId = await seedSku(t, storeId);
    await seedRollup(t, storeId, skuId, "d:2026-07-28", 500);

    const page1 = await t.run((ctx) =>
      handlerOf(listPeriodSkus)(ctx, {
        storeId,
        periodKey: "d:2026-07-28",
        sortBy: "revenue",
      }),
    );
    // No continuation needed for context-mismatch check; synthesize a
    // structurally valid cursor for a *different* periodKey and confirm the
    // handler still rejects it even without exhausting the first page.
    const mismatchedCursor = btoa(
      JSON.stringify({
        storeId,
        periodKey: "d:2026-07-27",
        sortBy: "revenue",
        lastSortKey: -500,
        lastSkuId: skuId,
      }),
    );

    await expect(
      t.run((ctx) =>
        handlerOf(listPeriodSkus)(ctx, {
          storeId,
          periodKey: "d:2026-07-28",
          sortBy: "revenue",
          cursor: mismatchedCursor,
        }),
      ),
    ).rejects.toThrow();

    const sortByMismatchCursor = btoa(
      JSON.stringify({
        storeId,
        periodKey: "d:2026-07-28",
        sortBy: "revenue",
        lastSortKey: -500,
        lastSkuId: skuId,
      }),
    );
    await expect(
      t.run((ctx) =>
        handlerOf(listPeriodSkus)(ctx, {
          storeId,
          periodKey: "d:2026-07-28",
          sortBy: "units", // sortBy mismatch
          cursor: sortByMismatchCursor,
        }),
      ),
    ).rejects.toThrow();
  });
});

describe("getSkuDetail", () => {
  async function seedSkuDay(
    t: ReturnType<typeof convexTest>,
    storeId: Id<"store">,
    productSkuId: Id<"productSku">,
    operatingDate: string,
    overrides: Partial<{
      netSalesMinor: number;
      grossProfitMinor: number | null;
    }> = {},
  ) {
    await t.run((ctx) =>
      ctx.db.insert("reportSkuDay", {
        storeId,
        productSkuId,
        operatingDate,
        unitsSold: 2,
        unitsReturned: 0,
        grossSalesMinor: overrides.netSalesMinor ?? 200,
        netSalesMinor: overrides.netSalesMinor ?? 200,
        refundsMinor: 0,
        uncostedRevenueMinor: 0,
        grossProfitMinor:
          overrides.grossProfitMinor === undefined
            ? 80
            : overrides.grossProfitMinor,
      }),
    );
  }

  it("returns empty days and null totals when nothing is seeded", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    const productSkuId = await seedSku(
      t,
      storeId,
      ["https://cdn.example.test/wig.webp"],
      12_500,
      7_250,
    );
    const result = await t.run((ctx) =>
      handlerOf(getSkuDetail)(ctx, {
        storeId,
        productSkuId,
        startDate: "2026-07-01",
        endDate: "2026-07-28",
      }),
    );
    // Identity still resolves: the page must be able to name a SKU that
    // simply had no activity in the selected window.
    expect(result).toMatchObject({ days: [], totals: null });
    expect(result?.identity?.displayName).toBe("Wig");
    expect(result?.identity?.imageUrl).toBe(
      "https://cdn.example.test/wig.webp",
    );
    expect(result?.identity?.netPriceMinor).toBe(12_500);
    expect(result?.identity?.unitCostMinor).toBe(7_250);
  });

  it("sums metrics across days, with operatingDate per row", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    const productSkuId = await seedSku(t, storeId);
    await seedSkuDay(t, storeId, productSkuId, "2026-07-26", {
      netSalesMinor: 100,
      grossProfitMinor: 40,
    });
    await seedSkuDay(t, storeId, productSkuId, "2026-07-27", {
      netSalesMinor: 200,
      grossProfitMinor: 80,
    });

    const result = await t.run((ctx) =>
      handlerOf(getSkuDetail)(ctx, {
        storeId,
        productSkuId,
        startDate: "2026-07-01",
        endDate: "2026-07-28",
      }),
    );

    expect(result.days).toHaveLength(2);
    expect(result.days[0]).toMatchObject({ operatingDate: "2026-07-26" });
    expect(result.totals).toMatchObject({
      netSalesMinor: 300,
      grossProfitMinor: 120,
      unitsSold: 4,
    });
  });

  it("returns totals for the immediately preceding equal-length range", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    const productSkuId = await seedSku(t, storeId);
    await seedSkuDay(t, storeId, productSkuId, "2026-07-24", {
      netSalesMinor: 100,
      grossProfitMinor: 40,
    });
    await seedSkuDay(t, storeId, productSkuId, "2026-07-25", {
      netSalesMinor: 200,
      grossProfitMinor: 80,
    });
    await seedSkuDay(t, storeId, productSkuId, "2026-07-26", {
      netSalesMinor: 300,
      grossProfitMinor: 120,
    });
    await seedSkuDay(t, storeId, productSkuId, "2026-07-27", {
      netSalesMinor: 500,
      grossProfitMinor: 200,
    });

    const result = await t.run((ctx) =>
      handlerOf(getSkuDetail)(ctx, {
        storeId,
        productSkuId,
        startDate: "2026-07-26",
        endDate: "2026-07-27",
      }),
    );

    expect(result.priorPeriodTotals).toMatchObject({
      netSalesMinor: 300,
      grossProfitMinor: 120,
      unitsSold: 4,
      refundsMinor: 0,
    });
  });

  it("reports null grossProfitMinor when any day lacks a cost basis", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    const productSkuId = await seedSku(t, storeId);
    await seedSkuDay(t, storeId, productSkuId, "2026-07-26", {
      grossProfitMinor: 40,
    });
    await seedSkuDay(t, storeId, productSkuId, "2026-07-27", {
      grossProfitMinor: null,
    });

    const result = await t.run((ctx) =>
      handlerOf(getSkuDetail)(ctx, {
        storeId,
        productSkuId,
        startDate: "2026-07-01",
        endDate: "2026-07-28",
      }),
    );

    expect(result.totals.grossProfitMinor).toBeNull();
  });

  it("rejects a range spanning more than 92 days", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    const productSkuId = await seedSku(t, storeId);
    await expect(
      t.run((ctx) =>
        handlerOf(getSkuDetail)(ctx, {
          storeId,
          productSkuId,
          startDate: "2026-01-01",
          endDate: "2026-05-01",
        }),
      ),
    ).rejects.toThrow();
  });
});

describe("listSkuDayTransactions", () => {
  it("groups SKU facts by source transaction and resolves POS evidence", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    const productSkuId = await seedSku(t, storeId);
    const transactionId = await t.run((ctx) =>
      ctx.db.insert("posTransaction", {
        transactionNumber: "TX-1042",
        storeId,
        subtotal: 5200,
        tax: 0,
        total: 5200,
        payments: [
          { method: "cash", amount: 5200, timestamp: 1_753_312_800_000 },
        ],
        totalPaid: 5200,
        status: "completed",
        completedAt: 1_753_312_800_000,
      }),
    );

    await t.run(async (ctx) => {
      for (const [lineId, quantity, netAmountMinor] of [
        ["line-1", 1, 3000],
        ["line-2", 2, 2200],
      ] as const) {
        await ctx.db.insert("reportFact", {
          storeId,
          sourceDomain: "pos",
          sourceId: String(transactionId),
          lineId,
          factKind: "sale",
          fingerprint: `fp-${lineId}`,
          fingerprintVersion: 1,
          occurredAt: 1_753_312_800_000,
          recordedAt: 1_753_312_800_000,
          operatingDate: "2025-07-23",
          currency: "GHS",
          grossAmountMinor: netAmountMinor,
          netAmountMinor,
          taxAmountMinor: 0,
          discountAmountMinor: 0,
          quantity,
          productSkuId,
          unitCostMinor: 500,
        });
      }
    });

    const result = await t.run((ctx) =>
      handlerOf(listSkuDayTransactions)(ctx, {
        storeId,
        productSkuId,
        operatingDate: "2025-07-23",
      }),
    );

    expect(result).toEqual({
      transactions: [
        {
          sourceDomain: "pos",
          sourceId: String(transactionId),
          reference: "TX-1042",
          occurredAt: 1_753_312_800_000,
          status: "completed",
          quantity: 3,
          netSalesMinor: 5200,
          costMinor: 1500,
          grossProfitMinor: 3700,
          hasRefunds: false,
          hasAdjustments: false,
        },
      ],
      truncated: false,
    });
  });
});

describe("getRangeResult", () => {
  async function seedRange(
    t: ReturnType<typeof convexTest>,
    storeId: Id<"store">,
    requestKey: string,
    expiresAt: number,
  ) {
    await t.run((ctx) =>
      ctx.db.insert("reportRangeResult", {
        storeId,
        requestKey,
        startDate: "2026-07-01",
        endDate: "2026-07-28",
        status: "completed",
        totals: { ...dayMetrics(), dayCount: 28, unsettledDayCount: 0 },
        requestedAt: 1,
        computedAt: 2,
        expiresAt,
        foldVersion: 1,
      }),
    );
  }

  it("returns null when no result exists for the requestKey", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    const result = await t.run((ctx) =>
      handlerOf(getRangeResult)(ctx, { storeId, requestKey: "missing" }),
    );
    expect(result).toBeNull();
  });

  it("returns the summary while unexpired", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    await seedRange(t, storeId, "req-1", Date.now() + 1_000_000);

    const result = await t.run((ctx) =>
      handlerOf(getRangeResult)(ctx, { storeId, requestKey: "req-1" }),
    );
    expect(result).toMatchObject({ requestKey: "req-1", status: "completed" });
    expect(result).not.toHaveProperty("storeId");
  });

  it("returns null once expiresAt has passed", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    await seedRange(t, storeId, "req-expired", Date.now() - 1_000);

    const result = await t.run((ctx) =>
      handlerOf(getRangeResult)(ctx, {
        storeId,
        requestKey: "req-expired",
      }),
    );
    expect(result).toBeNull();
  });
});

const weeklyMetrics = {
  grossSalesMinor: 1_000,
  netSalesMinor: 900,
  refundsMinor: 100,
  unitsSold: 10,
  unitsReturned: 1,
  uncostedRevenueMinor: 0,
  grossProfitMinor: 300,
  paymentsCollectedMinor: 900,
  paymentsRefundedMinor: 100,
  paymentAllocatedMinor: 800,
  paymentUnsettledMinor: 0,
  paymentAllocationCoverage: "complete" as const,
};

const weeklyLineage = [
  {
    localDate: "2026-07-27",
    included: true,
    scheduleVersionId: null,
    dayStatus: "reconciled" as const,
    dayAvailable: true,
    activityPosture: "recorded" as const,
  },
];

const weeklyCompleteness = { complete: true, reason: "complete" as const };

async function seedAcceptedWeek(
  t: ReturnType<typeof convexTest>,
  storeId: Id<"store">,
  overrides: Partial<{ acceptedAt: number; cycleStartDate: string }> = {},
) {
  return t.run(async (ctx) => {
    const store = await ctx.db.get("store", storeId);
    if (!store) throw new Error("Expected seeded store.");
    const closeId = await ctx.db.insert("dailyClose", {
      storeId,
      organizationId: store.organizationId,
      operatingDate: "2026-08-02",
      status: "completed",
      isCurrent: true,
      readiness: {
        status: "ready",
        blockerCount: 0,
        reviewCount: 0,
        carryForwardCount: 0,
        readyCount: 1,
      },
      summary: {},
      sourceSubjects: [],
      carryForwardWorkItemIds: [],
      createdAt: 1,
      updatedAt: 1,
      completedAt: 1,
    });
    return ctx.db.insert("reportWeekAccepted", {
      storeId,
      cycleStartDate: overrides.cycleStartDate ?? "2026-07-27",
      cycleEndDate: "2026-08-02",
      currency: "GHS",
      metricVersion: 1,
      acceptedAt: overrides.acceptedAt ?? 1_000,
      cutoffObservedAt: 900,
      closeId,
      baselineFingerprint: "weekly-fingerprint",
      included: weeklyMetrics,
      outsideSchedule: weeklyMetrics,
      scheduleLineage: weeklyLineage,
      completeness: weeklyCompleteness,
      lifecyclePosture: "accepted",
      amendmentPosture: "none",
    });
  });
}

describe("weekly projection reads", () => {
  it("fails closed after authorization when the store is outside the rollout", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    vi.mocked(isWeeklyReportingEnabledForStore).mockReturnValue(false);

    const active = await t.run((ctx) =>
      handlerOf(getActiveWeeklyBriefing)(ctx, { storeId }),
    );
    const history = await t.run((ctx) =>
      handlerOf(listAcceptedWeeklyHistory)(ctx, {
        storeId,
        paginationOpts: { cursor: null, numItems: 12 },
      }),
    );
    const detail = await t.run((ctx) =>
      handlerOf(getAcceptedWeeklyDetail)(ctx, {
        storeId,
        reportId: "week:2026-07-27",
      }),
    );

    expect(active).toEqual({
      status: "unavailable",
      reason: "capability_disabled",
    });
    expect(history).toEqual({ page: [], isDone: true, continueCursor: "" });
    expect(detail).toBeNull();
    expect(requireReportsStoreAccess).toHaveBeenCalledTimes(3);
    expect(isWeeklyReportingEnabledForStore).toHaveBeenCalledTimes(3);
    expect(
      vi.mocked(requireReportsStoreAccess).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(isWeeklyReportingEnabledForStore).mock.invocationCallOrder[0]!,
    );
  });

  it("returns the live singleton with its accepted baseline, without source hydration", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    const acceptedBaselineId = await seedAcceptedWeek(t, storeId);
    const acceptedBaseline = await t.run((ctx) =>
      ctx.db.get("reportWeekAccepted", acceptedBaselineId),
    );
    if (!acceptedBaseline) throw new Error("Expected accepted baseline.");
    const closePosture = {
      acceptedCloseId: acceptedBaseline.closeId,
      changedAt: 1_100,
      status: "accepted" as const,
    };
    const amendment = {
      changedAt: 1_100,
      currentFingerprint: "amended-fingerprint",
      included: { ...weeklyMetrics, netSalesMinor: 950 },
      includedNetSalesDeltaMinor: 50,
      outsideSchedule: { ...weeklyMetrics, netSalesMinor: 925 },
      outsideScheduleNetSalesDeltaMinor: 25,
    };
    const priorPeriod = {
      cycleStartDate: "2026-07-20",
      cycleEndDate: "2026-07-26",
      comparabilityReason: "comparable" as const,
      currentScheduledPositionCount: 6,
      priorScheduledPositionCount: 6,
      equivalentScheduledPositions: true,
      values: { ...weeklyMetrics, netSalesMinor: 700 },
    };
    const variancePosture = {
      closeVarianceMinor: -25,
      coverage: "complete" as const,
      coveredIncludedDayCount: 6,
      includedDayCount: 6,
    };
    await t.run((ctx) =>
      ctx.db.patch("reportWeekAccepted", acceptedBaselineId, {
        closePosture,
        amendment,
        amendmentPosture: "amended",
        priorPeriod,
        variancePosture,
        inventoryAttention: {
          newCount: 1,
          carriedForwardCount: 2,
          completeness: "complete",
          groups: [],
          observedCount: 3,
          overflow: false,
          route: {
            to: "/operations",
            search: { workType: "synced_sale_inventory_review" },
          },
        },
      }),
    );
    await t.run((ctx) =>
      ctx.db.insert("reportWeekCurrent", {
        storeId,
        cycleStartDate: "2026-07-27",
        cycleEndDate: "2026-08-02",
        currency: "GHS",
        metricVersion: 1,
        materializedAt: 1_100,
        included: { ...weeklyMetrics, netSalesMinor: 950 },
        outsideSchedule: weeklyMetrics,
        scheduleLineage: weeklyLineage,
        completeness: weeklyCompleteness,
        lifecyclePosture: "accepted",
        amendmentPosture: "amended",
        inventoryAttention: {
          newCount: 2,
          carriedForwardCount: 1,
          completeness: "incomplete",
          groups: [],
          observedCount: 3,
          overflow: true,
          route: {
            to: "/operations",
            search: { workType: "synced_sale_inventory_review" },
          },
        },
        acceptedBaselineId,
        closePosture,
        amendment,
        priorPeriod,
        variancePosture,
      }),
    );

    const result = await t.run((ctx) =>
      handlerOf(getActiveWeeklyBriefing)(ctx, { storeId }),
    );

    expect(requireReportsStoreAccess).toHaveBeenCalledWith(
      expect.anything(),
      storeId,
    );
    expect(result).toMatchObject({
      status: "available",
      current: { included: { netSalesMinor: 950 } },
      acceptedBaseline: {
        cycleStartDate: "2026-07-27",
        summary: { netUnits: 9, merchandiseMarginMinor: 300 },
        current: {
          summary: { netSalesMinor: 950, netUnits: 9 },
          outsideScheduleSummary: { netSalesMinor: 925, netUnits: 9 },
          includedNetSalesDeltaMinor: 50,
          outsideScheduleNetSalesDeltaMinor: 25,
        },
      },
    });
    expect(result.current).not.toHaveProperty("storeId");
    expect(result.acceptedBaseline).not.toHaveProperty("storeId");
    expect(result.current).toMatchObject({
      lifecyclePosture: "accepted",
      amendmentPosture: "amended",
      scheduleLineage: [{ activityPosture: "recorded" }],
      closePosture: { status: "accepted" },
      amendment: { includedNetSalesDeltaMinor: 50 },
      summary: { netUnits: 9, merchandiseMarginMinor: 300 },
      priorPeriod: {
        comparabilityReason: "comparable",
        equivalentScheduledPositions: true,
        values: { netSalesMinor: 700 },
        summary: { netUnits: 9, netSalesMinor: 700 },
        netSalesChange: { amountMinor: 250, direction: "higher" },
      },
      variancePosture: { closeVarianceMinor: -25, coverage: "complete" },
      inventoryAttention: {
        carriedForwardCount: 1,
        completeness: "incomplete",
        newCount: 2,
        overflow: true,
      },
    });
    expect(result.acceptedBaseline).toMatchObject({
      inventoryAttention: { newCount: 1, carriedForwardCount: 2 },
      closePosture: { status: "accepted" },
      lifecyclePosture: "accepted",
      amendmentPosture: "amended",
      amendment: { includedNetSalesDeltaMinor: 50 },
      summary: { netUnits: 9, merchandiseMarginMinor: 300 },
      priorPeriod: {
        comparabilityReason: "comparable",
        equivalentScheduledPositions: true,
        values: { netSalesMinor: 700 },
        summary: { netUnits: 9, netSalesMinor: 700 },
        netSalesChange: { amountMinor: 200, direction: "higher" },
      },
      variancePosture: { closeVarianceMinor: -25, coverage: "complete" },
      ownerRoutes: {
        dailyClose: {
          to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close-history",
          search: { day: "2026-07-27" },
        },
      },
    });
    expect(result.current.ownerRoutes).toEqual({
      transactions: {
        to: "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions",
        search: {
          startDate: "2026-07-27",
          endDate: "2026-08-02",
          order: "oldestFirst",
        },
      },
      dailyClose: {
        to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close",
        search: { operatingDate: "2026-07-27" },
      },
      cashControls: {
        to: "/$orgUrlSlug/store/$storeUrlSlug/cash-controls",
      },
      openWork: {
        to: "/$orgUrlSlug/store/$storeUrlSlug/operations/open-work",
        search: { workType: "synced_sale_inventory_review" },
      },
    });
  });

  it("does not expose current accepted truth when the baseline has no amendment", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    const acceptedBaselineId = await seedAcceptedWeek(t, storeId);
    await t.run((ctx) =>
      ctx.db.insert("reportWeekCurrent", {
        storeId,
        cycleStartDate: "2026-07-27",
        cycleEndDate: "2026-08-02",
        currency: "GHS",
        metricVersion: 1,
        materializedAt: 1_100,
        included: weeklyMetrics,
        outsideSchedule: weeklyMetrics,
        scheduleLineage: weeklyLineage,
        completeness: weeklyCompleteness,
        lifecyclePosture: "accepted",
        amendmentPosture: "none",
        acceptedBaselineId,
      }),
    );

    const result = await t.run((ctx) =>
      handlerOf(getActiveWeeklyBriefing)(ctx, { storeId }),
    );

    expect(result).toMatchObject({
      status: "available",
      current: { lifecyclePosture: "accepted", amendmentPosture: "none" },
      acceptedBaseline: {
        cycleStartDate: "2026-07-27",
        lifecyclePosture: "accepted",
        amendmentPosture: "none",
      },
    });
    expect(result.acceptedBaseline).not.toHaveProperty("current");
    expect(result.acceptedBaseline).not.toHaveProperty("amendment");
  });

  it("normalizes legacy accepted postures across active, history, and detail", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    const acceptedBaselineId = await seedAcceptedWeek(t, storeId);
    const accepted = await t.run((ctx) =>
      ctx.db.get("reportWeekAccepted", acceptedBaselineId),
    );
    if (!accepted) throw new Error("Expected accepted baseline.");
    await t.run(async (ctx) => {
      const amendment = {
        changedAt: 1_100,
        currentFingerprint: "legacy-amendment",
        included: { ...weeklyMetrics, netSalesMinor: 950 },
        includedNetSalesDeltaMinor: 50,
        outsideSchedule: weeklyMetrics,
        outsideScheduleNetSalesDeltaMinor: 0,
      };
      await ctx.db.patch("reportWeekAccepted", acceptedBaselineId, {
        lifecyclePosture: undefined,
        amendmentPosture: undefined,
        closePosture: {
          acceptedCloseId: accepted.closeId,
          changedAt: 1_100,
          status: "reopened_awaiting_successor",
        },
        amendment,
      });
      await ctx.db.insert("reportWeekCurrent", {
        storeId,
        availability: "available",
        cycleStartDate: accepted.cycleStartDate,
        cycleEndDate: accepted.cycleEndDate,
        currency: accepted.currency,
        metricVersion: accepted.metricVersion,
        materializedAt: 1_100,
        included: weeklyMetrics,
        outsideSchedule: weeklyMetrics,
        scheduleLineage: weeklyLineage,
        completeness: weeklyCompleteness,
        lifecyclePosture: "reopened_awaiting_successor",
        amendmentPosture: "amended",
        acceptedBaselineId,
      });
    });

    const active = await t.run((ctx) =>
      handlerOf(getActiveWeeklyBriefing)(ctx, { storeId }),
    );
    const history = await t.run((ctx) =>
      handlerOf(listAcceptedWeeklyHistory)(ctx, {
        storeId,
        paginationOpts: { cursor: null, numItems: 12 },
      }),
    );
    const detail = await t.run((ctx) =>
      handlerOf(getAcceptedWeeklyDetail)(ctx, {
        storeId,
        reportId: "week:2026-07-27",
      }),
    );

    const expected = {
      lifecyclePosture: "reopened_awaiting_successor",
      amendmentPosture: "amended",
    };
    expect(active).toMatchObject({ acceptedBaseline: expected });
    expect(history.page[0]).toMatchObject(expected);
    expect(detail).toMatchObject(expected);
  });

  it("exposes retained values with the schedule-cap refresh posture", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    await t.run((ctx) =>
      ctx.db.insert("reportWeekCurrent", {
        storeId,
        availability: "available",
        cycleStartDate: "2026-07-27",
        cycleEndDate: "2026-08-02",
        currency: "GHS",
        metricVersion: 1,
        materializedAt: 1_100,
        included: { ...weeklyMetrics, netSalesMinor: 950 },
        outsideSchedule: weeklyMetrics,
        scheduleLineage: weeklyLineage,
        completeness: { complete: false, reason: "schedule_history_cap" },
        lifecyclePosture: "materializing",
        amendmentPosture: "none",
      }),
    );

    await expect(
      t.run((ctx) => handlerOf(getActiveWeeklyBriefing)(ctx, { storeId })),
    ).resolves.toMatchObject({
      status: "available",
      current: {
        included: { netSalesMinor: 950 },
        lifecyclePosture: "materializing",
        amendmentPosture: "none",
        completeness: { complete: false, reason: "schedule_history_cap" },
      },
    });
  });

  it("returns missing projection without consulting Store Schedule", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);

    await expect(
      t.run((ctx) => handlerOf(getActiveWeeklyBriefing)(ctx, { storeId })),
    ).resolves.toEqual({ status: "unavailable", reason: "missing_projection" });
  });

  it.each(["missing_schedule", "missing_timezone", "schedule_history_cap", "no_scheduled_dates", "missing_day_fold"] as const)(
    "shapes the stored $reason unavailable posture",
    async (reason) => {
      const t = convexTest(schema, modules);
      const { storeId } = await seedStore(t);
      await t.run((ctx) =>
        ctx.db.insert("reportWeekCurrent", {
          storeId,
          availability: "unavailable",
          unavailableReason: reason,
          lifecyclePosture: "materializing",
          amendmentPosture: "none",
          materializedAt: 1_100,
        }),
      );

      await expect(
        t.run((ctx) => handlerOf(getActiveWeeklyBriefing)(ctx, { storeId })),
      ).resolves.toEqual({ status: "unavailable", reason });
    },
  );

  it("pages accepted history newest first with a strict page cap", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    await seedAcceptedWeek(t, storeId, {
      acceptedAt: 100,
      cycleStartDate: "2026-07-20",
    });
    await seedAcceptedWeek(t, storeId, {
      acceptedAt: 300,
      cycleStartDate: "2026-07-27",
    });

    const page = await t.run((ctx) =>
      handlerOf(listAcceptedWeeklyHistory)(ctx, {
        storeId,
        paginationOpts: { cursor: null, numItems: 1 },
      }),
    );

    expect(page.page).toHaveLength(1);
    expect(page.page[0]).toMatchObject({
      cycleStartDate: "2026-07-27",
      acceptedAt: 300,
    });
    expect(page.page[0]).toHaveProperty("reportId");
    expect(page.page[0]).toMatchObject({ summary: { netUnits: 9 } });
    expect(page.isDone).toBe(false);
    const nextPage = await t.run((ctx) =>
      handlerOf(listAcceptedWeeklyHistory)(ctx, {
        storeId,
        paginationOpts: { cursor: page.continueCursor, numItems: 1 },
      }),
    );
    expect(nextPage.page).toHaveLength(1);
    expect(nextPage.page[0]).toMatchObject({ cycleStartDate: "2026-07-20" });
    await expect(
      t.run((ctx) =>
        handlerOf(listAcceptedWeeklyHistory)(ctx, {
          storeId,
          paginationOpts: { cursor: null, numItems: 25 },
        }),
      ),
    ).rejects.toThrow("page size");
  });

  it("keeps cross-store and missing historical detail indistinguishable", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    const { storeId: otherStoreId } = await seedStore(t);
    await seedAcceptedWeek(t, otherStoreId);

    const [crossStore, missing] = await Promise.all([
      t.run((ctx) =>
        handlerOf(getAcceptedWeeklyDetail)(ctx, {
          storeId,
          reportId: "week:2026-07-27",
        }),
      ),
      t.run((ctx) =>
        handlerOf(getAcceptedWeeklyDetail)(ctx, {
          storeId,
          reportId: "week:2026-07-20",
        }),
      ),
    ]);

    expect(crossStore).toBeNull();
    expect(missing).toBeNull();
  });

  it("rejects malformed weekly ids before an accepted projection lookup", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);

    await expect(
      t.run((ctx) =>
        handlerOf(getAcceptedWeeklyDetail)(ctx, {
          storeId,
          reportId: "not-a-weekly-report",
        }),
      ),
    ).rejects.toThrow("Weekly report id is invalid.");
  });
});
