/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import schema from "../schema";
import { seedPosSale, seedStore } from "./reseedTestSupport";
import { VERIFY_MAX_SCHEDULES, verifyCurrentWeekWithCtx } from "./verify";
import { materializeAcceptedWeek, rebuildCurrentWeek } from "./weekly";

const modules = import.meta.glob("../**/*.ts");
const NOW = Date.parse("2026-03-05T18:00:00.000Z");

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

      const current = await ctx.db
        .query("reportWeekCurrent")
        .withIndex("by_storeId", (q) => q.eq("storeId", seeded.storeId))
        .unique();
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
