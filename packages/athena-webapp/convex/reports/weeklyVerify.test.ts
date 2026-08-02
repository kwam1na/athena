/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import schema from "../schema";
import type { MutationCtx } from "../_generated/server";
import { seedPosSale, seedStore, type SeededStore } from "./reseedTestSupport";
import { VERIFY_MAX_SCHEDULES, verifyCurrentWeekWithCtx } from "./verify";
import {
  availableWeekCurrent,
  materializeAcceptedWeek,
  rebuildCurrentWeek,
  refreshAcceptedWeekForDate,
} from "./weekly";

const modules = import.meta.glob("../**/*.ts");
const NOW = Date.parse("2026-03-05T18:00:00.000Z");
/** The frame NOW resolves to: Monday anchored, Sunday closed. */
const CYCLE_START = "2026-03-02";
const FINAL_DATE = "2026-03-07";

/** A store whose schedule resolves the frame above and may accept weeks. */
async function seedScheduledStore(ctx: MutationCtx) {
  const store = await seedStore(ctx);
  const scheduleId = await ctx.db.insert("storeSchedule", {
    organizationId: store.organizationId,
    storeId: store.storeId,
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
  await ctx.db.patch("store", store.storeId, {
    weeklyObservedAtVerification: {
      status: "complete",
      missingCount: 0,
      startedAt: NOW,
      completedAt: NOW,
    },
  });
  return { ...store, scheduleId };
}

const ZERO_PAYMENT_POSTURE = {
  allocatedMinor: 0,
  allocationCoverage: "complete" as const,
  allocationOmittedMinor: 0,
  collectedMinor: 0,
  hasInvalidAllocation: false,
  refundedMinor: 0,
  unsettledMinor: 0,
};

const CLEAN_FLAGS = {
  hasUncostedRevenue: false,
  mixedCurrency: false,
  quarantinedFactCount: 0,
};

/** A folded day row. Callers override only what the scenario is about. */
function dayRow(
  seeded: SeededStore,
  operatingDate: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    storeId: seeded.storeId,
    operatingDate,
    currency: "GHS",
    status: "open" as const,
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
    paymentPosture: ZERO_PAYMENT_POSTURE,
    flags: CLEAN_FLAGS,
    foldVersion: 1,
    factCount: 0,
    lastFactRecordedAt: NOW,
    ...overrides,
  };
}

function closeRow(
  seeded: SeededStore,
  operatingDate: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    storeId: seeded.storeId,
    organizationId: seeded.organizationId,
    operatingDate,
    status: "completed" as const,
    lifecycleStatus: "active" as const,
    isCurrent: true,
    readiness: {
      status: "ready" as const,
      blockerCount: 0,
      reviewCount: 0,
      carryForwardCount: 0,
      readyCount: 0,
    },
    summary: {} as Record<string, unknown>,
    sourceSubjects: [],
    carryForwardWorkItemIds: [],
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: NOW,
    ...overrides,
  };
}

describe("weekly source verification", () => {
  it("returns the stored unavailable posture without dereferencing weekly metrics", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const store = await seedStore(ctx);
      await ctx.db.insert("storeSchedule", {
        organizationId: store.organizationId,
        storeId: store.storeId,
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
      await ctx.db.insert("reportWeekCurrent", {
        storeId: store.storeId,
        availability: "unavailable",
        unavailableReason: "missing_day_fold",
        lifecyclePosture: "materializing",
        amendmentPosture: "none",
        materializedAt: NOW,
      });

      await expect(
        verifyCurrentWeekWithCtx(ctx, store.storeId),
      ).resolves.toEqual({
        outcome: "unavailable",
        reason: "missing_day_fold",
      });
    });
  });

  it("returns incomplete when accepted close history exceeds eight versions", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const store = await seedStore(ctx);
      await ctx.db.insert("storeSchedule", {
        organizationId: store.organizationId,
        storeId: store.storeId,
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
      await ctx.db.patch("store", store.storeId, {
        weeklyObservedAtVerification: {
          status: "complete",
          missingCount: 0,
          startedAt: NOW,
          completedAt: NOW,
        },
      });
      return store;
    });
    await t.run(async (ctx) => {
      expect(await rebuildCurrentWeek(ctx, seeded.storeId, NOW)).toBe(
        "rebuilt",
      );
      const closeId = await ctx.db.insert("dailyClose", {
        storeId: seeded.storeId,
        organizationId: seeded.organizationId,
        operatingDate: "2026-03-07",
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
        storeId: seeded.storeId,
        operatingDate: "2026-03-07",
        currency: "GHS",
        status: "reconciled",
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
        paymentPosture: {
          allocatedMinor: 0,
          allocationCoverage: "complete",
          allocationOmittedMinor: 0,
          collectedMinor: 0,
          hasInvalidAllocation: false,
          refundedMinor: 0,
          unsettledMinor: 0,
        },
        flags: {
          hasUncostedRevenue: false,
          mixedCurrency: false,
          quarantinedFactCount: 0,
        },
        closeId,
        closeAcceptedAt: NOW,
        foldedAt: NOW + 1,
        foldVersion: 1,
        factCount: 0,
        lastFactRecordedAt: NOW,
      });
      expect(
        await materializeAcceptedWeek({
          acceptedAt: NOW,
          closeId,
          ctx,
          cutoffObservedAt: NOW,
          storeId: seeded.storeId,
        }),
      ).toBe("created");
      const close = await ctx.db.get("dailyClose", closeId);
      if (!close) throw new Error("missing fixture close");
      const { _creationTime, _id, ...closeFields } = close;
      for (let index = 1; index <= 8; index += 1) {
        await ctx.db.insert("dailyClose", {
          ...closeFields,
          completedAt: NOW + index,
          createdAt: NOW + index,
          isCurrent: false,
          lifecycleStatus: "superseded",
          updatedAt: NOW + index,
        });
      }
      expect(await verifyCurrentWeekWithCtx(ctx, seeded.storeId)).toMatchObject(
        {
          daysChecked: 7,
          outcome: "incomplete",
          reason: "source_cap_exceeded",
        },
      );
    });
  });

  it("returns incomplete when a non-payment source lane exceeds its cap", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const store = await seedStore(ctx);
      await ctx.db.insert("storeSchedule", {
        organizationId: store.organizationId,
        storeId: store.storeId,
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
      return store;
    });
    await t.run(async (ctx) => {
      expect(await rebuildCurrentWeek(ctx, seeded.storeId, NOW)).toBe(
        "rebuilt",
      );
      for (let index = 0; index <= 500; index += 1) {
        await ctx.db.insert("posTransaction", {
          completedAt: Date.parse("2026-03-05T10:00:00.000Z"),
          payments: [],
          status: "completed",
          storeId: seeded.storeId,
          subtotal: 100,
          tax: 0,
          total: 100,
          totalPaid: 100,
          transactionNumber: `weekly-cap-${index}`,
        });
      }
      expect(await verifyCurrentWeekWithCtx(ctx, seeded.storeId)).toMatchObject(
        {
          daysChecked: 7,
          outcome: "incomplete",
          reason: "source_cap_exceeded",
        },
      );
    });
  });

  it("verifies against effective superseded schedule history", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const store = await seedStore(ctx);
      const scheduleId = await ctx.db.insert("storeSchedule", {
        organizationId: store.organizationId,
        storeId: store.storeId,
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
      return { ...store, scheduleId };
    });
    await t.run(async (ctx) => {
      expect(await rebuildCurrentWeek(ctx, seeded.storeId, NOW)).toBe(
        "rebuilt",
      );
      await ctx.db.patch("storeSchedule", seeded.scheduleId, {
        status: "superseded",
      });
      expect(await verifyCurrentWeekWithCtx(ctx, seeded.storeId)).toMatchObject(
        {
          matches: true,
          outcome: "verified",
          scheduleMatches: true,
        },
      );
    });
  });

  it("accepts exact-cap schedule history and refuses the first overflow", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const store = await seedStore(ctx);
      const scheduleId = await ctx.db.insert("storeSchedule", {
        organizationId: store.organizationId,
        storeId: store.storeId,
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
      return { ...store, scheduleId };
    });
    await t.run(async (ctx) => {
      expect(await rebuildCurrentWeek(ctx, seeded.storeId, NOW)).toBe(
        "rebuilt",
      );
      const schedule = await ctx.db.get("storeSchedule", seeded.scheduleId);
      if (!schedule) throw new Error("missing fixture schedule");
      const { _creationTime, _id, ...scheduleFields } = schedule;
      for (let index = 1; index < VERIFY_MAX_SCHEDULES; index += 1) {
        await ctx.db.insert("storeSchedule", {
          ...scheduleFields,
          effectiveFrom: Date.parse("2027-01-01T00:00:00.000Z") + index,
        });
      }
    });

    await t.run(async (ctx) => {
      expect(await verifyCurrentWeekWithCtx(ctx, seeded.storeId)).toMatchObject(
        {
          matches: true,
          outcome: "verified",
          truncated: false,
        },
      );
      const schedule = await ctx.db.get("storeSchedule", seeded.scheduleId);
      if (!schedule) throw new Error("missing fixture schedule");
      const { _creationTime, _id, ...scheduleFields } = schedule;
      await ctx.db.insert("storeSchedule", {
        ...scheduleFields,
        effectiveFrom:
          Date.parse("2027-01-01T00:00:00.000Z") + VERIFY_MAX_SCHEDULES,
      });
      expect(await verifyCurrentWeekWithCtx(ctx, seeded.storeId)).toMatchObject(
        {
          daysChecked: 0,
          outcome: "incomplete",
          reason: "source_cap_exceeded",
        },
      );
    });
  });

  it("independently verifies schedule membership and non-empty headline totals", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const store = await seedStore(ctx);
      await ctx.db.insert("storeSchedule", {
        organizationId: store.organizationId,
        storeId: store.storeId,
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
      await seedPosSale(ctx, store, {
        completedAt: Date.parse("2026-03-05T10:00:00.000Z"),
        lines: [{ quantity: 2, unitPrice: 5_000 }],
        tax: 500,
        transactionNumber: "weekly-verify",
      });
      await ctx.db.insert("reportDay", {
        storeId: store.storeId,
        operatingDate: "2026-03-05",
        currency: "GHS",
        status: "open",
        grossSalesMinor: 10_500,
        netSalesMinor: 10_500,
        refundsMinor: 0,
        unitsSold: 2,
        unitsReturned: 0,
        uncostedRevenueMinor: 10_500,
        grossProfitMinor: null,
        paymentsCollectedMinor: 0,
        paymentsRefundedMinor: 0,
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
        flags: {
          hasUncostedRevenue: true,
          mixedCurrency: false,
          quarantinedFactCount: 0,
        },
        foldVersion: 1,
        factCount: 1,
        lastFactRecordedAt: NOW,
      });
      return store;
    });

    await t.run(async (ctx) => {
      expect(await rebuildCurrentWeek(ctx, seeded.storeId, NOW)).toBe(
        "rebuilt",
      );
    });
    await t.run(async (ctx) => {
      const result = await verifyCurrentWeekWithCtx(ctx, seeded.storeId);
      expect(result).toMatchObject({
        amendmentMatches: true,
        closeMatches: true,
        daysChecked: 7,
        includedDifferences: [],
        inventoryMatches: true,
        matches: true,
        outcome: "verified",
        outsideScheduleDifferences: [],
        scheduleMatches: true,
        truncated: false,
        varianceMatches: true,
      });

      const current = availableWeekCurrent(
        await ctx.db
          .query("reportWeekCurrent")
          .withIndex("by_storeId", (q) => q.eq("storeId", seeded.storeId))
          .unique(),
      );
      if (!current) throw new Error("missing fixture projection");
      const closeId = await ctx.db.insert("dailyClose", {
        storeId: seeded.storeId,
        organizationId: seeded.organizationId,
        operatingDate: "2026-03-07",
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
      await ctx.db.patch("reportWeekCurrent", current._id, {
        amendment: {
          changedAt: NOW,
          currentFingerprint: "corrupt",
          included: current.included,
          includedNetSalesDeltaMinor: 1,
          outsideSchedule: current.outsideSchedule,
          outsideScheduleNetSalesDeltaMinor: 0,
          sourceCloseAcceptedAt: NOW,
          sourceCloseId: closeId,
        },
        closePosture: {
          acceptedCloseId: closeId,
          currentCloseId: closeId,
          changedAt: NOW,
          status: "accepted",
        },
        inventoryAttention: {
          ...current.inventoryAttention!,
          newCount: (current.inventoryAttention?.newCount ?? 0) + 1,
        },
        variancePosture: {
          ...current.variancePosture!,
          closeVarianceMinor:
            (current.variancePosture?.closeVarianceMinor ?? 0) + 1,
        },
      });
      expect(await verifyCurrentWeekWithCtx(ctx, seeded.storeId)).toMatchObject(
        {
          amendmentMatches: false,
          closeMatches: false,
          inventoryMatches: false,
          matches: false,
          outcome: "verified",
          varianceMatches: false,
        },
      );
    });
  });

  it("keeps the weekly gate incomplete for an untimed legacy payment void", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const store = await seedStore(ctx);
      await ctx.db.insert("storeSchedule", {
        organizationId: store.organizationId,
        storeId: store.storeId,
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
      await ctx.db.insert("paymentAllocation", {
        allocationType: "retail_sale",
        amount: 2_000,
        collectedInStore: true,
        currency: "GHS",
        direction: "in",
        method: "cash",
        organizationId: store.organizationId,
        recordedAt: Date.parse("2026-03-05T10:00:00.000Z"),
        status: "voided",
        storeId: store.storeId,
        targetId: "legacy",
        targetType: "pos_transaction",
      });
      return store;
    });

    await t.run(async (ctx) => {
      expect(await rebuildCurrentWeek(ctx, seeded.storeId, NOW)).toBe(
        "rebuilt",
      );
    });
    await t.run(async (ctx) => {
      expect(await verifyCurrentWeekWithCtx(ctx, seeded.storeId)).toMatchObject(
        {
          daysChecked: 7,
          outcome: "incomplete",
          reason: "payment_source_incomplete",
        },
      );
    });
  });
});

/**
 * Non-vacuity proofs.
 *
 * Each test starts from a projection the verifier agrees with, then breaks ONE
 * thing and asserts the verifier names it. A comparison that cannot be made to
 * fail is not a check, and these are the tests that say so.
 */
describe("weekly source verification — provable non-vacuity", () => {
  async function seedSettledPaymentWeek(t: ReturnType<typeof convexTest>) {
    const seeded = await t.run(async (ctx: MutationCtx) => {
      const store = await seedScheduledStore(ctx);
      await ctx.db.insert("paymentAllocation", {
        allocationType: "retail_sale",
        amount: 5_000,
        collectedInStore: true,
        currency: "GHS",
        direction: "in",
        method: "cash",
        organizationId: store.organizationId,
        recordedAt: Date.parse("2026-03-05T10:00:00.000Z"),
        status: "recorded",
        storeId: store.storeId,
        targetId: "settled",
        targetType: "pos_transaction",
      });
      await ctx.db.insert(
        "reportDay",
        dayRow(store, "2026-03-05", {
          factCount: 1,
          paymentAllocatedMinor: 5_000,
          paymentsCollectedMinor: 5_000,
          paymentPosture: {
            ...ZERO_PAYMENT_POSTURE,
            allocatedMinor: 5_000,
            collectedMinor: 5_000,
          },
        }),
      );
      return store;
    });
    await t.run(async (ctx: MutationCtx) => {
      expect(await rebuildCurrentWeek(ctx, seeded.storeId, NOW)).toBe("rebuilt");
    });
    return seeded;
  }

  it("flags each stored weekly payment field on its own", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedSettledPaymentWeek(t);

    await t.run(async (ctx: MutationCtx) => {
      expect(await verifyCurrentWeekWithCtx(ctx, seeded.storeId)).toMatchObject({
        includedPaymentDifferences: [],
        matches: true,
        outcome: "verified",
        outsideSchedulePaymentDifferences: [],
      });
    });

    const corruptions = [
      {
        fields: ["paymentUnsettledMinor"],
        patch: { paymentUnsettledMinor: 999 },
      },
      {
        fields: ["paymentAllocationCoverage"],
        patch: { paymentAllocationCoverage: "unknown" as const },
      },
      {
        // A nonzero omitted total is unknown coverage by contract
        // (`normalizeWeekMetrics`), so this one legitimately moves two lanes.
        fields: ["paymentAllocationCoverage", "paymentAllocationOmittedMinor"],
        patch: { paymentAllocationOmittedMinor: 500 },
      },
      {
        fields: ["paymentHasInvalidAllocation"],
        patch: { paymentHasInvalidAllocation: true },
      },
    ];

    for (const corruption of corruptions) {
      await t.run(async (ctx: MutationCtx) => {
        const current = availableWeekCurrent(
          await ctx.db
            .query("reportWeekCurrent")
            .withIndex("by_storeId", (q) => q.eq("storeId", seeded.storeId))
            .unique(),
        );
        if (!current) throw new Error("missing fixture projection");
        const original = current.included;
        await ctx.db.patch("reportWeekCurrent", current._id, {
          included: { ...original, ...corruption.patch },
        });
        const result = await verifyCurrentWeekWithCtx(ctx, seeded.storeId);
        if (result.outcome !== "verified") {
          throw new Error(`unexpected outcome ${result.outcome}`);
        }
        expect(
          result.includedPaymentDifferences.map((row) => row.field),
        ).toEqual(corruption.fields);
        expect(result.outsideSchedulePaymentDifferences).toEqual([]);
        expect(result.matches).toBe(false);
        await ctx.db.patch("reportWeekCurrent", current._id, {
          included: original,
        });
      });
    }
  });

  it("keeps the included and outside-schedule payment lanes separate", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedSettledPaymentWeek(t);

    await t.run(async (ctx: MutationCtx) => {
      const current = availableWeekCurrent(
        await ctx.db
          .query("reportWeekCurrent")
          .withIndex("by_storeId", (q) => q.eq("storeId", seeded.storeId))
          .unique(),
      );
      if (!current) throw new Error("missing fixture projection");
      await ctx.db.patch("reportWeekCurrent", current._id, {
        outsideSchedule: {
          ...current.outsideSchedule,
          paymentUnsettledMinor: 7,
        },
      });
      const result = await verifyCurrentWeekWithCtx(ctx, seeded.storeId);
      if (result.outcome !== "verified") {
        throw new Error(`unexpected outcome ${result.outcome}`);
      }
      expect(result.includedPaymentDifferences).toEqual([]);
      expect(result.outsideSchedulePaymentDifferences).toEqual([
        { actual: 7, expected: 0, field: "paymentUnsettledMinor" },
      ]);
      expect(result.matches).toBe(false);
    });
  });

  it("re-derives schedule membership from schedule versions, not the lineage", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(seedScheduledStore);
    await t.run(async (ctx: MutationCtx) => {
      expect(await rebuildCurrentWeek(ctx, seeded.storeId, NOW)).toBe("rebuilt");
      expect(await verifyCurrentWeekWithCtx(ctx, seeded.storeId)).toMatchObject({
        matches: true,
        scheduleMatches: true,
      });
    });

    // Close a scheduled date at the SOURCE and do not refold. A verifier that
    // called the projection's resolver would happily agree with the stale
    // lineage; one that reads schedule versions cannot.
    await t.run(async (ctx: MutationCtx) => {
      await ctx.db.patch("storeSchedule", seeded.scheduleId, {
        dateExceptions: [
          { localDate: "2026-03-04", closed: true, windows: [] },
        ],
      });
      expect(await verifyCurrentWeekWithCtx(ctx, seeded.storeId)).toMatchObject({
        matches: false,
        outcome: "verified",
        scheduleMatches: false,
      });
    });

    // And the stored lineage on its own is still checked.
    await t.run(async (ctx: MutationCtx) => {
      await ctx.db.patch("storeSchedule", seeded.scheduleId, {
        dateExceptions: [],
      });
      const current = availableWeekCurrent(
        await ctx.db
          .query("reportWeekCurrent")
          .withIndex("by_storeId", (q) => q.eq("storeId", seeded.storeId))
          .unique(),
      );
      if (!current) throw new Error("missing fixture projection");
      await ctx.db.patch("reportWeekCurrent", current._id, {
        scheduleLineage: current.scheduleLineage.map((row, index) =>
          index === 0 ? { ...row, included: !row.included } : row,
        ),
      });
      expect(await verifyCurrentWeekWithCtx(ctx, seeded.storeId)).toMatchObject({
        matches: false,
        scheduleMatches: false,
      });
    });
  });

  it("re-derives close lineage from dailyClose rows, not the stored posture", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(seedScheduledStore);
    await t.run(async (ctx: MutationCtx) => {
      expect(await rebuildCurrentWeek(ctx, seeded.storeId, NOW)).toBe("rebuilt");
      const closeId = await ctx.db.insert(
        "dailyClose",
        closeRow(seeded, FINAL_DATE),
      );
      await ctx.db.insert(
        "reportDay",
        dayRow(seeded, FINAL_DATE, {
          status: "reconciled",
          closeId,
          closeAcceptedAt: NOW,
          closeVarianceMinor: 0,
          foldedAt: NOW + 1,
        }),
      );
      expect(
        await materializeAcceptedWeek({
          acceptedAt: NOW,
          closeId,
          ctx,
          cutoffObservedAt: NOW,
          storeId: seeded.storeId,
        }),
      ).toBe("created");
      expect(await rebuildCurrentWeek(ctx, seeded.storeId, NOW)).toBe("rebuilt");
      expect(await verifyCurrentWeekWithCtx(ctx, seeded.storeId)).toMatchObject({
        closeMatches: true,
        matches: true,
      });
    });

    // A successor close lands but nothing refreshes the projection.
    await t.run(async (ctx: MutationCtx) => {
      await ctx.db.insert(
        "dailyClose",
        closeRow(seeded, FINAL_DATE, {
          completedAt: NOW + 5_000,
          isCurrent: false,
          updatedAt: NOW + 5_000,
        }),
      );
      expect(await verifyCurrentWeekWithCtx(ctx, seeded.storeId)).toMatchObject({
        closeMatches: false,
        matches: false,
        outcome: "verified",
      });
    });
  });

  it("recounts Open Work groups from work-item rows", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(seedScheduledStore);
    await t.run(async (ctx: MutationCtx) => {
      expect(await rebuildCurrentWeek(ctx, seeded.storeId, NOW)).toBe("rebuilt");
      expect(await verifyCurrentWeekWithCtx(ctx, seeded.storeId)).toMatchObject({
        inventoryMatches: true,
        matches: true,
      });
    });

    await t.run(async (ctx: MutationCtx) => {
      await ctx.db.insert("operationalWorkItem", {
        approvalState: "not_required",
        createdAt: NOW,
        metadata: { localTransactionId: "sale-late" },
        organizationId: seeded.organizationId,
        priority: "normal",
        productSkuId: seeded.skuId,
        status: "open",
        storeId: seeded.storeId,
        title: "Review inventory",
        type: "synced_sale_inventory_review",
      });
      expect(await verifyCurrentWeekWithCtx(ctx, seeded.storeId)).toMatchObject({
        inventoryMatches: false,
        matches: false,
        outcome: "verified",
      });
    });

    // And a stored count that drifts from the same rows is caught too.
    await t.run(async (ctx: MutationCtx) => {
      expect(await rebuildCurrentWeek(ctx, seeded.storeId, NOW)).toBe("rebuilt");
      const current = availableWeekCurrent(
        await ctx.db
          .query("reportWeekCurrent")
          .withIndex("by_storeId", (q) => q.eq("storeId", seeded.storeId))
          .unique(),
      );
      if (!current?.inventoryAttention) {
        throw new Error("missing fixture inventory attention");
      }
      expect(await verifyCurrentWeekWithCtx(ctx, seeded.storeId)).toMatchObject({
        inventoryMatches: true,
      });
      await ctx.db.patch("reportWeekCurrent", current._id, {
        inventoryAttention: {
          ...current.inventoryAttention,
          groups: current.inventoryAttention.groups.map((group) => ({
            ...group,
            memberCount: group.memberCount + 1,
          })),
        },
      });
      expect(await verifyCurrentWeekWithCtx(ctx, seeded.storeId)).toMatchObject({
        inventoryMatches: false,
        matches: false,
      });
    });
  });

  it("recomputes close variance from the close's own accepted sales", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx: MutationCtx) => {
      const store = await seedScheduledStore(ctx);
      await seedPosSale(ctx, store, {
        completedAt: Date.parse("2026-03-05T10:00:00.000Z"),
        lines: [{ quantity: 1, unitPrice: 5_000 }],
        transactionNumber: "variance-sale",
      });
      const closeId = await ctx.db.insert(
        "dailyClose",
        closeRow(store, "2026-03-05", { summary: { salesTotal: 5_000 } }),
      );
      await ctx.db.insert(
        "reportDay",
        dayRow(store, "2026-03-05", {
          status: "reconciled",
          factCount: 1,
          grossSalesMinor: 5_000,
          netSalesMinor: 5_000,
          unitsSold: 1,
          uncostedRevenueMinor: 5_000,
          grossProfitMinor: null,
          closeId,
          closeAcceptedAt: NOW,
          closeVarianceMinor: 0,
          foldedAt: NOW + 1,
        }),
      );
      return { ...store, closeId };
    });

    await t.run(async (ctx: MutationCtx) => {
      expect(await rebuildCurrentWeek(ctx, seeded.storeId, NOW)).toBe("rebuilt");
      expect(await verifyCurrentWeekWithCtx(ctx, seeded.storeId)).toMatchObject({
        matches: true,
        varianceMatches: true,
      });
    });

    // Move the close's own accepted total. Nothing in the projection changes,
    // so only a verifier that reads the close row notices.
    await t.run(async (ctx: MutationCtx) => {
      await ctx.db.patch("dailyClose", seeded.closeId, {
        summary: { salesTotal: 4_000 },
      });
      expect(await verifyCurrentWeekWithCtx(ctx, seeded.storeId)).toMatchObject({
        matches: false,
        outcome: "verified",
        varianceMatches: false,
      });
    });

    await t.run(async (ctx: MutationCtx) => {
      await ctx.db.patch("dailyClose", seeded.closeId, {
        summary: { salesTotal: 5_000 },
      });
      const current = availableWeekCurrent(
        await ctx.db
          .query("reportWeekCurrent")
          .withIndex("by_storeId", (q) => q.eq("storeId", seeded.storeId))
          .unique(),
      );
      if (!current?.variancePosture) {
        throw new Error("missing fixture variance posture");
      }
      await ctx.db.patch("reportWeekCurrent", current._id, {
        variancePosture: {
          ...current.variancePosture,
          coveredIncludedDayCount:
            current.variancePosture.coveredIncludedDayCount + 1,
        },
      });
      expect(await verifyCurrentWeekWithCtx(ctx, seeded.storeId)).toMatchObject({
        matches: false,
        varianceMatches: false,
      });
    });
  });

  it("flags a stored variance that omits an outside-schedule close", async () => {
    const t = convexTest(schema, modules);
    // 2026-03-08 is the frame's Sunday, non-operational under this schedule —
    // and closed out anyway, which is what operators actually do.
    const seeded = await t.run(async (ctx: MutationCtx) => {
      const store = await seedScheduledStore(ctx);
      await seedPosSale(ctx, store, {
        completedAt: Date.parse("2026-03-08T10:00:00.000Z"),
        lines: [{ quantity: 1, unitPrice: 5_000 }],
        transactionNumber: "outside-schedule-sale",
      });
      const closeId = await ctx.db.insert(
        "dailyClose",
        closeRow(store, "2026-03-08", { summary: { salesTotal: 4_000 } }),
      );
      await ctx.db.insert(
        "reportDay",
        dayRow(store, "2026-03-08", {
          status: "reconciled",
          factCount: 1,
          grossSalesMinor: 5_000,
          netSalesMinor: 5_000,
          unitsSold: 1,
          uncostedRevenueMinor: 5_000,
          grossProfitMinor: null,
          closeId,
          closeAcceptedAt: NOW,
          closeVarianceMinor: 1_000,
          foldedAt: NOW + 1,
        }),
      );
      return { ...store, closeId };
    });

    await t.run(async (ctx: MutationCtx) => {
      expect(await rebuildCurrentWeek(ctx, seeded.storeId, NOW)).toBe("rebuilt");
      const current = availableWeekCurrent(
        await ctx.db
          .query("reportWeekCurrent")
          .withIndex("by_storeId", (q) => q.eq("storeId", seeded.storeId))
          .unique(),
      );
      expect(current?.variancePosture).toMatchObject({
        closeVarianceMinor: 1_000,
        scheduledVarianceMinor: 0,
        outsideScheduleVarianceMinor: 1_000,
        outsideScheduleCoveredDayCount: 1,
        coveredIncludedDayCount: 0,
      });
      expect(await verifyCurrentWeekWithCtx(ctx, seeded.storeId)).toMatchObject({
        outcome: "verified",
        varianceMatches: true,
      });

      // The pre-fix figure: scheduled dates only. The verifier walks the whole
      // frame independently, so it must contradict rather than mirror it.
      await ctx.db.patch("reportWeekCurrent", current!._id, {
        variancePosture: {
          ...current!.variancePosture!,
          closeVarianceMinor: 0,
          outsideScheduleVarianceMinor: 0,
          outsideScheduleCoveredDayCount: 0,
        },
      });
      expect(await verifyCurrentWeekWithCtx(ctx, seeded.storeId)).toMatchObject({
        matches: false,
        outcome: "verified",
        varianceMatches: false,
      });
    });
  });
});

describe("weekly source verification — accepted lifecycle", () => {
  it("confirms a late fact plus a successor close as a consistent amendment", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx: MutationCtx) => {
      const store = await seedScheduledStore(ctx);
      await seedPosSale(ctx, store, {
        completedAt: Date.parse("2026-03-05T10:00:00.000Z"),
        lines: [{ quantity: 1, unitPrice: 5_000 }],
        transactionNumber: "baseline-sale",
      });
      await ctx.db.insert("reportFact", {
        storeId: store.storeId,
        sourceDomain: "pos",
        sourceId: "baseline-sale",
        lineId: "line-1",
        factKind: "sale",
        fingerprint: "baseline-fp",
        fingerprintVersion: 2,
        occurredAt: Date.parse("2026-03-05T10:00:00.000Z"),
        recordedAt: Date.parse("2026-03-05T10:00:00.000Z"),
        observedAt: NOW - 1_000,
        operatingDate: "2026-03-05",
        currency: "GHS",
        grossAmountMinor: 5_000,
        netAmountMinor: 5_000,
        taxAmountMinor: 0,
        discountAmountMinor: 0,
        quantity: 1,
      });
      await ctx.db.insert(
        "reportDay",
        dayRow(store, "2026-03-05", {
          factCount: 1,
          grossSalesMinor: 5_000,
          netSalesMinor: 5_000,
          unitsSold: 1,
          uncostedRevenueMinor: 5_000,
          grossProfitMinor: null,
        }),
      );
      const closeId = await ctx.db.insert(
        "dailyClose",
        closeRow(store, FINAL_DATE),
      );
      await ctx.db.insert(
        "reportDay",
        dayRow(store, FINAL_DATE, {
          status: "reconciled",
          closeId,
          closeAcceptedAt: NOW,
          closeVarianceMinor: 0,
          foldedAt: NOW + 1,
        }),
      );
      return { ...store, closeId };
    });

    const baseline = await t.run(async (ctx: MutationCtx) => {
      expect(await rebuildCurrentWeek(ctx, seeded.storeId, NOW)).toBe("rebuilt");
      expect(
        await materializeAcceptedWeek({
          acceptedAt: NOW,
          closeId: seeded.closeId,
          ctx,
          cutoffObservedAt: NOW,
          storeId: seeded.storeId,
        }),
      ).toBe("created");
      const accepted = await ctx.db
        .query("reportWeekAccepted")
        .withIndex("by_storeId_cycleStartDate", (q) =>
          q.eq("storeId", seeded.storeId).eq("cycleStartDate", CYCLE_START),
        )
        .unique();
      if (!accepted) throw new Error("missing accepted baseline");
      expect(accepted.included.netSalesMinor).toBe(5_000);
      expect(await verifyCurrentWeekWithCtx(ctx, seeded.storeId)).toMatchObject({
        amendmentMatches: true,
        closeMatches: true,
        matches: true,
        outcome: "verified",
      });
      return {
        fingerprint: accepted.baselineFingerprint,
        id: accepted._id,
        included: accepted.included,
        outsideSchedule: accepted.outsideSchedule,
      };
    });

    // A late sale lands on an already-accepted frame, and the store reopens and
    // re-closes the final date.
    await t.run(async (ctx: MutationCtx) => {
      await seedPosSale(ctx, seeded, {
        completedAt: Date.parse("2026-03-06T10:00:00.000Z"),
        lines: [{ quantity: 2, unitPrice: 1_500 }],
        transactionNumber: "late-sale",
      });
      await ctx.db.insert("reportFact", {
        storeId: seeded.storeId,
        sourceDomain: "pos",
        sourceId: "late-sale",
        lineId: "line-1",
        factKind: "sale",
        fingerprint: "late-fp",
        fingerprintVersion: 2,
        occurredAt: Date.parse("2026-03-06T10:00:00.000Z"),
        recordedAt: Date.parse("2026-03-06T10:00:00.000Z"),
        observedAt: NOW + 4_000,
        operatingDate: "2026-03-06",
        currency: "GHS",
        grossAmountMinor: 3_000,
        netAmountMinor: 3_000,
        taxAmountMinor: 0,
        discountAmountMinor: 0,
        quantity: 2,
      });
      await ctx.db.insert(
        "reportDay",
        dayRow(seeded, "2026-03-06", {
          factCount: 1,
          grossSalesMinor: 3_000,
          netSalesMinor: 3_000,
          unitsSold: 2,
          uncostedRevenueMinor: 3_000,
          grossProfitMinor: null,
        }),
      );
      await ctx.db.insert(
        "dailyClose",
        closeRow(seeded, FINAL_DATE, {
          completedAt: NOW + 5_000,
          isCurrent: false,
          updatedAt: NOW + 5_000,
        }),
      );
      expect(
        await refreshAcceptedWeekForDate(
          ctx,
          seeded.storeId,
          "2026-03-06",
          NOW + 6_000,
        ),
      ).toBe(1);
      expect(await rebuildCurrentWeek(ctx, seeded.storeId, NOW + 6_000)).toBe(
        "rebuilt",
      );
    });

    await t.run(async (ctx: MutationCtx) => {
      const accepted = await ctx.db.get("reportWeekAccepted", baseline.id);
      if (!accepted) throw new Error("missing accepted baseline");
      // The baseline is immutable: only the orthogonal amendment moved.
      expect(accepted.baselineFingerprint).toBe(baseline.fingerprint);
      expect(accepted.included).toEqual(baseline.included);
      expect(accepted.outsideSchedule).toEqual(baseline.outsideSchedule);
      expect(accepted.amendment?.includedNetSalesDeltaMinor).toBe(3_000);
      expect(accepted.closePosture?.status).toBe("successor_accepted");

      const result = await verifyCurrentWeekWithCtx(ctx, seeded.storeId);
      expect(result).toMatchObject({
        amendmentMatches: true,
        closeMatches: true,
        includedDifferences: [],
        inventoryMatches: true,
        matches: true,
        outcome: "verified",
        outsideScheduleDifferences: [],
        scheduleMatches: true,
        varianceMatches: true,
      });
    });
  });
});
