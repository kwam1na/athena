/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { internal } from "../_generated/api";
import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import {
  applyWeeklyAcceptedCorrection,
  buildWigclubWeeklyCorrectionCandidate,
} from "./weeklyAcceptedRepair";

const scheduledDates = [
  "2026-08-03",
  "2026-08-04",
  "2026-08-05",
  "2026-08-06",
  "2026-08-07",
  "2026-08-08",
];

function fixture() {
  const productRows = Array.from({ length: 11 }, (_, index) => ({
    productName: `Product ${index + 1}`,
    productSku: `SKU-${index + 1}`,
    productSkuId: `sku-${index + 1}` as Id<"productSku">,
    quantity: index < 5 ? 2 : 1,
    spend: index === 0 ? 60_500 : 1_000,
  }));
  const closes = scheduledDates.map((operatingDate, index) => ({
    _id: `close-${index + 1}` as Id<"dailyClose">,
    lifecycleStatus: "active" as const,
    operatingDate,
    reportSnapshot: {
      expenseProductEvidence: {
        contractVersion: 1 as const,
        expenseTotal: index === 0 ? 70_500 : 0,
        products: index === 0 ? productRows : [],
        sourceItemCount: index === 0 ? 11 : 0,
        sourceTransactionCount: index === 0 ? 10 : 0,
        status: "complete" as const,
      },
      summary: {
        netCashVariance: [10_000, -5_000, 8_000, 19_000, 0, 0][index],
        paymentTotals:
          index === 0
            ? [
                { amount: 1_658_000, method: "momo", transactionCount: 63 },
                { amount: 502_000, method: "cash", transactionCount: 26 },
                { amount: 342_500, method: "card", transactionCount: 10 },
              ]
            : [],
      },
    },
    status: "completed" as const,
  }));
  const scheduleLineage = [
    ...scheduledDates.map((localDate) => ({
      activityPosture: "recorded" as const,
      dayAvailable: true,
      dayClosed: false,
      dayStatus: "reconciled" as const,
      included: true,
      localDate,
      scheduleVersionId: "schedule-1" as Id<"storeSchedule">,
    })),
    {
      activityPosture: "zero_activity" as const,
      dayAvailable: true,
      dayClosed: false,
      dayStatus: "reconciled" as const,
      included: false,
      localDate: "2026-08-09",
      scheduleVersionId: "schedule-1" as Id<"storeSchedule">,
    },
  ];
  return {
    accepted: {
      baselineFingerprint: "baseline-fingerprint",
      cycleEndDate: "2026-08-09",
      cycleStartDate: "2026-08-03",
      scheduleLineage,
    },
    appliedAt: Date.parse("2026-08-10T12:00:00Z"),
    closes,
    days: closes.map((close) => ({
      closeId: close._id,
      operatingDate: close.operatingDate,
    })),
    sourceManifestFingerprint: "manifest-fingerprint",
  };
}

describe("accepted weekly correction", () => {
  it("seals the exact Aug 3-9 close, payment, cash, and expense evidence", () => {
    const candidate = buildWigclubWeeklyCorrectionCandidate(fixture());

    expect(candidate.correction.scheduleLineage).toHaveLength(7);
    expect(
      candidate.correction.scheduleLineage.filter((day) => day.included),
    ).toSatisfy((days: Array<{ dayClosed?: boolean }>) =>
      days.every((day) => day.dayClosed === true),
    );
    expect(candidate.correction.closeEvidence.cash).toMatchObject({
      cashVarianceMinor: 32_000,
      coverage: { status: "complete", usableDayCount: 6 },
    });
    expect(candidate.correction.closeEvidence.payments).toMatchObject({
      coveredTenderValueMinor: 2_502_500,
      coverage: { status: "complete", usableDayCount: 6 },
    });
    expect(candidate.correction.closeEvidence.expenses).toMatchObject({
      coveredQuantity: 16,
      coveredSpendMinor: 70_500,
      coverage: { status: "complete", usableDayCount: 6 },
    });
    expect(candidate.correction.closeEvidence.expenses.bySpend).toHaveLength(5);
    expect(candidate.correction.closeEvidence.expenses.byQuantity).toHaveLength(
      5,
    );
    expect(candidate.candidateFingerprint).toMatch(/^v1:[0-9a-f]{8}$/);
  });

  it("refuses drift even when the changed source preserves a weekly total", () => {
    const input = fixture();
    input.closes[0]!.reportSnapshot.expenseProductEvidence.products[0]!.spend -= 1_000;
    input.closes[0]!.reportSnapshot.expenseProductEvidence.products[1]!.spend += 1_000;

    const changed = buildWigclubWeeklyCorrectionCandidate(input);
    expect(changed.candidateFingerprint).not.toBe(
      buildWigclubWeeklyCorrectionCandidate(fixture()).candidateFingerprint,
    );
  });

  it("refuses a tender-use census that does not match the retained week", () => {
    const input = fixture();
    input.closes[0]!.reportSnapshot.summary.paymentTotals[0]!.transactionCount = 62;

    expect(() => buildWigclubWeeklyCorrectionCandidate(input)).toThrow(
      "payment evidence",
    );
  });

  it("sets one correction, no-ops identically, and rejects replacement", async () => {
    const candidate = buildWigclubWeeklyCorrectionCandidate(fixture());
    const patches: unknown[] = [];
    const accepted = {
      _id: "accepted-1" as Id<"reportWeekAccepted">,
      correction: undefined,
    };
    const ctx = {
      db: {
        patch: async (
          _table: "reportWeekAccepted",
          _id: unknown,
          value: unknown,
        ) => {
          patches.push(value);
          Object.assign(accepted, value);
        },
      },
    };

    await expect(
      applyWeeklyAcceptedCorrection(ctx, accepted, candidate.correction),
    ).resolves.toEqual({ outcome: "applied" });
    await expect(
      applyWeeklyAcceptedCorrection(ctx, accepted, candidate.correction),
    ).resolves.toEqual({ outcome: "unchanged" });
    expect(patches).toHaveLength(1);

    await expect(
      applyWeeklyAcceptedCorrection(ctx, accepted, {
        ...candidate.correction,
        candidateFingerprint: "v1:different",
      }),
    ).rejects.toThrow("different correction");
  });
});

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../")
      ? path.replace(/^\.\.\//, "./")
      : path.replace(/^\.\//, "./reports/"),
    loader,
  ]),
);
const DAY_MS = 86_400_000;
const ACCEPTED_AT = Date.parse("2026-08-08T20:47:00.000Z");

function dayStart(operatingDate: string) {
  return Date.parse(`${operatingDate}T00:00:00.000Z`);
}

const zeroWeekMetrics = {
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
  paymentUnsettledMinor: 0,
  paymentAllocationCoverage: "complete" as const,
};

const evidenceCoverage = (usableDayCount: number) => ({
  scheduledDayCount: 6,
  status:
    usableDayCount === 0 ? ("unavailable" as const) : ("complete" as const),
  usableDayCount,
});

// The pre-correction accepted baseline: legacy closes carried no frozen
// expense product evidence, so the expense lane is deliberately unavailable.
const baselineCloseEvidence = {
  cash: { cashVarianceMinor: 32_000, coverage: evidenceCoverage(6) },
  payments: {
    coveredTenderValueMinor: 2_502_500,
    coverage: evidenceCoverage(6),
    rows: [
      {
        amountMinor: 1_658_000,
        method: "momo",
        shareBasisPoints: 6_626,
        tenderUseCount: 63,
      },
      {
        amountMinor: 502_000,
        method: "cash",
        shareBasisPoints: 2_006,
        tenderUseCount: 26,
      },
      {
        amountMinor: 342_500,
        method: "card",
        shareBasisPoints: 1_369,
        tenderUseCount: 10,
      },
    ],
  },
  expenses: {
    byQuantity: [],
    bySpend: [],
    coveredQuantity: 0,
    coveredSpendMinor: 0,
    coverage: evidenceCoverage(0),
    quantityRemainder: null,
    spendRemainder: null,
  },
};

const daySummaries = scheduledDates.map((operatingDate, index) => ({
  expenseTotal: index === 0 ? 70_500 : 0,
  netCashVariance: [10_000, -5_000, 8_000, 19_000, 0, 0][index],
  operatingDate,
  paymentTotals:
    index === 0
      ? [
          { amount: 1_658_000, method: "momo", transactionCount: 63 },
          { amount: 502_000, method: "cash", transactionCount: 26 },
          { amount: 342_500, method: "card", transactionCount: 10 },
        ]
      : [],
}));

// 10 completed transactions with 11 items across 11 SKUs, GH₵705 spend and
// 16 units — the exact sealed Wigclub census, all inside the Aug 3 window.
const transactionSpecs = [
  { items: [{ costPrice: 30_250, quantity: 2, sku: 0 }], totalValue: 60_500 },
  ...[1, 2, 3, 4].map((sku) => ({
    items: [{ costPrice: 500, quantity: 2, sku }],
    totalValue: 1_000,
  })),
  ...[5, 6, 7, 8].map((sku) => ({
    items: [{ costPrice: 1_000, quantity: 1, sku }],
    totalValue: 1_000,
  })),
  {
    items: [
      { costPrice: 1_000, quantity: 1, sku: 9 },
      { costPrice: 1_000, quantity: 1, sku: 10 },
    ],
    totalValue: 2_000,
  },
];

async function seedWigclubWeek(
  t: ReturnType<typeof convexTest>,
  options: { leaderCount?: number; withAccepted?: boolean } = {},
) {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("athenaUser", {
      email: "wigclub-repair@test",
    });
    const organizationId = await ctx.db.insert("organization", {
      createdByUserId: userId,
      name: "Wigclub",
      slug: "wigclub",
    });
    const storeId = await ctx.db.insert("store", {
      createdByUserId: userId,
      currency: "GHS",
      name: "Wigclub",
      organizationId,
      slug: "wigclub",
    });
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
    const productId = await ctx.db.insert("product", {
      availability: "live",
      categoryId,
      createdByUserId: userId,
      currency: "GHS",
      inventoryCount: 0,
      name: "Expense stock",
      organizationId,
      slug: "expense-stock",
      storeId,
      subcategoryId,
    });
    const skuIds: Id<"productSku">[] = [];
    for (let index = 0; index < 11; index += 1) {
      skuIds.push(
        await ctx.db.insert("productSku", {
          images: [],
          inventoryCount: 0,
          price: 0,
          productId,
          productName: `Product ${index + 1}`,
          quantityAvailable: 0,
          sku: `SKU-${index + 1}`,
          storeId,
        }),
      );
    }
    const staffProfileId = await ctx.db.insert("staffProfile", {
      firstName: "Repair",
      fullName: "Repair Fixture",
      lastName: "Fixture",
      organizationId,
      status: "active",
      storeId,
    });
    const terminalId = await ctx.db.insert("posTerminal", {
      browserInfo: { userAgent: "test" },
      displayName: "Fixture terminal",
      fingerprintHash: "fixture",
      registeredAt: ACCEPTED_AT,
      registeredByUserId: userId,
      status: "active",
      storeId,
    });
    const sessionId = await ctx.db.insert("expenseSession", {
      createdAt: ACCEPTED_AT,
      expiresAt: ACCEPTED_AT,
      sessionNumber: "EXP-001",
      staffProfileId,
      status: "completed",
      storeId,
      terminalId,
      updatedAt: ACCEPTED_AT,
    });

    const closeIds: Id<"dailyClose">[] = [];
    for (const [index, operatingDate] of scheduledDates.entries()) {
      const startAt = dayStart(operatingDate);
      const completedAt = startAt + DAY_MS - 1;
      const summary = daySummaries[index]!;
      const closeId = await ctx.db.insert("dailyClose", {
        carryForwardWorkItemIds: [],
        completedAt,
        createdAt: completedAt,
        isCurrent: true,
        lifecycleStatus: "active",
        operatingDate,
        organizationId,
        readiness: {
          blockerCount: 0,
          carryForwardCount: 0,
          readyCount: 0,
          reviewCount: 0,
          status: "ready",
        },
        reportSnapshot: {
          carryForwardGroups: [],
          carryForwardItems: [],
          closeMetadata: {
            carryForwardWorkItemIds: [],
            completedAt,
            endAt: startAt + DAY_MS,
            operatingDate,
            organizationId,
            startAt,
            storeId,
          },
          frozenSyncedSaleInventoryReviewGroups: [],
          openWorkMembership: {
            completeness: "complete",
            observedLogicalCount: 0,
          },
          readiness: {
            blockerCount: 0,
            carryForwardCount: 0,
            readyCount: 0,
            reviewCount: 0,
            status: "ready",
          },
          readyItems: [],
          reviewedItems: [],
          snapshotContractVersion: 2,
          sourceSubjects: [],
          summary,
        },
        sourceSubjects: [],
        status: "completed",
        storeId,
        summary,
        updatedAt: completedAt,
      });
      closeIds.push(closeId);
      await ctx.db.insert("reportDay", {
        closeAcceptedAt: completedAt,
        closeId,
        closeVarianceMinor: 0,
        currency: "GHS",
        factCount: 0,
        flags: {
          hasUncostedRevenue: false,
          mixedCurrency: false,
          quarantinedFactCount: 0,
        },
        foldVersion: 1,
        foldedAt: completedAt,
        grossProfitMinor: 0,
        grossSalesMinor: 0,
        lastFactRecordedAt: completedAt,
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
        status: "reconciled",
        storeId,
        uncostedRevenueMinor: 0,
        unitsReturned: 0,
        unitsSold: 0,
      });
    }

    const transactionIds: Id<"expenseTransaction">[] = [];
    const itemIds: Id<"expenseTransactionItem">[] = [];
    const day0 = dayStart(scheduledDates[0]!);
    for (const [index, spec] of transactionSpecs.entries()) {
      const transactionId = await ctx.db.insert("expenseTransaction", {
        completedAt: day0 + (index + 1) * 3_600_000,
        sessionId,
        staffProfileId,
        status: "completed",
        storeId,
        totalValue: spec.totalValue,
        transactionNumber: String(index + 1).padStart(3, "0"),
      });
      transactionIds.push(transactionId);
      for (const item of spec.items) {
        itemIds.push(
          await ctx.db.insert("expenseTransactionItem", {
            costPrice: item.costPrice,
            productId,
            productName: `Product ${item.sku + 1}`,
            productSku: `SKU-${item.sku + 1}`,
            productSkuId: skuIds[item.sku]!,
            quantity: item.quantity,
            transactionId,
          }),
        );
      }
    }

    let acceptedId: Id<"reportWeekAccepted"> | null = null;
    if (options.withAccepted !== false) {
      acceptedId = await ctx.db.insert("reportWeekAccepted", {
        acceptedAt: ACCEPTED_AT,
        amendmentPosture: "none",
        baselineFingerprint: "baseline-live",
        cashVariancePosture: {
          cashVarianceMinor: 32_000,
          coverage: "complete",
          coveredIncludedDayCount: 6,
          includedDayCount: 6,
        },
        closeEvidence: baselineCloseEvidence,
        closeId: closeIds[5]!,
        completeness: { complete: true, reason: "complete" },
        currency: "GHS",
        cutoffObservedAt: ACCEPTED_AT,
        cycleEndDate: "2026-08-09",
        cycleStartDate: "2026-08-03",
        included: zeroWeekMetrics,
        lifecyclePosture: "accepted",
        metricVersion: 1,
        outsideSchedule: zeroWeekMetrics,
        scheduleLineage: [
          ...scheduledDates.map((localDate) => ({
            activityPosture: "recorded" as const,
            dayAvailable: true,
            dayClosed: false,
            dayStatus: "reconciled" as const,
            included: true,
            localDate,
            scheduleVersionId: null,
          })),
          {
            activityPosture: "zero_activity" as const,
            dayAvailable: true,
            dayClosed: false,
            dayStatus: "reconciled" as const,
            included: false,
            localDate: "2026-08-09",
            scheduleVersionId: null,
          },
        ],
        storeId,
        // Legacy production shape: units only, no frozen display identity.
        topSkuLeaders: Array.from(
          { length: options.leaderCount ?? 2 },
          (_, index) => ({
            productSkuId: skuIds[index]!,
            unitsSold: 10 - index,
          }),
        ),
        variancePosture: {
          closeVarianceMinor: 0,
          coverage: "complete",
          coveredIncludedDayCount: 6,
          includedDayCount: 6,
        },
      });
    }

    return {
      acceptedId,
      closeIds,
      itemIds,
      organizationId,
      sessionId,
      skuIds,
      staffProfileId,
      storeId,
      transactionIds,
    };
  });
}

/** JSON snapshot of every table the repair may read or (must never) write. */
async function snapshotState(
  t: ReturnType<typeof convexTest>,
  options: { includeAccepted?: boolean } = {},
) {
  return t.run(async (ctx) => {
    const state: Record<string, unknown> = {
      dailyClose: await ctx.db.query("dailyClose").take(100),
      expenseTransaction: await ctx.db.query("expenseTransaction").take(100),
      expenseTransactionItem: await ctx.db
        .query("expenseTransactionItem")
        .take(300),
      notificationDelivery: await ctx.db
        .query("notificationDelivery")
        .take(100),
      notificationIntent: await ctx.db.query("notificationIntent").take(100),
      reportDay: await ctx.db.query("reportDay").take(100),
      scheduledFunctions: await ctx.db.system
        .query("_scheduled_functions")
        .take(100),
    };
    if (options.includeAccepted !== false) {
      state.reportWeekAccepted = await ctx.db
        .query("reportWeekAccepted")
        .take(100);
    }
    return JSON.stringify(state);
  });
}

async function preview(t: ReturnType<typeof convexTest>) {
  return t.query(
    internal.reports.weeklyAcceptedRepair.previewWigclubAug3WeeklyCorrection,
    {},
  );
}

async function apply(
  t: ReturnType<typeof convexTest>,
  args: { baselineFingerprint: string; candidateFingerprint: string },
) {
  return t.mutation(
    internal.reports.weeklyAcceptedRepair.applyWigclubAug3WeeklyCorrection,
    args,
  );
}

describe("sealed Wigclub Aug 3-9 repair commands", () => {
  it("invalidates an accepted migration proof only when correction applies", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedWigclubWeek(t);
    const controlId = await t.run(async (ctx) => {
      const accepted = await ctx.db.get(
        "reportWeekAccepted",
        seeded.acceptedId!,
      );
      return ctx.db.insert("reportPipelineControl", {
        storeId: accepted!.storeId,
        mode: "shadow",
        fence: 1,
        sourceWatermark: 0,
        acceptedWatermark: 2,
      });
    });
    const dryRun = await preview(t);
    const args = {
      baselineFingerprint: dryRun.baselineFingerprint,
      candidateFingerprint: dryRun.candidateFingerprint,
    };
    expect(await apply(t, args)).toEqual({ outcome: "applied" });
    expect(
      await t.run((ctx) => ctx.db.get("reportPipelineControl", controlId)),
    ).toMatchObject({ acceptedWatermark: 3 });
    expect(await apply(t, args)).toEqual({ outcome: "unchanged" });
    expect(
      await t.run((ctx) => ctx.db.get("reportPipelineControl", controlId)),
    ).toMatchObject({ acceptedWatermark: 3 });
  });

  it("dry run reconstructs the sealed census and writes nothing", async () => {
    const t = convexTest(schema, modules);
    await seedWigclubWeek(t);
    const before = await snapshotState(t);

    const dryRun = await preview(t);

    expect(await snapshotState(t)).toBe(before);
    expect(dryRun.baselineFingerprint).toBe("baseline-live");
    expect(dryRun.candidateFingerprint).toMatch(/^v1:[0-9a-f]{8}$/);
    expect(dryRun.correction.closeEvidence.cash).toMatchObject({
      cashVarianceMinor: 32_000,
      coverage: { status: "complete", usableDayCount: 6 },
    });
    expect(dryRun.correction.closeEvidence.payments).toMatchObject({
      coveredTenderValueMinor: 2_502_500,
      coverage: { status: "complete", usableDayCount: 6 },
    });
    expect(dryRun.correction.closeEvidence.expenses).toMatchObject({
      coveredQuantity: 16,
      coveredSpendMinor: 70_500,
      coverage: { status: "complete", usableDayCount: 6 },
    });
    expect(dryRun.dailyReconciliation).toHaveLength(6);
    expect(dryRun.dailyReconciliation[0]).toMatchObject({
      expenseSpendMinor: 70_500,
      expenseTransactionCount: 10,
      operatingDate: "2026-08-03",
    });
    expect(dryRun.notificationState).toEqual({
      deliveryCount: 0,
      deliveryStatuses: [],
      intentCount: 0,
      intentStatuses: [],
    });
    expect(dryRun.warning).toContain("reconstructed");
  });

  it("apply stores only the correction projection and keeps the baseline byte-stable", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedWigclubWeek(t);
    const sourcesBefore = await snapshotState(t, { includeAccepted: false });
    const acceptedBefore = await t.run((ctx) =>
      ctx.db.get("reportWeekAccepted", seeded.acceptedId!),
    );
    const dryRun = await preview(t);

    await expect(
      apply(t, {
        baselineFingerprint: dryRun.baselineFingerprint,
        candidateFingerprint: dryRun.candidateFingerprint,
      }),
    ).resolves.toEqual({ outcome: "applied" });

    // Source rows, notification state, and the schedule stay untouched.
    expect(await snapshotState(t, { includeAccepted: false })).toBe(
      sourcesBefore,
    );
    const acceptedAfter = await t.run((ctx) =>
      ctx.db.get("reportWeekAccepted", seeded.acceptedId!),
    );
    expect(acceptedAfter?.correction).toMatchObject({
      candidateFingerprint: dryRun.candidateFingerprint,
      contractVersion: 1,
    });
    // Every original accepted baseline field is byte-stable.
    const { correction: _correction, ...withoutCorrection } = acceptedAfter!;
    expect(JSON.stringify(withoutCorrection)).toBe(
      JSON.stringify(acceptedBefore),
    );

    // An identical rerun no-ops without another write.
    const afterApply = await snapshotState(t);
    await expect(
      apply(t, {
        baselineFingerprint: dryRun.baselineFingerprint,
        candidateFingerprint: dryRun.candidateFingerprint,
      }),
    ).resolves.toEqual({ outcome: "unchanged" });
    expect(await snapshotState(t)).toBe(afterApply);

    // A different existing correction rejects instead of being replaced.
    await t.run(async (ctx) => {
      const accepted = await ctx.db.get(
        "reportWeekAccepted",
        seeded.acceptedId!,
      );
      await ctx.db.patch("reportWeekAccepted", seeded.acceptedId!, {
        correction: {
          ...accepted!.correction!,
          candidateFingerprint: "v1:conflict",
        },
      });
    });
    await expect(
      apply(t, {
        baselineFingerprint: dryRun.baselineFingerprint,
        candidateFingerprint: dryRun.candidateFingerprint,
      }),
    ).rejects.toThrow("different correction");
  });

  it("refuses when the sealed accepted target is missing", async () => {
    const t = convexTest(schema, modules);
    await seedWigclubWeek(t, { withAccepted: false });

    await expect(preview(t)).rejects.toThrow(
      "Sealed accepted weekly report lookup was not unique.",
    );
  });

  it("refuses a cash census that does not match the sealed week", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedWigclubWeek(t);
    await t.run(async (ctx) => {
      const close = await ctx.db.get("dailyClose", seeded.closeIds[0]!);
      await ctx.db.patch("dailyClose", seeded.closeIds[0]!, {
        reportSnapshot: {
          ...close!.reportSnapshot!,
          summary: {
            ...close!.reportSnapshot!.summary,
            netCashVariance: 11_000,
          },
        },
      });
    });

    await expect(preview(t)).rejects.toThrow(
      "cash evidence does not match the sealed census",
    );
  });

  it("refuses when the expense transaction probe overflows its sealed bound", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedWigclubWeek(t);
    await t.run(async (ctx) => {
      const day1 = dayStart(scheduledDates[1]!);
      for (let index = 0; index < 11; index += 1) {
        await ctx.db.insert("expenseTransaction", {
          completedAt: day1 + index + 1,
          sessionId: seeded.sessionId,
          staffProfileId: seeded.staffProfileId,
          status: "completed",
          storeId: seeded.storeId,
          totalValue: 0,
          transactionNumber: `overflow-${index}`,
        });
      }
    });

    await expect(preview(t)).rejects.toThrow("probe exceeded its sealed bound");
  });

  it("refuses a day whose reconstructed spend differs from its frozen close expense total", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedWigclubWeek(t);
    // The weekly GH₵705 census still reconciles; only the per-day frozen
    // Daily Close authority disagrees, so only the per-day seam can refuse.
    await t.run(async (ctx) => {
      const close = await ctx.db.get("dailyClose", seeded.closeIds[0]!);
      await ctx.db.patch("dailyClose", seeded.closeIds[0]!, {
        reportSnapshot: {
          ...close!.reportSnapshot!,
          summary: { ...close!.reportSnapshot!.summary, expenseTotal: 70_000 },
        },
      });
    });

    await expect(preview(t)).rejects.toThrow(
      "does not equal its frozen close expense total",
    );
    await expect(
      apply(t, {
        baselineFingerprint: "baseline-live",
        candidateFingerprint: "v1:any",
      }),
    ).rejects.toThrow("does not equal its frozen close expense total");
  });

  it("rebuilds frozen top-sales identity in the baseline's own order", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedWigclubWeek(t);

    const dryRun = await preview(t);

    expect(dryRun.correction.topSkuLeaders).toEqual([
      {
        productName: "Expense stock",
        productSku: "SKU-1",
        productSkuId: seeded.skuIds[0]!,
        unitsSold: 10,
      },
      {
        productName: "Expense stock",
        productSku: "SKU-2",
        productSkuId: seeded.skuIds[1]!,
        unitsSold: 9,
      },
    ]);

    await expect(
      apply(t, {
        baselineFingerprint: dryRun.baselineFingerprint,
        candidateFingerprint: dryRun.candidateFingerprint,
      }),
    ).resolves.toEqual({ outcome: "applied" });
    const accepted = await t.run((ctx) =>
      ctx.db.get("reportWeekAccepted", seeded.acceptedId!),
    );
    expect(accepted?.correction?.topSkuLeaders).toEqual(
      dryRun.correction.topSkuLeaders,
    );
    // The immutable baseline keeps its legacy identity-free leaders.
    expect(accepted?.topSkuLeaders?.[0]).toEqual({
      productSkuId: seeded.skuIds[0]!,
      unitsSold: 10,
    });
  });

  it("omits the section when the baseline retained no leaders", async () => {
    const t = convexTest(schema, modules);
    await seedWigclubWeek(t, { leaderCount: 0 });

    expect((await preview(t)).correction).not.toHaveProperty("topSkuLeaders");
  });

  it("refuses a leader whose catalog identity cannot be resolved", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedWigclubWeek(t);
    // A blank/placeholder SKU label is not a real catalog answer, and the
    // operator-reviewed repair must not seal the opaque id in its place.
    await t.run((ctx) =>
      ctx.db.patch("productSku", seeded.skuIds[1]!, { sku: "null" }),
    );

    await expect(preview(t)).rejects.toThrow("has no resolvable catalog label");
    await expect(
      apply(t, {
        baselineFingerprint: "baseline-live",
        candidateFingerprint: "v1:any",
      }),
    ).rejects.toThrow("has no resolvable catalog label");
  });

  it("refuses a leader whose SKU is missing from the sealed store", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedWigclubWeek(t);
    await t.run((ctx) => ctx.db.delete("productSku", seeded.skuIds[0]!));

    await expect(preview(t)).rejects.toThrow(
      "has no catalog SKU in the sealed store",
    );
  });

  it("refuses more leaders than the sealed top-sales bound", async () => {
    const t = convexTest(schema, modules);
    await seedWigclubWeek(t, { leaderCount: 6 });

    await expect(preview(t)).rejects.toThrow(
      "top sales leader probe exceeded its sealed bound",
    );
  });

  it("seals the reconstructed leaders into the candidate fingerprint", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedWigclubWeek(t);
    const dryRun = await preview(t);

    // Catalog drift after preview changes the frozen name the operator read.
    await t.run(async (ctx) => {
      const sku = await ctx.db.get("productSku", seeded.skuIds[0]!);
      await ctx.db.patch("product", sku!.productId, {
        name: "Renamed after preview",
      });
    });

    await expect(
      apply(t, {
        baselineFingerprint: dryRun.baselineFingerprint,
        candidateFingerprint: dryRun.candidateFingerprint,
      }),
    ).rejects.toThrow(
      "Correction candidate fingerprint drifted after preview.",
    );
    expect(
      (
        await t.run((ctx) =>
          ctx.db.get("reportWeekAccepted", seeded.acceptedId!),
        )
      )?.correction,
    ).toBeUndefined();
  });

  it("refuses apply when evidence drifts between preview and apply", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedWigclubWeek(t);
    const dryRun = await preview(t);

    await expect(
      apply(t, {
        baselineFingerprint: "baseline-drifted",
        candidateFingerprint: dryRun.candidateFingerprint,
      }),
    ).rejects.toThrow("Accepted baseline fingerprint drifted after preview.");

    // Same totals, different retained identity: the manifest must move.
    await t.run((ctx) =>
      ctx.db.patch("expenseTransactionItem", seeded.itemIds[0]!, {
        productName: "Renamed after preview",
      }),
    );
    await expect(
      apply(t, {
        baselineFingerprint: dryRun.baselineFingerprint,
        candidateFingerprint: dryRun.candidateFingerprint,
      }),
    ).rejects.toThrow(
      "Correction candidate fingerprint drifted after preview.",
    );
    expect(
      (
        await t.run((ctx) =>
          ctx.db.get("reportWeekAccepted", seeded.acceptedId!),
        )
      )?.correction,
    ).toBeUndefined();
  });
});
