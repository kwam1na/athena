/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";

import schema from "../schema";
import type { Doc, Id } from "../_generated/dataModel";
import { REPORTS_FOLD_VERSION } from "../../shared/reportsContract";

/**
 * `foldDay` is a cross-slice seam (slice A) and is exercised for real by the
 * integration tests at the bottom of this file. The toggle exists for exactly
 * one thing the sweeper owns and cannot otherwise provoke: what happens when a
 * fold fails mid-sweep.
 */
const foldControl = vi.hoisted(() => ({ shouldThrow: false }));

vi.mock("./foldDay", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./foldDay")>();
  return {
    ...actual,
    foldDay: (...args: Parameters<typeof actual.foldDay>) => {
      if (foldControl.shouldThrow) throw new Error("fold exploded");
      return actual.foldDay(...args);
    },
  };
});

import {
  REPORTS_SWEEP_STORE_ALLOWLIST_ENV,
  parseStoreAllowlist,
  selectAcceptedClose,
  sweepWithCtx,
  toCloseRef,
} from "./sweeper";

const modules = import.meta.glob("../**/*.ts");

afterEach(() => {
  foldControl.shouldThrow = false;
  delete process.env[REPORTS_SWEEP_STORE_ALLOWLIST_ENV];
});

function allow(...storeIds: Id<"store">[]) {
  process.env[REPORTS_SWEEP_STORE_ALLOWLIST_ENV] = storeIds.join(",");
}

// ---------------------------------------------------------------------------
// Pure units
// ---------------------------------------------------------------------------

describe("store allowlist", () => {
  it("allows nothing when unset or empty — the gate is fail-closed", () => {
    expect(parseStoreAllowlist(undefined).size).toBe(0);
    expect(parseStoreAllowlist("").size).toBe(0);
    expect(parseStoreAllowlist("  ,  ").size).toBe(0);
  });

  it("parses a comma-separated list, tolerating whitespace", () => {
    const allowlist = parseStoreAllowlist(" store-a , store-b,store-c ");
    expect([...allowlist].sort()).toEqual(["store-a", "store-b", "store-c"]);
  });
});

describe("accepted close selection", () => {
  const close = (overrides: Partial<Doc<"dailyClose">>) =>
    ({
      _id: "close-1" as Id<"dailyClose">,
      status: "completed",
      updatedAt: 100,
      summary: {},
      ...overrides,
    }) as Doc<"dailyClose">;

  it("ignores days with no completed close", () => {
    expect(selectAcceptedClose([])).toBeNull();
    expect(selectAcceptedClose([close({ status: "open" })])).toBeNull();
  });

  it("ignores superseded closes", () => {
    expect(
      selectAcceptedClose([close({ lifecycleStatus: "superseded" })]),
    ).toBeNull();
  });

  it("prefers the most recently completed surviving close", () => {
    const chosen = selectAcceptedClose([
      close({ _id: "old" as Id<"dailyClose">, completedAt: 100 }),
      close({ _id: "new" as Id<"dailyClose">, completedAt: 200 }),
      close({
        _id: "dead" as Id<"dailyClose">,
        completedAt: 300,
        lifecycleStatus: "superseded",
      }),
    ]);
    expect(chosen?._id).toBe("new");
  });

  it("reads close net sales as adjusted-then-raw sales total", () => {
    expect(
      toCloseRef(
        close({ summary: { salesTotal: 900, adjustedSalesTotal: 850 } }),
      ).closeNetSalesMinor,
    ).toBe(850);
    expect(
      toCloseRef(close({ summary: { salesTotal: 900 } })).closeNetSalesMinor,
    ).toBe(900);
    expect(toCloseRef(close({ summary: {} })).closeNetSalesMinor).toBe(0);
  });

  it("takes the acceptance instant from completedAt, falling back to updatedAt", () => {
    expect(toCloseRef(close({ completedAt: 555 })).acceptedAt).toBe(555);
    expect(toCloseRef(close({ updatedAt: 42 })).acceptedAt).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type Harness = ReturnType<typeof convexTest>;

async function seedStore(t: Harness, slug: string) {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("athenaUser", {
      email: `${slug}@example.test`,
    });
    const organizationId = await ctx.db.insert("organization", {
      createdByUserId: userId,
      name: slug,
      slug,
    });
    const storeId = await ctx.db.insert("store", {
      createdByUserId: userId,
      currency: "GHS",
      name: slug,
      organizationId,
      slug,
    });
    const categoryId = await ctx.db.insert("category", {
      name: "Wigs",
      slug: `${slug}-wigs`,
      storeId,
    });
    const subcategoryId = await ctx.db.insert("subcategory", {
      categoryId,
      name: "Lace",
      slug: `${slug}-lace`,
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
      slug: `${slug}-wig`,
      storeId,
      subcategoryId,
    });
    const productSkuId = await ctx.db.insert("productSku", {
      images: [],
      inventoryCount: 10,
      price: 100,
      productId,
      quantityAvailable: 10,
      sku: `${slug}-SKU`,
      storeId,
    });

    return { organizationId, productSkuId, storeId, userId };
  });
}

async function insertSaleFact(
  t: Harness,
  args: {
    storeId: Id<"store">;
    productSkuId?: Id<"productSku">;
    operatingDate: string;
    sourceId: string;
    netAmountMinor: number;
    quantity: number;
    unitCostMinor?: number;
    recordedAt?: number;
  },
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("reportFact", {
      storeId: args.storeId,
      sourceDomain: "pos",
      sourceId: args.sourceId,
      lineId: "1",
      factKind: "sale",
      fingerprint: `fp-${args.sourceId}`,
      fingerprintVersion: 1,
      occurredAt: 1_000,
      recordedAt: args.recordedAt ?? 1_000,
      operatingDate: args.operatingDate,
      currency: "GHS",
      grossAmountMinor: args.netAmountMinor,
      netAmountMinor: args.netAmountMinor,
      taxAmountMinor: 0,
      discountAmountMinor: 0,
      quantity: args.quantity,
      ...(args.productSkuId ? { productSkuId: args.productSkuId } : {}),
      ...(args.unitCostMinor !== undefined
        ? { unitCostMinor: args.unitCostMinor }
        : {}),
    });
  });
}

async function mark(
  t: Harness,
  storeId: Id<"store">,
  operatingDate: string,
  reason: Doc<"reportDirtyDay">["reason"] = "late_fact",
  markedAt = 1_000,
) {
  return t.run(async (ctx) =>
    ctx.db.insert("reportDirtyDay", {
      storeId,
      operatingDate,
      reason,
      markedAt,
    }),
  );
}

const sweep = (t: Harness) => t.run(async (ctx) => sweepWithCtx(ctx));

const marksOf = (t: Harness) =>
  t.run(async (ctx) => ctx.db.query("reportDirtyDay").collect());

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

describe("dirty-mark lifecycle", () => {
  it("folds a marked day, clears the mark, and materializes day/sku/rollup/overview docs", async () => {
    const t = convexTest(schema, modules);
    const { storeId, productSkuId } = await seedStore(t, "sweep-basic");
    allow(storeId);

    await insertSaleFact(t, {
      storeId,
      productSkuId,
      operatingDate: "2026-07-28",
      sourceId: "txn-1",
      netAmountMinor: 1_500,
      quantity: 3,
      unitCostMinor: 200,
    });
    await mark(t, storeId, "2026-07-28");

    const result = await sweep(t);
    expect(result.daysFolded).toBe(1);
    expect(result.foldFailures).toBe(0);

    // The mark is gone: no reportDay was `open`, so nothing is re-marked.
    expect(await marksOf(t)).toHaveLength(0);

    const { days, skuDays, rollups, overviews } = await t.run(async (ctx) => ({
      days: await ctx.db.query("reportDay").collect(),
      skuDays: await ctx.db.query("reportSkuDay").collect(),
      rollups: await ctx.db.query("reportPeriodSkuRollup").collect(),
      overviews: await ctx.db.query("reportOverview").collect(),
    }));

    expect(days).toHaveLength(1);
    expect(days[0].netSalesMinor).toBe(1_500);
    expect(days[0].unitsSold).toBe(3);
    expect(days[0].status).toBe("provisional");
    expect(days[0].foldVersion).toBe(REPORTS_FOLD_VERSION);
    expect(days[0].foldedAt).toBeGreaterThan(0);
    expect(days[0].factCount).toBe(1);

    expect(skuDays).toHaveLength(1);
    expect(skuDays[0].netSalesMinor).toBe(1_500);

    expect(rollups.map((row) => row.periodKey).sort()).toEqual([
      "d:2026-07-28",
      "m:2026-07",
      "w:2026-W31",
    ]);

    expect(overviews).toHaveLength(1);
    expect(overviews[0].today.netSalesMinor).toBe(1_500);
    expect(overviews[0].dailyTrend).toEqual([
      { operatingDate: "2026-07-28", netSalesMinor: 1_500, status: "provisional" },
    ]);
  });

  it("is idempotent: sweeping the same day twice yields the same rollups and one day doc", async () => {
    const t = convexTest(schema, modules);
    const { storeId, productSkuId } = await seedStore(t, "sweep-idempotent");
    allow(storeId);

    await insertSaleFact(t, {
      storeId,
      productSkuId,
      operatingDate: "2026-07-28",
      sourceId: "txn-1",
      netAmountMinor: 1_000,
      quantity: 2,
    });

    await mark(t, storeId, "2026-07-28");
    await sweep(t);
    const first = await t.run(async (ctx) => ({
      days: await ctx.db.query("reportDay").collect(),
      skuDays: await ctx.db.query("reportSkuDay").collect(),
      rollups: await ctx.db.query("reportPeriodSkuRollup").collect(),
    }));

    await mark(t, storeId, "2026-07-28", "late_fact", 2_000);
    await sweep(t);
    const second = await t.run(async (ctx) => ({
      days: await ctx.db.query("reportDay").collect(),
      skuDays: await ctx.db.query("reportSkuDay").collect(),
      rollups: await ctx.db.query("reportPeriodSkuRollup").collect(),
    }));

    expect(second.days).toHaveLength(1);
    expect(second.days[0]._id).toBe(first.days[0]._id);
    expect(second.days[0].netSalesMinor).toBe(first.days[0].netSalesMinor);
    // Rollups are re-aggregated in place — same docs, same numbers.
    expect(second.rollups.map((row) => row._id).sort()).toEqual(
      first.rollups.map((row) => row._id).sort(),
    );
    expect(
      second.rollups.map((row) => [row.periodKey, row.netSalesMinor]).sort(),
    ).toEqual(first.rollups.map((row) => [row.periodKey, row.netSalesMinor]).sort());
    expect(second.skuDays).toHaveLength(1);
  });

  it("drops sku-day rows for SKUs that lost all activity on the day", async () => {
    const t = convexTest(schema, modules);
    const { storeId, productSkuId } = await seedStore(t, "sweep-stale-sku");
    allow(storeId);

    // A stale row from an earlier fold of the same day.
    await t.run(async (ctx) => {
      await ctx.db.insert("reportSkuDay", {
        storeId,
        productSkuId,
        operatingDate: "2026-07-28",
        unitsSold: 99,
        unitsReturned: 0,
        grossSalesMinor: 9_900,
        netSalesMinor: 9_900,
        refundsMinor: 0,
        uncostedRevenueMinor: 0,
        grossProfitMinor: 0,
      });
    });

    // The day now folds to nothing SKU-attributed.
    await mark(t, storeId, "2026-07-28");
    await sweep(t);

    const skuDays = await t.run(async (ctx) =>
      ctx.db.query("reportSkuDay").collect(),
    );
    expect(skuDays).toHaveLength(0);
  });

  it("folds a day_open mark keeping the day open, and does not re-mark it", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t, "sweep-open-day");
    allow(storeId);

    await t.run(async (ctx) => {
      await ctx.db.insert("reportDay", {
        storeId,
        operatingDate: "2026-07-28",
        currency: "GHS",
        status: "open",
        grossSalesMinor: 0,
        netSalesMinor: 0,
        refundsMinor: 0,
        unitsSold: 0,
        unitsReturned: 0,
        uncostedRevenueMinor: 0,
        grossProfitMinor: 0,
        paymentsCollectedMinor: 0,
        paymentsRefundedMinor: 0,
        paymentAllocatedMinor: 0,
        foldVersion: REPORTS_FOLD_VERSION,
        factCount: 0,
        lastFactRecordedAt: 0,
        flags: {
          mixedCurrency: false,
          hasUncostedRevenue: false,
          quarantinedFactCount: 0,
        },
      });
    });
    await mark(t, storeId, "2026-07-28", "day_open");

    await sweep(t);

    // The mark is consumed and NOT re-created by the sweeper — ingestion
    // re-marks day_open with every current-day fact, so a quiet day stops
    // being refolded instead of looping one fold per tick.
    const marks = await marksOf(t);
    expect(marks).toHaveLength(0);

    // The fold ran (foldedAt stamped) but the day is still `open`: only a
    // close (reconciled/amended) or rollover moves it out of `open`.
    const day = await t.run(async (ctx) =>
      ctx.db
        .query("reportDay")
        .withIndex("by_storeId_operatingDate", (q) =>
          q.eq("storeId", storeId).eq("operatingDate", "2026-07-28"),
        )
        .unique(),
    );
    expect(day?.status).toBe("open");
    expect(day?.foldedAt).toBeDefined();
  });

  it("re-queues a day whose fold failed, under write_failure, and heals next tick", async () => {
    const t = convexTest(schema, modules);
    const { storeId, productSkuId } = await seedStore(t, "sweep-failure");
    allow(storeId);

    await insertSaleFact(t, {
      storeId,
      productSkuId,
      operatingDate: "2026-07-28",
      sourceId: "txn-1",
      netAmountMinor: 700,
      quantity: 1,
    });
    await mark(t, storeId, "2026-07-28");

    foldControl.shouldThrow = true;
    const failed = await sweep(t);
    expect(failed.foldFailures).toBe(1);
    expect(failed.daysFolded).toBe(0);

    const requeued = await marksOf(t);
    expect(requeued).toHaveLength(1);
    expect(requeued[0].reason).toBe("write_failure");
    expect(await t.run(async (ctx) => ctx.db.query("reportDay").collect())).toHaveLength(
      0,
    );

    foldControl.shouldThrow = false;
    const healed = await sweep(t);
    expect(healed.daysFolded).toBe(1);
    expect(await marksOf(t)).toHaveLength(0);
    const days = await t.run(async (ctx) => ctx.db.query("reportDay").collect());
    expect(days[0].netSalesMinor).toBe(700);
  });

  it("processes marks oldest-first and leaves the overflow for the next tick", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t, "sweep-batch");
    allow(storeId);

    for (let index = 0; index < 12; index += 1) {
      const date = `2026-07-${String(index + 1).padStart(2, "0")}`;
      await mark(t, storeId, date, "late_fact", 1_000 + index);
    }

    const result = await sweep(t);
    expect(result.daysFolded).toBe(10);

    const leftovers = await marksOf(t);
    expect(leftovers.map((row) => row.operatingDate).sort()).toEqual([
      "2026-07-11",
      "2026-07-12",
    ]);
  });
});

describe("allowlist gating", () => {
  it("leaves a non-allowlisted store's mark untouched and folds nothing for it", async () => {
    const t = convexTest(schema, modules);
    const allowed = await seedStore(t, "allowed-store");
    const blocked = await seedStore(t, "blocked-store");
    allow(allowed.storeId);

    await insertSaleFact(t, {
      storeId: blocked.storeId,
      productSkuId: blocked.productSkuId,
      operatingDate: "2026-07-28",
      sourceId: "txn-b",
      netAmountMinor: 999,
      quantity: 1,
    });
    const blockedMarkId = await mark(
      t,
      blocked.storeId,
      "2026-07-28",
      "late_fact",
      500,
    );
    await mark(t, allowed.storeId, "2026-07-28", "late_fact", 900);

    const result = await sweep(t);
    expect(result.skippedNotAllowed).toBe(1);
    expect(result.daysFolded).toBe(1);

    const marks = await marksOf(t);
    expect(marks).toHaveLength(1);
    expect(marks[0]._id).toBe(blockedMarkId);
    expect(marks[0].reason).toBe("late_fact");
    expect(marks[0].markedAt).toBe(500);

    const days = await t.run(async (ctx) => ctx.db.query("reportDay").collect());
    expect(days).toHaveLength(1);
    expect(days[0].storeId).toBe(allowed.storeId);
  });

  it("folds nothing at all when the allowlist is unset", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t, "no-allowlist");
    await mark(t, storeId, "2026-07-28");

    const result = await sweep(t);
    expect(result.daysFolded).toBe(0);
    expect(result.skippedNotAllowed).toBe(1);
    expect(await marksOf(t)).toHaveLength(1);
  });
});

describe("range results", () => {
  it("deletes results past their expiry", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t, "range-expiry");
    allow(storeId);

    await t.run(async (ctx) => {
      for (const [requestKey, expiresAt] of [
        ["expired", Date.now() - 1_000],
        ["live", Date.now() + 60_000],
      ] as const) {
        await ctx.db.insert("reportRangeResult", {
          storeId,
          requestKey,
          startDate: "2026-07-01",
          endDate: "2026-07-28",
          status: "completed",
          requestedAt: 0,
          expiresAt,
          foldVersion: REPORTS_FOLD_VERSION,
        });
      }
    });

    const result = await sweep(t);
    expect(result.rangesExpired).toBe(1);

    const remaining = await t.run(async (ctx) =>
      ctx.db.query("reportRangeResult").collect(),
    );
    expect(remaining.map((row) => row.requestKey)).toEqual(["live"]);
  });

  it("picks up a pending range for a touched, allowlisted store", async () => {
    const t = convexTest(schema, modules);
    const { storeId, productSkuId } = await seedStore(t, "range-pickup");
    allow(storeId);

    await insertSaleFact(t, {
      storeId,
      productSkuId,
      operatingDate: "2026-07-28",
      sourceId: "txn-1",
      netAmountMinor: 2_500,
      quantity: 5,
    });
    await mark(t, storeId, "2026-07-28");
    await t.run(async (ctx) => {
      await ctx.db.insert("reportRangeResult", {
        storeId,
        requestKey: "range-1",
        startDate: "2026-07-01",
        endDate: "2026-07-31",
        status: "pending",
        requestedAt: 0,
        expiresAt: Date.now() + 60_000,
        foldVersion: REPORTS_FOLD_VERSION,
      });
    });

    const result = await sweep(t);
    expect(result.rangesComputed).toBe(1);

    const stored = await t.run(async (ctx) =>
      ctx.db.query("reportRangeResult").collect(),
    );
    expect(stored[0].status).toBe("completed");
    // Computed from the day docs the sweep just folded, not from raw facts.
    expect(stored[0].totals?.netSalesMinor).toBe(2_500);
    expect(stored[0].totals?.dayCount).toBe(1);
    expect(stored[0].topSkus?.[0]?.productSkuId).toBe(productSkuId);
  });
});

// ---------------------------------------------------------------------------
// Integration with the real fold (slice A seam)
// ---------------------------------------------------------------------------

describe("fold integration", () => {
  it("reconciles a day against its accepted daily close", async () => {
    const t = convexTest(schema, modules);
    const { organizationId, productSkuId, storeId } = await seedStore(
      t,
      "fold-close",
    );
    allow(storeId);

    await insertSaleFact(t, {
      storeId,
      productSkuId,
      operatingDate: "2026-07-28",
      sourceId: "txn-1",
      netAmountMinor: 1_000,
      quantity: 2,
      recordedAt: 1_000,
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("dailyClose", {
        storeId,
        organizationId,
        operatingDate: "2026-07-28",
        status: "completed",
        isCurrent: true,
        readiness: {
          status: "ready",
          blockerCount: 0,
          reviewCount: 0,
          carryForwardCount: 0,
          readyCount: 0,
        },
        summary: { salesTotal: 900 },
        sourceSubjects: [],
        carryForwardWorkItemIds: [],
        createdAt: 1,
        updatedAt: 2_000,
        completedAt: 2_000,
      });
    });

    await mark(t, storeId, "2026-07-28", "close_accepted");
    await sweep(t);

    const days = await t.run(async (ctx) => ctx.db.query("reportDay").collect());
    expect(days[0].status).toBe("reconciled");
    expect(days[0].closeVarianceMinor).toBe(100); // 1000 folded vs 900 closed
    expect(days[0].closeAcceptedAt).toBe(2_000);
    expect(days[0].closeId).toBeDefined();
  });

  it("marks a day amended when a fact lands after the close was accepted", async () => {
    const t = convexTest(schema, modules);
    const { organizationId, productSkuId, storeId } = await seedStore(
      t,
      "fold-amended",
    );
    allow(storeId);

    await insertSaleFact(t, {
      storeId,
      productSkuId,
      operatingDate: "2026-07-28",
      sourceId: "txn-1",
      netAmountMinor: 1_000,
      quantity: 2,
      recordedAt: 1_000,
    });
    // Offline POS sale that only synced after the close.
    await insertSaleFact(t, {
      storeId,
      productSkuId,
      operatingDate: "2026-07-28",
      sourceId: "txn-2",
      netAmountMinor: 250,
      quantity: 1,
      recordedAt: 5_000,
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("dailyClose", {
        storeId,
        organizationId,
        operatingDate: "2026-07-28",
        status: "completed",
        isCurrent: true,
        readiness: {
          status: "ready",
          blockerCount: 0,
          reviewCount: 0,
          carryForwardCount: 0,
          readyCount: 0,
        },
        summary: { salesTotal: 1_000 },
        sourceSubjects: [],
        carryForwardWorkItemIds: [],
        createdAt: 1,
        updatedAt: 2_000,
        completedAt: 2_000,
      });
    });

    await mark(t, storeId, "2026-07-28", "late_fact");
    await sweep(t);

    const days = await t.run(async (ctx) => ctx.db.query("reportDay").collect());
    expect(days[0].status).toBe("amended");
    expect(days[0].postCloseNetSalesDeltaMinor).toBe(250);
    expect(days[0].netSalesMinor).toBe(1_250);
    expect(days[0].closeVarianceMinor).toBe(250);
  });

  it("ignores a superseded close rather than reconciling against it", async () => {
    const t = convexTest(schema, modules);
    const { organizationId, productSkuId, storeId } = await seedStore(
      t,
      "fold-superseded",
    );
    allow(storeId);

    await insertSaleFact(t, {
      storeId,
      productSkuId,
      operatingDate: "2026-07-28",
      sourceId: "txn-1",
      netAmountMinor: 1_000,
      quantity: 2,
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("dailyClose", {
        storeId,
        organizationId,
        operatingDate: "2026-07-28",
        status: "completed",
        lifecycleStatus: "superseded",
        isCurrent: false,
        readiness: {
          status: "ready",
          blockerCount: 0,
          reviewCount: 0,
          carryForwardCount: 0,
          readyCount: 0,
        },
        summary: { salesTotal: 10 },
        sourceSubjects: [],
        carryForwardWorkItemIds: [],
        createdAt: 1,
        updatedAt: 2,
        completedAt: 2,
      });
    });

    await mark(t, storeId, "2026-07-28");
    await sweep(t);

    const days = await t.run(async (ctx) => ctx.db.query("reportDay").collect());
    expect(days[0].status).toBe("provisional");
    expect(days[0].closeId).toBeUndefined();
    expect(days[0].closeVarianceMinor).toBeUndefined();
  });
});
