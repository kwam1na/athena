/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import schema from "../schema";
import type { Doc, Id } from "../_generated/dataModel";
import { resolveWeeklyPeriod } from "./weeklyPeriods";
import {
  MAX_WEEKLY_FACTS,
  MAX_WEEKLY_LIVE_PRIOR_CUTOFF_FACTS,
  WEEKLY_SCHEDULE_READ_LIMIT,
  foldWeekFromAcceptedFacts,
  foldWeekFromDays,
  materializeAcceptedWeek,
  markWeekDirty,
  reconcileRecentAcceptedWeeksForStore,
  rebuildCurrentWeek,
  refreshAcceptedWeekForDate,
} from "./weekly";

const modules = import.meta.glob("../**/*.ts");
const NOW = Date.parse("2026-07-04T12:00:00.000Z");

function period() {
  const result = resolveWeeklyPeriod({
    referenceAt: NOW,
    schedules: [
      {
        _id: "schedule-1",
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

describe("foldWeekFromDays", () => {
  it("synthesizes missing scheduled report days as complete zero-activity slots", () => {
    const result = foldWeekFromDays({
      period: period(),
      days: [day(), day({ operatingDate: "2026-07-05", netSalesMinor: 25 })],
    });

    expect(result.included.netSalesMinor).toBe(100);
    expect(result.outsideSchedule.netSalesMinor).toBe(25);
    expect(result.completeness).toEqual({
      complete: true,
      reason: "complete",
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

    expect(result.completeness).toEqual({
      complete: false,
      reason: "mixed_currency",
    });
  });

  it("does not invent a cutoff baseline when frozen evidence lacks observedAt", () => {
    const result = foldWeekFromAcceptedFacts({
      currency: "GHS",
      factsByDate: new Map([["2026-06-29", [fact({ observedAt: undefined })]]]),
      period: period(),
    });

    expect(result.completeness).toEqual({
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
      summary: {},
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
        summary: {},
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

describe("weekly materialization", () => {
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
      const before = await ctx.db
        .query("reportWeekCurrent")
        .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
        .unique();
      if (!before || before.availability === "unavailable") {
        throw new Error("expected verified weekly singleton");
      }
      await ctx.db.insert("reportDirtyDay", {
        storeId,
        operatingDate: "2026-07-01",
        reason: "write_failure",
        markedAt: NOW + 1,
      });

      expect(await rebuildCurrentWeek(ctx, storeId, NOW + 1)).toBe(
        "unavailable",
      );
      const retained = await ctx.db
        .query("reportWeekCurrent")
        .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
        .unique();
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
      const current = await ctx.db
        .query("reportWeekCurrent")
        .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
        .unique();
      expect(current?.included.netSalesMinor).toBe(600);
      expect(current?.outsideSchedule.netSalesMinor).toBe(100);
      expect(current?.completeness).toEqual({
        complete: true,
        reason: "complete",
      });
      expect(current?.variancePosture).toEqual({
        closeVarianceMinor: 30,
        coverage: "complete",
        coveredIncludedDayCount: 6,
        includedDayCount: 6,
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
      const before = await ctx.db
        .query("reportWeekCurrent")
        .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
        .unique();
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
      const current = await ctx.db
        .query("reportWeekCurrent")
        .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
        .unique();
      if (!current || current.availability === "unavailable") {
        throw new Error("expected available weekly singleton");
      }
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
      const current = await ctx.db
        .query("reportWeekCurrent")
        .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
        .unique();
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
      const current = await ctx.db
        .query("reportWeekCurrent")
        .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
        .unique();
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
      const current = await ctx.db
        .query("reportWeekCurrent")
        .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
        .unique();
      expect(current?.priorPeriod).toMatchObject({
        comparabilityReason: "comparable",
        currentScheduledPositionCount: 6,
        priorScheduledPositionCount: 6,
        values: { netSalesMinor: 150 },
      });
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
      const current = await ctx.db
        .query("reportWeekCurrent")
        .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
        .unique();
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
      const current = await ctx.db
        .query("reportWeekCurrent")
        .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
        .unique();
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
      const current = await ctx.db
        .query("reportWeekCurrent")
        .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
        .unique();
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
      const current = await ctx.db
        .query("reportWeekCurrent")
        .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
        .unique();
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
      const current = await ctx.db
        .query("reportWeekCurrent")
        .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
        .unique();
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
