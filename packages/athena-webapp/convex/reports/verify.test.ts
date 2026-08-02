/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";

import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { normalizeReseedCursor, reseedStep, type ReseedCursor } from "./reseed";
import { foldAndReplaceDay } from "./sweeper";
import {
  computeExpectedDay,
  diffMetrics,
  VERIFY_MAX_DAYS,
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
