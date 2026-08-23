/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";

import schema from "../schema";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { ReportWeekLineage } from "../../shared/reportsContract";
import { testId } from "../lib/testIds";
import { stableStringHash } from "./fingerprint";
import { resolveWeeklyPeriod } from "./weeklyPeriods";

/**
 * The one thing acceptance owns and cannot otherwise provoke: a materialization
 * attempt that fails after its intent exists. Everything else folds for real.
 */
const foldControl = vi.hoisted(() => ({ shouldThrow: false }));

vi.mock("./foldDay", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./foldDay")>();
  return {
    ...actual,
    foldDay: (...args: Parameters<typeof actual.foldDay>) => {
      if (foldControl.shouldThrow) throw new Error("weekly fold exploded");
      return actual.foldDay(...args);
    },
  };
});

import {
  MAX_WEEKLY_FACTS,
  MAX_WEEKLY_LIVE_PRIOR_CUTOFF_FACTS,
  WEEKLY_SCHEDULE_READ_LIMIT,
  acceptedTopSkuLeaders,
  foldWeekFromAcceptedFacts,
  foldWeekFromDays,
  materializeAcceptedWeek,
  nextWeeklyReportDeliveryAt,
  scheduleWeeklyManagerReportNotificationWithCtx,
  markWeekDirty,
  reconcileRecentAcceptedWeeksForStore,
  rebuildCurrentWeek,
  availableWeekCurrent,
  computeWeeklyVariancePosture,
  refreshAcceptedWeekForDate,
  weekTruthFingerprint,
  ZERO_WEEK_METRICS,
} from "./weekly";

afterEach(() => {
  foldControl.shouldThrow = false;
});

const modules = import.meta.glob("../**/*.ts");
const NOW = Date.parse("2026-07-04T12:00:00.000Z");

describe("weekly report delivery schedule", () => {
  it("schedules 8 AM on the next store-local day", () => {
    expect(
      nextWeeklyReportDeliveryAt({
        acceptedAt: Date.parse("2026-08-08T20:47:00.000Z"),
        timezone: "Africa/Accra",
      }),
    ).toBe(Date.parse("2026-08-09T08:00:00.000Z"));
  });

  it("uses the next local date across a timezone boundary", () => {
    expect(
      nextWeeklyReportDeliveryAt({
        acceptedAt: Date.parse("2026-08-09T03:30:00.000Z"),
        timezone: "America/New_York",
      }),
    ).toBe(Date.parse("2026-08-09T12:00:00.000Z"));
  });

  it("schedules one weekly intent for the accepted baseline", async () => {
    const t = convexTest(schema, modules);
    const storeId = await seedStore(t, "weekly-email-schedule");
    const store = await t.run((ctx) => ctx.db.get("store", storeId));
    if (!store) throw new Error("missing fixture store");
    const acceptedWeekId = "accepted-week-1" as Id<"reportWeekAccepted">;

    const scheduledId = await t.run((ctx) =>
      scheduleWeeklyManagerReportNotificationWithCtx(ctx, {
          acceptedAt: Date.now(),
          acceptedWeekId,
          organizationId: store.organizationId,
          storeId,
          timezone: "Africa/Accra",
      }),
    );
    const scheduled = await t.run((ctx) =>
      ctx.db.system.get("_scheduled_functions", scheduledId),
    );

    expect(scheduled).toMatchObject({
      args: [
        {
          kind: "eod.weekly_manager_report",
          organizationId: store.organizationId,
          payload: { acceptedWeekId },
          storeId,
          subjectId: String(acceptedWeekId),
          subjectType: "reportWeekAccepted",
        },
      ],
      name: "notifications/emit:emitNotification",
      scheduledTime: nextWeeklyReportDeliveryAt({
        acceptedAt: Date.now(),
        timezone: "Africa/Accra",
      }),
      state: { kind: "pending" },
    });
  });
});

function period() {
  const result = resolveWeeklyPeriod({
    referenceAt: NOW,
    schedules: [
      {
        _id: testId("storeSchedule", "schedule-1"),
        dateExceptions: [],
        effectiveFrom: Date.parse("2026-01-01T00:00:00.000Z"),
        reportingCycleStartsOn: 1,
        weeklyClosedDays: [0],
      },
    ],
    timezone: "UTC",
  });
  if (result.kind !== "resolved") throw new Error("fixture schedule failed");
  return result;
}

function day(overrides: Partial<Doc<"reportDay">> = {}) {
  return {
    currency: "GHS",
    flags: {
      hasUncostedRevenue: false,
      mixedCurrency: false,
      quarantinedFactCount: 0,
    },
    grossProfitMinor: 70,
    grossSalesMinor: 100,
    netSalesMinor: 100,
    operatingDate: "2026-06-29",
    paymentAllocatedMinor: 100,
    paymentPosture: {
      allocatedMinor: 100,
      allocationCoverage: "complete" as const,
      allocationOmittedMinor: 0,
      collectedMinor: 100,
      hasInvalidAllocation: false,
      refundedMinor: 0,
      unsettledMinor: 0,
    },
    paymentsCollectedMinor: 100,
    paymentsRefundedMinor: 0,
    refundsMinor: 0,
    status: "reconciled" as const,
    uncostedRevenueMinor: 0,
    unitsReturned: 0,
    unitsSold: 1,
    ...overrides,
  } as Doc<"reportDay">;
}

function fact(overrides: Partial<Doc<"reportFact">> = {}) {
  return {
    _id: "fact-1" as Id<"reportFact">,
    currency: "GHS",
    discountAmountMinor: 0,
    factKind: "sale" as const,
    fingerprint: "fp",
    fingerprintVersion: 2,
    grossAmountMinor: 100,
    lineId: "line",
    netAmountMinor: 100,
    observedAt: 10,
    occurredAt: 1,
    operatingDate: "2026-06-29",
    quantity: 1,
    recordedAt: 1,
    sourceDomain: "pos" as const,
    sourceId: "source",
    storeId: "store-1" as Id<"store">,
    taxAmountMinor: 0,
    ...overrides,
  } as Doc<"reportFact">;
}

describe("accepted weekly SKU leaders", () => {
  it("freezes up to five sold SKUs from cutoff facts", () => {
    const skuA = "sku-a" as Id<"productSku">;
    const skuB = "sku-b" as Id<"productSku">;
    const skuC = "sku-c" as Id<"productSku">;
    const skuD = "sku-d" as Id<"productSku">;

    expect(
      acceptedTopSkuLeaders({
        currency: "GHS",
        factsByDate: new Map([
          [
            "2026-08-03",
            [
              fact({ productSkuId: skuA, quantity: 3 }),
              fact({ _id: "fact-2" as Id<"reportFact">, productSkuId: skuB, quantity: 5 }),
              fact({ _id: "fact-3" as Id<"reportFact">, productSkuId: skuC, quantity: 2 }),
              fact({ _id: "fact-4" as Id<"reportFact">, productSkuId: skuD, quantity: 1 }),
            ],
          ],
          [
            "2026-08-08",
            [
              fact({ _id: "fact-5" as Id<"reportFact">, productSkuId: skuA, quantity: 4 }),
              fact({ _id: "fact-6" as Id<"reportFact">, productSkuId: skuC, quantity: 2 }),
            ],
          ],
        ]),
      }),
    ).toEqual([
      { productSkuId: skuA, unitsSold: 7 },
      { productSkuId: skuB, unitsSold: 5 },
      { productSkuId: skuC, unitsSold: 4 },
      { productSkuId: skuD, unitsSold: 1 },
    ]);
  });
});

describe("foldWeekFromDays", () => {
  it("synthesizes missing scheduled report days as complete zero-activity slots", () => {
    const result = foldWeekFromDays({
      period: period(),
      days: [
        day({ transactionCount: 7 }),
        day({
          operatingDate: "2026-07-05",
          netSalesMinor: 25,
          transactionCount: 2,
        }),
      ],
    });

    expect(result.included.netSalesMinor).toBe(100);
    expect(result.outsideSchedule.netSalesMinor).toBe(25);
    expect(result.included.transactionCount).toBe(7);
    expect(result.outsideSchedule.transactionCount).toBe(2);
    expect(result.completeness).toEqual({
      complete: true,
      reason: "complete",
      outsideSchedule: { complete: true, reason: "complete" },
    });
    expect(
      result.scheduleLineage.filter(
        (entry) => entry.included && !entry.dayAvailable,
      ),
    ).toHaveLength(5);
    expect(
      result.scheduleLineage.filter(
        (entry) => entry.included && entry.activityPosture === "zero_activity",
      ),
    ).toHaveLength(5);
  });

  it("keeps genuinely incomplete folded evidence fail-closed", () => {
    const result = foldWeekFromDays({
      period: period(),
      days: [
        day({
          flags: {
            hasUncostedRevenue: false,
            mixedCurrency: true,
            quarantinedFactCount: 0,
          },
        }),
      ],
    });

    expect(result.completeness).toMatchObject({
      complete: false,
      reason: "mixed_currency",
    });
  });

  it("carries payment mix across the included and outside-schedule lanes", () => {
    const mix = (
      rows: Array<{
        method: "cash" | "card" | "mobile_money";
        amountMinor: number;
        tenderUseCount: number;
      }>,
    ) => {
      const totalMinor = rows.reduce((sum, row) => sum + row.amountMinor, 0);
      return {
        status: "complete" as const,
        totalMinor,
        rows: rows.map((row) => ({
          ...row,
          shareBasisPoints:
            totalMinor === 0
              ? 0
              : Math.round((row.amountMinor * 10_000) / totalMinor),
        })),
      };
    };

    const result = foldWeekFromDays({
      period: period(),
      days: [
        day({
          paymentsCollectedMinor: 100,
          paymentMix: mix([
            { method: "cash", amountMinor: 60, tenderUseCount: 1 },
            { method: "card", amountMinor: 40, tenderUseCount: 2 },
          ]),
        }),
        // An open day inside the frame contributes to both lanes' truth.
        day({
          operatingDate: "2026-06-30",
          status: "open",
          paymentsCollectedMinor: 20,
          paymentMix: mix([{ method: "cash", amountMinor: 20, tenderUseCount: 1 }]),
        }),
        // Outside the schedule, but inside the labelled range.
        day({
          operatingDate: "2026-07-05",
          paymentsCollectedMinor: 25,
          paymentMix: mix([
            { method: "mobile_money", amountMinor: 25, tenderUseCount: 1 },
          ]),
        }),
      ],
    });

    expect(result.included.paymentsCollectedMinor).toBe(120);
    expect(result.includedPaymentMix).toEqual({
      status: "complete",
      totalMinor: 120,
      rows: [
        {
          method: "cash",
          amountMinor: 80,
          shareBasisPoints: 6_667,
          tenderUseCount: 2,
        },
        {
          method: "card",
          amountMinor: 40,
          shareBasisPoints: 3_333,
          tenderUseCount: 2,
        },
      ],
    });
    expect(result.outsideSchedulePaymentMix).toEqual({
      status: "complete",
      totalMinor: 25,
      rows: [
        {
          method: "mobile_money",
          amountMinor: 25,
          shareBasisPoints: 10_000,
          tenderUseCount: 1,
        },
      ],
    });
  });

  it("withholds a lane's mix when any contributing day lacks method evidence", () => {
    const complete = {
      status: "complete" as const,
      totalMinor: 100,
      rows: [
        {
          method: "cash" as const,
          amountMinor: 100,
          shareBasisPoints: 10_000,
          tenderUseCount: 1,
        },
      ],
    };

    // A legacy day carries NO mix field at all. Absent is unknown, never zero,
    // so the lane it belongs to cannot publish a reconciled breakdown.
    expect(
      foldWeekFromDays({
        period: period(),
        days: [
          day({ paymentMix: complete }),
          day({ operatingDate: "2026-06-30", paymentsCollectedMinor: 40 }),
        ],
      }).includedPaymentMix,
    ).toEqual({ status: "unavailable" });

    // An explicitly unavailable day poisons its lane the same way.
    expect(
      foldWeekFromDays({
        period: period(),
        days: [
          day({ paymentMix: complete }),
          day({
            operatingDate: "2026-06-30",
            paymentsCollectedMinor: 40,
            paymentMix: { status: "unavailable" },
          }),
        ],
      }).includedPaymentMix,
    ).toEqual({ status: "unavailable" });

    // And a lane whose rows do not add up to its own Payments received total
    // is refused rather than published beside a number it contradicts.
    expect(
      foldWeekFromDays({
        period: period(),
        days: [day({ paymentsCollectedMinor: 140, paymentMix: complete })],
      }).includedPaymentMix,
    ).toEqual({ status: "unavailable" });
  });

  it("does not invent a cutoff baseline when frozen evidence lacks observedAt", () => {
    const result = foldWeekFromAcceptedFacts({
      currency: "GHS",
      factsByDate: new Map([["2026-06-29", [fact({ observedAt: undefined })]]]),
      period: period(),
    });

    expect(result.completeness).toMatchObject({
      complete: false,
      reason: "legacy_fact_without_observed_at",
    });
  });
});

async function seedStore(t: ReturnType<typeof convexTest>, slug: string) {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("athenaUser", { email: `${slug}@test` });
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
        startedAt: NOW,
        completedAt: NOW,
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
      createdAt: NOW,
      updatedAt: NOW,
    });
    return storeId;
  });
}

async function insertFact(
  t: ReturnType<typeof convexTest>,
  storeId: Id<"store">,
  overrides: Partial<Doc<"reportFact">> = {},
) {
  return t.run(async (ctx) =>
    ctx.db.insert("reportFact", {
      storeId,
      sourceDomain: "pos",
      sourceId: "source",
      lineId: "line",
      factKind: "sale",
      fingerprint: "fp",
      fingerprintVersion: 2,
      occurredAt: NOW,
      recordedAt: NOW,
      observedAt: 100,
      operatingDate: "2026-06-29",
      currency: "GHS",
      grossAmountMinor: 100,
      netAmountMinor: 100,
      taxAmountMinor: 0,
      discountAmountMinor: 0,
      quantity: 1,
      ...overrides,
    }),
  );
}

async function insertCompletedClose(
  t: ReturnType<typeof convexTest>,
  args: {
    completedAt: number;
    expenseProductEvidence?: Record<string, unknown>;
    frozenGroups?: Array<{
      key: string;
      members: Array<{
        createdAt: number;
        workItemId: Id<"operationalWorkItem">;
      }>;
      membershipCompleteness: "complete" | "incomplete";
      oldestActionableAt: number;
      productSkuId: Id<"productSku"> | null;
    }>;
    operatingDate: string;
    summary?: Record<string, unknown>;
    storeId: Id<"store">;
  },
) {
  return t.run(async (ctx) => {
    const store = await ctx.db.get("store", args.storeId);
    if (!store) throw new Error("missing fixture store");
    return ctx.db.insert("dailyClose", {
      storeId: args.storeId,
      organizationId: store.organizationId,
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
      summary: args.summary ?? {},
      sourceSubjects: [],
      carryForwardWorkItemIds: [],
      reportSnapshot: {
        snapshotContractVersion: 2,
        closeMetadata: {
          operatingDate: args.operatingDate,
          storeId: args.storeId,
          organizationId: store.organizationId,
          startAt: args.completedAt - 1,
          endAt: args.completedAt,
          completedAt: args.completedAt,
          carryForwardWorkItemIds: [],
        },
        readiness: {
          status: "ready",
          blockerCount: 0,
          reviewCount: 0,
          carryForwardCount: 0,
          readyCount: 0,
        },
        summary: args.summary ?? {},
        ...(args.expenseProductEvidence
          ? { expenseProductEvidence: args.expenseProductEvidence }
          : {}),
        reviewedItems: [],
        carryForwardItems: [],
        carryForwardGroups: [],
        frozenSyncedSaleInventoryReviewGroups: args.frozenGroups ?? [],
        readyItems: [],
        openWorkMembership: {
          completeness: "complete",
          observedLogicalCount: args.frozenGroups?.length ?? 0,
        },
        sourceSubjects: [],
      },
      createdAt: args.completedAt,
      updatedAt: args.completedAt,
      completedAt: args.completedAt,
    });
  });
}

async function insertFoldedCloseDay(
  t: ReturnType<typeof convexTest>,
  args: {
    closeId: Id<"dailyClose">;
    foldedAt?: number;
    operatingDate: string;
    storeId: Id<"store">;
    netSalesMinor?: number;
  },
) {
  return t.run(async (ctx) =>
    ctx.db.insert("reportDay", {
      ...day({
        operatingDate: args.operatingDate,
        netSalesMinor: args.netSalesMinor ?? 100,
      }),
      storeId: args.storeId,
      closeId: args.closeId,
      closeAcceptedAt: NOW,
      closeVarianceMinor: 0,
      foldedAt: args.foldedAt ?? NOW + 1,
      foldVersion: 1,
      factCount: 1,
      lastFactRecordedAt: NOW,
    }),
  );
}

async function insertHistoricalWeekDays(
  t: ReturnType<typeof convexTest>,
  storeId: Id<"store">,
) {
  await t.run(async (ctx) => {
    for (const entry of period().dates) {
      if (entry.localDate === "2026-07-04") continue;
      await ctx.db.insert("reportDay", {
        ...day({
          operatingDate: entry.localDate,
          netSalesMinor: entry.localDate === "2026-06-29" ? 100 : 0,
        }),
        storeId,
        foldedAt: NOW + 1,
        foldVersion: 1,
        factCount: entry.localDate === "2026-06-29" ? 1 : 0,
        lastFactRecordedAt: NOW,
      });
    }
  });
}

describe("computeWeeklyVariancePosture", () => {
  const OUTSIDE_DATE = "2026-07-05";

  function withCloses(entries: Record<string, number>) {
    return period().dates.map((entry) =>
      day({
        operatingDate: entry.localDate,
        ...(entry.localDate in entries
          ? { closeVarianceMinor: entries[entry.localDate] }
          : {}),
      }),
    );
  }

  it("counts a close on an outside-schedule date without inflating coverage", () => {
    const scheduledOnly = computeWeeklyVariancePosture(
      period(),
      withCloses({ "2026-06-29": 5, "2026-06-30": 5 }),
    );
    const withOutside = computeWeeklyVariancePosture(
      period(),
      withCloses({ "2026-06-29": 5, "2026-06-30": 5, [OUTSIDE_DATE]: -400 }),
    );

    expect(withOutside.closeVarianceMinor).toBe(-390);
    expect(withOutside.scheduledVarianceMinor).toBe(10);
    expect(withOutside.outsideScheduleVarianceMinor).toBe(-400);
    expect(withOutside.outsideScheduleCoveredDayCount).toBe(1);
    // Scheduled expectation is the only thing coverage measures, so the
    // outside close cannot move the ratio or complete a partial week.
    expect(withOutside.coverage).toBe("partial");
    expect(withOutside.coveredIncludedDayCount).toBe(
      scheduledOnly.coveredIncludedDayCount,
    );
    expect(withOutside.includedDayCount).toBe(scheduledOnly.includedDayCount);
  });

  it("reports a zero outside lane when every close is scheduled", () => {
    const posture = computeWeeklyVariancePosture(
      period(),
      withCloses({ "2026-06-29": 5, "2026-06-30": -12 }),
    );

    expect(posture.outsideScheduleVarianceMinor).toBe(0);
    expect(posture.outsideScheduleCoveredDayCount).toBe(0);
    expect(posture.closeVarianceMinor).toBe(posture.scheduledVarianceMinor);
    expect(posture.closeVarianceMinor).toBe(-7);
  });
});

describe("weekly materialization", () => {
  it("persists the same partial close evidence on current and the first accepted baseline", async () => {
    const t = convexTest(schema, modules);
    const storeId = await seedStore(t, "weekly-close-evidence");
    const productSkuId = await t.run(async (ctx) => {
      const store = await ctx.db.get("store", storeId);
      if (!store) throw new Error("missing fixture store");
      const categoryId = await ctx.db.insert("category", {
        name: "Expense",
        slug: "expense",
        storeId,
      });
      const subcategoryId = await ctx.db.insert("subcategory", {
        categoryId,
        name: "Expense",
        slug: "expense",
        storeId,
      });
      const userId = await ctx.db.insert("athenaUser", {
        email: "weekly-close-evidence@example.test",
      });
      const productId = await ctx.db.insert("product", {
        availability: "live",
        categoryId,
        createdByUserId: userId,
        currency: "GHS",
        inventoryCount: 0,
        name: "Bag",
        organizationId: store.organizationId,
        slug: "bag",
        storeId,
        subcategoryId,
      });
      return ctx.db.insert("productSku", {
        images: [],
        inventoryCount: 0,
        price: 25,
        productId,
        productName: "Bag fallback",
        quantityAvailable: 0,
        sku: "BAG-01",
        storeId,
      });
    });
    await insertFact(t, storeId, {
      observedAt: NOW + 5,
      productSkuId,
      quantity: 2,
    });
    const closeIds = new Map<string, Id<"dailyClose">>();
    for (const [index, operatingDate] of period().includedDates.entries()) {
      const closeId = await insertCompletedClose(t, {
        completedAt: NOW + index,
        expenseProductEvidence:
          index < 2
            ? {
                contractVersion: 1,
                expenseTotal: 25,
                products: [
                  {
                    productName: "Bag",
                    productSku: "BAG",
                    productSkuId,
                    quantity: 1,
                    spend: 25,
                  },
                ],
                sourceItemCount: 1,
                sourceTransactionCount: 1,
                status: "complete",
              }
            : undefined,
        operatingDate,
        storeId,
        summary: {
          ...(index < 4 ? { netCashVariance: 10 } : {}),
          ...(index < 3
            ? {
                paymentTotals: [
                  { amount: 100, method: "cash", transactionCount: 1 },
                ],
              }
            : {}),
        },
      });
      closeIds.set(operatingDate, closeId);
      await insertFoldedCloseDay(t, {
        closeId,
        foldedAt: NOW + 10,
        operatingDate,
        storeId,
      });
    }

    await t.run(async (ctx) => {
      expect(await rebuildCurrentWeek(ctx, storeId, NOW + 10)).toBe("rebuilt");
      const current = availableWeekCurrent(
        await ctx.db
          .query("reportWeekCurrent")
          .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
          .unique(),
      );
      expect(current?.closeEvidence).toMatchObject({
        cash: {
          cashVarianceMinor: 40,
          coverage: { status: "partial", usableDayCount: 4 },
        },
        payments: {
          coveredTenderValueMinor: 300,
          coverage: { status: "partial", usableDayCount: 3 },
        },
        expenses: {
          coveredSpendMinor: 50,
          coverage: { status: "partial", usableDayCount: 2 },
        },
      });

      const finalCloseId = closeIds.get("2026-07-04");
      if (!finalCloseId) throw new Error("missing final close fixture");
      expect(
        await materializeAcceptedWeek({
          acceptedAt: NOW + 5,
          closeId: finalCloseId,
          ctx,
          cutoffObservedAt: NOW + 5,
          storeId,
        }),
      ).toBe("created");
      const accepted = await ctx.db
        .query("reportWeekAccepted")
        .withIndex("by_storeId_cycleStartDate", (q) =>
          q.eq("storeId", storeId).eq("cycleStartDate", "2026-06-29"),
        )
        .unique();
      expect(accepted?.closeEvidence).toEqual(current?.closeEvidence);
      expect(accepted?.baselineFingerprint).not.toBeUndefined();
      expect(accepted?.topSkuLeaders).toEqual([
        {
          productName: "Bag",
          productSku: "BAG-01",
          productSkuId,
          unitsSold: 2,
        },
      ]);
      const sku = await ctx.db.get("productSku", productSkuId);
      if (!sku) throw new Error("missing fixture SKU");
      await ctx.db.patch("productSku", productSkuId, {
        productName: "Renamed fallback",
        sku: "CHANGED",
      });
      await ctx.db.patch("product", sku.productId, { name: "Renamed product" });
      expect((await ctx.db.get("reportWeekAccepted", accepted!._id))?.topSkuLeaders)
        .toEqual(accepted?.topSkuLeaders);
    });
  });

  it("freezes complete 6-of-6 cash evidence and fully closed lineage on first acceptance", async () => {
    const t = convexTest(schema, modules);
    const storeId = await seedStore(t, "weekly-fully-closed-week");
    const closeIds = new Map<string, Id<"dailyClose">>();
    for (const [index, operatingDate] of period().includedDates.entries()) {
      const closeId = await insertCompletedClose(t, {
        completedAt: NOW + index,
        operatingDate,
        storeId,
        // Mixed signs: the frozen weekly figure is a NET, not a magnitude.
        summary: { netCashVariance: index % 2 === 0 ? 250 : -100 },
      });
      closeIds.set(operatingDate, closeId);
      await insertFoldedCloseDay(t, {
        closeId,
        foldedAt: NOW + 10,
        operatingDate,
        storeId,
      });
    }

    await t.run(async (ctx) => {
      const finalCloseId = closeIds.get("2026-07-04");
      if (!finalCloseId) throw new Error("missing final close fixture");
      expect(
        await materializeAcceptedWeek({
          acceptedAt: NOW + 10,
          closeId: finalCloseId,
          ctx,
          cutoffObservedAt: NOW + 10,
          storeId,
        }),
      ).toBe("created");

      const baseline = await ctx.db
        .query("reportWeekAccepted")
        .withIndex("by_storeId_cycleStartDate", (q) =>
          q.eq("storeId", storeId).eq("cycleStartDate", "2026-06-29"),
        )
        .unique();
      // Every included day — not just the final one — persists as closed.
      const includedLineage = baseline?.scheduleLineage.filter(
        (row) => row.included,
      );
      expect(includedLineage?.map((row) => row.localDate)).toEqual(
        period().includedDates,
      );
      expect(includedLineage?.map((row) => row.dayClosed)).toEqual([
        true,
        true,
        true,
        true,
        true,
        true,
      ]);
      expect(baseline?.closeEvidence?.cash).toEqual({
        cashVarianceMinor: 450,
        coverage: {
          scheduledDayCount: 6,
          status: "complete",
          usableDayCount: 6,
        },
      });
      expect(baseline?.cashVariancePosture).toEqual({
        cashVarianceMinor: 450,
        coverage: "complete",
        coveredIncludedDayCount: 6,
        includedDayCount: 6,
      });
    });
  });

  it("freezes fact-backed mix at acceptance and amends it without touching the baseline", async () => {
    const t = convexTest(schema, modules);
    const storeId = await seedStore(t, "weekly-payment-mix-lifecycle");
    const CUTOFF = NOW + 10;

    /** A payment receipt fact carrying the mix dimensions. */
    const receipt = async (args: {
      sourceId: string;
      amountMinor: number;
      method: "cash" | "card" | "mobile_money";
      participationId: string;
      observedAt: number;
      operatingDate?: string;
    }) =>
      insertFact(t, storeId, {
        sourceDomain: "payments",
        sourceId: args.sourceId,
        lineId: "",
        factKind: "payment",
        fingerprintVersion: 3,
        observedAt: args.observedAt,
        operatingDate: args.operatingDate ?? "2026-06-29",
        grossAmountMinor: args.amountMinor,
        netAmountMinor: args.amountMinor,
        quantity: 0,
        paymentAllocationCoverage: "known",
        paymentAllocationMinor: args.amountMinor,
        paymentMethod: args.method,
        paymentParticipationId: args.participationId,
        paymentMixMinor: args.amountMinor,
      });

    // Split tender on one transaction, plus a repeated same-method allocation
    // on that same transaction: 3 methods of value, but Cash used ONCE.
    await receipt({
      sourceId: "alloc-1",
      amountMinor: 60,
      method: "cash",
      participationId: "txn-1",
      observedAt: NOW,
    });
    await receipt({
      sourceId: "alloc-2",
      amountMinor: 20,
      method: "cash",
      participationId: "txn-1",
      observedAt: NOW,
    });
    await receipt({
      sourceId: "alloc-3",
      amountMinor: 20,
      method: "card",
      participationId: "txn-1",
      observedAt: NOW,
    });

    const closeIds = new Map<string, Id<"dailyClose">>();
    for (const [index, operatingDate] of period().includedDates.entries()) {
      const closeId = await insertCompletedClose(t, {
        completedAt: NOW + index,
        operatingDate,
        storeId,
      });
      closeIds.set(operatingDate, closeId);
      await insertFoldedCloseDay(t, {
        closeId,
        foldedAt: CUTOFF,
        operatingDate,
        storeId,
      });
    }

    /** Every seeded day carries a mix, so no legacy row withholds the lane. */
    const cashOnlyMix = (amountMinor: number) => ({
      status: "complete" as const,
      totalMinor: amountMinor,
      rows: [
        {
          method: "cash" as const,
          amountMinor,
          shareBasisPoints: 10_000,
          tenderUseCount: 1,
        },
      ],
    });
    await t.run(async (ctx) => {
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      const days = await ctx.db
        .query("reportDay")
        .withIndex("by_storeId_operatingDate", (q) => q.eq("storeId", storeId))
        .collect();
      for (const row of days) {
        await ctx.db.patch("reportDay", row._id, {
          paymentMix: cashOnlyMix(row.paymentsCollectedMinor),
        });
      }
    });

    const finalCloseId = closeIds.get("2026-07-04")!;
    const baselineOf = async (ctx: MutationCtx) =>
      ctx.db
        .query("reportWeekAccepted")
        .withIndex("by_storeId_cycleStartDate", (q) =>
          q.eq("storeId", storeId).eq("cycleStartDate", "2026-06-29"),
        )
        .unique();

    const frozen = await t.run(async (ctx) => {
      expect(
        await materializeAcceptedWeek({
          acceptedAt: CUTOFF,
          closeId: finalCloseId,
          ctx,
          cutoffObservedAt: CUTOFF,
          storeId,
        }),
      ).toBe("created");

      const baseline = await baselineOf(ctx);
      expect(baseline?.paymentMix).toEqual({
        status: "complete",
        totalMinor: 100,
        rows: [
          {
            method: "cash",
            amountMinor: 80,
            shareBasisPoints: 8_000,
            // 80 minor across TWO allocations on one transaction is one use.
            tenderUseCount: 1,
          },
          {
            method: "card",
            amountMinor: 20,
            shareBasisPoints: 2_000,
            tenderUseCount: 1,
          },
        ],
      });
      return {
        paymentMix: baseline?.paymentMix,
        baselineFingerprint: baseline?.baselineFingerprint,
      };
    });

    // A payment observed AFTER the cutoff: it is later truth, not baseline
    // truth. The day it lands on has to be refolded for current to see it.
    await receipt({
      sourceId: "alloc-late",
      amountMinor: 50,
      method: "mobile_money",
      participationId: "txn-2",
      observedAt: CUTOFF + 5,
    });

    await t.run(async (ctx) => {
      const day = await ctx.db
        .query("reportDay")
        .withIndex("by_storeId_operatingDate", (q) =>
          q.eq("storeId", storeId).eq("operatingDate", "2026-06-29"),
        )
        .unique();
      await ctx.db.patch("reportDay", day!._id, {
        paymentsCollectedMinor: 150,
        paymentMix: {
          status: "complete",
          totalMinor: 150,
          rows: [
            {
              method: "cash",
              amountMinor: 100,
              shareBasisPoints: 6_667,
              tenderUseCount: 1,
            },
            {
              method: "mobile_money",
              amountMinor: 50,
              shareBasisPoints: 3_333,
              tenderUseCount: 1,
            },
          ],
        },
      });

      expect(await rebuildCurrentWeek(ctx, storeId, CUTOFF + 20)).toBe("rebuilt");
      const current = availableWeekCurrent(
        await ctx.db
          .query("reportWeekCurrent")
          .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
          .unique(),
      );

      // Current moved: five seeded cash-only days plus the amended one.
      expect(current?.included.paymentsCollectedMinor).toBe(650);
      expect(current?.paymentMix).toMatchObject({
        status: "complete",
        totalMinor: 650,
        rows: [
          { method: "cash", amountMinor: 600, tenderUseCount: 6 },
          { method: "mobile_money", amountMinor: 50, tenderUseCount: 1 },
        ],
      });

      // …and the immutable baseline did not.
      const baseline = await baselineOf(ctx);
      expect(baseline?.paymentMix).toEqual(frozen.paymentMix);
      expect(baseline?.baselineFingerprint).toBe(frozen.baselineFingerprint);

      // The mix is part of weekly truth, so the existing amendment path — not
      // a baseline rewrite — carries the later method evidence.
      await refreshAcceptedWeekForDate(ctx, storeId, "2026-06-29", CUTOFF + 30);
      const refreshed = await baselineOf(ctx);
      expect(refreshed?.paymentMix).toEqual(frozen.paymentMix);
      expect(refreshed?.baselineFingerprint).toBe(frozen.baselineFingerprint);
      expect(refreshed?.amendment?.paymentMix).toMatchObject({
        status: "complete",
        totalMinor: 650,
        rows: [
          { method: "cash", amountMinor: 600 },
          { method: "mobile_money", amountMinor: 50 },
        ],
      });
    });
  });

  it("preserves an existing amendment's changedAt when nothing moved", async () => {
    const t = convexTest(schema, modules);
    const storeId = await seedStore(t, "weekly-amendment-changed-at");
    const CUTOFF = NOW + 10;
    const closeIds = new Map<string, Id<"dailyClose">>();
    for (const [index, operatingDate] of period().includedDates.entries()) {
      const closeId = await insertCompletedClose(t, {
        completedAt: NOW + index,
        operatingDate,
        storeId,
      });
      closeIds.set(operatingDate, closeId);
      await insertFoldedCloseDay(t, {
        closeId,
        foldedAt: CUTOFF,
        operatingDate,
        storeId,
      });
    }

    const baselineOf = async (ctx: MutationCtx) =>
      ctx.db
        .query("reportWeekAccepted")
        .withIndex("by_storeId_cycleStartDate", (q) =>
          q.eq("storeId", storeId).eq("cycleStartDate", "2026-06-29"),
        )
        .unique();

    await t.run(async (ctx) => {
      expect(
        await materializeAcceptedWeek({
          acceptedAt: CUTOFF,
          closeId: closeIds.get("2026-07-04")!,
          ctx,
          cutoffObservedAt: CUTOFF,
          storeId,
        }),
      ).toBe("created");

      await refreshAcceptedWeekForDate(ctx, storeId, "2026-07-04", CUTOFF + 20);
      const first = await baselineOf(ctx);
      expect(first?.amendment).toBeDefined();
      const firstChangedAt = first!.amendment!.changedAt;

      // A later refresh over unchanged truth must PRESERVE the timestamp. The
      // stored `currentFingerprint` is the dedupe key, so anything that changes
      // how it is computed re-stamps every existing amendment and tells the
      // reader the week just moved when it did not.
      await refreshAcceptedWeekForDate(ctx, storeId, "2026-07-04", CUTOFF + 999);
      expect((await baselineOf(ctx))?.amendment?.changedAt).toBe(firstChangedAt);
    });
  });

  it("hashes a mixless week exactly as it did before payment mix existed", () => {
    // A legacy accepted row carries no mix. Its truth fingerprint must be
    // byte-identical to the pre-mix hash, or the first refresh after this
    // change re-stamps its amendment's changedAt for no reason.
    const legacyPayload = {
      included: { ...ZERO_WEEK_METRICS },
      outsideSchedule: { ...ZERO_WEEK_METRICS },
      scheduleLineage: [] as ReportWeekLineage[],
    };
    const { transactionCount: _includedCount, ...legacyIncluded } =
      legacyPayload.included;
    const { transactionCount: _outsideCount, ...legacyOutside } =
      legacyPayload.outsideSchedule;
    const preMixHash = stableStringHash(
      JSON.stringify({
        included: legacyIncluded,
        outsideSchedule: legacyOutside,
        scheduleLineage: [],
      }),
    );

    expect(weekTruthFingerprint(legacyPayload)).toBe(preMixHash);
    // An explicitly unavailable lane is equally unknown, so it hashes the same.
    expect(
      weekTruthFingerprint({
        ...legacyPayload,
        paymentMix: { status: "unavailable" },
        outsideSchedulePaymentMix: { status: "unavailable" },
      }),
    ).toBe(preMixHash);
    // A complete mix is knowable truth and changes the hash — but only when
    // the counterpart it is being compared against is knowable too. Absent
    // means "no counterpart", which is exactly the legacy baseline case.
    expect(
      weekTruthFingerprint({
        ...legacyPayload,
        paymentMix: { status: "complete", totalMinor: 0, rows: [] },
        counterpartPaymentMix: { status: "complete", totalMinor: 7, rows: [] },
      }),
    ).not.toBe(preMixHash);
  });

  it("does not re-stamp changedAt when a legacy lane merely becomes knowable", () => {
    // The accepted baseline is legacy: no mix, forever. Once fold version 6
    // drains, the CURRENT fold starts producing a complete mix for the same
    // week. Nothing knowable moved — the baseline never had a knowable mix to
    // move from — so the truth fingerprint must not budge, or every existing
    // amendment gets its changedAt reset the first time it is recomputed.
    const legacyBaseline = {
      included: { ...ZERO_WEEK_METRICS },
      outsideSchedule: { ...ZERO_WEEK_METRICS },
      scheduleLineage: [] as ReportWeekLineage[],
    };
    const completeMix = {
      status: "complete" as const,
      totalMinor: 0,
      rows: [],
    };

    expect(
      weekTruthFingerprint({
        ...legacyBaseline,
        paymentMix: completeMix,
        counterpartPaymentMix: undefined,
        counterpartOutsideSchedulePaymentMix: undefined,
      }),
    ).toBe(weekTruthFingerprint(legacyBaseline));

    // But when the counterpart lane IS knowable, the mix is truth again and
    // must move the hash — otherwise a real method-only correction would
    // never refresh the amendment's changedAt.
    expect(
      weekTruthFingerprint({
        ...legacyBaseline,
        paymentMix: completeMix,
        counterpartPaymentMix: {
          status: "complete",
          totalMinor: 5,
          rows: [],
        },
      }),
    ).not.toBe(weekTruthFingerprint(legacyBaseline));
  });

  it("hashes a lane's knowable truth, so only a real move re-stamps changedAt", () => {
    // The fingerprint's job here is to be the changedAt dedupe key. It must
    // therefore move when — and only when — the amendment gate says the mix
    // moved, or an existing amendment gets a fresh timestamp for nothing.
    const base = {
      included: { ...ZERO_WEEK_METRICS },
      outsideSchedule: { ...ZERO_WEEK_METRICS },
      scheduleLineage: [] as ReportWeekLineage[],
    };
    const cash = {
      status: "complete" as const,
      totalMinor: 100,
      rows: [
        {
          method: "cash" as const,
          amountMinor: 100,
          shareBasisPoints: 10_000,
          tenderUseCount: 1,
        },
      ],
    };
    const card = { ...cash, rows: [{ ...cash.rows[0], method: "card" as const }] };

    // Rollout drain: the baseline froze a complete mix from facts while the
    // day rows still read unavailable. When repair lands and the folded lane
    // becomes complete AND IDENTICAL, nothing moved.
    const duringDrain = weekTruthFingerprint({
      ...base,
      paymentMix: { status: "unavailable" },
      counterpartPaymentMix: cash,
    });
    const afterDrain = weekTruthFingerprint({
      ...base,
      paymentMix: cash,
      counterpartPaymentMix: cash,
    });
    expect(afterDrain).toBe(duringDrain);

    // A lane poisoned by a correction onto an unclassifiable method also did
    // not move the week's knowable truth.
    expect(
      weekTruthFingerprint({
        ...base,
        paymentMix: { status: "unavailable" },
        counterpartPaymentMix: cash,
      }),
    ).toBe(afterDrain);

    // A genuine knowable-to-knowable move must still re-stamp.
    expect(
      weekTruthFingerprint({
        ...base,
        paymentMix: card,
        counterpartPaymentMix: cash,
      }),
    ).not.toBe(afterDrain);
  });

  it("amends on a method-only move that changes no total", async () => {
    const t = convexTest(schema, modules);
    const storeId = await seedStore(t, "weekly-method-only-amendment");
    const CUTOFF = NOW + 10;
    const closeIds = new Map<string, Id<"dailyClose">>();
    for (const [index, operatingDate] of period().includedDates.entries()) {
      const closeId = await insertCompletedClose(t, {
        completedAt: NOW + index,
        operatingDate,
        storeId,
      });
      closeIds.set(operatingDate, closeId);
      await insertFoldedCloseDay(t, {
        closeId,
        foldedAt: CUTOFF,
        operatingDate,
        storeId,
      });
    }

    const laneMix = (method: "cash" | "card") => ({
      status: "complete" as const,
      totalMinor: 100,
      rows: [
        { method, amountMinor: 100, shareBasisPoints: 10_000, tenderUseCount: 1 },
      ],
    });
    const setEveryDayMix = async (
      ctx: MutationCtx,
      mix: ReturnType<typeof laneMix> | { status: "unavailable" },
    ) => {
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      const days = await ctx.db
        .query("reportDay")
        .withIndex("by_storeId_operatingDate", (q) => q.eq("storeId", storeId))
        .collect();
      for (const row of days) {
        await ctx.db.patch("reportDay", row._id, { paymentMix: mix });
      }
    };
    const baselineOf = async (ctx: MutationCtx) =>
      ctx.db
        .query("reportWeekAccepted")
        .withIndex("by_storeId_cycleStartDate", (q) =>
          q.eq("storeId", storeId).eq("cycleStartDate", "2026-06-29"),
        )
        .unique();

    await t.run(async (ctx) => {
      await setEveryDayMix(ctx, laneMix("cash"));
      expect(
        await materializeAcceptedWeek({
          acceptedAt: CUTOFF,
          closeId: closeIds.get("2026-07-04")!,
          ctx,
          cutoffObservedAt: CUTOFF,
          storeId,
        }),
      ).toBe("created");
      // Acceptance folds from cutoff facts while amendments fold from days.
      // Align the baseline to the day-derived lanes so the ONLY variable left
      // in this test is the method evidence.
      expect(await rebuildCurrentWeek(ctx, storeId, CUTOFF + 5)).toBe("rebuilt");
      const current = availableWeekCurrent(
        await ctx.db
          .query("reportWeekCurrent")
          .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
          .unique(),
      );
      const baseline = await baselineOf(ctx);
      await ctx.db.patch("reportWeekAccepted", baseline!._id, {
        included: current!.included,
        outsideSchedule: current!.outsideSchedule,
        scheduleLineage: current!.scheduleLineage,
        paymentMix: current!.paymentMix,
        outsideSchedulePaymentMix: current!.outsideSchedulePaymentMix,
        amendment: undefined,
      });

      // A method-only move: no total changes, but the week's method truth
      // does, and that has to reach the reader through the amendment path.
      // (The converse — an unavailable lane must NOT argue for an amendment —
      // is pinned by the weekly source verifier suite, whose fixtures carry
      // pre-mix legacy days against fact-derived baselines.)
      await setEveryDayMix(ctx, laneMix("card"));
      await refreshAcceptedWeekForDate(ctx, storeId, "2026-07-04", CUTOFF + 30);
      const amended = await baselineOf(ctx);
      expect(amended?.amendment?.includedNetSalesDeltaMinor).toBe(0);
      expect(amended?.amendment?.paymentMix).toMatchObject({
        status: "complete",
        rows: [{ method: "card", amountMinor: 600 }],
      });
    });
  });

  it("treats a legacy weekly row without mix fields as unavailable, never empty", async () => {
    const t = convexTest(schema, modules);
    const storeId = await seedStore(t, "weekly-legacy-mix");
    // A day folded before the mix landed: payments received, no method
    // evidence. Absent must not read as a zero-row breakdown.
    await t.run(async (ctx) => {
      await ctx.db.insert("reportDay", {
        ...day({ operatingDate: "2026-06-29", paymentsCollectedMinor: 100 }),
        storeId,
        foldedAt: NOW + 1,
        foldVersion: 1,
        factCount: 1,
        lastFactRecordedAt: NOW,
      });

      expect(await rebuildCurrentWeek(ctx, storeId, NOW + 20)).toBe("rebuilt");
      const current = availableWeekCurrent(
        await ctx.db
          .query("reportWeekCurrent")
          .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
          .unique(),
      );
      expect(current?.included.paymentsCollectedMinor).toBe(100);
      expect(current?.paymentMix).toEqual({ status: "unavailable" });
    });
  });

  it("does not publish zero activity while a scheduled day fold is still pending", async () => {
    const t = convexTest(schema, modules);
    const storeId = await seedStore(t, "weekly-pending-day");
    await t.run(async (ctx) => {
      await ctx.db.insert("reportDirtyDay", {
        storeId,
        operatingDate: "2026-07-01",
        reason: "write_failure",
        markedAt: NOW,
      });

      expect(await rebuildCurrentWeek(ctx, storeId, NOW)).toBe("unavailable");
      expect(
        await ctx.db
          .query("reportWeekCurrent")
          .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
          .unique(),
      ).toMatchObject({
        availability: "unavailable",
        unavailableReason: "missing_day_fold",
        lifecyclePosture: "materializing",
        amendmentPosture: "none",
      });
    });
  });

  it("retains verified weekly values while a replacement day fold is pending", async () => {
    const t = convexTest(schema, modules);
    const storeId = await seedStore(t, "weekly-retained-pending-day");
    await t.run(async (ctx) => {
      expect(await rebuildCurrentWeek(ctx, storeId, NOW)).toBe("rebuilt");
      const before = availableWeekCurrent(
        await ctx.db
          .query("reportWeekCurrent")
          .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
          .unique(),
      );
      if (!before) throw new Error("expected verified weekly singleton");
      await ctx.db.insert("reportDirtyDay", {
        storeId,
        operatingDate: "2026-07-01",
        reason: "write_failure",
        markedAt: NOW + 1,
      });

      expect(await rebuildCurrentWeek(ctx, storeId, NOW + 1)).toBe(
        "unavailable",
      );
      const retained = availableWeekCurrent(
        await ctx.db
          .query("reportWeekCurrent")
          .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
          .unique(),
      );
      expect(retained).toMatchObject({
        _id: before._id,
        availability: "available",
        cycleStartDate: before.cycleStartDate,
        cycleEndDate: before.cycleEndDate,
        included: before.included,
        outsideSchedule: before.outsideSchedule,
        scheduleLineage: before.scheduleLineage,
        lifecyclePosture: "materializing",
        amendmentPosture: "none",
        completeness: { complete: false, reason: "missing_day_fold" },
      });
    });
  });

  it("replaces the live singleton from bounded reportDay inputs", async () => {
    const t = convexTest(schema, modules);
    const storeId = await seedStore(t, "weekly-live");
    await t.run(async (ctx) => {
      for (const entry of period().dates) {
        await ctx.db.insert("reportDay", {
          ...day({
            operatingDate: entry.localDate,
            closeVarianceMinor: entry.included ? 5 : 100,
          }),
          storeId,
          foldVersion: 1,
          factCount: 1,
          lastFactRecordedAt: NOW,
        });
      }
      await ctx.db.insert("operationalWorkItem", {
        approvalState: "not_required",
        createdAt: NOW,
        organizationId: (await ctx.db.get("store", storeId))!.organizationId,
        priority: "normal",
        status: "open",
        storeId,
        title: "Review inventory",
        type: "synced_sale_inventory_review",
      });
      expect(await rebuildCurrentWeek(ctx, storeId, NOW)).toBe("rebuilt");
      const current = availableWeekCurrent(
        await ctx.db
          .query("reportWeekCurrent")
          .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
          .unique(),
      );
      expect(current?.included.netSalesMinor).toBe(600);
      expect(current?.outsideSchedule.netSalesMinor).toBe(100);
      expect(current?.completeness).toEqual({
        complete: true,
        reason: "complete",
        outsideSchedule: { complete: true, reason: "complete" },
      });
      expect(current?.variancePosture).toEqual({
        // The Sunday close is outside the schedule and still real money.
        closeVarianceMinor: 130,
        coverage: "complete",
        coveredIncludedDayCount: 6,
        includedDayCount: 6,
        scheduledVarianceMinor: 30,
        outsideScheduleVarianceMinor: 100,
        outsideScheduleCoveredDayCount: 1,
      });
      expect(current).toMatchObject({
        availability: "available",
        lifecyclePosture: "awaiting_final_close",
        amendmentPosture: "none",
        inventoryAttention: {
          carriedForwardCount: 0,
          completeness: "complete",
          newCount: 1,
          observedCount: 1,
          overflow: false,
        },
      });
    });
  });

  it("retains verified values when schedule history temporarily exceeds its cap", async () => {
    const t = convexTest(schema, modules);
    const storeId = await seedStore(t, "weekly-schedule-cap");
    await t.run(async (ctx) => {
      expect(await rebuildCurrentWeek(ctx, storeId, NOW)).toBe("rebuilt");
      const before = availableWeekCurrent(
        await ctx.db
          .query("reportWeekCurrent")
          .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
          .unique(),
      );
      if (!before) throw new Error("expected live weekly singleton");
      const store = await ctx.db.get("store", storeId);
      if (!store) throw new Error("missing fixture store");

      for (let index = 0; index < WEEKLY_SCHEDULE_READ_LIMIT; index += 1) {
        await ctx.db.insert("storeSchedule", {
          organizationId: store.organizationId,
          storeId,
          timezone: "UTC",
          weeklyWindows: [],
          weeklyClosedDays: [0],
          dateExceptions: [],
          reportingCycleStartsOn: 1,
          effectiveFrom: NOW + index + 1,
          status: "active",
          source: "admin",
          createdAt: NOW,
          updatedAt: NOW,
        });
      }

      expect(await rebuildCurrentWeek(ctx, storeId, NOW + 1)).toBe(
        "unavailable",
      );
      expect(
        await ctx.db
          .query("reportWeekCurrent")
          .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
          .unique(),
      ).toMatchObject({
        _id: before._id,
        availability: "available",
        included: before.included,
        scheduleLineage: before.scheduleLineage,
        lifecyclePosture: "materializing",
        completeness: {
          complete: false,
          reason: "schedule_history_cap",
        },
      });
    });
  });

  it("stores the real recompute transition before refreshing accepted truth", async () => {
    const t = convexTest(schema, modules);
    const storeId = await seedStore(t, "weekly-recompute-posture");
    const closeId = await insertCompletedClose(t, {
      completedAt: NOW,
      operatingDate: "2026-07-04",
      storeId,
    });
    await t.run(async (ctx) => {
      await rebuildCurrentWeek(ctx, storeId, NOW);
      const current = availableWeekCurrent(
        await ctx.db
          .query("reportWeekCurrent")
          .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
          .unique(),
      );
      if (!current) throw new Error("expected available weekly singleton");
      const acceptedBaselineId = await ctx.db.insert("reportWeekAccepted", {
        storeId,
        cycleStartDate: current.cycleStartDate,
        cycleEndDate: current.cycleEndDate,
        currency: current.currency,
        metricVersion: current.metricVersion,
        acceptedAt: NOW,
        cutoffObservedAt: NOW,
        closeId,
        baselineFingerprint: "baseline",
        included: current.included,
        outsideSchedule: current.outsideSchedule,
        scheduleLineage: current.scheduleLineage,
        completeness: current.completeness,
        lifecyclePosture: "accepted",
        amendmentPosture: "none",
      });
      await ctx.db.patch("reportWeekCurrent", current._id, {
        acceptedBaselineId,
        lifecyclePosture: "accepted",
        amendmentPosture: "none",
      });

      await markWeekDirty(ctx, storeId, "day_folded", NOW + 1);

      expect(await ctx.db.get("reportWeekCurrent", current._id)).toMatchObject({
        lifecyclePosture: "accepted",
        amendmentPosture: "pending_recompute",
      });
      expect(
        await ctx.db.get("reportWeekAccepted", acceptedBaselineId),
      ).toMatchObject({
        lifecyclePosture: "accepted",
        amendmentPosture: "pending_recompute",
      });
    });
  });

  it("keeps current inventory attention explicitly incomplete after the canonical Open Work cap", async () => {
    const t = convexTest(schema, modules);
    const storeId = await seedStore(t, "weekly-live-inventory-cap");
    await t.run(async (ctx) => {
      const store = await ctx.db.get("store", storeId);
      if (!store) throw new Error("missing fixture store");
      for (let index = 0; index < 501; index += 1) {
        await ctx.db.insert("operationalWorkItem", {
          approvalState: "not_required",
          createdAt: NOW,
          metadata: { localTransactionId: `sale-${index}` },
          organizationId: store.organizationId,
          priority: "normal",
          productSkuId:
            "000000000000000000000001001productSku" as Id<"productSku">,
          status: "open",
          storeId,
          title: "Review inventory",
          type: "synced_sale_inventory_review",
        });
      }

      expect(await rebuildCurrentWeek(ctx, storeId, NOW)).toBe("rebuilt");
      const current = availableWeekCurrent(
        await ctx.db
          .query("reportWeekCurrent")
          .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
          .unique(),
      );
      expect(current?.inventoryAttention).toMatchObject({
        completeness: "incomplete",
        observedCount: 1,
        overflow: true,
      });
    });
  });

  it("resolves prior values under the prior frame schedule and names changed membership", async () => {
    const t = convexTest(schema, modules);
    const storeId = await seedStore(t, "weekly-prior-schedule");
    await t.run(async (ctx) => {
      const schedules = await ctx.db
        .query("storeSchedule")
        .withIndex("by_storeId_status_effectiveFrom", (q) =>
          q.eq("storeId", storeId).eq("status", "active"),
        )
        .take(2);
      const priorSchedule = schedules[0];
      if (!priorSchedule) throw new Error("missing fixture schedule");
      await ctx.db.patch("storeSchedule", priorSchedule._id, {
        effectiveTo: Date.parse("2026-06-29T00:00:00.000Z"),
        status: "superseded",
        weeklyClosedDays: [0, 6],
      });
      await ctx.db.insert("storeSchedule", {
        organizationId: priorSchedule.organizationId,
        storeId,
        timezone: priorSchedule.timezone,
        weeklyWindows: priorSchedule.weeklyWindows,
        dateExceptions: priorSchedule.dateExceptions,
        reportingCycleStartsOn: priorSchedule.reportingCycleStartsOn,
        effectiveFrom: Date.parse("2026-06-29T00:00:00.000Z"),
        status: "active",
        source: priorSchedule.source,
        weeklyClosedDays: [0],
        createdAt: NOW,
        updatedAt: NOW,
      });
      for (let offset = 0; offset < 14; offset += 1) {
        const operatingDate = new Date(
          Date.parse("2026-06-22T12:00:00.000Z") + offset * 86_400_000,
        )
          .toISOString()
          .slice(0, 10);
        await ctx.db.insert("reportDay", {
          ...day({
            operatingDate,
            netSalesMinor: offset < 7 ? 10 : 100,
          }),
          storeId,
          foldedAt: NOW,
          foldVersion: 1,
          factCount: 1,
          lastFactRecordedAt: NOW,
        });
      }

      expect(await rebuildCurrentWeek(ctx, storeId, NOW)).toBe("rebuilt");
      const current = availableWeekCurrent(
        await ctx.db
          .query("reportWeekCurrent")
          .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
          .unique(),
      );
      expect(current?.priorPeriod).toMatchObject({
        comparabilityReason: "scheduled_membership_changed",
        currentScheduledPositionCount: 6,
        equivalentScheduledPositions: false,
        priorScheduledPositionCount: 5,
        values: { netSalesMinor: 40 },
      });
    });
  });

  it("folds a live scheduled prior date only through the matching noon cutoff", async () => {
    const t = convexTest(schema, modules);
    const storeId = await seedStore(t, "weekly-prior-noon-cutoff");
    await t.run(async (ctx) => {
      for (let offset = 0; offset < 7; offset += 1) {
        const operatingDate = new Date(
          Date.parse("2026-06-22T12:00:00.000Z") + offset * 86_400_000,
        )
          .toISOString()
          .slice(0, 10);
        await ctx.db.insert("reportDay", {
          ...day({
            operatingDate,
            netSalesMinor: operatingDate === "2026-06-27" ? 999 : 10,
          }),
          storeId,
          foldVersion: 1,
          factCount: 1,
          lastFactRecordedAt: NOW,
        });
      }
    });
    await insertFact(t, storeId, {
      occurredAt: Date.parse("2026-06-27T11:59:00.000Z"),
      operatingDate: "2026-06-27",
      sourceId: "before-noon",
    });
    await insertFact(t, storeId, {
      grossAmountMinor: 500,
      netAmountMinor: 500,
      occurredAt: Date.parse("2026-06-27T12:01:00.000Z"),
      operatingDate: "2026-06-27",
      sourceId: "after-noon",
    });

    await t.run(async (ctx) => {
      expect(await rebuildCurrentWeek(ctx, storeId, NOW)).toBe("rebuilt");
      const current = availableWeekCurrent(
        await ctx.db
          .query("reportWeekCurrent")
          .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
          .unique(),
      );
      expect(current?.priorPeriod).toMatchObject({
        comparabilityReason: "comparable",
        currentScheduledPositionCount: 6,
        priorScheduledPositionCount: 6,
        values: { netSalesMinor: 150 },
      });
    });
  });

  it("persists the prior period's outside-schedule lane inside the mirrored window", async () => {
    const t = convexTest(schema, modules);
    const storeId = await seedStore(t, "weekly-prior-outside-lane");
    await t.run(async (ctx) => {
      const schedule = await ctx.db
        .query("storeSchedule")
        .withIndex("by_storeId_status_effectiveFrom", (q) =>
          q.eq("storeId", storeId).eq("status", "active"),
        )
        .unique();
      if (!schedule) throw new Error("missing fixture schedule");
      // Close Mondays so the prior week's excluded date falls inside the
      // elapsed window the comparison mirrors.
      await ctx.db.patch("storeSchedule", schedule._id, {
        weeklyClosedDays: [1],
      });
      for (let offset = 0; offset < 7; offset += 1) {
        const operatingDate = new Date(
          Date.parse("2026-06-22T12:00:00.000Z") + offset * 86_400_000,
        )
          .toISOString()
          .slice(0, 10);
        await ctx.db.insert("reportDay", {
          ...day({
            operatingDate,
            netSalesMinor: operatingDate === "2026-06-22" ? 500 : 10,
          }),
          storeId,
          foldVersion: 1,
          factCount: 1,
          lastFactRecordedAt: NOW,
        });
      }

      expect(await rebuildCurrentWeek(ctx, storeId, NOW)).toBe("rebuilt");
      const current = availableWeekCurrent(
        await ctx.db
          .query("reportWeekCurrent")
          .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
          .unique(),
      );
      expect(current?.priorPeriod).toMatchObject({
        comparabilityReason: "comparable",
        outsideScheduleValues: { netSalesMinor: 500 },
      });
      expect(current?.priorPeriod?.values?.netSalesMinor).not.toBe(500);
    });
  });

  it("withholds the prior outside-schedule lane when that lane is incomplete", async () => {
    const t = convexTest(schema, modules);
    const storeId = await seedStore(t, "weekly-prior-outside-incomplete");
    await t.run(async (ctx) => {
      const schedule = await ctx.db
        .query("storeSchedule")
        .withIndex("by_storeId_status_effectiveFrom", (q) =>
          q.eq("storeId", storeId).eq("status", "active"),
        )
        .unique();
      if (!schedule) throw new Error("missing fixture schedule");
      await ctx.db.patch("storeSchedule", schedule._id, {
        weeklyClosedDays: [1],
      });
      for (let offset = 0; offset < 7; offset += 1) {
        const operatingDate = new Date(
          Date.parse("2026-06-22T12:00:00.000Z") + offset * 86_400_000,
        )
          .toISOString()
          .slice(0, 10);
        const base = day({ operatingDate, netSalesMinor: 10 });
        await ctx.db.insert("reportDay", {
          ...base,
          ...(operatingDate === "2026-06-22"
            ? { flags: { ...base.flags, mixedCurrency: true } }
            : {}),
          storeId,
          foldVersion: 1,
          factCount: 1,
          lastFactRecordedAt: NOW,
        });
      }

      expect(await rebuildCurrentWeek(ctx, storeId, NOW)).toBe("rebuilt");
      const current = availableWeekCurrent(
        await ctx.db
          .query("reportWeekCurrent")
          .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
          .unique(),
      );
      // The scheduled lane is still a valid comparison; the total is not.
      expect(current?.priorPeriod).toMatchObject({
        comparabilityReason: "comparable",
        outsideScheduleValues: null,
      });
      expect(current?.priorPeriod?.values).not.toBeNull();
    });
  });

  it("uses the current and prior periods' own timezones for the live cutoff", async () => {
    const t = convexTest(schema, modules);
    const storeId = await seedStore(t, "weekly-prior-effective-timezones");
    await t.run(async (ctx) => {
      const priorSchedule = await ctx.db
        .query("storeSchedule")
        .withIndex("by_storeId_status_effectiveFrom", (q) =>
          q.eq("storeId", storeId).eq("status", "active"),
        )
        .unique();
      if (!priorSchedule) throw new Error("missing fixture schedule");
      const currentEffectiveFrom = Date.parse("2026-06-29T04:00:00.000Z");
      await ctx.db.patch("storeSchedule", priorSchedule._id, {
        effectiveTo: currentEffectiveFrom,
        status: "superseded",
        timezone: "America/Los_Angeles",
      });
      await ctx.db.insert("storeSchedule", {
        organizationId: priorSchedule.organizationId,
        storeId,
        timezone: "America/New_York",
        weeklyWindows: priorSchedule.weeklyWindows,
        weeklyClosedDays: priorSchedule.weeklyClosedDays,
        dateExceptions: priorSchedule.dateExceptions,
        reportingCycleStartsOn: priorSchedule.reportingCycleStartsOn,
        effectiveFrom: currentEffectiveFrom,
        status: "active",
        source: priorSchedule.source,
        createdAt: NOW,
        updatedAt: NOW,
      });
      for (let offset = 0; offset < 7; offset += 1) {
        const operatingDate = new Date(
          Date.parse("2026-06-22T12:00:00.000Z") + offset * 86_400_000,
        )
          .toISOString()
          .slice(0, 10);
        await ctx.db.insert("reportDay", {
          ...day({ operatingDate, netSalesMinor: 0 }),
          storeId,
          foldVersion: 1,
          factCount: 0,
          lastFactRecordedAt: NOW,
        });
      }
    });
    await insertFact(t, storeId, {
      occurredAt: Date.parse("2026-06-27T14:59:00.000Z"), // 07:59 PDT
      operatingDate: "2026-06-27",
      sourceId: "before-prior-local-cutoff",
    });
    await insertFact(t, storeId, {
      grossAmountMinor: 500,
      netAmountMinor: 500,
      occurredAt: Date.parse("2026-06-27T15:01:00.000Z"), // 08:01 PDT
      operatingDate: "2026-06-27",
      sourceId: "after-prior-local-cutoff",
    });

    await t.run(async (ctx) => {
      expect(await rebuildCurrentWeek(ctx, storeId, NOW)).toBe("rebuilt");
      const current = availableWeekCurrent(
        await ctx.db
          .query("reportWeekCurrent")
          .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
          .unique(),
      );
      expect(current?.priorPeriod).toMatchObject({
        comparabilityReason: "comparable",
        currentScheduledPositionCount: 6,
        priorScheduledPositionCount: 6,
        values: { netSalesMinor: 100 },
      });
    });
  });

  it("uses the schedule effective now when the timezone changes within the frame", async () => {
    const t = convexTest(schema, modules);
    const storeId = await seedStore(t, "weekly-intra-frame-timezone");
    const now = Date.parse("2026-07-04T04:30:00.000Z"); // 00:30 EDT, 21:30 PDT
    await t.run(async (ctx) => {
      const priorSchedule = await ctx.db
        .query("storeSchedule")
        .withIndex("by_storeId_status_effectiveFrom", (q) =>
          q.eq("storeId", storeId).eq("status", "active"),
        )
        .unique();
      if (!priorSchedule) throw new Error("missing fixture schedule");
      const currentEffectiveFrom = Date.parse("2026-07-02T07:00:00.000Z");
      await ctx.db.patch("storeSchedule", priorSchedule._id, {
        effectiveTo: currentEffectiveFrom,
        status: "superseded",
        timezone: "America/Los_Angeles",
      });
      await ctx.db.insert("storeSchedule", {
        organizationId: priorSchedule.organizationId,
        storeId,
        timezone: "America/New_York",
        weeklyWindows: priorSchedule.weeklyWindows,
        weeklyClosedDays: priorSchedule.weeklyClosedDays,
        dateExceptions: priorSchedule.dateExceptions,
        reportingCycleStartsOn: priorSchedule.reportingCycleStartsOn,
        effectiveFrom: currentEffectiveFrom,
        status: "active",
        source: priorSchedule.source,
        createdAt: now,
        updatedAt: now,
      });
      for (let offset = 0; offset < 7; offset += 1) {
        const operatingDate = new Date(
          Date.parse("2026-06-22T12:00:00.000Z") + offset * 86_400_000,
        )
          .toISOString()
          .slice(0, 10);
        await ctx.db.insert("reportDay", {
          ...day({ operatingDate, netSalesMinor: 0 }),
          storeId,
          foldVersion: 1,
          factCount: 0,
          lastFactRecordedAt: now,
        });
      }
    });
    await insertFact(t, storeId, {
      occurredAt: Date.parse("2026-06-27T07:15:00.000Z"), // 00:15 PDT
      operatingDate: "2026-06-27",
      sourceId: "before-intra-frame-cutoff",
    });
    await insertFact(t, storeId, {
      grossAmountMinor: 500,
      netAmountMinor: 500,
      occurredAt: Date.parse("2026-06-27T07:45:00.000Z"), // 00:45 PDT
      operatingDate: "2026-06-27",
      sourceId: "after-intra-frame-cutoff",
    });

    await t.run(async (ctx) => {
      expect(await rebuildCurrentWeek(ctx, storeId, now)).toBe("rebuilt");
      const current = availableWeekCurrent(
        await ctx.db
          .query("reportWeekCurrent")
          .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
          .unique(),
      );
      expect(current?.priorPeriod).toMatchObject({
        comparabilityReason: "comparable",
        currentScheduledPositionCount: 6,
        priorScheduledPositionCount: 6,
        values: { netSalesMinor: 100 },
      });
    });
  });

  it("preserves the local wall-clock cutoff across a daylight-saving transition", async () => {
    const t = convexTest(schema, modules);
    const storeId = await seedStore(t, "weekly-prior-dst-cutoff");
    const now = Date.parse("2026-03-15T16:30:00.000Z"); // 12:30 EDT
    await t.run(async (ctx) => {
      const schedule = await ctx.db
        .query("storeSchedule")
        .withIndex("by_storeId_status_effectiveFrom", (q) =>
          q.eq("storeId", storeId).eq("status", "active"),
        )
        .unique();
      if (!schedule) throw new Error("missing fixture schedule");
      await ctx.db.patch("storeSchedule", schedule._id, {
        timezone: "America/New_York",
        weeklyClosedDays: [],
      });
      for (let offset = 0; offset < 7; offset += 1) {
        const operatingDate = new Date(
          Date.parse("2026-03-02T12:00:00.000Z") + offset * 86_400_000,
        )
          .toISOString()
          .slice(0, 10);
        await ctx.db.insert("reportDay", {
          ...day({
            operatingDate,
            netSalesMinor: operatingDate === "2026-03-08" ? 999 : 0,
          }),
          storeId,
          foldVersion: 1,
          factCount: 1,
          lastFactRecordedAt: now,
        });
      }
    });
    await insertFact(t, storeId, {
      occurredAt: Date.parse("2026-03-08T16:15:00.000Z"), // 12:15 EDT
      operatingDate: "2026-03-08",
      sourceId: "before-dst-cutoff",
    });
    await insertFact(t, storeId, {
      grossAmountMinor: 500,
      netAmountMinor: 500,
      occurredAt: Date.parse("2026-03-08T16:45:00.000Z"), // 12:45 EDT
      operatingDate: "2026-03-08",
      sourceId: "after-dst-cutoff",
    });

    await t.run(async (ctx) => {
      expect(await rebuildCurrentWeek(ctx, storeId, now)).toBe("rebuilt");
      const current = availableWeekCurrent(
        await ctx.db
          .query("reportWeekCurrent")
          .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
          .unique(),
      );
      expect(current?.priorPeriod).toMatchObject({
        comparabilityReason: "comparable",
        currentScheduledPositionCount: 7,
        priorScheduledPositionCount: 7,
        values: { netSalesMinor: 100 },
      });
    });
  });

  it("keeps the prior comparison explicitly incomplete when its live cutoff fact probe overflows", async () => {
    const t = convexTest(schema, modules);
    const storeId = await seedStore(t, "weekly-prior-cutoff-cap");
    await t.run(async (ctx) => {
      for (
        let index = 0;
        index <= MAX_WEEKLY_LIVE_PRIOR_CUTOFF_FACTS;
        index += 1
      ) {
        await ctx.db.insert("reportFact", {
          currency: "GHS",
          discountAmountMinor: 0,
          factKind: "sale",
          fingerprint: "fp",
          fingerprintVersion: 2,
          grossAmountMinor: 100,
          lineId: "line",
          netAmountMinor: 100,
          observedAt: 100,
          occurredAt: Date.parse("2026-06-27T11:59:00.000Z"),
          operatingDate: "2026-06-27",
          quantity: 1,
          recordedAt: NOW,
          sourceDomain: "pos",
          sourceId: `cutoff-cap-${index}`,
          storeId,
          taxAmountMinor: 0,
        });
      }

      expect(await rebuildCurrentWeek(ctx, storeId, NOW)).toBe("rebuilt");
      const current = availableWeekCurrent(
        await ctx.db
          .query("reportWeekCurrent")
          .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
          .unique(),
      );
      expect(current?.priorPeriod).toMatchObject({
        comparabilityReason: "prior_incomplete",
        values: null,
      });
    });
  });

  it("uses one shared fact cap and keeps a late-observed fact out of the immutable baseline", async () => {
    const t = convexTest(schema, modules);
    const storeId = await seedStore(t, "weekly-accepted");
    await insertFact(t, storeId, { observedAt: 100, sourceId: "before" });
    await insertFact(t, storeId, {
      observedAt: 101,
      sourceId: "after",
      netAmountMinor: 500,
      grossAmountMinor: 500,
    });

    await t.run(async (ctx) => {
      const store = await ctx.db.get("store", storeId);
      if (!store) throw new Error("missing fixture store");
      const closeId = await ctx.db.insert("dailyClose", {
        storeId,
        organizationId: store.organizationId,
        operatingDate: "2026-07-04",
        status: "completed",
        isCurrent: true,
        readiness: {
          status: "ready",
          blockerCount: 0,
          reviewCount: 0,
          carryForwardCount: 0,
          readyCount: 0,
        },
        summary: {},
        sourceSubjects: [],
        carryForwardWorkItemIds: [],
        createdAt: NOW,
        updatedAt: NOW,
        completedAt: NOW,
      });
      await ctx.db.insert("reportDay", {
        ...day({
          flags: {
            hasUncostedRevenue: true,
            mixedCurrency: false,
            quarantinedFactCount: 0,
          },
          grossProfitMinor: null,
          grossSalesMinor: 600,
          netSalesMinor: 600,
          operatingDate: "2026-07-04",
          uncostedRevenueMinor: 600,
          unitsSold: 2,
        }),
        storeId,
        closeId,
        closeAcceptedAt: NOW,
        closeVarianceMinor: 0,
        foldedAt: NOW + 1,
        foldVersion: 1,
        factCount: 1,
        lastFactRecordedAt: NOW,
      });
      expect(
        await materializeAcceptedWeek({
          acceptedAt: NOW,
          closeId,
          ctx,
          cutoffObservedAt: 100,
          storeId,
        }),
      ).toBe("created");
      const baseline = await ctx.db
        .query("reportWeekAccepted")
        .withIndex("by_storeId_cycleStartDate", (q) =>
          q.eq("storeId", storeId).eq("cycleStartDate", "2026-06-29"),
        )
        .unique();
      expect(baseline?.included.netSalesMinor).toBe(100);
      expect(
        baseline?.scheduleLineage.find(
          (entry) => entry.localDate === "2026-07-04",
        )?.dayClosed,
      ).toBe(true);
      expect(baseline?.amendment).toMatchObject({
        included: { netSalesMinor: 600 },
        includedNetSalesDeltaMinor: 500,
      });
      expect(baseline?.inventoryAttention).toMatchObject({
        completeness: "unavailable",
        observedCount: 0,
      });
      await ctx.db.insert("operationalWorkItem", {
        approvalState: "not_required",
        createdAt: NOW,
        organizationId: store.organizationId,
        priority: "normal",
        status: "open",
        storeId,
        title: "Review inventory",
        type: "synced_sale_inventory_review",
      });
      expect(await rebuildCurrentWeek(ctx, storeId, NOW)).toBe("rebuilt");
      const current = availableWeekCurrent(
        await ctx.db
          .query("reportWeekCurrent")
          .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
          .unique(),
      );
      expect(current?.amendment).toMatchObject({
        included: { netSalesMinor: 600 },
        includedNetSalesDeltaMinor: 500,
      });
      const unchangedBaseline = await ctx.db
        .query("reportWeekAccepted")
        .withIndex("by_storeId_cycleStartDate", (q) =>
          q.eq("storeId", storeId).eq("cycleStartDate", "2026-06-29"),
        )
        .unique();
      expect(current?.inventoryAttention).toMatchObject({
        completeness: "complete",
        newCount: 1,
        observedCount: 1,
      });
      expect(unchangedBaseline?.inventoryAttention).toMatchObject({
        completeness: "unavailable",
        observedCount: 0,
      });
    });

    expect(MAX_WEEKLY_FACTS).toBeGreaterThan(0);
  });

  it("publishes no accepted baseline while a frame day fold is pending", async () => {
    const t = convexTest(schema, modules);
    const storeId = await seedStore(t, "weekly-accepted-pending-day");
    await insertFact(t, storeId, { observedAt: 100 });

    await t.run(async (ctx) => {
      const store = await ctx.db.get("store", storeId);
      if (!store) throw new Error("missing fixture store");
      const closeId = await ctx.db.insert("dailyClose", {
        storeId,
        organizationId: store.organizationId,
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
        summary: {},
        sourceSubjects: [],
        carryForwardWorkItemIds: [],
        createdAt: NOW,
        updatedAt: NOW,
        completedAt: NOW,
      });
      await ctx.db.insert("reportDay", {
        ...day({ operatingDate: "2026-07-04" }),
        storeId,
        closeId,
        closeAcceptedAt: NOW,
        foldedAt: NOW + 1,
        foldVersion: 1,
        factCount: 1,
        lastFactRecordedAt: NOW,
      });
      await ctx.db.insert("reportDirtyDay", {
        storeId,
        operatingDate: "2026-07-01",
        reason: "write_failure",
        markedAt: NOW,
      });

      expect(
        await materializeAcceptedWeek({
          acceptedAt: NOW,
          closeId,
          ctx,
          cutoffObservedAt: 100,
          storeId,
        }),
      ).toBe("incomplete");
      expect(
        await ctx.db
          .query("reportWeekAccepted")
          .withIndex("by_storeId_cycleStartDate", (q) =>
            q.eq("storeId", storeId).eq("cycleStartDate", "2026-06-29"),
          )
          .unique(),
      ).toBeNull();
    });
  });

  it("accepts only the final scheduled folded close and recovers idempotently", async () => {
    const t = convexTest(schema, modules);
    const storeId = await seedStore(t, "weekly-final-close");
    await insertFact(t, storeId, { observedAt: 100 });
    const nonFinalCloseId = await insertCompletedClose(t, {
      completedAt: NOW,
      operatingDate: "2026-07-03",
      storeId,
    });
    await insertFoldedCloseDay(t, {
      closeId: nonFinalCloseId,
      operatingDate: "2026-07-03",
      storeId,
    });

    await t.run(async (ctx) => {
      expect(
        await reconcileRecentAcceptedWeeksForStore(ctx, storeId, NOW),
      ).toBe(0);
    });

    const frozenWorkItemId = await t.run(async (ctx) => {
      const store = await ctx.db.get("store", storeId);
      if (!store) throw new Error("missing fixture store");
      return ctx.db.insert("operationalWorkItem", {
        approvalState: "not_required",
        createdAt: Date.parse("2026-06-28T12:00:00.000Z"),
        organizationId: store.organizationId,
        priority: "high",
        status: "open",
        storeId,
        title: "Review inventory",
        type: "synced_sale_inventory_review",
      });
    });
    const finalCloseId = await insertCompletedClose(t, {
      completedAt: NOW,
      frozenGroups: [
        {
          key: "synced_sale_inventory_review:store-1:missing-sku",
          members: [
            {
              createdAt: Date.parse("2026-06-28T12:00:00.000Z"),
              workItemId: frozenWorkItemId,
            },
          ],
          membershipCompleteness: "complete",
          oldestActionableAt: Date.parse("2026-06-28T12:00:00.000Z"),
          productSkuId: null,
        },
      ],
      operatingDate: "2026-07-04",
      storeId,
    });
    await insertFoldedCloseDay(t, {
      closeId: finalCloseId,
      operatingDate: "2026-07-04",
      storeId,
    });

    await t.run(async (ctx) => {
      expect(
        await reconcileRecentAcceptedWeeksForStore(ctx, storeId, NOW),
      ).toBe(1);
      expect(
        await reconcileRecentAcceptedWeeksForStore(ctx, storeId, NOW),
      ).toBe(0);
      const accepted = await ctx.db
        .query("reportWeekAccepted")
        .withIndex("by_storeId_cycleStartDate", (q) =>
          q.eq("storeId", storeId).eq("cycleStartDate", "2026-06-29"),
        )
        .unique();
      expect(accepted).toMatchObject({
        closeId: finalCloseId,
        closePosture: {
          acceptedCloseId: finalCloseId,
          currentCloseId: finalCloseId,
          status: "accepted",
        },
        inventoryAttention: {
          carriedForwardCount: 1,
          completeness: "complete",
          observedCount: 1,
        },
      });
    });
  });

  it("does not requeue an open final scheduled day before its close exists", async () => {
    const t = convexTest(schema, modules);
    const storeId = await seedStore(t, "weekly-open-final-day");

    await t.run(async (ctx) => {
      await ctx.db.insert("reportDay", {
        ...day({ operatingDate: "2026-07-04", status: "open" }),
        storeId,
        foldVersion: 1,
        factCount: 1,
        lastFactRecordedAt: NOW,
      });

      expect(
        await refreshAcceptedWeekForDate(ctx, storeId, "2026-07-04", NOW),
      ).toBe(0);
      expect(
        await ctx.db
          .query("reportDirtyDay")
          .withIndex("by_storeId_operatingDate", (q) =>
            q.eq("storeId", storeId).eq("operatingDate", "2026-07-04"),
          )
          .unique(),
      ).toBeNull();
    });
  });

  it("stops requeuing a folded date whose schedule history can never resolve it", async () => {
    const t = convexTest(schema, modules);
    const storeId = await seedStore(t, "weekly-unresolvable-date");
    // Every schedule version starts well after this date, so resolving a
    // weekly frame for it fails permanently rather than transiently.
    const orphanDate = "2020-01-06";
    await t.run((ctx) =>
      ctx.db.insert("reportDirtyDay", {
        storeId,
        operatingDate: orphanDate,
        reason: "late_fact",
        markedAt: NOW,
      }),
    );

    await t.run(async (ctx) => {
      expect(
        await refreshAcceptedWeekForDate(ctx, storeId, orphanDate, NOW + 1),
      ).toBe(0);
      // Re-marking here would requeue the date on every sweep forever.
      const marks = await ctx.db
        .query("reportDirtyDay")
        .withIndex("by_storeId_operatingDate", (q) =>
          q.eq("storeId", storeId).eq("operatingDate", orphanDate),
        )
        .unique();
      expect(marks?.markedAt).toBe(NOW);
    });
  });

  it("never manufactures a baseline for a close completed before the acceptance floor", async () => {
    const t = convexTest(schema, modules);
    const storeId = await seedStore(t, "weekly-acceptance-floor");
    await insertFact(t, storeId, { observedAt: 100 });
    const preActivationCloseId = await insertCompletedClose(t, {
      completedAt: NOW,
      operatingDate: "2026-07-04",
      storeId,
    });
    await insertFoldedCloseDay(t, {
      closeId: preActivationCloseId,
      operatingDate: "2026-07-04",
      storeId,
    });
    await t.run((ctx) =>
      ctx.db.patch("store", storeId, {
        weeklyReportingAcceptanceFloor: NOW + 1,
      }),
    );

    await t.run(async (ctx) => {
      expect(
        await reconcileRecentAcceptedWeeksForStore(ctx, storeId, NOW),
      ).toBe(0);
      expect(
        await refreshAcceptedWeekForDate(ctx, storeId, "2026-07-04", NOW),
      ).toBe(0);
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      expect(await ctx.db.query("reportWeekAccepted").collect()).toEqual([]);
      // A pre-activation close is permanently unacceptable — no retry marker.
      // eslint-disable-next-line @convex-dev/no-collect-in-query -- convex-test fixture read, not a production query
      expect(await ctx.db.query("reportDirtyWeek").collect()).toEqual([]);
    });

    // At/after the floor the same close accepts normally.
    await t.run(async (ctx) => {
      await ctx.db.patch("store", storeId, {
        weeklyReportingAcceptanceFloor: NOW,
      });
      expect(
        await reconcileRecentAcceptedWeeksForStore(ctx, storeId, NOW),
      ).toBe(1);
    });
  });

  it("accepts a delayed final-date close into the operating date's prior cycle", async () => {
    const t = convexTest(schema, modules);
    const storeId = await seedStore(t, "weekly-delayed-final-close");
    const delayedAcceptedAt = Date.parse("2026-07-06T12:00:00.000Z");
    await insertFact(t, storeId, {
      observedAt: delayedAcceptedAt,
      operatingDate: "2026-07-04",
    });
    const finalCloseId = await insertCompletedClose(t, {
      completedAt: delayedAcceptedAt,
      operatingDate: "2026-07-04",
      storeId,
    });
    await insertFoldedCloseDay(t, {
      closeId: finalCloseId,
      foldedAt: delayedAcceptedAt + 1,
      operatingDate: "2026-07-04",
      storeId,
    });

    await t.run(async (ctx) => {
      expect(
        await reconcileRecentAcceptedWeeksForStore(
          ctx,
          storeId,
          delayedAcceptedAt + 2,
        ),
      ).toBe(1);
      const accepted = await ctx.db
        .query("reportWeekAccepted")
        .withIndex("by_storeId_cycleStartDate", (q) =>
          q.eq("storeId", storeId).eq("cycleStartDate", "2026-06-29"),
        )
        .unique();
      expect(accepted).toMatchObject({
        acceptedAt: delayedAcceptedAt,
        closeId: finalCloseId,
        cycleEndDate: "2026-07-05",
        cycleStartDate: "2026-06-29",
      });
      expect(
        await ctx.db
          .query("reportWeekAccepted")
          .withIndex("by_storeId_cycleStartDate", (q) =>
            q.eq("storeId", storeId).eq("cycleStartDate", "2026-07-06"),
          )
          .unique(),
      ).toBeNull();
    });
  });

  it("keeps reopen posture independent from one replaceable current amendment", async () => {
    const t = convexTest(schema, modules);
    const storeId = await seedStore(t, "weekly-amendment");
    await insertFact(t, storeId, { observedAt: 100 });
    const acceptedCloseId = await insertCompletedClose(t, {
      completedAt: NOW,
      operatingDate: "2026-07-04",
      storeId,
      summary: { netCashVariance: 75, paymentTotals: [] },
    });
    const finalDayId = await insertFoldedCloseDay(t, {
      closeId: acceptedCloseId,
      operatingDate: "2026-07-04",
      storeId,
      netSalesMinor: 0,
    });
    await t.run(async (ctx) => {
      for (const entry of period().dates) {
        if (entry.localDate === "2026-07-04") continue;
        await ctx.db.insert("reportDay", {
          ...day({
            operatingDate: entry.localDate,
            netSalesMinor: entry.localDate === "2026-06-29" ? 100 : 0,
          }),
          storeId,
          foldedAt: NOW + 1,
          foldVersion: 1,
          factCount: entry.localDate === "2026-06-29" ? 1 : 0,
          lastFactRecordedAt: NOW,
        });
      }
    });

    await t.run(async (ctx) => {
      expect(
        await reconcileRecentAcceptedWeeksForStore(ctx, storeId, NOW),
      ).toBe(1);
      const originalBaseline = await ctx.db
        .query("reportWeekAccepted")
        .withIndex("by_storeId_cycleStartDate", (q) =>
          q.eq("storeId", storeId).eq("cycleStartDate", "2026-06-29"),
        )
        .unique();
      expect(originalBaseline?.closeEvidence?.cash).toMatchObject({
        cashVarianceMinor: 75,
        coverage: { status: "partial", usableDayCount: 1 },
      });
      expect(await rebuildCurrentWeek(ctx, storeId, NOW + 1)).toBe("rebuilt");
      await ctx.db.patch("dailyClose", acceptedCloseId, {
        lifecycleStatus: "reopened",
        isCurrent: false,
      });
      const accepted = await ctx.db.get("dailyClose", acceptedCloseId);
      if (!accepted) throw new Error("missing accepted close");
      const reopenedCloseId = await ctx.db.insert("dailyClose", {
        storeId,
        organizationId: accepted.organizationId,
        operatingDate: accepted.operatingDate,
        status: "open",
        lifecycleStatus: "active",
        isCurrent: true,
        readiness: accepted.readiness,
        reportSnapshot: accepted.reportSnapshot,
        summary: accepted.summary,
        sourceSubjects: [],
        carryForwardWorkItemIds: [],
        reopenedFromDailyCloseId: acceptedCloseId,
        supersedesDailyCloseId: acceptedCloseId,
        createdAt: NOW + 2,
        updatedAt: NOW + 2,
      });
      await ctx.db.patch("reportDay", finalDayId, {
        closeId: undefined,
        netSalesMinor: 50,
        foldedAt: NOW + 3,
      });
      await refreshAcceptedWeekForDate(ctx, storeId, "2026-07-04", NOW + 3);

      const week = await ctx.db
        .query("reportWeekAccepted")
        .withIndex("by_storeId_cycleStartDate", (q) =>
          q.eq("storeId", storeId).eq("cycleStartDate", "2026-06-29"),
        )
        .unique();
      expect(week).toMatchObject({
        closePosture: {
          acceptedCloseId,
          status: "reopened_awaiting_successor",
        },
        amendment: {
          includedNetSalesDeltaMinor: 50,
          outsideScheduleNetSalesDeltaMinor: 0,
        },
      });
      expect(week?.closeEvidence).toEqual(originalBaseline?.closeEvidence);
      const reopenedCurrent = availableWeekCurrent(
        await ctx.db
          .query("reportWeekCurrent")
          .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
          .unique(),
      );
      expect(reopenedCurrent?.closeEvidence?.cash).toMatchObject({
        cashVarianceMinor: 0,
        coverage: { status: "unavailable", usableDayCount: 0 },
      });

      await ctx.db.patch("dailyClose", acceptedCloseId, {
        lifecycleStatus: "superseded",
      });
      await ctx.db.patch("dailyClose", reopenedCloseId, {
        completedAt: NOW + 4,
        status: "completed",
        updatedAt: NOW + 4,
      });
      await ctx.db.patch("reportDay", finalDayId, {
        closeId: reopenedCloseId,
        closeAcceptedAt: NOW + 4,
        foldedAt: NOW + 5,
      });
      const outsideDay = await ctx.db
        .query("reportDay")
        .withIndex("by_storeId_operatingDate", (q) =>
          q.eq("storeId", storeId).eq("operatingDate", "2026-07-05"),
        )
        .unique();
      if (!outsideDay) throw new Error("missing outside-schedule day");
      await ctx.db.patch("reportDay", outsideDay._id, {
        netSalesMinor: 25,
        foldedAt: NOW + 5,
      });
      await refreshAcceptedWeekForDate(ctx, storeId, "2026-07-04", NOW + 5);
      await refreshAcceptedWeekForDate(ctx, storeId, "2026-07-05", NOW + 5);

      const amended = await ctx.db
        .query("reportWeekAccepted")
        .withIndex("by_storeId_cycleStartDate", (q) =>
          q.eq("storeId", storeId).eq("cycleStartDate", "2026-06-29"),
        )
        .unique();
      expect(amended).toMatchObject({
        closeId: acceptedCloseId,
        closePosture: {
          acceptedCloseId,
          currentCloseId: reopenedCloseId,
          status: "successor_accepted",
        },
        amendment: {
          includedNetSalesDeltaMinor: 50,
          outsideScheduleNetSalesDeltaMinor: 25,
          sourceCloseId: reopenedCloseId,
        },
      });
      expect(amended?.closeEvidence).toEqual(originalBaseline?.closeEvidence);
      const successorCurrent = availableWeekCurrent(
        await ctx.db
          .query("reportWeekCurrent")
          .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
          .unique(),
      );
      expect(successorCurrent?.closeEvidence?.cash).toMatchObject({
        cashVarianceMinor: 75,
        coverage: { status: "partial", usableDayCount: 1 },
      });
    });
  });

  it("refreshes the exact historical accepted week after it ages out of the recent window", async () => {
    const t = convexTest(schema, modules);
    const storeId = await seedStore(t, "weekly-historical-amendment");
    await insertFact(t, storeId, { observedAt: 100 });
    const closeId = await insertCompletedClose(t, {
      completedAt: NOW,
      operatingDate: "2026-07-04",
      storeId,
    });
    await insertFoldedCloseDay(t, {
      closeId,
      operatingDate: "2026-07-04",
      storeId,
      netSalesMinor: 0,
    });
    await insertHistoricalWeekDays(t, storeId);

    await t.run(async (ctx) => {
      expect(
        await reconcileRecentAcceptedWeeksForStore(ctx, storeId, NOW),
      ).toBe(1);
      const baseline = await ctx.db
        .query("reportWeekAccepted")
        .withIndex("by_storeId_cycleStartDate", (q) =>
          q.eq("storeId", storeId).eq("cycleStartDate", "2026-06-29"),
        )
        .unique();
      if (!baseline) throw new Error("missing accepted baseline");

      for (let index = 0; index < 16; index += 1) {
        const { _creationTime, _id, ...fields } = baseline;
        await ctx.db.insert("reportWeekAccepted", {
          ...fields,
          acceptedAt: NOW + index + 1,
          baselineFingerprint: `newer-${index}`,
          cycleEndDate: `2026-08-${String(index + 1).padStart(2, "0")}`,
          cycleStartDate: `2026-07-${String(index + 6).padStart(2, "0")}`,
        });
      }

      const monday = await ctx.db
        .query("reportDay")
        .withIndex("by_storeId_operatingDate", (q) =>
          q.eq("storeId", storeId).eq("operatingDate", "2026-06-29"),
        )
        .unique();
      if (!monday) throw new Error("missing folded Monday");
      await ctx.db.patch("reportDay", monday._id, {
        netSalesMinor: 150,
        foldedAt: NOW + 2,
      });

      expect(
        await refreshAcceptedWeekForDate(ctx, storeId, "2026-06-29", NOW + 2),
      ).toBe(1);
      const amended = await ctx.db
        .query("reportWeekAccepted")
        .withIndex("by_storeId_cycleStartDate", (q) =>
          q.eq("storeId", storeId).eq("cycleStartDate", "2026-06-29"),
        )
        .unique();
      expect(amended?.amendment).toMatchObject({
        includedNetSalesDeltaMinor: 50,
      });

      await ctx.db.patch("reportDay", monday._id, {
        flags: {
          hasUncostedRevenue: false,
          mixedCurrency: true,
          quarantinedFactCount: 0,
        },
      });
      expect(
        await refreshAcceptedWeekForDate(ctx, storeId, "2026-06-29", NOW + 3),
      ).toBe(0);
      expect(
        await ctx.db
          .query("reportDirtyDay")
          .withIndex("by_storeId_operatingDate", (q) =>
            q.eq("storeId", storeId).eq("operatingDate", "2026-06-29"),
          )
          .unique(),
      ).toMatchObject({ markedAt: NOW + 3, reason: "late_fact" });
    });
  });

  it("retains the exact date while verification or reseed posture blocks refresh", async () => {
    const t = convexTest(schema, modules);
    const storeId = await seedStore(t, "weekly-refresh-guard-retry");

    await t.run(async (ctx) => {
      await ctx.db.patch("store", storeId, {
        weeklyObservedAtVerification: undefined,
      });
      expect(
        await refreshAcceptedWeekForDate(ctx, storeId, "2026-07-04", NOW + 1),
      ).toBe(0);
      const verificationRetry = await ctx.db
        .query("reportDirtyDay")
        .withIndex("by_storeId_operatingDate", (q) =>
          q.eq("storeId", storeId).eq("operatingDate", "2026-07-04"),
        )
        .unique();
      expect(verificationRetry).toMatchObject({
        markedAt: NOW + 1,
        reason: "late_fact",
      });
      if (!verificationRetry) throw new Error("missing verification retry");
      await ctx.db.delete("reportDirtyDay", verificationRetry._id);

      await ctx.db.patch("store", storeId, {
        reportingReseedStartedAt: NOW + 2,
        weeklyObservedAtVerification: {
          status: "complete",
          missingCount: 0,
          startedAt: NOW,
          completedAt: NOW,
        },
      });
      expect(
        await refreshAcceptedWeekForDate(ctx, storeId, "2026-07-04", NOW + 2),
      ).toBe(0);
      expect(
        await ctx.db
          .query("reportDirtyDay")
          .withIndex("by_storeId_operatingDate", (q) =>
            q.eq("storeId", storeId).eq("operatingDate", "2026-07-04"),
          )
          .unique(),
      ).toMatchObject({ markedAt: NOW + 2, reason: "late_fact" });
    });
  });

  it("retains a missing baseline retry when historical schedule resolution is capped", async () => {
    const t = convexTest(schema, modules);
    const storeId = await seedStore(t, "weekly-historical-schedule-cap-retry");
    const closeId = await insertCompletedClose(t, {
      completedAt: NOW,
      operatingDate: "2026-07-04",
      storeId,
    });
    await insertFoldedCloseDay(t, {
      closeId,
      operatingDate: "2026-07-04",
      storeId,
    });

    await t.run(async (ctx) => {
      const schedule = await ctx.db
        .query("storeSchedule")
        .withIndex("by_storeId_status_effectiveFrom", (q) =>
          q.eq("storeId", storeId),
        )
        .unique();
      if (!schedule) throw new Error("missing fixture schedule");
      const { _creationTime, _id, ...scheduleFields } = schedule;
      for (let index = 0; index < WEEKLY_SCHEDULE_READ_LIMIT; index += 1) {
        await ctx.db.insert("storeSchedule", {
          ...scheduleFields,
          effectiveFrom: schedule.effectiveFrom + index + 1,
          status: "candidate",
        });
      }

      expect(
        await refreshAcceptedWeekForDate(ctx, storeId, "2026-07-04", NOW + 1),
      ).toBe(0);
      expect(
        await ctx.db
          .query("reportDirtyDay")
          .withIndex("by_storeId_operatingDate", (q) =>
            q.eq("storeId", storeId).eq("operatingDate", "2026-07-04"),
          )
          .unique(),
      ).toMatchObject({ markedAt: NOW + 1, reason: "late_fact" });
    });
  });

  it("refreshes at eight close versions and requeues the ninth", async () => {
    const t = convexTest(schema, modules);
    const storeId = await seedStore(t, "weekly-close-version-bound");
    await insertFact(t, storeId, { observedAt: 100 });
    const closeId = await insertCompletedClose(t, {
      completedAt: NOW,
      operatingDate: "2026-07-04",
      storeId,
    });
    await insertFoldedCloseDay(t, {
      closeId,
      operatingDate: "2026-07-04",
      storeId,
      netSalesMinor: 0,
    });
    await insertHistoricalWeekDays(t, storeId);

    await t.run(async (ctx) => {
      expect(
        await reconcileRecentAcceptedWeeksForStore(ctx, storeId, NOW),
      ).toBe(1);
      const close = await ctx.db.get("dailyClose", closeId);
      if (!close) throw new Error("missing fixture close");
      const { _creationTime, _id, ...closeFields } = close;
      for (let index = 1; index < 8; index += 1) {
        await ctx.db.insert("dailyClose", {
          ...closeFields,
          completedAt: NOW + index,
          createdAt: NOW + index,
          isCurrent: false,
          lifecycleStatus: "superseded",
          updatedAt: NOW + index,
        });
      }
      const monday = await ctx.db
        .query("reportDay")
        .withIndex("by_storeId_operatingDate", (q) =>
          q.eq("storeId", storeId).eq("operatingDate", "2026-06-29"),
        )
        .unique();
      if (!monday) throw new Error("missing folded Monday");
      await ctx.db.patch("reportDay", monday._id, { netSalesMinor: 150 });
      expect(
        await refreshAcceptedWeekForDate(ctx, storeId, "2026-06-29", NOW + 8),
      ).toBe(1);

      await ctx.db.insert("dailyClose", {
        ...closeFields,
        completedAt: NOW + 8,
        createdAt: NOW + 8,
        isCurrent: false,
        lifecycleStatus: "superseded",
        updatedAt: NOW + 8,
      });
      await ctx.db.patch("reportDay", monday._id, { netSalesMinor: 175 });
      expect(
        await refreshAcceptedWeekForDate(ctx, storeId, "2026-06-29", NOW + 9),
      ).toBe(0);
      expect(
        await ctx.db
          .query("reportDirtyDay")
          .withIndex("by_storeId_operatingDate", (q) =>
            q.eq("storeId", storeId).eq("operatingDate", "2026-06-29"),
          )
          .unique(),
      ).toMatchObject({ markedAt: NOW + 9, reason: "late_fact" });
    });
  });

  it("retries a historical final close after newer closes exceed the recovery scan", async () => {
    const t = convexTest(schema, modules);
    const storeId = await seedStore(t, "weekly-historical-baseline-retry");
    await insertFact(t, storeId, { observedAt: 100 });
    await insertHistoricalWeekDays(t, storeId);

    for (let index = 0; index < 16; index += 1) {
      await insertCompletedClose(t, {
        completedAt: NOW + index + 1,
        operatingDate: `2026-07-${String(index + 5).padStart(2, "0")}`,
        storeId,
      });
    }

    await t.run(async (ctx) => {
      // The bounded fallback no longer reaches July 4; its final-close
      // baseline must remain reachable through the folded-day handoff.
      expect(
        await reconcileRecentAcceptedWeeksForStore(ctx, storeId, NOW + 20),
      ).toBe(0);
      expect(
        await refreshAcceptedWeekForDate(ctx, storeId, "2026-07-04", NOW + 20),
      ).toBe(0);
      expect(
        await ctx.db
          .query("reportDirtyDay")
          .withIndex("by_storeId_operatingDate", (q) =>
            q.eq("storeId", storeId).eq("operatingDate", "2026-07-04"),
          )
          .unique(),
      ).toMatchObject({ markedAt: NOW + 20, reason: "late_fact" });
    });

    const closeId = await insertCompletedClose(t, {
      completedAt: NOW,
      operatingDate: "2026-07-04",
      storeId,
    });
    await insertFoldedCloseDay(t, {
      closeId,
      operatingDate: "2026-07-04",
      storeId,
      netSalesMinor: 0,
    });

    await t.run(async (ctx) => {
      const retry = await ctx.db
        .query("reportDirtyDay")
        .withIndex("by_storeId_operatingDate", (q) =>
          q.eq("storeId", storeId).eq("operatingDate", "2026-07-04"),
        )
        .unique();
      if (!retry) throw new Error("missing historical retry");
      await ctx.db.delete("reportDirtyDay", retry._id);
      expect(
        await refreshAcceptedWeekForDate(ctx, storeId, "2026-07-04", NOW + 21),
      ).toBe(1);
      expect(
        await ctx.db
          .query("reportWeekAccepted")
          .withIndex("by_storeId_cycleStartDate", (q) =>
            q.eq("storeId", storeId).eq("cycleStartDate", "2026-06-29"),
          )
          .unique(),
      ).toMatchObject({ closeId });
    });
  });
});

/** convexTest's harness is untyped for indexed reads; run needs the real ctx. */
type WeeklyHarness = {
  run: <T>(fn: (ctx: MutationCtx) => Promise<T>) => Promise<T>;
};

async function readWeekMark(t: WeeklyHarness, storeId: Id<"store">) {
  return t.run(async (ctx) =>
    ctx.db
      .query("reportDirtyWeek")
      .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
      .unique(),
  );
}

async function readBaseline(
  t: WeeklyHarness,
  storeId: Id<"store">,
  cycleStartDate = "2026-06-29",
) {
  return t.run(async (ctx) =>
    ctx.db
      .query("reportWeekAccepted")
      .withIndex("by_storeId_cycleStartDate", (q) =>
        q.eq("storeId", storeId).eq("cycleStartDate", cycleStartDate),
      )
      .unique(),
  );
}

describe("weekly acceptance intent", () => {
  it("keeps the recorded cutoff across a failed attempt and a later close patch", async () => {
    const t = convexTest(schema, modules);
    const storeId = await seedStore(t, "weekly-intent-retry");
    await insertFact(t, storeId, { observedAt: NOW - 10, sourceId: "before" });
    await insertFact(t, storeId, {
      grossAmountMinor: 500,
      netAmountMinor: 500,
      observedAt: NOW + 10,
      sourceId: "after",
    });
    const closeId = await insertCompletedClose(t, {
      completedAt: NOW,
      operatingDate: "2026-07-04",
      storeId,
    });
    await insertFoldedCloseDay(t, {
      closeId,
      operatingDate: "2026-07-04",
      storeId,
      netSalesMinor: 0,
    });
    await insertHistoricalWeekDays(t, storeId);

    foldControl.shouldThrow = true;
    await t.run(async (ctx) => {
      await expect(
        materializeAcceptedWeek({ closeId, ctx, now: NOW, storeId }),
      ).rejects.toThrow("weekly fold exploded");
    });
    expect((await readWeekMark(t, storeId))?.intent).toMatchObject({
      closeId,
      cycleStartDate: "2026-06-29",
      cutoffObservedAt: NOW,
    });

    // The close is patched between attempts; neither timestamp may move the
    // cutoff of a baseline whose intent already exists.
    await t.run(async (ctx) => {
      await ctx.db.patch("dailyClose", closeId, {
        completedAt: NOW + 5_000,
        updatedAt: NOW + 5_000,
      });
    });
    foldControl.shouldThrow = false;

    await t.run(async (ctx) => {
      expect(
        await materializeAcceptedWeek({ closeId, ctx, now: NOW + 6_000, storeId }),
      ).toBe("created");
    });
    expect(await readBaseline(t, storeId)).toMatchObject({
      acceptedAt: NOW,
      cutoffObservedAt: NOW,
      included: { netSalesMinor: 100 },
    });
    expect((await readWeekMark(t, storeId))?.intent).toBeUndefined();
  });

  it("reproduces the baseline fingerprint after newer facts and refolds exist", async () => {
    const t = convexTest(schema, modules);
    const storeId = await seedStore(t, "weekly-intent-fingerprint");
    await insertFact(t, storeId, { observedAt: NOW - 10, sourceId: "before" });
    const closeId = await insertCompletedClose(t, {
      completedAt: NOW,
      operatingDate: "2026-07-04",
      storeId,
    });
    await insertFoldedCloseDay(t, {
      closeId,
      operatingDate: "2026-07-04",
      storeId,
      netSalesMinor: 0,
    });
    await insertHistoricalWeekDays(t, storeId);

    await t.run(async (ctx) => {
      expect(
        await materializeAcceptedWeek({ closeId, ctx, now: NOW, storeId }),
      ).toBe("created");
    });
    const first = await readBaseline(t, storeId);
    if (!first) throw new Error("missing first baseline");

    await insertFact(t, storeId, {
      grossAmountMinor: 500,
      netAmountMinor: 500,
      observedAt: NOW + 50,
      sourceId: "late",
    });
    await t.run(async (ctx) => {
      await ctx.db.delete("reportWeekAccepted", first._id);
      const monday = await ctx.db
        .query("reportDay")
        .withIndex("by_storeId_operatingDate", (q) =>
          q.eq("storeId", storeId).eq("operatingDate", "2026-06-29"),
        )
        .unique();
      if (!monday) throw new Error("missing folded Monday");
      await ctx.db.patch("reportDay", monday._id, {
        netSalesMinor: 600,
        foldedAt: NOW + 60,
      });
      expect(
        await materializeAcceptedWeek({ closeId, ctx, now: NOW + 70, storeId }),
      ).toBe("created");
    });

    expect(await readBaseline(t, storeId)).toMatchObject({
      acceptedAt: first.acceptedAt,
      baselineFingerprint: first.baselineFingerprint,
      cutoffObservedAt: first.cutoffObservedAt,
      included: first.included,
    });
  });

  it("refuses to derive a cutoff from a completed close with no completedAt", async () => {
    const t = convexTest(schema, modules);
    const storeId = await seedStore(t, "weekly-intent-no-completed-at");
    await insertFact(t, storeId, { observedAt: NOW - 10 });
    const closeId = await insertCompletedClose(t, {
      completedAt: NOW,
      operatingDate: "2026-07-04",
      storeId,
    });
    await insertFoldedCloseDay(t, {
      closeId,
      operatingDate: "2026-07-04",
      storeId,
    });
    await insertHistoricalWeekDays(t, storeId);
    await t.run(async (ctx) => {
      await ctx.db.patch("dailyClose", closeId, {
        completedAt: undefined,
        updatedAt: NOW + 9,
      });
      expect(
        await materializeAcceptedWeek({ closeId, ctx, now: NOW + 10, storeId }),
      ).toBe("unavailable");
    });

    expect(await readBaseline(t, storeId)).toBeNull();
    const mark = await readWeekMark(t, storeId);
    expect(mark).toMatchObject({
      acceptanceBlockedReason: "close_missing_completed_at",
      reason: "acceptance_requested",
    });
    expect(mark?.intent).toBeUndefined();
  });

  it("recreates the same intent and baseline identity after both are deleted", async () => {
    const t = convexTest(schema, modules);
    const storeId = await seedStore(t, "weekly-intent-recovery");
    await insertFact(t, storeId, { observedAt: NOW - 10 });
    const closeId = await insertCompletedClose(t, {
      completedAt: NOW,
      operatingDate: "2026-07-04",
      storeId,
    });
    await insertFoldedCloseDay(t, {
      closeId,
      operatingDate: "2026-07-04",
      storeId,
      netSalesMinor: 0,
    });
    await insertHistoricalWeekDays(t, storeId);

    await t.run(async (ctx) => {
      expect(
        await reconcileRecentAcceptedWeeksForStore(ctx, storeId, NOW + 1),
      ).toBe(1);
    });
    const first = await readBaseline(t, storeId);
    if (!first) throw new Error("missing first baseline");

    await t.run(async (ctx) => {
      await ctx.db.delete("reportWeekAccepted", first._id);
      const mark = await ctx.db
        .query("reportDirtyWeek")
        .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
        .unique();
      if (mark) await ctx.db.delete("reportDirtyWeek", mark._id);
      expect(
        await reconcileRecentAcceptedWeeksForStore(ctx, storeId, NOW + 2),
      ).toBe(1);
    });

    expect(await readBaseline(t, storeId)).toMatchObject({
      acceptedAt: first.acceptedAt,
      baselineFingerprint: first.baselineFingerprint,
      closeId: first.closeId,
      cutoffObservedAt: first.cutoffObservedAt,
    });
  });

  it("discloses a shared fact cap breach and keeps the verified values", async () => {
    const t = convexTest(schema, modules);
    const storeId = await seedStore(t, "weekly-fact-cap-posture");
    const closeId = await insertCompletedClose(t, {
      completedAt: NOW,
      operatingDate: "2026-07-04",
      storeId,
    });
    await insertFoldedCloseDay(t, {
      closeId,
      operatingDate: "2026-07-04",
      storeId,
    });
    await insertHistoricalWeekDays(t, storeId);
    const before = await t.run(async (ctx) => {
      expect(await rebuildCurrentWeek(ctx, storeId, NOW)).toBe("rebuilt");
      return availableWeekCurrent(
        await ctx.db
          .query("reportWeekCurrent")
          .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
          .unique(),
      );
    });
    if (!before) throw new Error("expected verified weekly singleton");

    await t.run(async (ctx) => {
      for (let index = 0; index <= MAX_WEEKLY_FACTS; index += 1) {
        await ctx.db.insert("reportFact", {
          currency: "GHS",
          discountAmountMinor: 0,
          factKind: "sale",
          fingerprint: `fp-${index}`,
          fingerprintVersion: 2,
          grossAmountMinor: 100,
          lineId: "line",
          netAmountMinor: 100,
          observedAt: NOW - 10,
          occurredAt: NOW - 10,
          operatingDate: "2026-06-29",
          quantity: 1,
          recordedAt: NOW - 10,
          sourceDomain: "pos",
          sourceId: `cap-${index}`,
          storeId,
          taxAmountMinor: 0,
        });
      }
      expect(
        await materializeAcceptedWeek({ closeId, ctx, now: NOW + 1, storeId }),
      ).toBe("incomplete");
    });

    expect(await readBaseline(t, storeId)).toBeNull();
    const after = await t.run(async (ctx) =>
      availableWeekCurrent(
        await ctx.db
          .query("reportWeekCurrent")
          .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
          .unique(),
      ),
    );
    expect(after?.completeness).toMatchObject({
      complete: false,
      reason: "fact_cap_exceeded",
    });
    expect(after?.included).toEqual(before.included);
    expect(after?.outsideSchedule).toEqual(before.outsideSchedule);
  });
});

describe("weekly completeness scoping", () => {
  it("rolls day payment posture into weekly omitted and invalid disclosure", () => {
    const result = foldWeekFromDays({
      period: period(),
      days: [
        day({
          paymentPosture: {
            allocatedMinor: 75,
            allocationCoverage: "unknown",
            allocationOmittedMinor: 25,
            collectedMinor: 100,
            hasInvalidAllocation: false,
            refundedMinor: 0,
            unsettledMinor: null,
          },
        }),
        day({
          operatingDate: "2026-06-30",
          paymentPosture: {
            allocatedMinor: 400,
            allocationCoverage: "complete",
            allocationOmittedMinor: 0,
            collectedMinor: 100,
            hasInvalidAllocation: true,
            refundedMinor: 0,
            unsettledMinor: 0,
          },
        }),
      ],
    });

    expect(result.included.paymentAllocationOmittedMinor).toBe(25);
    expect(result.included.paymentHasInvalidAllocation).toBe(true);
    expect(result.included.paymentAllocationCoverage).toBe("unknown");
    expect(result.completeness).toMatchObject({
      complete: false,
      reason: "payment_invalid_allocation",
    });
  });

  it("composes weekly units across included days apart from refund timing", () => {
    const result = foldWeekFromDays({
      period: period(),
      days: [
        day({ refundsMinor: 40, unitsReturned: 1, unitsSold: 3 }),
        day({ operatingDate: "2026-06-30", unitsReturned: 0, unitsSold: 2 }),
        day({ operatingDate: "2026-07-05", unitsReturned: 4, unitsSold: 9 }),
      ],
    });

    expect(result.included).toMatchObject({
      refundsMinor: 40,
      unitsReturned: 1,
      unitsSold: 5,
    });
    expect(result.outsideSchedule).toMatchObject({
      unitsReturned: 4,
      unitsSold: 9,
    });
  });

  it("compares live prior positions despite an incomparable later prior date", async () => {
    const t = convexTest(schema, modules);
    const storeId = await seedStore(t, "weekly-prior-scoped-completeness");
    const now = Date.parse("2026-07-01T12:00:00.000Z");
    await t.run(async (ctx) => {
      for (const [operatingDate, netSalesMinor] of [
        ["2026-06-22", 10],
        ["2026-06-23", 10],
        ["2026-06-24", 10],
      ] as const) {
        await ctx.db.insert("reportDay", {
          ...day({ netSalesMinor, operatingDate }),
          storeId,
          foldVersion: 1,
          factCount: 1,
          lastFactRecordedAt: now,
        });
      }
      // Beyond every compared position, so it cannot qualify the comparison.
      await ctx.db.insert("reportDay", {
        ...day({
          flags: {
            hasUncostedRevenue: false,
            mixedCurrency: true,
            quarantinedFactCount: 0,
          },
          netSalesMinor: 500,
          operatingDate: "2026-06-26",
        }),
        storeId,
        foldVersion: 1,
        factCount: 1,
        lastFactRecordedAt: now,
      });

      expect(await rebuildCurrentWeek(ctx, storeId, now)).toBe("rebuilt");
      const current = availableWeekCurrent(
        await ctx.db
          .query("reportWeekCurrent")
          .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
          .unique(),
      );
      expect(current?.priorPeriod).toMatchObject({
        comparabilityReason: "comparable",
        currentScheduledPositionCount: 3,
        priorScheduledPositionCount: 3,
        values: { netSalesMinor: 20 },
      });
    });
  });

  it("names a queued prior day fold instead of the generic incomplete bucket", async () => {
    const t = convexTest(schema, modules);
    const storeId = await seedStore(t, "weekly-prior-pending-fold");
    await t.run(async (ctx) => {
      await ctx.db.insert("reportDirtyDay", {
        storeId,
        operatingDate: "2026-06-24",
        reason: "late_fact",
        markedAt: NOW,
      });

      expect(await rebuildCurrentWeek(ctx, storeId, NOW)).toBe("rebuilt");
      const current = availableWeekCurrent(
        await ctx.db
          .query("reportWeekCurrent")
          .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
          .unique(),
      );
      expect(current?.priorPeriod).toMatchObject({
        comparabilityReason: "missing_prior_day_fold",
        values: null,
      });
    });
  });

  it("discloses an excluded mixed-currency date without withholding the week", async () => {
    const t = convexTest(schema, modules);
    const storeId = await seedStore(t, "weekly-outside-mixed-currency");
    await insertFact(t, storeId, { observedAt: NOW - 10 });
    await insertFact(t, storeId, {
      observedAt: NOW - 10,
      operatingDate: "2026-07-05",
      sourceId: "outside-ghs",
    });
    await insertFact(t, storeId, {
      currency: "USD",
      observedAt: NOW - 10,
      operatingDate: "2026-07-05",
      sourceId: "outside-usd",
    });
    const closeId = await insertCompletedClose(t, {
      completedAt: NOW,
      operatingDate: "2026-07-04",
      storeId,
    });
    await insertFoldedCloseDay(t, {
      closeId,
      operatingDate: "2026-07-04",
      storeId,
      netSalesMinor: 0,
    });
    await insertHistoricalWeekDays(t, storeId);

    await t.run(async (ctx) => {
      const sunday = await ctx.db
        .query("reportDay")
        .withIndex("by_storeId_operatingDate", (q) =>
          q.eq("storeId", storeId).eq("operatingDate", "2026-07-05"),
        )
        .unique();
      if (!sunday) throw new Error("missing outside-schedule day");
      await ctx.db.patch("reportDay", sunday._id, {
        flags: {
          hasUncostedRevenue: false,
          mixedCurrency: true,
          quarantinedFactCount: 0,
        },
      });

      expect(
        await materializeAcceptedWeek({ closeId, ctx, now: NOW + 1, storeId }),
      ).toBe("created");
      expect(await rebuildCurrentWeek(ctx, storeId, NOW + 2)).toBe("rebuilt");
    });

    expect((await readBaseline(t, storeId))?.completeness).toEqual({
      complete: true,
      reason: "complete",
      outsideSchedule: { complete: false, reason: "mixed_currency" },
    });
    const current = await t.run(async (ctx) =>
      availableWeekCurrent(
        await ctx.db
          .query("reportWeekCurrent")
          .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
          .unique(),
      ),
    );
    expect(current?.completeness).toEqual({
      complete: true,
      reason: "complete",
      outsideSchedule: { complete: false, reason: "mixed_currency" },
    });
  });
});

describe("weekly acceptance lifecycle", () => {
  async function patchScheduleExceptions(
    t: WeeklyHarness,
    storeId: Id<"store">,
    dateExceptions: Array<{
      closed: boolean;
      localDate: string;
      windows: Array<{ endMinute: number; startMinute: number }>;
    }>,
  ) {
    await t.run(async (ctx) => {
      const schedule = await ctx.db
        .query("storeSchedule")
        .withIndex("by_storeId_status_effectiveFrom", (q) =>
          q.eq("storeId", storeId),
        )
        .unique();
      if (!schedule) throw new Error("missing fixture schedule");
      await ctx.db.patch("storeSchedule", schedule._id, { dateExceptions });
    });
  }

  async function linkCloseToDay(
    t: WeeklyHarness,
    args: {
      closeId: Id<"dailyClose">;
      operatingDate: string;
      storeId: Id<"store">;
    },
  ) {
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("reportDay")
        .withIndex("by_storeId_operatingDate", (q) =>
          q.eq("storeId", args.storeId).eq("operatingDate", args.operatingDate),
        )
        .unique();
      if (!row) throw new Error(`missing report day ${args.operatingDate}`);
      await ctx.db.patch("reportDay", row._id, {
        closeId: args.closeId,
        closeAcceptedAt: NOW,
        foldedAt: NOW + 1,
      });
    });
  }

  it("accepts the earlier final date when an exception closes the last one", async () => {
    const t = convexTest(schema, modules);
    const storeId = await seedStore(t, "weekly-exception-earlier-final");
    await patchScheduleExceptions(t, storeId, [
      { closed: true, localDate: "2026-07-04", windows: [] },
    ]);
    await insertFact(t, storeId, { observedAt: NOW - 10 });
    await insertHistoricalWeekDays(t, storeId);

    const excludedCloseId = await insertCompletedClose(t, {
      completedAt: NOW,
      operatingDate: "2026-07-04",
      storeId,
    });
    await insertFoldedCloseDay(t, {
      closeId: excludedCloseId,
      operatingDate: "2026-07-04",
      storeId,
      netSalesMinor: 0,
    });
    await t.run(async (ctx) => {
      expect(
        await reconcileRecentAcceptedWeeksForStore(ctx, storeId, NOW + 1),
      ).toBe(0);
    });
    expect(await readBaseline(t, storeId)).toBeNull();

    const finalCloseId = await insertCompletedClose(t, {
      completedAt: NOW,
      operatingDate: "2026-07-03",
      storeId,
    });
    await linkCloseToDay(t, {
      closeId: finalCloseId,
      operatingDate: "2026-07-03",
      storeId,
    });
    await t.run(async (ctx) => {
      expect(
        await reconcileRecentAcceptedWeeksForStore(ctx, storeId, NOW + 2),
      ).toBe(1);
    });
    expect(await readBaseline(t, storeId)).toMatchObject({
      closeId: finalCloseId,
      cycleEndDate: "2026-07-05",
      cycleStartDate: "2026-06-29",
    });
  });

  it("accepts an exception-opened closed day as the final trigger", async () => {
    const t = convexTest(schema, modules);
    const storeId = await seedStore(t, "weekly-exception-opened-final");
    await patchScheduleExceptions(t, storeId, [
      { closed: false, localDate: "2026-07-05", windows: [] },
    ]);
    await insertFact(t, storeId, { observedAt: NOW - 10 });
    await insertHistoricalWeekDays(t, storeId);

    const saturdayCloseId = await insertCompletedClose(t, {
      completedAt: NOW,
      operatingDate: "2026-07-04",
      storeId,
    });
    await insertFoldedCloseDay(t, {
      closeId: saturdayCloseId,
      operatingDate: "2026-07-04",
      storeId,
      netSalesMinor: 0,
    });
    await t.run(async (ctx) => {
      expect(
        await reconcileRecentAcceptedWeeksForStore(ctx, storeId, NOW + 1),
      ).toBe(0);
    });
    expect(await readBaseline(t, storeId)).toBeNull();

    const sundayCloseId = await insertCompletedClose(t, {
      completedAt: NOW,
      operatingDate: "2026-07-05",
      storeId,
    });
    await linkCloseToDay(t, {
      closeId: sundayCloseId,
      operatingDate: "2026-07-05",
      storeId,
    });
    await t.run(async (ctx) => {
      expect(
        await reconcileRecentAcceptedWeeksForStore(ctx, storeId, NOW + 2),
      ).toBe(1);
    });
    const baseline = await readBaseline(t, storeId);
    expect(baseline).toMatchObject({ closeId: sundayCloseId });
    expect(
      baseline?.scheduleLineage.find((row) => row.localDate === "2026-07-05")
        ?.included,
    ).toBe(true);
  });

  it("accepts an excluded-date fact observed before the cutoff", async () => {
    const t = convexTest(schema, modules);
    const storeId = await seedStore(t, "weekly-outside-before-cutoff");
    await insertFact(t, storeId, { observedAt: NOW - 10 });
    await insertFact(t, storeId, {
      observedAt: NOW - 5,
      operatingDate: "2026-07-05",
      sourceId: "outside-before-cutoff",
    });
    const closeId = await insertCompletedClose(t, {
      completedAt: NOW,
      operatingDate: "2026-07-04",
      storeId,
    });
    await insertFoldedCloseDay(t, {
      closeId,
      operatingDate: "2026-07-04",
      storeId,
      netSalesMinor: 0,
    });
    await insertHistoricalWeekDays(t, storeId);

    await t.run(async (ctx) => {
      expect(
        await materializeAcceptedWeek({ closeId, ctx, now: NOW + 1, storeId }),
      ).toBe("created");
    });
    expect(await readBaseline(t, storeId)).toMatchObject({
      included: { netSalesMinor: 100 },
      outsideSchedule: { netSalesMinor: 100 },
    });
  });

  it("keeps a reseeded pre-close fact amendment-only after acceptance", async () => {
    const t = convexTest(schema, modules);
    const storeId = await seedStore(t, "weekly-reseed-race");
    await insertFact(t, storeId, { observedAt: NOW - 10 });
    const closeId = await insertCompletedClose(t, {
      completedAt: NOW,
      operatingDate: "2026-07-04",
      storeId,
    });
    await insertFoldedCloseDay(t, {
      closeId,
      operatingDate: "2026-07-04",
      storeId,
      netSalesMinor: 0,
    });
    await insertHistoricalWeekDays(t, storeId);
    await t.run(async (ctx) => {
      expect(
        await reconcileRecentAcceptedWeeksForStore(ctx, storeId, NOW + 1),
      ).toBe(1);
    });
    const baseline = await readBaseline(t, storeId);
    if (!baseline) throw new Error("missing accepted baseline");

    // Reseed presents pre-close business time; server-stamped knowledge time
    // is after the cutoff, so the immutable baseline cannot absorb it.
    await insertFact(t, storeId, {
      grossAmountMinor: 500,
      netAmountMinor: 500,
      observedAt: NOW + 100,
      occurredAt: NOW - 1_000,
      recordedAt: NOW - 1_000,
      sourceId: "reseeded",
    });
    await t.run(async (ctx) => {
      const monday = await ctx.db
        .query("reportDay")
        .withIndex("by_storeId_operatingDate", (q) =>
          q.eq("storeId", storeId).eq("operatingDate", "2026-06-29"),
        )
        .unique();
      if (!monday) throw new Error("missing folded Monday");
      await ctx.db.patch("reportDay", monday._id, {
        netSalesMinor: 600,
        foldedAt: NOW + 101,
      });
      expect(
        await refreshAcceptedWeekForDate(ctx, storeId, "2026-06-29", NOW + 102),
      ).toBe(1);
    });

    expect(await readBaseline(t, storeId)).toMatchObject({
      baselineFingerprint: baseline.baselineFingerprint,
      cutoffObservedAt: baseline.cutoffObservedAt,
      included: baseline.included,
      amendment: { includedNetSalesDeltaMinor: 500 },
    });
  });
});
