/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";

import schema from "../schema";
import { assertConformsToExportedReturns } from "../lib/returnValidatorContract";
import type { Id } from "../_generated/dataModel";
import {
  getLiveOperatingDay,
  LIVE_DAY_SKU_ROW_LIMIT,
  LIVE_STOCK_SKU_LIMIT,
  listLiveSkuStock,
} from "./liveDay";

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

const dayFlags = {
  mixedCurrency: false,
  hasUncostedRevenue: false,
  quarantinedFactCount: 0,
};

function dayMetrics(overrides: Record<string, number | null> = {}) {
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

function skuMetrics(overrides: Record<string, number | null> = {}) {
  return {
    unitsSold: 4,
    unitsReturned: 0,
    grossSalesMinor: 400,
    netSalesMinor: 400,
    refundsMinor: 0,
    uncostedRevenueMinor: 0,
    grossProfitMinor: 120,
    ...overrides,
  };
}

async function seedStore(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("athenaUser", {
      email: "reports-live-day@example.test",
    });
    const organizationId = await ctx.db.insert("organization", {
      createdByUserId: userId,
      name: "Live day",
      slug: "live-day",
    });
    const storeId = await ctx.db.insert("store", {
      createdByUserId: userId,
      currency: "GHS",
      name: "Live day",
      organizationId,
      slug: "live-day",
    });
    return { organizationId, storeId, userId };
  });
}

async function seedSku(
  t: ReturnType<typeof convexTest>,
  storeId: Id<"store">,
  sku: string,
) {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("athenaUser", {
      email: `live-sku-${sku}@example.test`,
    });
    const organizationId = await ctx.db.insert("organization", {
      createdByUserId: userId,
      name: "Sku org",
      slug: `sku-org-${sku}`,
    });
    const categoryId = await ctx.db.insert("category", {
      name: "Home",
      slug: `home-${sku}`,
      storeId,
    });
    const subcategoryId = await ctx.db.insert("subcategory", {
      categoryId,
      name: "Living",
      slug: `living-${sku}`,
      storeId,
    });
    const productId = await ctx.db.insert("product", {
      availability: "live",
      categoryId,
      createdByUserId: userId,
      currency: "GHS",
      inventoryCount: 10,
      name: "Clay mug",
      organizationId,
      slug: `clay-mug-${sku}`,
      storeId,
      subcategoryId,
    });
    return ctx.db.insert("productSku", {
      images: [],
      inventoryCount: 10,
      price: 100,
      productId,
      productName: "Clay mug",
      quantityAvailable: 10,
      sku,
      storeId,
      unitCost: 60,
    });
  });
}

function skuIdentity(
  overrides: Partial<{
    displayName: string;
    netPriceMinor: number;
    productId: string;
    quantityAvailable: number;
    sku: string | null;
    unitCostMinor: number | null;
  }> = {},
) {
  return {
    displayName: "Clay mug",
    netPriceMinor: 100,
    productId: "jd7abcdef",
    quantityAvailable: 10,
    sku: "FM5W-9C3-2RD",
    unitCostMinor: 60,
    ...overrides,
  };
}

describe("live day return contracts", () => {
  it("conforms representative returns to the exported validators", () => {
    // Executable proof of the declared `returns` shapes: a loose string check
    // on exportReturns() would not catch a drifted field.
    assertConformsToExportedReturns(getLiveOperatingDay, {
      day: {
        currency: "GHS",
        factCount: 7,
        lastFactRecordedAt: 1_733_000_000_000,
        metrics: dayMetrics(),
        status: "open",
      },
      operatingDate: "2026-08-04",
      skus: [
        {
          identity: skuIdentity(),
          metrics: skuMetrics(),
          productSkuId: "kg2abcdef",
          sku: "FM5W-9C3-2RD",
        },
      ],
    });

    // An untouched day and an unresolvable catalogue code are both part of the
    // contract, not edge cases the validator merely tolerates.
    assertConformsToExportedReturns(getLiveOperatingDay, {
      day: null,
      operatingDate: "2026-08-04",
      skus: [
        {
          identity: null,
          metrics: skuMetrics(),
          productSkuId: "kg2abcdef",
          sku: null,
        },
      ],
    });

    assertConformsToExportedReturns(listLiveSkuStock, [
      {
        identity: skuIdentity(),
        productSkuId: "kg2abcdef",
        sku: "FM5W-9C3-2RD",
      },
    ]);
    // A SKU priced at the register carries no cost and may carry no code.
    assertConformsToExportedReturns(listLiveSkuStock, [
      {
        identity: skuIdentity({ sku: null, unitCostMinor: null }),
        productSkuId: "kg2abcdef",
        sku: null,
      },
    ]);
    assertConformsToExportedReturns(listLiveSkuStock, []);
  });
});

describe("getLiveOperatingDay", () => {
  it("checks reports access before reading anything", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);

    await t.run((ctx) =>
      handlerOf(getLiveOperatingDay)(ctx, {
        operatingDate: "2026-08-04",
        storeId,
      }),
    );

    expect(requireReportsStoreAccess).toHaveBeenCalledWith(
      expect.anything(),
      storeId,
    );
  });

  it("reports an untouched day as absent rather than as zeroes", async () => {
    // Absent and all-zero are different facts: the caller decides whether an
    // untouched day means "nothing sold yet" or "no live day at all", and
    // fabricating a zero row here would take that choice away.
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);

    const result = await t.run((ctx) =>
      handlerOf(getLiveOperatingDay)(ctx, {
        operatingDate: "2026-08-04",
        storeId,
      }),
    );

    expect(result).toEqual({
      day: null,
      operatingDate: "2026-08-04",
      skus: [],
    });
  });

  it("returns the incrementally-patched open day with its sku rows", async () => {
    // reportDay is written inside the sale's own transaction, so it is the
    // only reporting row that is fresh the instant a sale completes — the
    // sweeper-written overview and rollups lag by up to five minutes.
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    const skuId = await seedSku(t, storeId, "FM5W-9C3-2RD");

    await t.run(async (ctx) => {
      await ctx.db.insert("reportDay", {
        storeId,
        operatingDate: "2026-08-04",
        currency: "GHS",
        status: "open",
        ...dayMetrics(),
        foldVersion: 1,
        factCount: 7,
        lastFactRecordedAt: 1_733_000_000_000,
        flags: dayFlags,
      });
      await ctx.db.insert("reportSkuDay", {
        storeId,
        productSkuId: skuId,
        operatingDate: "2026-08-04",
        ...skuMetrics(),
      });
    });

    const result = await t.run((ctx) =>
      handlerOf(getLiveOperatingDay)(ctx, {
        operatingDate: "2026-08-04",
        storeId,
      }),
    );

    expect(result.operatingDate).toBe("2026-08-04");
    expect(result.day).toMatchObject({
      currency: "GHS",
      factCount: 7,
      lastFactRecordedAt: 1_733_000_000_000,
      metrics: dayMetrics(),
      status: "open",
    });
    expect(result.skus).toEqual([
      {
        identity: {
          displayName: "Clay mug",
          netPriceMinor: 100,
          productId: expect.any(String),
          quantityAvailable: 10,
          sku: "FM5W-9C3-2RD",
          unitCostMinor: 60,
        },
        metrics: skuMetrics(),
        productSkuId: String(skuId),
        sku: "FM5W-9C3-2RD",
      },
    ]);
  });

  it("carries the open day's running transaction count", async () => {
    // Not close-gated: ingest maintains it per sale, so a caller reading the
    // day live can state a basket size while the store is still trading.
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);

    await t.run(async (ctx) => {
      await ctx.db.insert("reportDay", {
        storeId,
        operatingDate: "2026-08-04",
        currency: "GHS",
        status: "open",
        ...dayMetrics(),
        foldVersion: 1,
        factCount: 7,
        lastFactRecordedAt: 1_733_000_000_000,
        flags: dayFlags,
        transactionCount: 6,
      });
    });

    const result = await t.run((ctx) =>
      handlerOf(getLiveOperatingDay)(ctx, {
        operatingDate: "2026-08-04",
        storeId,
      }),
    );

    expect(result.day?.status).toBe("open");
    expect(result.day?.transactionCount).toBe(6);
  });

  it("omits the count on a day written before it existed", async () => {
    // Absent means unknown, never zero — the caller withholds rather than
    // reporting a basket divided by a count that was never recorded.
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);

    await t.run(async (ctx) => {
      await ctx.db.insert("reportDay", {
        storeId,
        operatingDate: "2026-08-04",
        currency: "GHS",
        status: "open",
        ...dayMetrics(),
        foldVersion: 1,
        factCount: 7,
        lastFactRecordedAt: 1_733_000_000_000,
        flags: dayFlags,
      });
    });

    const result = await t.run((ctx) =>
      handlerOf(getLiveOperatingDay)(ctx, {
        operatingDate: "2026-08-04",
        storeId,
      }),
    );

    expect(result.day).not.toHaveProperty("transactionCount");
  });

  it("names a sku the caller could not resolve on its own", async () => {
    // A SKU created at the register by POS quick add exists in no client
    // catalogue, so the row is the only place its name can come from. It is
    // priced but never costed, and a null cost is what says so.
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    const skuId = await seedSku(t, storeId, "FM5W-QCK-ADD");
    await t.run((ctx) =>
      ctx.db.patch("productSku", skuId, {
        netPrice: 500,
        price: 500,
        productName: "Bottled water",
        unitCost: undefined,
      }),
    );
    await t.run(async (ctx) => {
      await ctx.db.insert("reportSkuDay", {
        storeId,
        productSkuId: skuId,
        operatingDate: "2026-08-04",
        ...skuMetrics(),
      });
    });

    const result = await t.run((ctx) =>
      handlerOf(getLiveOperatingDay)(ctx, {
        operatingDate: "2026-08-04",
        storeId,
      }),
    );

    expect(result.skus[0]!.identity).toMatchObject({
      displayName: "Bottled water",
      netPriceMinor: 500,
      unitCostMinor: null,
    });
  });

  it("carries the business sku code so a caller can resolve identity", async () => {
    // The demo's fixtures are keyed by catalogue slug, never by a Convex id.
    // Publishing the code is what lets that bridge exist at all.
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    const skuId = await seedSku(t, storeId, "FM5W-7K2-3Q9");

    await t.run((ctx) =>
      ctx.db.insert("reportSkuDay", {
        storeId,
        productSkuId: skuId,
        operatingDate: "2026-08-04",
        ...skuMetrics(),
      }),
    );

    const result = await t.run((ctx) =>
      handlerOf(getLiveOperatingDay)(ctx, {
        operatingDate: "2026-08-04",
        storeId,
      }),
    );

    expect(result.skus[0].sku).toBe("FM5W-7K2-3Q9");
  });

  it("keeps a sku row whose catalogue document is gone", async () => {
    // A reporting row outlives its subject. Dropping it would understate the
    // day; the caller decides what an unresolvable code means.
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    const skuId = await seedSku(t, storeId, "FM5W-0AA-0AA");
    await t.run((ctx) => ctx.db.delete("productSku", skuId));

    await t.run((ctx) =>
      ctx.db.insert("reportSkuDay", {
        storeId,
        productSkuId: skuId,
        operatingDate: "2026-08-04",
        ...skuMetrics(),
      }),
    );

    const result = await t.run((ctx) =>
      handlerOf(getLiveOperatingDay)(ctx, {
        operatingDate: "2026-08-04",
        storeId,
      }),
    );

    expect(result.skus).toHaveLength(1);
    expect(result.skus[0].sku).toBeNull();
  });

  it("reads only the requested day", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    const skuId = await seedSku(t, storeId, "FM5W-6BX-5W1");

    await t.run(async (ctx) => {
      for (const operatingDate of ["2026-08-03", "2026-08-04", "2026-08-05"]) {
        await ctx.db.insert("reportDay", {
          storeId,
          operatingDate,
          currency: "GHS",
          status: operatingDate === "2026-08-04" ? "open" : "reconciled",
          ...dayMetrics({
            netSalesMinor: operatingDate === "2026-08-04" ? 900 : 111,
          }),
          foldVersion: 1,
          factCount: 1,
          lastFactRecordedAt: 1,
          flags: dayFlags,
        });
        await ctx.db.insert("reportSkuDay", {
          storeId,
          productSkuId: skuId,
          operatingDate,
          ...skuMetrics({
            netSalesMinor: operatingDate === "2026-08-04" ? 400 : 222,
          }),
        });
      }
    });

    const result = await t.run((ctx) =>
      handlerOf(getLiveOperatingDay)(ctx, {
        operatingDate: "2026-08-04",
        storeId,
      }),
    );

    expect(result.day?.metrics.netSalesMinor).toBe(900);
    expect(result.skus).toHaveLength(1);
    expect(result.skus[0].metrics.netSalesMinor).toBe(400);
  });

  it("never reads another store's day", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    const other = await seedStore(t);

    await t.run((ctx) =>
      ctx.db.insert("reportDay", {
        storeId: other.storeId,
        operatingDate: "2026-08-04",
        currency: "GHS",
        status: "open",
        ...dayMetrics(),
        foldVersion: 1,
        factCount: 1,
        lastFactRecordedAt: 1,
        flags: dayFlags,
      }),
    );

    const result = await t.run((ctx) =>
      handlerOf(getLiveOperatingDay)(ctx, {
        operatingDate: "2026-08-04",
        storeId,
      }),
    );

    expect(result.day).toBeNull();
  });

  it("rejects a malformed operating date instead of scanning", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);

    await expect(
      t.run((ctx) =>
        handlerOf(getLiveOperatingDay)(ctx, {
          operatingDate: "not-a-date",
          storeId,
        }),
      ),
    ).rejects.toThrow(/operating date/i);
  });

  it("bounds the sku read", async () => {
    expect(LIVE_DAY_SKU_ROW_LIMIT).toBeGreaterThan(0);
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);

    const seedSkuId = await seedSku(t, storeId, "BULK-SEED");
    const productId = await t.run(
      async (ctx) => (await ctx.db.get("productSku", seedSkuId))!.productId,
    );

    await t.run(async (ctx) => {
      for (let index = 0; index < LIVE_DAY_SKU_ROW_LIMIT + 5; index += 1) {
        const skuId = await ctx.db.insert("productSku", {
          images: [],
          inventoryCount: 1,
          price: 10,
          productId,
          quantityAvailable: 1,
          sku: `BULK-${index}`,
          storeId,
        });
        await ctx.db.insert("reportSkuDay", {
          storeId,
          productSkuId: skuId,
          operatingDate: "2026-08-04",
          ...skuMetrics(),
        });
      }
    });

    const result = await t.run((ctx) =>
      handlerOf(getLiveOperatingDay)(ctx, {
        operatingDate: "2026-08-04",
        storeId,
      }),
    );

    expect(result.skus).toHaveLength(LIVE_DAY_SKU_ROW_LIMIT);
  });
});

describe("listLiveSkuStock", () => {
  it("checks reports access before reading anything", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);

    await t.run((ctx) => handlerOf(listLiveSkuStock)(ctx, { storeId }));

    expect(requireReportsStoreAccess).toHaveBeenCalledWith(
      expect.anything(),
      storeId,
    );
  });

  it("reports current sellable stock with the identity to name it", async () => {
    // Identity rides along because the caller cannot always resolve the row
    // itself: a SKU created at the register exists in no client catalogue.
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    const skuId = await seedSku(t, storeId, "FM5W-9C3-2RD");
    await t.run((ctx) =>
      ctx.db.patch("productSku", skuId, { quantityAvailable: 7 }),
    );

    const result = await t.run((ctx) =>
      handlerOf(listLiveSkuStock)(ctx, { storeId }),
    );

    expect(result).toEqual([
      {
        identity: {
          displayName: "Clay mug",
          netPriceMinor: 100,
          productId: expect.any(String),
          quantityAvailable: 7,
          sku: "FM5W-9C3-2RD",
          unitCostMinor: 60,
        },
        productSkuId: String(skuId),
        sku: "FM5W-9C3-2RD",
      },
    ]);
  });

  it("moves with the row rather than reporting a seeded constant", async () => {
    // The point of the read: a sale decrements the row, and the next result
    // reflects it. A fixture constant never would.
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    const skuId = await seedSku(t, storeId, "FM5W-6BX-5W1");

    await t.run((ctx) =>
      ctx.db.patch("productSku", skuId, { quantityAvailable: 20 }),
    );
    const before = await t.run((ctx) =>
      handlerOf(listLiveSkuStock)(ctx, { storeId }),
    );
    await t.run((ctx) =>
      ctx.db.patch("productSku", skuId, { quantityAvailable: 12 }),
    );
    const after = await t.run((ctx) =>
      handlerOf(listLiveSkuStock)(ctx, { storeId }),
    );

    expect(before[0].identity.quantityAvailable).toBe(20);
    expect(after[0].identity.quantityAvailable).toBe(12);
  });

  it("keeps a sku with no business code, keyed by its id", async () => {
    // The code is no longer the key, so a SKU that has none is disclosed
    // rather than dropped — it is still a real row a visitor can sell.
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    const skuId = await seedSku(t, storeId, "FM5W-0AA-0AA");
    await t.run((ctx) =>
      ctx.db.patch("productSku", skuId, { sku: undefined }),
    );

    const result = await t.run((ctx) =>
      handlerOf(listLiveSkuStock)(ctx, { storeId }),
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      productSkuId: String(skuId),
      sku: null,
    });
    expect(result[0]!.identity.sku).toBeNull();
  });

  it("never reads another store's stock", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    const other = await seedStore(t);
    await seedSku(t, other.storeId, "FM5W-OTHER");

    const result = await t.run((ctx) =>
      handlerOf(listLiveSkuStock)(ctx, { storeId }),
    );

    expect(result).toEqual([]);
  });

  it("bounds the read", async () => {
    expect(LIVE_STOCK_SKU_LIMIT).toBeGreaterThan(0);
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t);
    const seedSkuId = await seedSku(t, storeId, "BULK-SEED");
    const productId = await t.run(
      async (ctx) => (await ctx.db.get("productSku", seedSkuId))!.productId,
    );

    await t.run(async (ctx) => {
      for (let index = 0; index < LIVE_STOCK_SKU_LIMIT + 5; index += 1) {
        await ctx.db.insert("productSku", {
          images: [],
          inventoryCount: 1,
          price: 10,
          productId,
          quantityAvailable: 1,
          sku: `BULK-${index}`,
          storeId,
        });
      }
    });

    const result = await t.run((ctx) =>
      handlerOf(listLiveSkuStock)(ctx, { storeId }),
    );

    expect(result.length).toBeLessThanOrEqual(LIVE_STOCK_SKU_LIMIT);
  });
});
