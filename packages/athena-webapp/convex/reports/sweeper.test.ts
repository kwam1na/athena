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

/**
 * The weekly lane's own seam: a materialization failure must be contained,
 * counted, and re-marked without touching the completed Daily Close.
 */
const weeklyControl = vi.hoisted(() => ({ shouldThrow: false }));

vi.mock("./weekly", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./weekly")>();
  return {
    ...actual,
    rebuildCurrentWeek: (...args: Parameters<typeof actual.rebuildCurrentWeek>) => {
      if (weeklyControl.shouldThrow) throw new Error("weekly rebuild exploded");
      return actual.rebuildCurrentWeek(...args);
    },
  };
});

import {
  countUncertifiedDaysWithCtx,
  markStaleFoldVersionDaysWithCtx,
} from "./foldVersionRepair";
import {
  MAX_FACTS_PER_DAY,
  REPORTS_SWEEP_STORE_ALLOWLIST_ENV,
  WEEKLY_DIRTY_BATCH,
  parseStoreAllowlist,
  selectAcceptedClose,
  sweepWithCtx,
  toCloseRef,
} from "./sweeper";

const WEEKLY_NOW = Date.parse("2026-07-04T12:00:00.000Z");

const modules = import.meta.glob("../**/*.ts");

afterEach(() => {
  foldControl.shouldThrow = false;
  weeklyControl.shouldThrow = false;
  delete process.env[REPORTS_SWEEP_STORE_ALLOWLIST_ENV];
  vi.restoreAllMocks();
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
      weeklyObservedAtVerification: {
        status: "complete",
        missingCount: 0,
        startedAt: WEEKLY_NOW,
        completedAt: WEEKLY_NOW,
      },
    });
    await ctx.db.insert("storeSchedule", {
      organizationId,
      storeId,
      timezone: "UTC",
      weeklyWindows: [],
      weeklyClosedDays: [0],
      dateExceptions: [],
      reportingCycleStartsOn: 1,
      effectiveFrom: Date.parse("2026-01-01T00:00:00.000Z"),
      status: "active",
      source: "admin",
      createdAt: WEEKLY_NOW,
      updatedAt: WEEKLY_NOW,
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
    observedAt?: number;
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
      ...(args.observedAt !== undefined ? { observedAt: args.observedAt } : {}),
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
  // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
  t.run(async (ctx) => ctx.db.query("reportDirtyDay").collect());

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

describe("dirty-mark lifecycle", () => {
  it("drains the bounded weekly marker through the existing sweeper", async () => {
    vi.spyOn(Date, "now").mockReturnValue(WEEKLY_NOW);
    const t = convexTest(schema, modules);
    const { storeId } = await seedStore(t, "sweep-weekly");
    allow(storeId);
    await mark(t, storeId, "2026-07-04");

    const result = await sweep(t);
    expect(result.weeksRebuilt).toBe(1);
    await t.run(async (ctx) => {
      const week = await ctx.db
        .query("reportWeekCurrent")
        .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
        .unique();
      expect(week).toMatchObject({
        cycleStartDate: "2026-06-29",
        cycleEndDate: "2026-07-05",
      });
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- fixture inspection
      expect(await ctx.db.query("reportDirtyWeek").collect()).toHaveLength(0);
    });
  });

  it("derives one accepted week only after the final scheduled close day folds", async () => {
    vi.spyOn(Date, "now").mockReturnValue(WEEKLY_NOW);
    const t = convexTest(schema, modules);
    const { organizationId, storeId } = await seedStore(
      t,
      "sweep-weekly-accept",
    );
    allow(storeId);
    await t.run(async (ctx) => {
      await ctx.db.insert("dailyClose", {
        storeId,
        organizationId,
        operatingDate: "2026-07-03",
        status: "completed",
        lifecycleStatus: "active",
        isCurrent: false,
        readiness: {
          status: "ready",
          blockerCount: 0,
          reviewCount: 0,
          carryForwardCount: 0,
          readyCount: 0,
        },
        summary: { salesTotal: 100 },
        sourceSubjects: [],
        carryForwardWorkItemIds: [],
        createdAt: WEEKLY_NOW - 2,
        updatedAt: WEEKLY_NOW - 2,
        completedAt: WEEKLY_NOW - 2,
      });
    });
    await insertSaleFact(t, {
      storeId,
      operatingDate: "2026-07-03",
      sourceId: "non-final-sale",
      netAmountMinor: 100,
      observedAt: WEEKLY_NOW - 3,
      quantity: 1,
    });
    await mark(t, storeId, "2026-07-03", "close_accepted");
    await sweep(t);
    expect(
      await t.run(async (ctx) =>
        ctx.db
          .query("reportWeekAccepted")
          .withIndex("by_storeId_acceptedAt", (q) => q.eq("storeId", storeId))
          .take(2),
      ),
    ).toHaveLength(0);

    await t.run(async (ctx) => {
      await ctx.db.insert("dailyClose", {
        storeId,
        organizationId,
        operatingDate: "2026-07-04",
        status: "completed",
        lifecycleStatus: "active",
        isCurrent: true,
        readiness: {
          status: "ready",
          blockerCount: 0,
          reviewCount: 0,
          carryForwardCount: 0,
          readyCount: 0,
        },
        summary: { salesTotal: 100 },
        sourceSubjects: [],
        carryForwardWorkItemIds: [],
        createdAt: WEEKLY_NOW,
        updatedAt: WEEKLY_NOW,
        completedAt: WEEKLY_NOW,
      });
    });
    await insertSaleFact(t, {
      storeId,
      operatingDate: "2026-07-04",
      sourceId: "final-sale",
      netAmountMinor: 100,
      observedAt: WEEKLY_NOW,
      quantity: 1,
    });
    await mark(t, storeId, "2026-07-04", "close_accepted");

    const first = await sweep(t);
    const second = await sweep(t);
    expect(first.weeksAccepted).toBe(1);
    expect(second.weeksAccepted).toBe(0);
    expect(
      await t.run(async (ctx) =>
        ctx.db
          .query("reportWeekAccepted")
          .withIndex("by_storeId_acceptedAt", (q) => q.eq("storeId", storeId))
          .take(2),
      ),
    ).toHaveLength(1);
  });

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
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      days: await ctx.db.query("reportDay").collect(),
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      skuDays: await ctx.db.query("reportSkuDay").collect(),
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      rollups: await ctx.db.query("reportPeriodSkuRollup").collect(),
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
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
      {
        operatingDate: "2026-07-28",
        netSalesMinor: 1_500,
        status: "provisional",
        unitsSold: 3,
      },
    ]);
  });

  it("folds facts for a store whose configured currency is lowercase", async () => {
    // Regression: wigclub's dev store carries currency "ghs" while emitters
    // normalize fact currency to "GHS". The sweeper must normalize the store
    // side too, or every fact is excluded as foreign currency and every day
    // folds to zeros with mixedCurrency set (found by verify on dev).
    const t = convexTest(schema, modules);
    const { storeId, productSkuId } = await seedStore(t, "sweep-lowercase");
    await t.run(async (ctx) => {
      await ctx.db.patch("store", storeId, { currency: " ghs " });
    });
    allow(storeId);

    await insertSaleFact(t, {
      storeId,
      productSkuId,
      operatingDate: "2026-07-28",
      sourceId: "txn-lc",
      netAmountMinor: 2_000,
      quantity: 2,
      unitCostMinor: 100,
    });
    await mark(t, storeId, "2026-07-28");

    await sweep(t);

    const day = await t.run(async (ctx) => ctx.db.query("reportDay").unique());
    expect(day?.netSalesMinor).toBe(2_000);
    expect(day?.unitsSold).toBe(2);
    expect(day?.flags.mixedCurrency).toBe(false);
    expect(day?.currency).toBe("GHS");
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
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      days: await ctx.db.query("reportDay").collect(),
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      skuDays: await ctx.db.query("reportSkuDay").collect(),
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      rollups: await ctx.db.query("reportPeriodSkuRollup").collect(),
    }));

    await mark(t, storeId, "2026-07-28", "late_fact", 2_000);
    await sweep(t);
    const second = await t.run(async (ctx) => ({
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      days: await ctx.db.query("reportDay").collect(),
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      skuDays: await ctx.db.query("reportSkuDay").collect(),
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
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
    ).toEqual(
      first.rollups.map((row) => [row.periodKey, row.netSalesMinor]).sort(),
    );
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
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      ctx.db.query("reportSkuDay").collect(),
    );
    expect(skuDays).toHaveLength(0);
    // The published count follows the rows down to zero. A day that shed its
    // last SKU row must not keep advertising the old size — the mix probe
    // would then route a range it cannot actually size.
    const day = await t.run(async (ctx) =>
      ctx.db
        .query("reportDay")
        .withIndex("by_storeId_operatingDate", (q) =>
          q.eq("storeId", storeId).eq("operatingDate", "2026-07-28"),
        )
        .unique(),
    );
    expect(day?.skuDayRowCount).toBe(0);
  });

  it("publishes a sku row count equal to the rows the same fold wrote", async () => {
    // The probe's whole basis: this number and those rows come out of one
    // mutation, so they cannot drift. Asserted against the actual row count
    // rather than a literal, so a fold that writes a different number of rows
    // fails here instead of silently mis-sizing every mix read.
    const t = convexTest(schema, modules);
    const { storeId, productSkuId } = await seedStore(t, "sweep-row-count");
    allow(storeId);

    await insertSaleFact(t, {
      storeId,
      productSkuId,
      operatingDate: "2026-07-28",
      sourceId: "row-count-1",
      netAmountMinor: 2_500,
      quantity: 2,
    });
    await mark(t, storeId, "2026-07-28");
    await sweep(t);

    const { day, skuDays } = await t.run(async (ctx) => ({
      day: await ctx.db
        .query("reportDay")
        .withIndex("by_storeId_operatingDate", (q) =>
          q.eq("storeId", storeId).eq("operatingDate", "2026-07-28"),
        )
        .unique(),
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      skuDays: await ctx.db.query("reportSkuDay").collect(),
    }));

    expect(skuDays.length).toBeGreaterThan(0);
    expect(day?.skuDayRowCount).toBe(skuDays.length);
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
    expect(
      await t.run(async (ctx) => ctx.db.query("reportDay").take(2)),
    ).toHaveLength(0);

    foldControl.shouldThrow = false;
    const healed = await sweep(t);
    expect(healed.daysFolded).toBe(1);
    expect(await marksOf(t)).toHaveLength(0);
    const days = await t.run(async (ctx) => ctx.db.query("reportDay").take(2));
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
      // July 4 is the final scheduled date and remains reachable until its
      // temporarily missing close can establish the accepted baseline.
      "2026-07-04",
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

    const days = await t.run(async (ctx) => ctx.db.query("reportDay").take(2));
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
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
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
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
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

    const days = await t.run(async (ctx) => ctx.db.query("reportDay").take(2));
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

    const days = await t.run(async (ctx) => ctx.db.query("reportDay").take(2));
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

    const days = await t.run(async (ctx) => ctx.db.query("reportDay").take(2));
    expect(days[0].status).toBe("provisional");
    expect(days[0].closeId).toBeUndefined();
    expect(days[0].closeVarianceMinor).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Read caps
// ---------------------------------------------------------------------------

describe("fold read caps", () => {
  it("refuses a day past the fact cap instead of folding a truncated total", async () => {
    const t = convexTest(schema, modules);
    const { storeId, productSkuId } = await seedStore(t, "sweep-cap");
    allow(storeId);

    // One past the cap. Each fact is worth 100, so a truncated fold would
    // still produce a large, plausible-looking number — which is exactly why
    // silence here is dangerous.
    const factCount = MAX_FACTS_PER_DAY + 1;
    await t.run(async (ctx) => {
      for (let i = 0; i < factCount; i += 1) {
        await ctx.db.insert("reportFact", {
          storeId,
          sourceDomain: "pos",
          sourceId: `txn-${i}`,
          lineId: "1",
          factKind: "sale",
          fingerprint: `fp-${i}`,
          fingerprintVersion: 1,
          occurredAt: 1_000,
          recordedAt: 1_000,
          operatingDate: "2026-07-28",
          currency: "GHS",
          grossAmountMinor: 100,
          netAmountMinor: 100,
          taxAmountMinor: 0,
          discountAmountMinor: 0,
          quantity: 1,
          productSkuId,
        });
      }
    });
    await mark(t, storeId, "2026-07-28");

    const result = await sweep(t);

    // Counted apart from a transient failure: this is a structural limit.
    expect(result.capExceeded).toBe(1);
    expect(result.foldFailures).toBe(0);
    expect(result.daysFolded).toBe(0);

    // Nothing written — no day document, no per-SKU rows. A wrong number is
    // worse than an absent one, because it cannot be told apart from a real one.
    const { days, skuDays } = await t.run(async (ctx) => ({
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      days: await ctx.db.query("reportDay").collect(),
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      skuDays: await ctx.db.query("reportSkuDay").collect(),
    }));
    expect(days).toHaveLength(0);
    expect(skuDays).toHaveLength(0);

    // The refusal stays on the queue under its own reason, so it is visible
    // and so raising the cap heals it on a later sweep.
    const marks = await marksOf(t);
    expect(marks).toHaveLength(1);
    expect(marks[0].reason).toBe("fact_cap_exceeded");
  });

  it("folds a day sitting exactly on the cap", async () => {
    const t = convexTest(schema, modules);
    const { storeId, productSkuId } = await seedStore(t, "sweep-at-cap");
    allow(storeId);

    // Exactly at the cap must still fold: the guard reads cap+1 precisely so a
    // full page is not mistaken for a truncated one.
    await t.run(async (ctx) => {
      for (let i = 0; i < MAX_FACTS_PER_DAY; i += 1) {
        await ctx.db.insert("reportFact", {
          storeId,
          sourceDomain: "pos",
          sourceId: `txn-${i}`,
          lineId: "1",
          factKind: "sale",
          fingerprint: `fp-${i}`,
          fingerprintVersion: 1,
          occurredAt: 1_000,
          recordedAt: 1_000,
          operatingDate: "2026-07-28",
          currency: "GHS",
          grossAmountMinor: 100,
          netAmountMinor: 100,
          taxAmountMinor: 0,
          discountAmountMinor: 0,
          quantity: 1,
          productSkuId,
        });
      }
    });
    await mark(t, storeId, "2026-07-28");

    const result = await sweep(t);

    expect(result.capExceeded).toBe(0);
    expect(result.daysFolded).toBe(1);

    const day = await t.run(async (ctx) => ctx.db.query("reportDay").unique());
    expect(day?.netSalesMinor).toBe(MAX_FACTS_PER_DAY * 100);
    expect(day?.factCount).toBe(MAX_FACTS_PER_DAY);
  });
});

// ---------------------------------------------------------------------------
// Weekly lane containment and handoff
// ---------------------------------------------------------------------------

async function insertWeeklyCloseFixture(
  t: Harness,
  args: {
    completedAt?: number;
    operatingDate: string;
    organizationId: Id<"organization">;
    storeId: Id<"store">;
  },
) {
  return t.run(async (ctx) =>
    ctx.db.insert("dailyClose", {
      storeId: args.storeId,
      organizationId: args.organizationId,
      operatingDate: args.operatingDate,
      status: "completed",
      lifecycleStatus: "active",
      isCurrent: true,
      readiness: {
        status: "ready",
        blockerCount: 0,
        reviewCount: 0,
        carryForwardCount: 0,
        readyCount: 0,
      },
      summary: { salesTotal: 100 },
      sourceSubjects: [],
      carryForwardWorkItemIds: [],
      createdAt: args.completedAt ?? WEEKLY_NOW,
      updatedAt: args.completedAt ?? WEEKLY_NOW,
      completedAt: args.completedAt ?? WEEKLY_NOW,
    }),
  );
}

describe("certified fold revisions", () => {
  it("stamps matching revisions on the day and all its SKU rows, and a refold advances them together", async () => {
    const t = convexTest(schema, modules);
    const { storeId, productSkuId } = await seedStore(t, "sweep-revision");
    allow(storeId);

    // A second SKU so "all rows" means more than one.
    const secondSkuId = await t.run(async (ctx) => {
      const sku = await ctx.db.get("productSku", productSkuId);
      return ctx.db.insert("productSku", {
        images: [],
        inventoryCount: 5,
        price: 50,
        productId: sku!.productId,
        quantityAvailable: 5,
        sku: "sweep-revision-SKU-2",
        storeId,
      });
    });

    await insertSaleFact(t, {
      storeId,
      productSkuId,
      operatingDate: "2026-07-28",
      sourceId: "txn-rev-1",
      netAmountMinor: 1_000,
      quantity: 2,
    });
    await insertSaleFact(t, {
      storeId,
      productSkuId: secondSkuId,
      operatingDate: "2026-07-28",
      sourceId: "txn-rev-2",
      netAmountMinor: 500,
      quantity: 1,
    });

    await mark(t, storeId, "2026-07-28");
    await sweep(t);

    const readDocs = () =>
      t.run(async (ctx) => ({
        day: await ctx.db.query("reportDay").unique(),
        // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
        skuDays: await ctx.db.query("reportSkuDay").collect(),
      }));

    const first = await readDocs();
    expect(first.day?.foldVersion).toBe(REPORTS_FOLD_VERSION);
    expect(typeof first.day?.certifiedFoldRevision).toBe("number");
    expect(first.skuDays).toHaveLength(2);
    for (const row of first.skuDays) {
      expect(row.certifiedFoldRevision).toBe(first.day?.certifiedFoldRevision);
    }

    // Refold the same day: the revision advances on the day AND every SKU row.
    await mark(t, storeId, "2026-07-28", "late_fact", 2_000);
    await sweep(t);

    const second = await readDocs();
    expect(second.day?._id).toBe(first.day?._id);
    expect(second.day?.certifiedFoldRevision).toBe(
      first.day!.certifiedFoldRevision! + 1,
    );
    for (const row of second.skuDays) {
      expect(row.certifiedFoldRevision).toBe(second.day?.certifiedFoldRevision);
    }
  });

  it("backfills a mixed-generation store through repair + sweep until coverage reports complete", async () => {
    const t = convexTest(schema, modules);
    const { storeId, productSkuId } = await seedStore(t, "sweep-backfill");
    allow(storeId);

    // Two folded, certified days...
    for (const [operatingDate, sourceId] of [
      ["2026-07-27", "txn-bf-1"],
      ["2026-07-28", "txn-bf-2"],
    ] as const) {
      await insertSaleFact(t, {
        storeId,
        productSkuId,
        operatingDate,
        sourceId,
        netAmountMinor: 1_000,
        quantity: 1,
      });
      await mark(t, storeId, operatingDate);
    }
    await sweep(t);

    // ...then one is downgraded to the pre-certification generation, exactly
    // what history looks like after the fold-version bump deploys.
    await t.run(async (ctx) => {
      const legacyDay = await ctx.db
        .query("reportDay")
        .withIndex("by_storeId_operatingDate", (q) =>
          q.eq("storeId", storeId).eq("operatingDate", "2026-07-27"),
        )
        .unique();
      await ctx.db.patch("reportDay", legacyDay!._id, {
        foldVersion: REPORTS_FOLD_VERSION - 1,
        certifiedFoldRevision: undefined,
      });
      const legacySku = await ctx.db
        .query("reportSkuDay")
        .withIndex("by_storeId_operatingDate_productSkuId", (q) =>
          q.eq("storeId", storeId).eq("operatingDate", "2026-07-27"),
        )
        .unique();
      await ctx.db.patch("reportSkuDay", legacySku!._id, {
        certifiedFoldRevision: undefined,
      });
    });

    // Mid-repair, coverage sees the store as not yet movement-ready.
    const mixed = await t.run(async (ctx) =>
      countUncertifiedDaysWithCtx(ctx, { storeId }),
    );
    expect(mixed).toMatchObject({
      isDone: true,
      processedCount: 2,
      staleFoldVersionCount: 1,
      missingRevisionCount: 0,
      uncertifiedCount: 1,
      certifiedCount: 1,
    });

    // The repair marks exactly the stale day dirty...
    const repair = await t.run(async (ctx) =>
      markStaleFoldVersionDaysWithCtx(ctx, { storeId }),
    );
    expect(repair).toMatchObject({ isDone: true, markedCount: 1 });
    const marks = await marksOf(t);
    expect(marks.map((m) => [m.operatingDate, m.reason])).toEqual([
      ["2026-07-27", "fold_version_bump"],
    ]);

    // ...and draining it through the sweeper certifies day AND SKU rows.
    await sweep(t);
    expect(await marksOf(t)).toHaveLength(0);

    const { days, skuDays } = await t.run(async (ctx) => ({
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      days: await ctx.db.query("reportDay").collect(),
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      skuDays: await ctx.db.query("reportSkuDay").collect(),
    }));
    for (const dayRow of days) {
      expect(dayRow.foldVersion).toBe(REPORTS_FOLD_VERSION);
      expect(typeof dayRow.certifiedFoldRevision).toBe("number");
    }
    for (const row of skuDays) {
      const owner = days.find(
        (dayRow) => dayRow.operatingDate === row.operatingDate,
      );
      expect(row.certifiedFoldRevision).toBe(owner?.certifiedFoldRevision);
    }

    await expect(
      t.run(async (ctx) => countUncertifiedDaysWithCtx(ctx, { storeId })),
    ).resolves.toMatchObject({
      isDone: true,
      uncertifiedCount: 0,
      certifiedCount: 2,
    });
  });
});

describe("weekly lane", () => {
  it("contains a weekly failure without touching the completed close", async () => {
    vi.spyOn(Date, "now").mockReturnValue(WEEKLY_NOW);
    const t = convexTest(schema, modules);
    const { organizationId, storeId } = await seedStore(t, "sweep-weekly-fail");
    allow(storeId);
    const closeId = await insertWeeklyCloseFixture(t, {
      operatingDate: "2026-07-04",
      organizationId,
      storeId,
    });
    await insertSaleFact(t, {
      storeId,
      operatingDate: "2026-07-04",
      sourceId: "final-sale",
      netAmountMinor: 100,
      observedAt: WEEKLY_NOW,
      quantity: 1,
    });
    await mark(t, storeId, "2026-07-04", "close_accepted");
    const before = await t.run(async (ctx) => ctx.db.get("dailyClose", closeId));

    weeklyControl.shouldThrow = true;
    const result = await sweep(t);

    expect(result.weekFailures).toBe(1);
    expect(result.weeksRebuilt).toBe(0);
    expect(result.daysFolded).toBe(1);
    await t.run(async (ctx) => {
      expect(
        await ctx.db
          .query("reportDirtyWeek")
          .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
          .unique(),
      ).toMatchObject({ reason: "write_failure" });
      expect(
        await ctx.db
          .query("reportWeekAccepted")
          .withIndex("by_storeId_acceptedAt", (q) => q.eq("storeId", storeId))
          .take(2),
      ).toHaveLength(0);
      expect(await ctx.db.get("dailyClose", closeId)).toEqual(before);
    });
  });

  it("replays a folded date whose weekly marker missed the batch page", async () => {
    vi.spyOn(Date, "now").mockReturnValue(WEEKLY_NOW);
    const t = convexTest(schema, modules);
    const { organizationId, storeId, userId } = await seedStore(
      t,
      "sweep-weekly-backlog",
    );
    const noiseStoreIds = await t.run(async (ctx) => {
      const ids: Id<"store">[] = [];
      for (let index = 0; index < WEEKLY_DIRTY_BATCH; index += 1) {
        const noiseStoreId = await ctx.db.insert("store", {
          createdByUserId: userId,
          currency: "GHS",
          name: `noise-${index}`,
          organizationId,
          slug: `noise-${index}`,
        });
        ids.push(noiseStoreId);
      }
      return ids;
    });
    allow(storeId, ...noiseStoreIds);

    await insertWeeklyCloseFixture(t, {
      operatingDate: "2026-07-04",
      organizationId,
      storeId,
    });
    await insertSaleFact(t, {
      storeId,
      operatingDate: "2026-07-04",
      sourceId: "final-sale",
      netAmountMinor: 100,
      observedAt: WEEKLY_NOW,
      quantity: 1,
    });
    await mark(t, storeId, "2026-07-04", "close_accepted");
    expect((await sweep(t)).weeksAccepted).toBe(1);

    // A full page of older pending weekly marks now sits ahead of this store.
    await t.run(async (ctx) => {
      for (const noiseStoreId of noiseStoreIds) {
        await ctx.db.insert("reportDirtyWeek", {
          storeId: noiseStoreId,
          reason: "day_folded",
          markedAt: 1,
        });
      }
    });

    // Age the accepted week out of the bounded newest-first fallback, so only
    // the exact folded-date handoff can still reach it.
    const baseline = await t.run(async (ctx) => {
      const accepted = await ctx.db
        .query("reportWeekAccepted")
        .withIndex("by_storeId_cycleStartDate", (q) =>
          q.eq("storeId", storeId).eq("cycleStartDate", "2026-06-29"),
        )
        .unique();
      if (!accepted) throw new Error("missing accepted baseline");
      const { _creationTime, _id, ...fields } = accepted;
      for (let index = 0; index < 16; index += 1) {
        await ctx.db.insert("reportWeekAccepted", {
          ...fields,
          acceptedAt: WEEKLY_NOW + index + 1,
          baselineFingerprint: `newer-${index}`,
          cycleStartDate: `2026-07-${String(index + 6).padStart(2, "0")}`,
          cycleEndDate: `2026-08-${String(index + 1).padStart(2, "0")}`,
        });
      }
      return accepted;
    });

    await insertSaleFact(t, {
      storeId,
      operatingDate: "2026-06-29",
      sourceId: "late-historical-sale",
      netAmountMinor: 500,
      observedAt: WEEKLY_NOW + 500,
      quantity: 1,
    });
    await mark(t, storeId, "2026-06-29", "late_fact", WEEKLY_NOW + 500);

    // The store's marker is newer than the ten pending ones, so this tick's
    // weekly page cannot reach it; the folded date must not be lost with it.
    const blocked = await sweep(t);
    expect(blocked.daysFolded).toBe(1);
    expect(blocked.weeksRefreshed).toBe(0);
    await t.run(async (ctx) => {
      expect(
        await ctx.db.get("reportWeekAccepted", baseline._id),
      ).toMatchObject({
        amendment: { includedNetSalesDeltaMinor: 0 },
      });
      expect(
        await ctx.db
          .query("reportDirtyWeek")
          .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
          .unique(),
      ).toMatchObject({ foldedDates: ["2026-06-29"] });
    });

    const replayed = await sweep(t);
    expect(replayed.weeksRefreshed).toBe(1);
    await t.run(async (ctx) => {
      expect(
        await ctx.db.get("reportWeekAccepted", baseline._id),
      ).toMatchObject({
        amendment: { includedNetSalesDeltaMinor: 500 },
        baselineFingerprint: baseline.baselineFingerprint,
        included: baseline.included,
      });
    });
  });
});

// ---------------------------------------------------------------------------
// Movement lane — the unconditional backstop scan and child-first cleanup.
// The lifecycle itself is covered by skuMovementRange.test.ts; these tests
// prove the SWEEPER's contract: schedule-only recovery, per-tick budgets,
// legacy-lane separation, and expiry ordering.
// ---------------------------------------------------------------------------

describe("movement lane", () => {
  const movementConstants = () =>
    import("./skuMovementRange");

  async function insertMovementHeader(
    t: Harness,
    storeId: Id<"store">,
    overrides: Partial<Doc<"reportRangeResult">> = {},
  ) {
    return t.run((ctx) =>
      ctx.db.insert("reportRangeResult", {
        storeId,
        requestKey: `movement:${Math.random().toString(16).slice(2)}`,
        startDate: "2026-07-01",
        endDate: "2026-07-01",
        status: "pending",
        kind: "sku_movement",
        movementPhase: "queued",
        movementContractVersion: 1,
        movementRevisionVector: [
          { operatingDate: "2026-07-01", revision: "empty" as const },
        ],
        movementAttempt: 0,
        movementEligibleAt: Date.now() - 1_000,
        movementFence: 1,
        movementSourceDayCursor: "2026-07-01",
        requestedAt: Date.now(),
        expiresAt: Date.now() + 60 * 60 * 1000,
        foldVersion: REPORTS_FOLD_VERSION,
        ...overrides,
      }),
    );
  }

  // The backstop schedules real internal actions; freeze setTimeout so the
  // convex-test scheduler cannot race the assertions below.
  const withFrozenScheduler = () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval"] });
    return () => vi.useRealTimers();
  };

  it("recovers a dropped continuation with no allowlist and no dirty marks", async () => {
    const restore = withFrozenScheduler();
    try {
      const t = convexTest(schema, modules);
      const { storeId } = await seedStore(t, "movement-liveness");
      // Deliberately NOT allowlisted: the movement backstop is unconditional.
      const headerId = await insertMovementHeader(t, storeId);

      const result = await sweep(t);
      expect(result.movementWorkersScheduled).toBe(1);

      const { MOVEMENT_STALL_RECOVERY_MS } = await movementConstants();
      const header = await t.run((ctx) =>
        ctx.db.get("reportRangeResult", headerId),
      );
      // Rescheduled and pushed one stall window out, not re-scanned per tick.
      expect(header!.movementEligibleAt).toBeGreaterThan(Date.now());
      expect(header!.movementEligibleAt).toBeLessThanOrEqual(
        Date.now() + MOVEMENT_STALL_RECOVERY_MS,
      );
    } finally {
      restore();
    }
  });

  it("budgets the backstop per tick and leaves backing-off rows alone", async () => {
    const restore = withFrozenScheduler();
    try {
      const { MOVEMENT_BACKSTOP_SCHEDULES_PER_TICK } =
        await movementConstants();
      const t = convexTest(schema, modules);
      const { storeId } = await seedStore(t, "movement-budget");

      for (
        let index = 0;
        index < MOVEMENT_BACKSTOP_SCHEDULES_PER_TICK + 2;
        index += 1
      ) {
        await insertMovementHeader(t, storeId);
      }
      // A poison request waiting out its capped backoff must not be touched.
      const poisonId = await insertMovementHeader(t, storeId, {
        movementPhase: "retry_wait",
        movementAttempt: 3,
        movementEligibleAt: Date.now() + 60 * 60 * 1000,
      });

      const first = await sweep(t);
      expect(first.movementWorkersScheduled).toBe(
        MOVEMENT_BACKSTOP_SCHEDULES_PER_TICK,
      );
      const second = await sweep(t);
      expect(second.movementWorkersScheduled).toBe(2);

      const poison = await t.run((ctx) =>
        ctx.db.get("reportRangeResult", poisonId),
      );
      expect(poison!.movementEligibleAt).toBeGreaterThan(Date.now());
      expect(poison!.movementPhase).toBe("retry_wait");
    } finally {
      restore();
    }
  });

  it("clears a settled row out of the eligible index without scheduling it", async () => {
    const restore = withFrozenScheduler();
    try {
      const t = convexTest(schema, modules);
      const { storeId } = await seedStore(t, "movement-settled");
      const headerId = await insertMovementHeader(t, storeId, {
        status: "completed",
        movementPhase: "completed",
        movementTotals: {
          unitsSold: 1,
          unitsReturned: 0,
          netUnits: 1,
          skuCount: 1,
        },
        computedAt: Date.now(),
      });

      const result = await sweep(t);
      expect(result.movementWorkersScheduled).toBe(0);
      const header = await t.run((ctx) =>
        ctx.db.get("reportRangeResult", headerId),
      );
      expect(header!.movementEligibleAt).toBeUndefined();
      expect(header!.movementPhase).toBe("completed");
    } finally {
      restore();
    }
  });

  it("computes pending legacy summaries but never a movement row", async () => {
    const restore = withFrozenScheduler();
    try {
      const t = convexTest(schema, modules);
      const { storeId } = await seedStore(t, "movement-legacy-split");
      allow(storeId);

      // Touch the store so computePendingRanges runs for it.
      await insertSaleFact(t, {
        storeId,
        operatingDate: "2026-07-01",
        sourceId: "tx-1",
        netAmountMinor: 500,
        quantity: 1,
      });
      await mark(t, storeId, "2026-07-01");

      await t.run((ctx) =>
        ctx.db.insert("reportRangeResult", {
          storeId,
          requestKey: "range:legacy-pending",
          startDate: "2026-07-01",
          endDate: "2026-07-01",
          status: "pending",
          requestedAt: Date.now(),
          expiresAt: Date.now() + 60 * 60 * 1000,
          foldVersion: REPORTS_FOLD_VERSION,
        }),
      );
      const movementId = await insertMovementHeader(t, storeId, {
        movementEligibleAt: Date.now() + 60 * 60 * 1000,
      });

      const result = await sweep(t);
      expect(result.daysFolded).toBe(1);
      expect(result.rangesComputed).toBe(1);

      const legacy = await t.run((ctx) =>
        ctx.db
          .query("reportRangeResult")
          .withIndex("by_storeId_requestKey", (q) =>
            q.eq("storeId", storeId).eq("requestKey", "range:legacy-pending"),
          )
          .unique(),
      );
      expect(legacy!.status).toBe("completed");

      // The movement row is untouched by the summary compute path.
      const movement = await t.run((ctx) =>
        ctx.db.get("reportRangeResult", movementId),
      );
      expect(movement!.status).toBe("pending");
      expect(movement!.movementPhase).toBe("queued");
      expect(movement!.totals).toBeUndefined();
      expect(movement!.topSkus).toBeUndefined();
    } finally {
      restore();
    }
  });

  it("expires movement snapshots child-first: cleaning phase, then children, then the header", async () => {
    const restore = withFrozenScheduler();
    try {
      const t = convexTest(schema, modules);
      const { storeId, productSkuId } = await seedStore(t, "movement-expiry");

      const headerId = await insertMovementHeader(t, storeId, {
        status: "completed",
        movementPhase: "completed",
        movementEligibleAt: undefined,
        expiresAt: Date.now() - 1_000,
      });
      // Children still inside their own expiry window: the header must WAIT.
      const childIds = await t.run(async (ctx) => {
        const ids = [];
        for (let index = 0; index < 3; index += 1) {
          ids.push(
            await ctx.db.insert("reportRangeMovementSku", {
              storeId,
              rangeResultId: headerId,
              productSkuId,
              unitsSold: 1,
              unitsReturned: 0,
              netUnits: 1,
              absNetUnitsSortKey: -1,
              rank: index + 1,
              expiresAt: Date.now() + 60 * 60 * 1000,
            }),
          );
        }
        return ids;
      });
      // A legacy expired row keeps its existing one-shot deletion.
      await t.run((ctx) =>
        ctx.db.insert("reportRangeResult", {
          storeId,
          requestKey: "range:legacy-expired",
          startDate: "2026-07-01",
          endDate: "2026-07-01",
          status: "completed",
          requestedAt: Date.now() - 10_000,
          expiresAt: Date.now() - 1_000,
          foldVersion: REPORTS_FOLD_VERSION,
        }),
      );

      const first = await sweep(t);
      expect(first.rangesExpired).toBe(1); // the legacy row only
      expect(first.movementHeadersExpired).toBe(0);
      const cleaning = await t.run((ctx) =>
        ctx.db.get("reportRangeResult", headerId),
      );
      expect(cleaning!.movementPhase).toBe("cleaning");

      // Children reach their own expiry; the next ticks drain child-first.
      await t.run(async (ctx) => {
        for (const childId of childIds) {
          await ctx.db.patch("reportRangeMovementSku", childId, {
            expiresAt: Date.now() - 1_000,
          });
        }
      });
      const second = await sweep(t);
      expect(second.movementChildrenExpired).toBe(3);
      expect(second.movementHeadersExpired).toBe(1);
      expect(
        await t.run((ctx) => ctx.db.get("reportRangeResult", headerId)),
      ).toBeNull();
      expect(
        await t.run((ctx) => ctx.db.get("reportRangeMovementSku", childIds[0]!)),
      ).toBeNull();
    } finally {
      restore();
    }
  });
});
