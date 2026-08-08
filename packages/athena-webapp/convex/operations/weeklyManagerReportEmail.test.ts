/// <reference types="vite/client" />

import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import type { DailyManagerReportProps } from "../emails/DailyManagerReport";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../")
      ? path.replace(/^\.\.\//, "./")
      : path.replace(/^\.\//, "./operations/"),
    loader,
  ]),
);
const getPayload = makeFunctionReference<
  "query",
  { acceptedWeekId: Id<"reportWeekAccepted"> },
  DailyManagerReportProps | null
>("operations/weeklyManagerReportEmail:getAcceptedWeeklyManagerReportPayload");

const metrics = {
  grossProfitMinor: 0,
  grossSalesMinor: 0,
  netSalesMinor: 0,
  paymentAllocatedMinor: 0,
  paymentAllocationCoverage: "complete" as const,
  paymentAllocationOmittedMinor: 0,
  paymentHasInvalidAllocation: false,
  paymentUnsettledMinor: 0,
  paymentsCollectedMinor: 0,
  paymentsRefundedMinor: 0,
  refundsMinor: 0,
  uncostedRevenueMinor: 0,
  unitsReturned: 0,
  unitsSold: 20,
};

describe("accepted weekly manager report top items", () => {
  it("uses the canonical range mix ranking for the accepted week", async () => {
    const t = convexTest(schema, modules);
    const acceptedWeekId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("athenaUser", {
        email: "owner@example.com",
        normalizedEmail: "owner@example.com",
      });
      const organizationId = await ctx.db.insert("organization", {
        createdByUserId: userId,
        name: "Accra",
        slug: "accra",
      });
      const storeId = await ctx.db.insert("store", {
        createdByUserId: userId,
        currency: "GHS",
        name: "Wigclub",
        organizationId,
        slug: "wigclub",
      });
      const closeId = await ctx.db.insert("dailyClose", {
        carryForwardWorkItemIds: [],
        completedAt: 1,
        createdAt: 1,
        isCurrent: true,
        operatingDate: "2026-08-08",
        organizationId,
        readiness: {
          blockerCount: 0,
          carryForwardCount: 0,
          readyCount: 1,
          reviewCount: 0,
          status: "ready",
        },
        sourceSubjects: [],
        status: "completed",
        storeId,
        summary: {},
        updatedAt: 1,
      });

      const categoryId = await ctx.db.insert("category", {
        name: "Wigs",
        slug: "wigs",
        storeId,
      });
      const subcategoryId = await ctx.db.insert("subcategory", {
        categoryId,
        name: "Featured",
        slug: "featured",
        storeId,
      });
      const skuLeaders: Array<{
        productSkuId: Id<"productSku">;
        unitsSold: number;
      }> = [];
      let lateProductSkuId: Id<"productSku"> | null = null;

      for (const [index, item] of [
        { name: "Silk Press", sku: "SP-18", units: [3, 5] },
        { name: "Body Wave", sku: "BW-20", units: [2, 4] },
        { name: "Lace Closure", sku: "LC-14", units: [1, 3] },
        { name: "Deep Wave", sku: "DW-22", units: [1, 1] },
      ].entries()) {
        const productId = await ctx.db.insert("product", {
          availability: "live",
          categoryId,
          createdByUserId: userId,
          currency: "GHS",
          inventoryCount: 10,
          name: item.name,
          organizationId,
          slug: item.sku.toLowerCase(),
          storeId,
          subcategoryId,
        });
        const productSkuId = await ctx.db.insert("productSku", {
          images: [],
          inventoryCount: 10,
          price: 100,
          productId,
          quantityAvailable: 10,
          sku: item.sku,
          storeId,
        });
        skuLeaders.push({
          productSkuId,
          unitsSold: item.units.reduce((total, units) => total + units, 0),
        });
        if (index === 3) lateProductSkuId = productSkuId;
        for (const [dayIndex, unitsSold] of item.units.entries()) {
          await ctx.db.insert("reportSkuDay", {
            grossProfitMinor: 0,
            grossSalesMinor: 0,
            netSalesMinor: 0,
            operatingDate: dayIndex === 0 ? "2026-08-03" : "2026-08-08",
            productSkuId,
            refundsMinor: 0,
            storeId,
            uncostedRevenueMinor: 0,
            unitsReturned: 0,
            unitsSold,
          });
        }
      }

      const acceptedWeekId = await ctx.db.insert("reportWeekAccepted", {
        acceptedAt: Date.parse("2026-08-08T20:47:00.000Z"),
        baselineFingerprint: "baseline",
        closeId,
        completeness: { complete: true, reason: "complete" },
        currency: "GHS",
        cutoffObservedAt: Date.parse("2026-08-08T20:47:00.000Z"),
        cycleEndDate: "2026-08-08",
        cycleStartDate: "2026-08-03",
        included: metrics,
        metricVersion: 1,
        outsideSchedule: { ...metrics, unitsSold: 0 },
        priorPeriod: {
          cycleEndDate: "2026-08-02",
          cycleStartDate: "2026-07-27",
          comparabilityReason: "comparable",
          currentScheduledPositionCount: 0,
          equivalentScheduledPositions: true,
          outsideScheduleValues: { ...metrics, unitsSold: 0 },
          priorScheduledPositionCount: 0,
          values: { ...metrics, netSalesMinor: 500 },
        },
        scheduleLineage: [],
        storeId,
        topSkuLeaders: skuLeaders.slice(0, 3),
      });
      if (!lateProductSkuId) throw new Error("missing late SKU fixture");
      await ctx.db.insert("reportSkuDay", {
        grossProfitMinor: 0,
        grossSalesMinor: 0,
        netSalesMinor: 0,
        operatingDate: "2026-08-08",
        productSkuId: lateProductSkuId,
        refundsMinor: 0,
        storeId,
        uncostedRevenueMinor: 0,
        unitsReturned: 0,
        unitsSold: 100,
      });
      return acceptedWeekId;
    });

    const payload = await t.query(getPayload, { acceptedWeekId });

    expect(payload?.topItems).toEqual([
      { detail: "SP-18", name: "Silk Press", unitsSold: 8 },
      { detail: "BW-20", name: "Body Wave", unitsSold: 6 },
      { detail: "LC-14", name: "Lace Closure", unitsSold: 4 },
    ]);
    expect(payload?.topItemsUrl).toContain(
      "/wigclub/store/wigclub/reports/weekly?reportId=week%3A2026-08-03&units=true",
    );

    expect(payload).toMatchObject({
      completedBy: "Athena",
      operatingDate: "Aug 3–8, 2026",
      presentation: {
        emptyAttentionCopy:
          "Net sales finished GH₵5 lower than the prior week. 0 of 0 scheduled days closed. Payments were fully accounted for.",
        timestampDate: "Aug 8",
        timestampLabel: "Accepted",
      },
      status: "applied",
      storeName: "Wigclub",
    });
  });
});
