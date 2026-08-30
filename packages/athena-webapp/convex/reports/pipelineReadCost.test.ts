/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import schema from "../schema";
import { REPORTS_FOLD_VERSION } from "../../shared/reportsContract";
import { WEEKLY_REPORT_STORE_ALLOWLIST_ENV } from "../platform/capabilityCatalog";
import { recordReadCosts } from "./readCostTestSupport";
import { rebuildRollupsForDates } from "./rollups";
import { REPORTS_SWEEP_STORE_ALLOWLIST_ENV, sweepWithCtx } from "./sweeper";
import { markWeekDirty, materializeAcceptedWeek } from "./weekly";

const modules = import.meta.glob("../**/*.ts");
const NOW = Date.parse("2026-08-29T20:00:00.000Z");
const WEEK_DATES = [
  "2026-08-24",
  "2026-08-25",
  "2026-08-26",
  "2026-08-27",
  "2026-08-28",
  "2026-08-29",
];
const LARGE_CLOSE_PADDING_BYTES = 128 * 1024;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function seedStore(ctx: MutationCtx) {
  const userId = await ctx.db.insert("athenaUser", { email: "read-cost@test" });
  const organizationId = await ctx.db.insert("organization", {
    createdByUserId: userId,
    name: "Read cost",
    slug: "read-cost",
  });
  const verified = {
    status: "complete" as const,
    missingCount: 0,
    startedAt: NOW - 1,
    completedAt: NOW - 1,
  };
  const storeId = await ctx.db.insert("store", {
    createdByUserId: userId,
    organizationId,
    currency: "GHS",
    name: "Read cost",
    slug: "read-cost",
    weeklyObservedAtVerification: verified,
    weeklyReportingCycleAnchorVerification: verified,
  });
  return { storeId, userId, organizationId };
}

async function seedWeeklyFixture(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const { storeId, organizationId } = await seedStore(ctx);
    await ctx.db.insert("storeSchedule", {
      storeId,
      organizationId,
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
    const closeIds: Id<"dailyClose">[] = [];
    for (const operatingDate of WEEK_DATES) {
      const completedAt = Date.parse(`${operatingDate}T18:00:00.000Z`);
      const readiness = {
        status: "ready" as const,
        blockerCount: 0,
        reviewCount: 0,
        carryForwardCount: 0,
        readyCount: 0,
      };
      const closeId = await ctx.db.insert("dailyClose", {
        storeId,
        organizationId,
        operatingDate,
        status: "completed",
        lifecycleStatus: "active",
        isCurrent: true,
        readiness,
        summary: { salesTotal: 0 },
        sourceSubjects: [],
        carryForwardWorkItemIds: [],
        createdAt: completedAt,
        updatedAt: completedAt,
        completedAt,
        reportSnapshot: {
          snapshotContractVersion: 2,
          closeMetadata: {
            operatingDate,
            storeId,
            organizationId,
            completedAt,
            startAt: completedAt - 1,
            endAt: completedAt,
            carryForwardWorkItemIds: [],
            // Irrelevant source detail changes size, never report truth.
            // Identical shape gives adding ASCII text an exact byte delta.
            notes: "",
          },
          readiness,
          summary: {
            netCashVariance: 0,
            transactionCount: 0,
            paymentTotals: [],
          },
          expenseProductEvidence: {
            contractVersion: 1,
            expenseTotal: 0,
            products: [],
            sourceItemCount: 0,
            sourceTransactionCount: 0,
            status: "complete",
          },
          reviewedItems: [],
          carryForwardItems: [],
          carryForwardGroups: [],
          frozenSyncedSaleInventoryReviewGroups: [],
          readyItems: [],
          openWorkMembership: {
            completeness: "complete",
            observedLogicalCount: 0,
          },
          sourceSubjects: [],
        },
      });
      closeIds.push(closeId);
      await ctx.db.insert("reportDay", {
        storeId,
        operatingDate,
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
        closeAcceptedAt: completedAt,
        closeVarianceMinor: 0,
        foldedAt: NOW + 1,
        foldVersion: REPORTS_FOLD_VERSION,
        factCount: 0,
        lastFactRecordedAt: completedAt,
      });
    }
    return { storeId, closeIds };
  });
}

async function measureWeeklyOnlySweep(
  t: ReturnType<typeof convexTest>,
  storeId: Id<"store">,
) {
  // Producer work is outside this measurement, consistently for both fixtures.
  // Future whole-pipeline comparisons must also include producer/worker costs.
  await t.run((ctx) => markWeekDirty(ctx, storeId, "day_folded", NOW));
  return t.run(async (ctx) => {
    const recorder = recordReadCosts(ctx);
    const result = await sweepWithCtx(recorder.ctx);
    return { result, cost: recorder.snapshot() };
  });
}

describe("reports pipeline read-cost characterization (returned payload proxy)", () => {
  it("rehydrates large close detail repeatedly on a weekly-only sweep with an existing baseline", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    const { storeId, closeIds } = await seedWeeklyFixture(t);
    vi.stubEnv(REPORTS_SWEEP_STORE_ALLOWLIST_ENV, String(storeId));
    vi.stubEnv(WEEKLY_REPORT_STORE_ALLOWLIST_ENV, String(storeId));
    await t.run(async (ctx) => {
      expect(
        await materializeAcceptedWeek({
          ctx,
          storeId,
          closeId: closeIds.at(-1)!,
          now: NOW,
        }),
      ).toBe("created");
    });
    // Warm the current singleton once, so both samples have identical rows.
    await measureWeeklyOnlySweep(t, storeId);
    const small = await measureWeeklyOnlySweep(t, storeId);
    const before = await t.run((ctx) =>
      ctx.db
        .query("reportWeekAccepted")
        .withIndex("by_storeId_cycleStartDate", (q) => q.eq("storeId", storeId))
        .unique(),
    );
    await t.run(async (ctx) => {
      for (const closeId of closeIds) {
        const close = await ctx.db.get("dailyClose", closeId);
        await ctx.db.patch("dailyClose", closeId, {
          reportSnapshot: {
            ...close!.reportSnapshot!,
            closeMetadata: {
              ...close!.reportSnapshot!.closeMetadata,
              notes: "x".repeat(LARGE_CLOSE_PADDING_BYTES),
            },
          },
        });
      }
    });
    const large = await measureWeeklyOnlySweep(t, storeId);
    expect(large.result).toMatchObject({
      daysFolded: 0,
      storesTouched: 0,
      weeksRebuilt: 1,
      weeksAccepted: 0,
      weekFailures: 0,
    });
    expect(large.cost.byTable.dailyClose.returnedDocuments).toBeGreaterThan(
      closeIds.length * 2,
    );
    expect(large.cost.byTable.dailyClose.returnedDocuments).toBe(
      small.cost.byTable.dailyClose.returnedDocuments,
    );
    expect(
      large.cost.byTable.dailyClose.serializedBytes -
        small.cost.byTable.dailyClose.serializedBytes,
    ).toBe(
      LARGE_CLOSE_PADDING_BYTES *
        large.cost.byTable.dailyClose.returnedDocuments,
    );
    expect(
      large.cost.byTable.dailyClose.serializedBytes /
        large.cost.total.serializedBytes,
    ).toBeGreaterThan(0.95);
    const after = await t.run((ctx) =>
      ctx.db
        .query("reportWeekAccepted")
        .withIndex("by_storeId_cycleStartDate", (q) => q.eq("storeId", storeId))
        .unique(),
    );
    expect(after).toEqual(before);
    console.info("[reports-read-cost] existing-week large-close baseline", {
      closeCount: closeIds.length,
      addedBytesPerClose: LARGE_CLOSE_PADDING_BYTES,
      small: {
        total: small.cost.total,
        dailyClose: small.cost.byTable.dailyClose,
      },
      large: {
        total: large.cost.total,
        dailyClose: large.cost.byTable.dailyClose,
      },
    });
  });

  it("rereads the same full week and month for small changed-day batches", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    const SKU_COUNT = 8;
    const MONTH_DAYS = 31;
    const changedDates = ["2026-08-10", "2026-08-11", "2026-08-12"];
    const fixture = await t.run(async (ctx) => {
      const { storeId, organizationId, userId } = await seedStore(ctx);
      const categoryId = await ctx.db.insert("category", {
        name: "Fixture",
        slug: "fixture",
        storeId,
      });
      const subcategoryId = await ctx.db.insert("subcategory", {
        categoryId,
        name: "Fixture",
        slug: "fixture",
        storeId,
      });
      const productId = await ctx.db.insert("product", {
        availability: "live",
        categoryId,
        subcategoryId,
        createdByUserId: userId,
        currency: "GHS",
        inventoryCount: 0,
        name: "Fixture",
        organizationId,
        slug: "fixture",
        storeId,
      });
      const skuIds: Id<"productSku">[] = [];
      for (let sku = 0; sku < SKU_COUNT; sku += 1) {
        skuIds.push(
          await ctx.db.insert("productSku", {
            images: [],
            inventoryCount: 0,
            price: 100,
            productId,
            quantityAvailable: 0,
            sku: `COST-${sku}`,
            storeId,
          }),
        );
      }
      for (let day = 1; day <= MONTH_DAYS; day += 1) {
        const operatingDate = `2026-08-${String(day).padStart(2, "0")}`;
        for (const productSkuId of skuIds) {
          await ctx.db.insert("reportSkuDay", {
            storeId,
            productSkuId,
            operatingDate,
            unitsSold: 1,
            unitsReturned: 0,
            grossSalesMinor: 100,
            netSalesMinor: 100,
            refundsMinor: 0,
            uncostedRevenueMinor: 0,
            grossProfitMinor: 40,
          });
        }
      }
      await rebuildRollupsForDates(ctx, storeId, changedDates);
      return { storeId, skuId: skuIds[0] };
    });
    const costs = [];
    for (const operatingDate of changedDates) {
      await t.run(async (ctx) => {
        const day = await ctx.db
          .query("reportSkuDay")
          .withIndex("by_storeId_operatingDate_productSkuId", (q) =>
            q
              .eq("storeId", fixture.storeId)
              .eq("operatingDate", operatingDate)
              .eq("productSkuId", fixture.skuId),
          )
          .unique();
        await ctx.db.patch("reportSkuDay", day!._id, { netSalesMinor: 200 });
      });
      const cost = await t.run(async (ctx) => {
        const recorder = recordReadCosts(ctx);
        await rebuildRollupsForDates(recorder.ctx, fixture.storeId, [
          operatingDate,
        ]);
        return recorder.snapshot();
      });
      // One changed SKU-day still reads every SKU in its day, week and month.
      expect(cost.byTable.reportSkuDay).toMatchObject({
        calls: 3,
        returnedDocuments: SKU_COUNT * (1 + 7 + MONTH_DAYS),
      });
      expect(cost.byTable.reportPeriodSkuRollup).toMatchObject({
        calls: 3,
        returnedDocuments: SKU_COUNT * 3,
      });
      costs.push(cost);
    }
    const monthly = await t.run((ctx) =>
      ctx.db
        .query("reportPeriodSkuRollup")
        .withIndex("by_storeId_periodKey_productSkuId", (q) =>
          q
            .eq("storeId", fixture.storeId)
            .eq("periodKey", "m:2026-08")
            .eq("productSkuId", fixture.skuId),
        )
        .unique(),
    );
    expect(monthly?.netSalesMinor).toBe(
      (MONTH_DAYS + changedDates.length) * 100,
    );
    console.info("[reports-read-cost] repeated-period baseline", {
      skuCount: SKU_COUNT,
      monthDays: MONTH_DAYS,
      changedSkuDays: changedDates.length,
      calls: costs.reduce((sum, cost) => sum + cost.total.calls, 0),
      returnedDocuments: costs.reduce(
        (sum, cost) => sum + cost.total.returnedDocuments,
        0,
      ),
      serializedBytes: costs.reduce(
        (sum, cost) => sum + cost.total.serializedBytes,
        0,
      ),
    });
  });
});
