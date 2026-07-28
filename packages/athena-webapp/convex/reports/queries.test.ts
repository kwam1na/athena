/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import { descendingSortKey } from "../../shared/reportsContract";
import {
  getOverview,
  listDays,
  listPeriodSkus,
  getSkuDetail,
  getRangeResult,
} from "./queries";

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

async function seedSku(t: ReturnType<typeof convexTest>, storeId: Id<"store">) {
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
      images: [],
      inventoryCount: 10,
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

  it("pages 25 at a time in descending revenue order, then exhausts with continueCursor null", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    const skuIds: Id<"productSku">[] = [];
    for (let i = 0; i < 30; i += 1) {
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
    expect(page1.rows).toHaveLength(25);
    expect(page1.continueCursor).not.toBeNull();
    // Descending revenue: sku 0 (netSales 1000) first.
    expect(page1.rows[0].productSkuId).toBe(skuIds[0]);
    expect(page1.rows[24].productSkuId).toBe(skuIds[24]);

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
      skuIds.slice(25, 30),
    );
  });

  it("disambiguates exact sort-key ties by productSkuId across the cursor boundary", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    const skuIds: Id<"productSku">[] = [];
    // 27 SKUs tied at the same revenue -> same sortKey, forcing tie-break
    // logic to page correctly at the 25/2 boundary.
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
    expect(page1.rows).toHaveLength(25);
    expect(page1.continueCursor).not.toBeNull();

    const page2 = await t.run((ctx) =>
      handlerOf(listPeriodSkus)(ctx, {
        storeId,
        periodKey: "d:2026-07-28",
        sortBy: "revenue",
        cursor: page1.continueCursor,
      }),
    );
    expect(page2.rows).toHaveLength(2);
    expect(page2.continueCursor).toBeNull();

    const seenIds = new Set([
      ...page1.rows.map((r: any) => r.productSkuId),
      ...page2.rows.map((r: any) => r.productSkuId),
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
    const productSkuId = await seedSku(t, storeId);
    const result = await t.run((ctx) =>
      handlerOf(getSkuDetail)(ctx, {
        storeId,
        productSkuId,
        startDate: "2026-07-01",
        endDate: "2026-07-28",
      }),
    );
    expect(result).toEqual({ days: [], totals: null });
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
