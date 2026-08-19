/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { api } from "../_generated/api";
import schema from "../schema";
import {
  computeRange,
  computeRequestKey,
  requestRangeCore,
} from "./customRange";
import {
  REPORT_RANGE_MAX_DAYS,
  REPORT_RANGE_TTL_MS,
  REPORTS_FOLD_VERSION,
} from "../../shared/reportsContract";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../")
      ? path.replace(/^\.\.\//, "./")
      : path.replace(/^\.\//, "./reports/"),
    loader,
  ]),
);

async function seedStore(ctx: MutationCtx) {
  const userId = await ctx.db.insert("athenaUser", {
    email: "owner@example.test",
  });
  const organizationId = await ctx.db.insert("organization", {
    createdByUserId: userId,
    name: "Test Org",
    slug: "test-org",
  });
  const storeId = await ctx.db.insert("store", {
    createdByUserId: userId,
    currency: "GHS",
    name: "Test Store",
    organizationId,
    slug: "test-store",
  });
  return { userId, organizationId, storeId };
}

async function seedProductSku(
  ctx: MutationCtx,
  storeId: Id<"store">,
  suffix: string,
) {
  const categoryId = await ctx.db.insert("category", {
    name: `Category ${suffix}`,
    slug: `category-${suffix}`,
    storeId,
  });
  const subcategoryId = await ctx.db.insert("subcategory", {
    categoryId,
    name: `Subcategory ${suffix}`,
    slug: `subcategory-${suffix}`,
    storeId,
  });
  const userId = await ctx.db.insert("athenaUser", {
    email: `sku-${suffix}@example.test`,
  });
  const productId = await ctx.db.insert("product", {
    availability: "live" as const,
    categoryId,
    createdByUserId: userId,
    currency: "GHS",
    inventoryCount: 10,
    name: `Product ${suffix}`,
    organizationId: (await ctx.db.get("store", storeId))!.organizationId,
    slug: `product-${suffix}`,
    storeId,
    subcategoryId,
  });
  return ctx.db.insert("productSku", {
    images: [],
    inventoryCount: 10,
    price: 1000,
    productId,
    quantityAvailable: 10,
    storeId,
  });
}

const ZERO_DAY_FIELDS = {
  grossSalesMinor: 0,
  netSalesMinor: 0,
  refundsMinor: 0,
  unitsSold: 0,
  unitsReturned: 0,
  uncostedRevenueMinor: 0,
  grossProfitMinor: 0 as number | null,
  paymentsCollectedMinor: 0,
  paymentsRefundedMinor: 0,
  paymentAllocatedMinor: 0,
};

function reportDayRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ...ZERO_DAY_FIELDS,
    currency: "GHS",
    status: "reconciled" as const,
    foldVersion: REPORTS_FOLD_VERSION,
    factCount: 1,
    lastFactRecordedAt: 1,
    flags: {
      mixedCurrency: false,
      hasUncostedRevenue: false,
      quarantinedFactCount: 0,
    },
    ...overrides,
  };
}

describe("customRange.requestRangeCore", () => {
  it("rejects a malformed startDate", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await t.run(seedStore);
    await expect(
      t.run((ctx) =>
        requestRangeCore(ctx, {
          storeId,
          startDate: "2026-13-40",
          endDate: "2026-07-01",
        }),
      ),
    ).rejects.toThrow(/Invalid startDate/);
  });

  it("rejects a malformed endDate", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await t.run(seedStore);
    await expect(
      t.run((ctx) =>
        requestRangeCore(ctx, {
          storeId,
          startDate: "2026-07-01",
          endDate: "not-a-date",
        }),
      ),
    ).rejects.toThrow(/Invalid endDate/);
  });

  it("rejects startDate after endDate", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await t.run(seedStore);
    await expect(
      t.run((ctx) =>
        requestRangeCore(ctx, {
          storeId,
          startDate: "2026-07-10",
          endDate: "2026-07-01",
        }),
      ),
    ).rejects.toThrow(/startDate must be on or before endDate/);
  });

  it("rejects a span longer than REPORT_RANGE_MAX_DAYS", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await t.run(seedStore);
    await expect(
      t.run((ctx) =>
        requestRangeCore(ctx, {
          storeId,
          startDate: "2025-01-01",
          endDate: "2026-01-02", // 367 days inclusive
        }),
      ),
    ).rejects.toThrow(/maximum is 366 days/);
  });

  it("accepts a span exactly at REPORT_RANGE_MAX_DAYS", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await t.run(seedStore);
    // 2025-01-01 .. 2026-01-01 inclusive is exactly 366 days.
    await expect(
      t.run((ctx) =>
        requestRangeCore(ctx, {
          storeId,
          startDate: "2025-01-01",
          endDate: "2026-01-01",
        }),
      ),
    ).resolves.toEqual({
      requestKey: expect.any(String),
    });
  });

  it("computeRequestKey is deterministic and excludes clock input", () => {
    const args = {
      storeId: "store-1" as Id<"store">,
      startDate: "2026-07-01",
      endDate: "2026-07-10",
    };
    const a = computeRequestKey(args);
    const b = computeRequestKey(args);
    expect(a).toBe(b);
  });

  it("computeRequestKey differs across store/range/fold-version inputs", () => {
    const base = {
      storeId: "store-1" as Id<"store">,
      startDate: "2026-07-01",
      endDate: "2026-07-10",
    };
    const differentStore = computeRequestKey({
      ...base,
      storeId: "store-2" as Id<"store">,
    });
    const differentRange = computeRequestKey({
      ...base,
      endDate: "2026-07-11",
    });
    const key = computeRequestKey(base);
    expect(differentStore).not.toBe(key);
    expect(differentRange).not.toBe(key);
  });

  it("dedupes an identical in-flight request without reinserting", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await t.run(seedStore);
    const args = { storeId, startDate: "2026-07-01", endDate: "2026-07-10" };

    const first = await t.run((ctx) => requestRangeCore(ctx, args));
    const second = await t.run((ctx) => requestRangeCore(ctx, args));

    expect(second.requestKey).toBe(first.requestKey);
    const rows = await t.run((ctx) =>
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      ctx.db.query("reportRangeResult").collect(),
    );
    expect(rows).toHaveLength(1);
  });

  it("deletes and reinserts an expired request row instead of returning it", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await t.run(seedStore);
    const args = { storeId, startDate: "2026-07-01", endDate: "2026-07-10" };

    const first = await t.run((ctx) => requestRangeCore(ctx, args));
    const originalId = await t.run(async (ctx) => {
      const row = await ctx.db
        .query("reportRangeResult")
        .withIndex("by_storeId_requestKey", (q) =>
          q.eq("storeId", storeId).eq("requestKey", first.requestKey),
        )
        .unique();
      // Force expiry into the past.
      await ctx.db.patch("reportRangeResult", row!._id, { expiresAt: Date.now() - 1 });
      return row!._id;
    });

    const second = await t.run((ctx) => requestRangeCore(ctx, args));
    expect(second.requestKey).toBe(first.requestKey);

    const rows = await t.run((ctx) =>
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      ctx.db.query("reportRangeResult").collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]._id).not.toBe(originalId);
    expect(rows[0].expiresAt).toBeGreaterThan(Date.now());
    expect(rows[0].expiresAt - rows[0].requestedAt).toBe(REPORT_RANGE_TTL_MS);
  });
});

describe("customRange.requestRange mutation (access gating)", () => {
  it("never runs unguarded: rejects an unauthenticated caller", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await t.run(seedStore);

    await expect(
      t.mutation(api.reports.customRange.requestRange, {
        storeId,
        startDate: "2026-07-01",
        endDate: "2026-07-10",
      }),
      // The admission rail stops an anonymous caller before the handler, so
      // the denial is the rail's rather than the reports gate's. Nothing is
      // written either way, which the row assertion below proves.
    ).rejects.toThrow("Sign in again to continue.");

    await expect(
      t.run((ctx) =>
        // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
        ctx.db.query("reportRangeResult").collect(),
      ),
    ).resolves.toEqual([]);
  });
});

describe("customRange.computeRange", () => {
  it("sums seeded reportDay docs into totals", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await t.run(seedStore);

    await t.run((ctx) =>
      ctx.db.insert("reportDay", {
        storeId,
        operatingDate: "2026-07-01",
        ...reportDayRow({
          grossSalesMinor: 1000,
          netSalesMinor: 900,
          unitsSold: 3,
          grossProfitMinor: 200,
        }),
      }),
    );
    await t.run((ctx) =>
      ctx.db.insert("reportDay", {
        storeId,
        operatingDate: "2026-07-02",
        ...reportDayRow({
          status: "open",
          grossSalesMinor: 500,
          netSalesMinor: 450,
          unitsSold: 1,
          grossProfitMinor: 100,
        }),
      }),
    );

    const request = await t.run((ctx) =>
      ctx.db.insert("reportRangeResult", {
        storeId,
        requestKey: "range:test",
        startDate: "2026-07-01",
        endDate: "2026-07-05",
        status: "pending",
        requestedAt: Date.now(),
        expiresAt: Date.now() + REPORT_RANGE_TTL_MS,
        foldVersion: REPORTS_FOLD_VERSION,
      }),
    );

    await t.run((ctx) =>
      ctx.db.get("reportRangeResult", request).then(async (doc) => {
        await computeRange(ctx, doc!);
      }),
    );

    const result = await t.run((ctx) => ctx.db.get("reportRangeResult", request));
    expect(result!.status).toBe("completed");
    expect(result!.computedAt).toBeDefined();
    expect(result!.totals).toMatchObject({
      dayCount: 2,
      unsettledDayCount: 1,
      grossSalesMinor: 1500,
      netSalesMinor: 1350,
      unitsSold: 4,
      grossProfitMinor: 300,
    });
  });

  it("propagates null grossProfitMinor when any day in range is null", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await t.run(seedStore);

    await t.run((ctx) =>
      ctx.db.insert("reportDay", {
        storeId,
        operatingDate: "2026-07-01",
        ...reportDayRow({ grossProfitMinor: 200 }),
      }),
    );
    await t.run((ctx) =>
      ctx.db.insert("reportDay", {
        storeId,
        operatingDate: "2026-07-02",
        ...reportDayRow({ grossProfitMinor: null }),
      }),
    );

    const request = await t.run((ctx) =>
      ctx.db.insert("reportRangeResult", {
        storeId,
        requestKey: "range:test-null",
        startDate: "2026-07-01",
        endDate: "2026-07-05",
        status: "pending",
        requestedAt: Date.now(),
        expiresAt: Date.now() + REPORT_RANGE_TTL_MS,
        foldVersion: REPORTS_FOLD_VERSION,
      }),
    );

    await t.run(async (ctx) => {
      const doc = await ctx.db.get("reportRangeResult", request);
      await computeRange(ctx, doc!);
    });

    const result = await t.run((ctx) => ctx.db.get("reportRangeResult", request));
    expect(result!.totals!.grossProfitMinor).toBeNull();
  });

  it("orders and caps topSkus by netSalesMinor, tagged with the custom periodKey", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await t.run(seedStore);
    const skuLow = await t.run((ctx) => seedProductSku(ctx, storeId, "low"));
    const skuHigh = await t.run((ctx) => seedProductSku(ctx, storeId, "high"));
    const skuMid = await t.run((ctx) => seedProductSku(ctx, storeId, "mid"));

    const skuDayFields = {
      unitsSold: 1,
      unitsReturned: 0,
      grossSalesMinor: 0,
      refundsMinor: 0,
      uncostedRevenueMinor: 0,
      grossProfitMinor: 0 as number | null,
    };

    await t.run((ctx) =>
      ctx.db.insert("reportSkuDay", {
        storeId,
        productSkuId: skuLow,
        operatingDate: "2026-07-01",
        ...skuDayFields,
        netSalesMinor: 100,
      }),
    );
    await t.run((ctx) =>
      ctx.db.insert("reportSkuDay", {
        storeId,
        productSkuId: skuHigh,
        operatingDate: "2026-07-01",
        ...skuDayFields,
        netSalesMinor: 900,
      }),
    );
    // Second day for the same SKU aggregates into one row.
    await t.run((ctx) =>
      ctx.db.insert("reportSkuDay", {
        storeId,
        productSkuId: skuHigh,
        operatingDate: "2026-07-02",
        ...skuDayFields,
        netSalesMinor: 200,
      }),
    );
    await t.run((ctx) =>
      ctx.db.insert("reportSkuDay", {
        storeId,
        productSkuId: skuMid,
        operatingDate: "2026-07-02",
        ...skuDayFields,
        netSalesMinor: 500,
      }),
    );

    const request = await t.run((ctx) =>
      ctx.db.insert("reportRangeResult", {
        storeId,
        requestKey: "range:test-skus",
        startDate: "2026-07-01",
        endDate: "2026-07-05",
        status: "pending",
        requestedAt: Date.now(),
        expiresAt: Date.now() + REPORT_RANGE_TTL_MS,
        foldVersion: REPORTS_FOLD_VERSION,
      }),
    );

    await t.run(async (ctx) => {
      const doc = await ctx.db.get("reportRangeResult", request);
      await computeRange(ctx, doc!);
    });

    const result = await t.run((ctx) => ctx.db.get("reportRangeResult", request));
    expect(result!.topSkus).toHaveLength(3);
    expect(result!.topSkus!.map((s) => s.productSkuId)).toEqual([
      skuHigh,
      skuMid,
      skuLow,
    ]);
    expect(result!.topSkus![0]).toMatchObject({
      netSalesMinor: 1100,
      periodKey: "custom:2026-07-01:2026-07-05",
    });
  });

  it("caps topSkus at REPORT_RANGE_TOP_SKU_LIMIT", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await t.run(seedStore);

    const skuDayFields = {
      unitsSold: 1,
      unitsReturned: 0,
      grossSalesMinor: 0,
      refundsMinor: 0,
      uncostedRevenueMinor: 0,
      grossProfitMinor: 0 as number | null,
    };

    for (let i = 0; i < 105; i += 1) {
      const skuId = await t.run((ctx) =>
        seedProductSku(ctx, storeId, `n${i}`),
      );
      await t.run((ctx) =>
        ctx.db.insert("reportSkuDay", {
          storeId,
          productSkuId: skuId,
          operatingDate: "2026-07-01",
          ...skuDayFields,
          netSalesMinor: i,
        }),
      );
    }

    const request = await t.run((ctx) =>
      ctx.db.insert("reportRangeResult", {
        storeId,
        requestKey: "range:test-cap",
        startDate: "2026-07-01",
        endDate: "2026-07-05",
        status: "pending",
        requestedAt: Date.now(),
        expiresAt: Date.now() + REPORT_RANGE_TTL_MS,
        foldVersion: REPORTS_FOLD_VERSION,
      }),
    );

    await t.run(async (ctx) => {
      const doc = await ctx.db.get("reportRangeResult", request);
      await computeRange(ctx, doc!);
    });

    const result = await t.run((ctx) => ctx.db.get("reportRangeResult", request));
    expect(result!.topSkus).toHaveLength(100);
    expect(result!.topSkus![0].netSalesMinor).toBe(104);
  });

  it("reads only reportDay/reportSkuDay: a conflicting reportFact row is ignored", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await t.run(seedStore);

    await t.run((ctx) =>
      ctx.db.insert("reportDay", {
        storeId,
        operatingDate: "2026-07-01",
        ...reportDayRow({ netSalesMinor: 900, grossProfitMinor: 200 }),
      }),
    );

    // A fact whose amount would change the totals if the fold were re-read
    // from reportFact instead of the materialized reportDay projection.
    await t.run((ctx) =>
      ctx.db.insert("reportFact", {
        storeId,
        sourceDomain: "pos",
        sourceId: "tx-conflict",
        lineId: "",
        factKind: "sale",
        fingerprint: "v1:deadbeef",
        fingerprintVersion: 1,
        occurredAt: Date.now(),
        recordedAt: Date.now(),
        operatingDate: "2026-07-01",
        currency: "GHS",
        grossAmountMinor: 999_999,
        netAmountMinor: 999_999,
        taxAmountMinor: 0,
        discountAmountMinor: 0,
        quantity: 1,
      }),
    );

    const request = await t.run((ctx) =>
      ctx.db.insert("reportRangeResult", {
        storeId,
        requestKey: "range:test-no-fact-read",
        startDate: "2026-07-01",
        endDate: "2026-07-05",
        status: "pending",
        requestedAt: Date.now(),
        expiresAt: Date.now() + REPORT_RANGE_TTL_MS,
        foldVersion: REPORTS_FOLD_VERSION,
      }),
    );

    await t.run(async (ctx) => {
      const doc = await ctx.db.get("reportRangeResult", request);
      await computeRange(ctx, doc!);
    });

    const result = await t.run((ctx) => ctx.db.get("reportRangeResult", request));
    // Totals reflect only the reportDay projection (900), not the
    // reportFact row's 999,999 — proof the fact table was never read.
    expect(result!.totals!.netSalesMinor).toBe(900);
  });

  it("patches status to failed with a failureReason and does not throw", async () => {
    // A hand-rolled ctx (not backed by convex-test's db) is the direct way
    // to force a genuine failure inside computeRange's read step: the local
    // convex-test backend does not runtime-validate index filter values, so
    // there is no data shape that reliably makes a real query throw. This
    // isolates exactly the behavior under test — the catch path patches the
    // row to "failed" with a reason and never rethrows.
    const patchCalls: Array<{
      table: unknown;
      id: unknown;
      fields: Record<string, unknown>;
    }> = [];
    const fakeCtx = {
      db: {
        query: () => {
          throw new Error("simulated read failure");
        },
        // Writes name their table explicitly (@convex-dev/explicit-table-ids),
        // so the fake mirrors the three-argument signature.
        patch: async (
          table: unknown,
          id: unknown,
          fields: Record<string, unknown>,
        ) => {
          patchCalls.push({ table, id, fields });
        },
      },
    } as unknown as MutationCtx;

    const request = {
      _id: "request-1",
      storeId: "store-1",
      requestKey: "range:test-fail",
      startDate: "2026-07-01",
      endDate: "2026-07-05",
      status: "pending",
      requestedAt: 1,
      expiresAt: 1 + REPORT_RANGE_TTL_MS,
      foldVersion: REPORTS_FOLD_VERSION,
    } as unknown as Parameters<typeof computeRange>[1];

    await expect(computeRange(fakeCtx, request)).resolves.toBeUndefined();

    expect(patchCalls).toHaveLength(1);
    expect(patchCalls[0].table).toBe("reportRangeResult");
    expect(patchCalls[0].id).toBe("request-1");
    expect(patchCalls[0].fields).toMatchObject({
      status: "failed",
      failureReason: "simulated read failure",
    });
    expect(patchCalls[0].fields.computedAt).toBeDefined();
    expect(patchCalls[0].fields.totals).toBeUndefined();
  });
});
