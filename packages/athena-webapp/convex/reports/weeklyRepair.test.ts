/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import schema from "../schema";
import { repairCurrentWeeklyProjectionWithCtx } from "./weeklyRepair";

const modules = import.meta.glob("../**/*.ts");
const NOW = Date.parse("2026-07-04T12:00:00.000Z");

describe("weekly projection repair", () => {
  it("replaces only current projection state without touching facts or accepted history", async () => {
    const t = convexTest(schema, modules);
    const storeId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("athenaUser", {
        email: "repair@test",
      });
      const organizationId = await ctx.db.insert("organization", {
        createdByUserId: userId,
        name: "Repair",
        slug: "repair",
      });
      const id = await ctx.db.insert("store", {
        createdByUserId: userId,
        currency: "GHS",
        name: "Repair",
        organizationId,
        slug: "repair",
      });
      await ctx.db.insert("storeSchedule", {
        organizationId,
        storeId: id,
        timezone: "UTC",
        weeklyWindows: [],
        weeklyClosedDays: [0],
        dateExceptions: [],
        reportingCycleStartsOn: 1,
        effectiveFrom: Date.parse("2026-01-01T00:00:00Z"),
        status: "active",
        source: "admin",
        createdAt: NOW,
        updatedAt: NOW,
      });
      await ctx.db.insert("reportDay", {
        storeId: id,
        operatingDate: "2026-06-29",
        currency: "GHS",
        status: "reconciled",
        grossSalesMinor: 100,
        netSalesMinor: 100,
        refundsMinor: 0,
        unitsSold: 1,
        unitsReturned: 0,
        uncostedRevenueMinor: 0,
        grossProfitMinor: 50,
        paymentsCollectedMinor: 100,
        paymentsRefundedMinor: 0,
        paymentAllocatedMinor: 100,
        paymentPosture: {
          allocatedMinor: 100,
          allocationCoverage: "complete",
          allocationOmittedMinor: 0,
          collectedMinor: 100,
          hasInvalidAllocation: false,
          refundedMinor: 0,
          unsettledMinor: 0,
        },
        flags: {
          hasUncostedRevenue: false,
          mixedCurrency: false,
          quarantinedFactCount: 0,
        },
        foldVersion: 1,
        factCount: 1,
        lastFactRecordedAt: NOW,
      });
      await ctx.db.insert("reportFact", {
        storeId: id,
        sourceDomain: "pos",
        sourceId: "sale-1",
        lineId: "line-1",
        factKind: "sale",
        fingerprint: "fp",
        fingerprintVersion: 2,
        occurredAt: NOW,
        recordedAt: NOW,
        observedAt: NOW,
        operatingDate: "2026-06-29",
        currency: "GHS",
        grossAmountMinor: 100,
        netAmountMinor: 100,
        taxAmountMinor: 0,
        discountAmountMinor: 0,
        quantity: 1,
      });
      return id;
    });

    await t.run(async (ctx) => {
      const factsBefore = await ctx.db
        .query("reportFact")
        .withIndex("by_storeId_operatingDate", (q) => q.eq("storeId", storeId))
        .take(10);
      expect(
        await repairCurrentWeeklyProjectionWithCtx(ctx, { now: NOW, storeId }),
      ).toEqual({ outcome: "rebuilt" });
      const factsAfter = await ctx.db
        .query("reportFact")
        .withIndex("by_storeId_operatingDate", (q) => q.eq("storeId", storeId))
        .take(10);
      expect(factsAfter.map((fact) => fact._id)).toEqual(
        factsBefore.map((fact) => fact._id),
      );
      expect(
        await ctx.db
          .query("reportWeekAccepted")
          .withIndex("by_storeId_cycleStartDate", (q) =>
            q.eq("storeId", storeId),
          )
          .take(1),
      ).toEqual([]);
      expect(
        await ctx.db
          .query("reportWeekCurrent")
          .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
          .unique(),
      ).not.toBeNull();
    });
  });
});
