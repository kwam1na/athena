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
} from "./queries";
import { emptySnapshot } from "./overview";

const modules = import.meta.glob("../**/*.ts");

vi.mock("./access", () => ({
  requireReportsStoreAccess: vi.fn(),
}));
import { requireReportsStoreAccess } from "./access";

function handlerOf(fn: unknown): (...args: any[]) => Promise<any> {
  return (fn as unknown as { _handler: (...args: any[]) => Promise<any> })
    ._handler;
}

beforeEach(() => {
  vi.mocked(requireReportsStoreAccess).mockResolvedValue({} as never);
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
    return { storeId };
  });
}

async function seedSku(
  t: ReturnType<typeof convexTest>,
  storeId: Id<"store">,
  images: string[] = [],
  netPrice?: number,
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

    const result = await t.run((ctx) =>
      handlerOf(getOverview)(ctx, { storeId }),
    );

    expect(requireReportsStoreAccess).toHaveBeenCalledWith(
      expect.anything(),
      storeId,
    );
    expect(result).toMatchObject({ updatedAt: 1000, currency: "GHS" });
    expect(result?.yesterday).toEqual(emptySnapshot());
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
      netPriceMinor: 100,
      productId: expect.any(String),
    });
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
    const productSkuId = await seedSku(t, storeId, [
      "https://cdn.example.test/wig.webp",
    ], 12_500);
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
