/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";

import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { normalizeReseedCursor, reseedStep, type ReseedCursor } from "./reseed";
import { foldAndReplaceDay } from "./sweeper";
import {
  computeExpectedDay,
  diffMetrics,
  VERIFY_MAX_DAYS,
  VERIFY_MAX_DOCS_PER_DOMAIN,
  VERIFY_MAX_PAYMENT_ALLOCATIONS_IN_PERIOD,
  VERIFY_MAX_PAYMENT_REVERSAL_LOOKBACK_DOCS,
  verifyDayWithCtx,
  verifyStoreSummaryWithCtx,
} from "./verify";
import {
  seedDailyClose,
  seedOnlineOrder,
  seedPaymentAllocation,
  seedPosSale,
  seedServiceCase,
  seedStore,
  type SeededStore,
} from "./reseedTestSupport";

const modules = import.meta.glob("../**/*.ts");

const NOW = Date.parse("2026-03-10T12:00:00Z");
const DAY1 = "2026-03-05";
const at = (time: string) => Date.parse(`${DAY1}T${time}:00Z`);

afterEach(() => {
  vi.restoreAllMocks();
});

type Harness = ReturnType<typeof convexTest>;

/** One paginated walk per execution — see the note in reseed.test.ts. */
async function runReseed(t: Harness, storeId: Id<"store">): Promise<void> {
  let cursor: ReseedCursor = normalizeReseedCursor(undefined);
  for (let step = 0; step < 300; step += 1) {
    const progress = await t.run(async (ctx: MutationCtx) =>
      reseedStep(ctx, storeId, cursor),
    );
    if (progress.cursor === null) return;
    cursor = progress.cursor;
  }
  throw new Error("reseed did not terminate");
}

/** Drain the dirty queue the way the sweeper would, one day per execution. */
async function foldDirtyDays(
  t: Harness,
  storeId: Id<"store">,
): Promise<string[]> {
  const dates = await t.run(async (ctx: MutationCtx) => {
    // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
    const marks = await ctx.db
      .query("reportDirtyDay")
      .withIndex("by_storeId_operatingDate", (q) => q.eq("storeId", storeId))
      .collect();
    return marks.map((mark) => mark.operatingDate);
  });

  for (const operatingDate of dates) {
    await t.run(async (ctx: MutationCtx) => {
      await foldAndReplaceDay(ctx, storeId, operatingDate, NOW);
    });
  }
  return dates;
}

/**
 * The fixture both slice F suites share, minus the domains with no revenue
 * effect. Expected DAY1 totals, worked out by hand:
 *
 *   POS         gross 10_500 (10_000 subtotal + 500 tax), net 10_500, units 2
 *   Storefront  gross  4_000 (3_000 merchandise + 1_000 delivery),
 *               net    3_500 (less a 500 order discount),        units 1
 *   Service     gross  4_000, net 4_000,                          units 1
 *   Refund      refunds 1_000, net -1_000
 *   Payments    collected 9_000 (the 1_000 outbound row is a refund)
 */
const EXPECTED_DAY1 = {
  grossSalesMinor: 18_500,
  netSalesMinor: 17_000,
  paymentAllocatedMinor: 8_000,
  paymentsCollectedMinor: 9_000,
  paymentsRefundedMinor: 1_000,
  refundsMinor: 1_000,
  unitsReturned: 0,
  unitsSold: 4,
};

async function seedVerifiableDay(ctx: MutationCtx): Promise<SeededStore> {
  const seeded = await seedStore(ctx);

  await seedPosSale(ctx, seeded, {
    completedAt: at("10:00"),
    lines: [{ quantity: 2, unitPrice: 5_000 }],
    tax: 500,
    transactionNumber: "T-1",
  });
  await seedOnlineOrder(ctx, seeded, {
    completedAt: at("11:00"),
    deliveryFee: 1_000,
    discountTotal: 500,
    items: [{ price: 3_000, quantity: 1 }],
    orderNumber: "O-1",
    refunds: [{ amount: 1_000, date: at("15:00"), id: "rf1" }],
  });
  await seedServiceCase(ctx, seeded, {
    completedAt: at("12:00"),
    lines: [{ amount: 4_000, quantity: 1 }],
  });
  await seedPaymentAllocation(ctx, seeded, {
    amount: 9_000,
    recordedAt: at("13:00"),
    targetId: "T-1",
  });
  await seedPaymentAllocation(ctx, seeded, {
    amount: 1_000,
    direction: "out",
    recordedAt: at("13:30"),
    targetId: "O-1",
  });
  await seedDailyClose(ctx, seeded, {
    completedAt: at("20:00"),
    operatingDate: DAY1,
    salesTotal: 17_000,
  });

  return seeded;
}

describe("verify — agreement with a reseeded, folded day", () => {
  it("does not bless a source with more than 500 child rows", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(seedStore);
    await t.run((ctx) =>
      seedPosSale(ctx, seeded, {
        completedAt: at("10:00"),
        lines: Array.from({ length: 501 }, () => ({
          quantity: 1,
          unitPrice: 1,
        })),
        transactionNumber: "oversized-verifier-transaction",
      }),
    );

    const result = await t.run((ctx: QueryCtx) =>
      verifyDayWithCtx(ctx, seeded.storeId, DAY1),
    );
    expect(result.truncated).toBe(true);
    expect(result.matches).toBe(false);
  });

  it("recomputes the same totals the fold produced", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    const seeded = await t.run(seedVerifiableDay);
    await runReseed(t, seeded.storeId);
    await foldDirtyDays(t, seeded.storeId);

    await t.run(async (ctx: QueryCtx) => {
      const result = await verifyDayWithCtx(ctx, seeded.storeId, DAY1);
      expect(result.differences).toEqual([]);
      expect(result.matches).toBe(true);
      expect(result.expected).toEqual(EXPECTED_DAY1);
      expect(result.paymentDifferences).toEqual([]);
      expect(result.paymentPosture).toMatchObject({
        allocationCoverage: "complete",
        coveredMinor: 8_000,
        eligibleMinor: 8_000,
        outcome: "complete",
        unsettledMinor: 0,
      });
      expect(result.truncated).toBe(false);
      expect(result.factCount).toBeGreaterThan(0);
    });
  });

  it("agrees with what the fold actually wrote, field for field", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    const seeded = await t.run(seedVerifiableDay);
    await runReseed(t, seeded.storeId);
    await foldDirtyDays(t, seeded.storeId);

    await t.run(async (ctx: QueryCtx) => {
      const day = await ctx.db
        .query("reportDay")
        .withIndex("by_storeId_operatingDate", (q) =>
          q.eq("storeId", seeded.storeId).eq("operatingDate", DAY1),
        )
        .unique();
      expect(day).toMatchObject(EXPECTED_DAY1);
      // The close matched the fold exactly, so there is no variance.
      expect(day?.closeVarianceMinor).toBe(0);
    });
  });

  it("labels a reseeded closed day `amended` — ESCALATION, see below", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    const seeded = await t.run(seedVerifiableDay);
    await runReseed(t, seeded.storeId);
    await foldDirtyDays(t, seeded.storeId);

    await t.run(async (ctx: QueryCtx) => {
      const result = await verifyDayWithCtx(ctx, seeded.storeId, DAY1);
      // Resolved escalation: reseed stamps business time as `recordedAt`
      // (NewReportFact.recordedAt), so a re-derived historical fact no longer
      // postdates its close — the day folds `reconciled`, as it should.
      expect(result.dayStatus).toBe("reconciled");
      expect(result.matches).toBe(true);
    });
  });
});

describe("verify — catching a corrupted fold", () => {
  it("reports the exact fields that differ, with expected and actual", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    const seeded = await t.run(seedVerifiableDay);
    await runReseed(t, seeded.storeId);
    await foldDirtyDays(t, seeded.storeId);

    await t.run(async (ctx: MutationCtx) => {
      const day = await ctx.db
        .query("reportDay")
        .withIndex("by_storeId_operatingDate", (q) =>
          q.eq("storeId", seeded.storeId).eq("operatingDate", DAY1),
        )
        .unique();
      await ctx.db.patch("reportDay", day!._id, {
        netSalesMinor: 1,
        unitsSold: 99,
      });
    });

    await t.run(async (ctx: QueryCtx) => {
      const result = await verifyDayWithCtx(ctx, seeded.storeId, DAY1);
      expect(result.matches).toBe(false);
      expect(result.differences).toEqual([
        { actual: 1, expected: 17_000, field: "netSalesMinor" },
        { actual: 99, expected: 4, field: "unitsSold" },
      ]);
    });
  });

  it("treats a missing day as zeros rather than as nothing to check", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    const seeded = await t.run(seedVerifiableDay);
    // Deliberately no reseed and no fold: the day should have had sales.

    await t.run(async (ctx: QueryCtx) => {
      const result = await verifyDayWithCtx(ctx, seeded.storeId, DAY1);
      expect(result.dayStatus).toBe("missing");
      expect(result.factCount).toBe(0);
      expect(result.matches).toBe(false);
      expect(
        result.differences.map((difference) => difference.field).sort(),
      ).toEqual([
        "grossSalesMinor",
        "netSalesMinor",
        "paymentAllocatedMinor",
        "paymentsCollectedMinor",
        "paymentsRefundedMinor",
        "refundsMinor",
        "unitsSold",
      ]);
    });
  });

  it("catches a dropped fact — the failure mode reseed exists to fix", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    const seeded = await t.run(seedVerifiableDay);
    await runReseed(t, seeded.storeId);

    // Lose the service sale, then refold. The fold is self-consistent with the
    // facts it can see; only a source-truth check notices the hole.
    await t.run(async (ctx: MutationCtx) => {
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      const orphan = (await ctx.db.query("reportFact").collect()).find(
        (fact) => fact.sourceDomain === "service",
      );
      await ctx.db.delete("reportFact", orphan!._id);
    });
    await foldDirtyDays(t, seeded.storeId);

    await t.run(async (ctx: QueryCtx) => {
      const result = await verifyDayWithCtx(ctx, seeded.storeId, DAY1);
      expect(result.matches).toBe(false);
      expect(result.differences).toEqual([
        { actual: 13_000, expected: 17_000, field: "netSalesMinor" },
        { actual: 14_500, expected: 18_500, field: "grossSalesMinor" },
        { actual: 3, expected: 4, field: "unitsSold" },
      ]);
    });
  });
});

describe("verifyStoreSummary", () => {
  it("checks an exact-cap day set completely and truncates only on overflow", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(seedStore);
    await t.run(async (ctx) => {
      for (let index = 0; index < VERIFY_MAX_DAYS; index += 1) {
        const operatingDate = new Date(
          Date.parse("2025-01-01T12:00:00.000Z") + index * 86_400_000,
        )
          .toISOString()
          .slice(0, 10);
        await ctx.db.insert("reportDay", {
          currency: "GHS",
          factCount: 0,
          flags: {
            hasUncostedRevenue: false,
            mixedCurrency: false,
            quarantinedFactCount: 0,
          },
          foldVersion: 1,
          grossProfitMinor: 0,
          grossSalesMinor: 0,
          lastFactRecordedAt: NOW,
          netSalesMinor: 0,
          operatingDate,
          paymentAllocatedMinor: 0,
          paymentPosture: {
            allocatedMinor: 0,
            allocationCoverage: "complete",
            allocationOmittedMinor: 0,
            collectedMinor: 0,
            hasInvalidAllocation: false,
            refundedMinor: 0,
            unsettledMinor: 0,
          },
          paymentsCollectedMinor: 0,
          paymentsRefundedMinor: 0,
          refundsMinor: 0,
          status: "open",
          storeId: seeded.storeId,
          uncostedRevenueMinor: 0,
          unitsReturned: 0,
          unitsSold: 0,
        });
      }
    });

    const exact = await t.run(async (ctx: QueryCtx) =>
      verifyStoreSummaryWithCtx(ctx, seeded.storeId),
    );
    expect(exact).toMatchObject({
      daysChecked: VERIFY_MAX_DAYS,
      daysMatching: VERIFY_MAX_DAYS,
      mismatches: [],
      truncated: false,
    });

    await t.run(async (ctx) => {
      await ctx.db.insert("reportDay", {
        currency: "GHS",
        factCount: 0,
        flags: {
          hasUncostedRevenue: false,
          mixedCurrency: false,
          quarantinedFactCount: 0,
        },
        foldVersion: 1,
        grossProfitMinor: 0,
        grossSalesMinor: 0,
        lastFactRecordedAt: NOW,
        netSalesMinor: 0,
        operatingDate: "2026-12-31",
        paymentAllocatedMinor: 0,
        paymentPosture: {
          allocatedMinor: 0,
          allocationCoverage: "complete",
          allocationOmittedMinor: 0,
          collectedMinor: 0,
          hasInvalidAllocation: false,
          refundedMinor: 0,
          unsettledMinor: 0,
        },
        paymentsCollectedMinor: 0,
        paymentsRefundedMinor: 0,
        refundsMinor: 0,
        status: "open",
        storeId: seeded.storeId,
        uncostedRevenueMinor: 0,
        unitsReturned: 0,
        unitsSold: 0,
      });
    });
    const overflow = await t.run(async (ctx: QueryCtx) =>
      verifyStoreSummaryWithCtx(ctx, seeded.storeId),
    );
    expect(overflow).toMatchObject({
      daysChecked: VERIFY_MAX_DAYS,
      daysMatching: VERIFY_MAX_DAYS,
      mismatches: [],
      truncated: true,
    });
  });

  it("aggregates across every folded day and lists only the mismatches", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const store = await seedVerifiableDay(ctx);
      // A second, simpler day so the summary has something to count.
      await seedPosSale(ctx, store, {
        completedAt: Date.parse("2026-03-07T10:00:00Z"),
        lines: [{ quantity: 3, unitPrice: 1_000 }],
        transactionNumber: "T-2",
      });
      return store;
    });
    await runReseed(t, seeded.storeId);
    const foldedDates = await foldDirtyDays(t, seeded.storeId);
    expect(foldedDates).toContain(DAY1);
    expect(foldedDates).toContain("2026-03-07");

    const clean = await t.run(async (ctx: QueryCtx) =>
      verifyStoreSummaryWithCtx(ctx, seeded.storeId),
    );
    expect(clean.daysChecked).toBeGreaterThanOrEqual(2);
    expect(clean.mismatches).toEqual([]);
    expect(clean.daysMatching).toBe(clean.daysChecked);
    expect(clean.truncated).toBe(false);

    // Corrupt exactly one day; the summary must isolate it.
    await t.run(async (ctx: MutationCtx) => {
      const day = await ctx.db
        .query("reportDay")
        .withIndex("by_storeId_operatingDate", (q) =>
          q.eq("storeId", seeded.storeId).eq("operatingDate", "2026-03-07"),
        )
        .unique();
      await ctx.db.patch("reportDay", day!._id, { unitsSold: 0 });
    });

    const dirty = await t.run(async (ctx: QueryCtx) =>
      verifyStoreSummaryWithCtx(ctx, seeded.storeId),
    );
    expect(dirty.daysChecked).toBe(clean.daysChecked);
    expect(dirty.daysMatching).toBe(clean.daysChecked - 1);
    expect(dirty.mismatches).toHaveLength(1);
    expect(dirty.mismatches[0].operatingDate).toBe("2026-03-07");
    expect(dirty.mismatches[0].differences).toEqual([
      { actual: 0, expected: 3, field: "unitsSold" },
    ]);
  });
});

describe("verify — independence from the fold", () => {
  it("reads no reportFact rows at all", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    const seeded = await t.run(seedVerifiableDay);
    await runReseed(t, seeded.storeId);
    await foldDirtyDays(t, seeded.storeId);

    // Wipe the ledger. A verifier that leaned on facts would now report zeros;
    // one that reads sources is unmoved.
    await t.run(async (ctx: MutationCtx) => {
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      for (const fact of await ctx.db.query("reportFact").collect()) {
        await ctx.db.delete("reportFact", fact._id);
      }
    });

    await t.run(async (ctx: QueryCtx) => {
      const { expected } = await computeExpectedDay(ctx, seeded.storeId, DAY1);
      expect(expected).toEqual(EXPECTED_DAY1);
    });
  });

  it("disagrees with the fold about a void — ESCALATION, see verify.ts", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const store = await seedStore(ctx);
      await seedPosSale(ctx, store, {
        completedAt: at("10:00"),
        lines: [{ quantity: 1, unitPrice: 5_000 }],
        status: "void",
        transactionNumber: "T-VOID",
        voidedAt: at("11:00"),
      });
      return store;
    });
    await runReseed(t, seeded.storeId);
    await foldDirtyDays(t, seeded.storeId);

    await t.run(async (ctx: QueryCtx) => {
      const result = await verifyDayWithCtx(ctx, seeded.storeId, DAY1);
      // Sale 5_000 then void 5_000 on the same day: the business answer is 0.
      expect(result.expected.netSalesMinor).toBe(0);
      expect(result.expected.unitsSold).toBe(0);
      // Resolved escalation: voids are now emitted with NEGATED amounts and
      // quantities (the fold trusts void signs as carried), so the fold and
      // the source-derived verifier agree — the void fix is provably complete.
      expect(result.matches).toBe(true);
      expect(result.differences).toEqual([]);
    });
  });
});

describe("verify — operating-day attribution", () => {
  it("uses the store's local day, not UTC, to place a sale", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    // 2026-03-05T16:00Z is 2026-03-06 01:00 in Tokyo. UTC would file this sale
    // under 03-05; the operating-day authority files it under 03-06.
    const seeded = await t.run(async (ctx) => {
      const store = await seedStore(ctx, "Asia/Tokyo");
      await seedPosSale(ctx, store, {
        completedAt: Date.parse("2026-03-05T16:00:00Z"),
        lines: [{ quantity: 1, unitPrice: 5_000 }],
        transactionNumber: "T-TZ",
      });
      return store;
    });

    await t.run(async (ctx: QueryCtx) => {
      const utcDay = await computeExpectedDay(
        ctx,
        seeded.storeId,
        "2026-03-05",
      );
      expect(utcDay.expected.netSalesMinor).toBe(0);
      const localDay = await computeExpectedDay(
        ctx,
        seeded.storeId,
        "2026-03-06",
      );
      expect(localDay.expected.netSalesMinor).toBe(5_000);
      expect(localDay.expected.unitsSold).toBe(1);
    });
  });
});

describe("verify — payment posture", () => {
  it("proves timed refunds/allocation and marks untimed legacy voids incomplete", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const store = await seedStore(ctx);
      await seedPaymentAllocation(ctx, store, {
        amount: 5_000,
        recordedAt: at("09:00"),
        targetId: "a",
      });
      await seedPaymentAllocation(ctx, store, {
        amount: 2_000,
        direction: "out",
        recordedAt: at("10:00"),
        targetId: "b",
      });
      const timedVoidId = await seedPaymentAllocation(ctx, store, {
        amount: 3_000,
        recordedAt: at("11:00"),
        status: "voided",
        targetId: "c",
      });
      await ctx.db.patch("paymentAllocation", timedVoidId, {
        voidedAt: at("12:00"),
      });
      await seedPaymentAllocation(ctx, store, {
        amount: 1_000,
        recordedAt: at("13:00"),
        status: "voided",
        targetId: "legacy",
      });
      return store;
    });

    await t.run(async (ctx: QueryCtx) => {
      const { expected, paymentPosture } = await computeExpectedDay(
        ctx,
        seeded.storeId,
        DAY1,
      );
      expect(expected).toMatchObject({
        paymentsCollectedMinor: 9_000,
        paymentsRefundedMinor: 5_000,
        paymentAllocatedMinor: 3_000,
      });
      expect(paymentPosture).toMatchObject({
        allocationCoverage: "unknown",
        omittedMinor: 1_000,
        outcome: "incomplete",
        reason: "legacy_void_missing_timestamp",
        unsettledMinor: null,
      });
    });
  });

  it("bounds the allocation scan to the period, not the store's lifetime", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const store = await seedStore(ctx);
      // Far outside the verified period's lookback. Before this scan was date
      // bounded these alone exhausted the per-domain cap, and every later day
      // in the store's life verified as permanently incomplete.
      for (let index = 0; index <= VERIFY_MAX_DOCS_PER_DOMAIN; index += 1) {
        await seedPaymentAllocation(ctx, store, {
          amount: 100,
          recordedAt: Date.parse("2025-01-01T10:00:00Z") + index,
          targetId: `ancient-${index}`,
        });
      }
      for (const [index, amount] of [1_000, 2_000, 3_000].entries()) {
        await seedPaymentAllocation(ctx, store, {
          amount,
          recordedAt: at("09:00") + index,
          targetId: `inside-${index}`,
        });
      }
      return store;
    });

    await t.run(async (ctx: QueryCtx) => {
      const { expected, paymentPosture, truncated } = await computeExpectedDay(
        ctx,
        seeded.storeId,
        DAY1,
      );
      expect(truncated).toBe(false);
      expect(expected.paymentsCollectedMinor).toBe(6_000);
      expect(expected.paymentAllocatedMinor).toBe(6_000);
      expect(paymentPosture).toMatchObject({
        allocationCoverage: "complete",
        omittedMinor: 0,
        outcome: "complete",
        reason: "complete",
      });
    });
  });

  /**
   * REGRESSION — production, 2026-08-02.
   *
   * The allocation scan used to read `[startAt - 90d, endAt]` under the
   * 500-doc per-domain cap. On the live store that window held 1,050 rows, so
   * every day of the week returned `incomplete/source_cap_exceeded` and the
   * payment posture was unreadable. In-period volume alone, well past the old
   * cap, must now verify.
   */
  it("verifies a day whose in-period allocations exceed the old 500 cap", async () => {
    const COLLECTIONS = 1_200;
    expect(COLLECTIONS).toBeGreaterThan(VERIFY_MAX_DOCS_PER_DOMAIN);
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const store = await seedStore(ctx);
      for (let index = 0; index < COLLECTIONS; index += 1) {
        await seedPaymentAllocation(ctx, store, {
          amount: 100,
          recordedAt: at("09:00") + index,
          targetId: `inside-${index}`,
        });
      }
      await seedPaymentAllocation(ctx, store, {
        amount: 5_000,
        direction: "out",
        recordedAt: at("16:00"),
        targetId: "refund",
      });
      return store;
    });

    await t.run(async (ctx: QueryCtx) => {
      const result = await verifyDayWithCtx(ctx, seeded.storeId, DAY1);
      expect(result.truncated).toBe(false);
      expect(result.expected).toMatchObject({
        paymentAllocatedMinor: 115_000,
        paymentsCollectedMinor: 120_000,
        paymentsRefundedMinor: 5_000,
      });
      expect(result.paymentPosture).toMatchObject({
        allocationCoverage: "complete",
        coveredMinor: 115_000,
        eligibleMinor: 115_000,
        omittedMinor: 0,
        outcome: "complete",
        reason: "complete",
        reversalLookback: { outcome: "complete", reason: "complete" },
        unsettledMinor: 0,
      });
      // Nothing was withheld: this is a full verification, not a partial one.
      expect(result.unverifiedFields).toEqual([]);
    });
    // Deliberately large fixtures: these three tests seed thousands of
    // allocations to exercise the real ceilings, which outruns the default
    // 5s budget when the whole suite is competing for workers.
  }, 60_000);

  it("refuses a period that exceeds the in-period allocation ceiling", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const store = await seedStore(ctx);
      for (
        let index = 0;
        index <= VERIFY_MAX_PAYMENT_ALLOCATIONS_IN_PERIOD;
        index += 1
      ) {
        await seedPaymentAllocation(ctx, store, {
          amount: 100,
          recordedAt: at("09:00") + index,
          targetId: `inside-${index}`,
        });
      }
      return store;
    });

    await t.run(async (ctx: QueryCtx) => {
      const result = await verifyDayWithCtx(ctx, seeded.storeId, DAY1);
      // A capped read is a lower bound, never a total that happens to agree.
      expect(result.truncated).toBe(true);
      expect(result.matches).toBe(false);
      expect(result.expected.paymentsCollectedMinor).toBeLessThan(
        (VERIFY_MAX_PAYMENT_ALLOCATIONS_IN_PERIOD + 1) * 100,
      );
      expect(result.paymentPosture).toMatchObject({
        allocationCoverage: "unknown",
        outcome: "incomplete",
        reason: "source_cap_exceeded",
        unsettledMinor: null,
      });
      // Incomplete, therefore unverified — never presented as a difference.
      expect(
        result.differences.filter((difference) =>
          difference.field.startsWith("payment"),
        ),
      ).toEqual([]);
      expect(result.unverifiedFields).toContain("paymentsCollectedMinor");
    });
  }, 60_000);

  it("degrades only reversal detection when the lookback bound is exhausted", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const store = await seedStore(ctx);
      // A long allocation history inside the reversal lookback window.
      for (
        let index = 0;
        index <= VERIFY_MAX_PAYMENT_REVERSAL_LOOKBACK_DOCS;
        index += 1
      ) {
        await seedPaymentAllocation(ctx, store, {
          amount: 100,
          recordedAt: at("09:00") - 30 * 86_400_000 + index,
          targetId: `historical-${index}`,
        });
      }
      await seedPaymentAllocation(ctx, store, {
        amount: 9_000,
        recordedAt: at("09:00"),
        targetId: "inside",
      });
      return store;
    });

    await t.run(async (ctx: QueryCtx) => {
      const result = await verifyDayWithCtx(ctx, seeded.storeId, DAY1);
      // The in-period posture still verifies; only the reversal lane is bounded.
      expect(result.truncated).toBe(false);
      expect(result.expected.paymentsCollectedMinor).toBe(9_000);
      expect(result.paymentPosture).toMatchObject({
        outcome: "complete",
        reason: "complete",
        reversalLookback: {
          outcome: "incomplete",
          reason: "lookback_cap_exceeded",
        },
      });
      // Collection cannot be moved by an unseen historical void; anything a
      // missed reversal could move is withheld, and named.
      expect(result.unverifiedFields).not.toContain("paymentsCollectedMinor");
      expect(result.unverifiedFields).toEqual(
        expect.arrayContaining([
          "paymentAllocatedMinor",
          "paymentAllocationCoverage",
          "paymentsRefundedMinor",
        ]),
      );
    });
  }, 60_000);

  it("detects a void landing in-period against an older allocation", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const store = await seedStore(ctx);
      await seedPaymentAllocation(ctx, store, {
        amount: 5_000,
        recordedAt: at("09:00"),
        targetId: "inside",
      });
      const olderId = await seedPaymentAllocation(ctx, store, {
        amount: 3_000,
        recordedAt: at("09:00") - 30 * 86_400_000,
        status: "voided",
        targetId: "older",
      });
      await ctx.db.patch("paymentAllocation", olderId, {
        voidedAt: at("11:00"),
      });
      return store;
    });

    await t.run(async (ctx: QueryCtx) => {
      const { expected, paymentPosture } = await computeExpectedDay(
        ctx,
        seeded.storeId,
        DAY1,
      );
      expect(expected).toMatchObject({
        paymentAllocatedMinor: 2_000,
        paymentsCollectedMinor: 5_000,
        paymentsRefundedMinor: 3_000,
      });
      expect(paymentPosture).toMatchObject({
        outcome: "complete",
        reversalLookback: { outcome: "complete" },
      });
    });
  });

  it("flags period-local over-allocation and never returns negative unsettled", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const store = await seedStore(ctx);
      await seedPaymentAllocation(ctx, store, {
        amount: 5_000,
        recordedAt: at("09:00"),
        targetId: "collection",
      });
      await seedPaymentAllocation(ctx, store, {
        amount: 6_000,
        direction: "out",
        recordedAt: at("10:00"),
        targetId: "refund",
      });
      return store;
    });

    await t.run(async (ctx: QueryCtx) => {
      const { paymentPosture } = await computeExpectedDay(
        ctx,
        seeded.storeId,
        DAY1,
      );
      expect(paymentPosture).toMatchObject({
        hasInvalidAllocation: true,
        outcome: "incomplete",
        reason: "invalid_allocation",
        unsettledMinor: null,
      });
    });
  });
});

/**
 * REGRESSION — production, 2026-08-02.
 *
 * With the payment lane incomplete, `expected` fell back to 0 and the diff
 * emitted `{ field: "paymentsCollectedMinor", expected: 0, actual: 396000 }`
 * with `matches: false`. "We could not check" read exactly like "this is
 * wrong", and a real mismatch was indistinguishable from a cap. These two
 * tests are the proof that the cases are now distinguishable.
 */
describe("verify — unverified is not mismatched", () => {
  /** A folded day carrying real payment totals and nothing else. */
  async function seedFoldedPaymentDay(
    ctx: MutationCtx,
    seeded: SeededStore,
    paymentsCollectedMinor: number,
  ): Promise<void> {
    await ctx.db.insert("reportDay", {
      currency: "GHS",
      factCount: 1,
      flags: {
        hasUncostedRevenue: false,
        mixedCurrency: false,
        quarantinedFactCount: 0,
      },
      foldVersion: 1,
      grossProfitMinor: 0,
      grossSalesMinor: 0,
      lastFactRecordedAt: NOW,
      netSalesMinor: 0,
      operatingDate: DAY1,
      paymentAllocatedMinor: paymentsCollectedMinor,
      paymentPosture: {
        allocatedMinor: paymentsCollectedMinor,
        allocationCoverage: "complete",
        allocationOmittedMinor: 0,
        collectedMinor: paymentsCollectedMinor,
        hasInvalidAllocation: false,
        refundedMinor: 0,
        unsettledMinor: 0,
      },
      paymentsCollectedMinor,
      paymentsRefundedMinor: 0,
      refundsMinor: 0,
      status: "open",
      storeId: seeded.storeId,
      uncostedRevenueMinor: 0,
      unitsReturned: 0,
      unitsSold: 0,
    });
  }

  it("withholds payment fields rather than diffing them against a fallback 0", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const store = await seedStore(ctx);
      // An untimed legacy void: the payment lane cannot complete.
      await seedPaymentAllocation(ctx, store, {
        amount: 2_000,
        recordedAt: at("09:00"),
        status: "voided",
        targetId: "legacy",
      });
      await seedFoldedPaymentDay(ctx, store, 396_000);
      return store;
    });

    await t.run(async (ctx: QueryCtx) => {
      const result = await verifyDayWithCtx(ctx, seeded.storeId, DAY1);
      expect(result.paymentPosture.outcome).toBe("incomplete");
      // Not one payment field may masquerade as a discrepancy.
      expect(result.differences).toEqual([]);
      expect(result.paymentDifferences).toEqual([]);
      expect(result.unverifiedFields).toEqual(
        expect.arrayContaining([
          "paymentAllocatedMinor",
          "paymentAllocationCoverage",
          "paymentAllocationOmittedMinor",
          "paymentHasInvalidAllocation",
          "paymentUnsettledMinor",
          "paymentsCollectedMinor",
          "paymentsRefundedMinor",
        ]),
      );
      // Everything CHECKED agreed — which is partial verification, not a
      // clean bill of health, and the field list is what says so.
      expect(result.matches).toBe(true);
      expect(result.unverifiedFields.length).toBeGreaterThan(0);
    });
  });

  it("still reports a genuine payment mismatch when the lane completes", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const store = await seedStore(ctx);
      await seedPaymentAllocation(ctx, store, {
        amount: 9_000,
        recordedAt: at("09:00"),
        targetId: "settled",
      });
      await seedFoldedPaymentDay(ctx, store, 396_000);
      return store;
    });

    await t.run(async (ctx: QueryCtx) => {
      const result = await verifyDayWithCtx(ctx, seeded.storeId, DAY1);
      expect(result.paymentPosture.outcome).toBe("complete");
      expect(result.unverifiedFields).toEqual([]);
      expect(result.differences).toEqual([
        { actual: 396_000, expected: 9_000, field: "paymentsCollectedMinor" },
        { actual: 396_000, expected: 9_000, field: "paymentAllocatedMinor" },
      ]);
      expect(result.matches).toBe(false);
    });
  });
});

describe("verify — diffMetrics", () => {
  it("is pure and reports every differing field in contract order", () => {
    const expected = {
      grossSalesMinor: 1,
      netSalesMinor: 2,
      paymentsCollectedMinor: 3,
      paymentsRefundedMinor: 7,
      paymentAllocatedMinor: -4,
      refundsMinor: 4,
      unitsReturned: 5,
      unitsSold: 6,
    };
    expect(diffMetrics(expected, expected)).toEqual([]);
    expect(diffMetrics(expected, { ...expected, refundsMinor: 40 })).toEqual([
      { actual: 40, expected: 4, field: "refundsMinor" },
    ]);
  });
});

/** A minimal folded day document, for publishing a mix the verifier can contradict. */
function dayDocFor(storeId: Id<"store">, operatingDate: string) {
  return {
    currency: "GHS",
    factCount: 0,
    flags: {
      hasUncostedRevenue: false,
      mixedCurrency: false,
      quarantinedFactCount: 0,
    },
    foldVersion: 1,
    grossProfitMinor: 0,
    grossSalesMinor: 0,
    lastFactRecordedAt: NOW,
    netSalesMinor: 0,
    operatingDate,
    paymentAllocatedMinor: 0,
    paymentsCollectedMinor: 0,
    paymentsRefundedMinor: 0,
    refundsMinor: 0,
    status: "provisional" as const,
    storeId,
    uncostedRevenueMinor: 0,
    unitsReturned: 0,
    unitsSold: 0,
  };
}

describe("verify — payment mix", () => {
  /** Seed a POS transaction so allocations can carry a real participation id. */
  async function seedTransaction(
    ctx: MutationCtx,
    store: Awaited<ReturnType<typeof seedStore>>,
    transactionNumber: string,
  ) {
    return seedPosSale(ctx, store, {
      completedAt: at("09:00"),
      lines: [{ quantity: 1, unitPrice: 1_000 }],
      transactionNumber,
    });
  }

  it("recomputes method values and Daily Close-aligned use counts from allocations", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const store = await seedStore(ctx);
      const txn = await seedTransaction(ctx, store, "T-A");
      // Two Cash allocations on ONE transaction: full value, one tender use.
      await seedPaymentAllocation(ctx, store, {
        amount: 2_000,
        method: "cash",
        posTransactionId: txn,
        recordedAt: at("09:00"),
        targetId: "a1",
      });
      await seedPaymentAllocation(ctx, store, {
        amount: 1_000,
        method: "Cash",
        posTransactionId: txn,
        recordedAt: at("09:05"),
        targetId: "a2",
      });
      // Split tender on the same transaction: a second, separate use.
      await seedPaymentAllocation(ctx, store, {
        amount: 3_000,
        method: "momo",
        posTransactionId: txn,
        recordedAt: at("09:10"),
        targetId: "a3",
      });
      // Non-POS allocations stand for themselves.
      await seedPaymentAllocation(ctx, store, {
        amount: 500,
        method: "card",
        recordedAt: at("09:20"),
        targetId: "b1",
      });
      await seedPaymentAllocation(ctx, store, {
        amount: 500,
        method: "card",
        recordedAt: at("09:25"),
        targetId: "b2",
      });
      return store;
    });

    await t.run(async (ctx: QueryCtx) => {
      const { expectedPaymentMix } = await computeExpectedDay(
        ctx,
        seeded.storeId,
        DAY1,
      );
      expect(expectedPaymentMix).toEqual({
        status: "complete",
        totalMinor: 7_000,
        rows: [
          {
            method: "cash",
            amountMinor: 3_000,
            shareBasisPoints: 4_286,
            tenderUseCount: 1,
          },
          {
            method: "card",
            amountMinor: 1_000,
            shareBasisPoints: 1_429,
            tenderUseCount: 2,
          },
          {
            method: "mobile_money",
            amountMinor: 3_000,
            shareBasisPoints: 4_286,
            tenderUseCount: 1,
          },
        ],
      });
    });
  });

  it("detects a wrong method value and a wrong use count independently", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const store = await seedStore(ctx);
      const txn = await seedTransaction(ctx, store, "T-B");
      await seedPaymentAllocation(ctx, store, {
        amount: 2_000,
        method: "cash",
        posTransactionId: txn,
        recordedAt: at("09:00"),
        targetId: "a1",
      });
      await seedPaymentAllocation(ctx, store, {
        amount: 1_000,
        method: "cash",
        posTransactionId: txn,
        recordedAt: at("09:05"),
        targetId: "a2",
      });
      return store;
    });

    const publish = async (
      mix: NonNullable<Doc<"reportDay">["paymentMix"]>,
      collectedMinor = 3_000,
    ) =>
      t.run(async (ctx) => {
        const existing = await ctx.db
          .query("reportDay")
          .withIndex("by_storeId_operatingDate", (q) =>
            q.eq("storeId", seeded.storeId).eq("operatingDate", DAY1),
          )
          .unique();
        const doc = {
          ...dayDocFor(seeded.storeId, DAY1),
          paymentsCollectedMinor: collectedMinor,
          paymentAllocatedMinor: collectedMinor,
          paymentMix: mix,
        };
        if (existing) await ctx.db.patch("reportDay", existing._id, doc);
        else await ctx.db.insert("reportDay", doc);
      });

    // Right use count, WRONG value.
    await publish({
      status: "complete",
      totalMinor: 3_000,
      rows: [
        {
          method: "cash",
          amountMinor: 3_000,
          shareBasisPoints: 10_000,
          tenderUseCount: 9,
        },
      ],
    });
    const wrongCount = await t.run((ctx: QueryCtx) =>
      verifyDayWithCtx(ctx, seeded.storeId, DAY1),
    );
    expect(wrongCount.paymentMixDifferences).toContainEqual(
      expect.objectContaining({ field: "tenderUseCount", method: "cash" }),
    );

    // Right value, WRONG use count — the two failures are independent.
    await publish({
      status: "complete",
      totalMinor: 3_000,
      rows: [
        {
          method: "cash",
          amountMinor: 2_000,
          shareBasisPoints: 10_000,
          tenderUseCount: 1,
        },
      ],
    });
    const wrongValue = await t.run((ctx: QueryCtx) =>
      verifyDayWithCtx(ctx, seeded.storeId, DAY1),
    );
    expect(wrongValue.paymentMixDifferences).toContainEqual(
      expect.objectContaining({ field: "amountMinor", method: "cash" }),
    );
  });

  it("classifies methodless legacy evidence as unavailable, not a mismatched zero", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const store = await seedStore(ctx);
      await seedPaymentAllocation(ctx, store, {
        amount: 2_000,
        method: "cash",
        recordedAt: at("09:00"),
        targetId: "a",
      });
      // A method reporting cannot classify: the money was still received.
      await seedPaymentAllocation(ctx, store, {
        amount: 1_000,
        method: "cheque",
        recordedAt: at("09:30"),
        targetId: "b",
      });
      return store;
    });

    await t.run(async (ctx: QueryCtx) => {
      const { expected, expectedPaymentMix } = await computeExpectedDay(
        ctx,
        seeded.storeId,
        DAY1,
      );
      // Payments totals are untouched by unclassifiable method evidence.
      expect(expected.paymentsCollectedMinor).toBe(3_000);
      expect(expectedPaymentMix).toEqual({ status: "unavailable" });
    });
  });
});

describe("verify — payment mix agrees with the fold on reversed receipts", () => {
  it("keeps a voided receipt's gross method value on the day it was received", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const store = await seedStore(ctx);
      await seedPaymentAllocation(ctx, store, {
        amount: 2_000,
        method: "cash",
        recordedAt: at("09:00"),
        targetId: "kept",
      });
      // Received, then reversed later the same day. Gross received by method
      // is a statement about what came IN: the reversal moves settlement, not
      // the gross mix, so this value must still appear under Cash.
      await seedPaymentAllocation(ctx, store, {
        amount: 1_000,
        method: "cash",
        recordedAt: at("10:00"),
        status: "voided",
        targetId: "reversed",
        voidedAt: at("11:00"),
      });
      return store;
    });

    await t.run(async (ctx: QueryCtx) => {
      const { expected, expectedPaymentMix } = await computeExpectedDay(
        ctx,
        seeded.storeId,
        DAY1,
      );
      expect(expected.paymentsCollectedMinor).toBe(3_000);
      // Reconciles to gross collected, with both receipts counted.
      expect(expectedPaymentMix).toEqual({
        status: "complete",
        totalMinor: 3_000,
        rows: [
          {
            method: "cash",
            amountMinor: 3_000,
            shareBasisPoints: 10_000,
            tenderUseCount: 2,
          },
        ],
      });
    });
  });

  it("emits the same gross method evidence the verifier expects for a reversed receipt", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const store = await seedStore(ctx);
      await seedPaymentAllocation(ctx, store, {
        amount: 2_000,
        method: "cash",
        recordedAt: at("09:00"),
        targetId: "kept",
      });
      await seedPaymentAllocation(ctx, store, {
        amount: 1_000,
        method: "cash",
        recordedAt: at("10:00"),
        status: "voided",
        targetId: "reversed",
        voidedAt: at("11:00"),
      });
      return store;
    });

    await runReseed(t, seeded.storeId);
    await t.run(async (ctx) => {
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      const receipts = (await ctx.db.query("reportFact").collect()).filter(
        (fact) => fact.sourceDomain === "payments" && fact.factKind === "payment",
      );
      expect(receipts).toHaveLength(2);
      // Both receipt facts carry method evidence — the reversed one included,
      // or its day's mix could never reconcile to its own gross total.
      expect(receipts.every((fact) => fact.paymentMethod === "cash")).toBe(true);
      expect(
        receipts.reduce((sum, fact) => sum + (fact.paymentMixMinor ?? 0), 0),
      ).toBe(3_000);
    });
  });
});
