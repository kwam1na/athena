/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { REPORTS_FOLD_VERSION } from "../../shared/reportsContract";
import schema from "../schema";
import { createOperationalWorkItemWithCtx } from "../operations/operationalWorkItems";
import { requestRangeCore } from "./customRange";
import { seedDailyClose, seedStore } from "./reseedTestSupport";
import {
  addDaysToDate,
  MAX_ROLLUP_SKU_DAY_ROWS,
  rebuildPeriodRollup,
} from "./rollups";
import {
  foldAndReplaceDay,
  REPORTS_SWEEP_STORE_ALLOWLIST_ENV,
  SWEEP_MARK_SCAN_LIMIT,
  sweepWithCtx,
  WEEKLY_DIRTY_BATCH,
} from "./sweeper";
import { markWeekDirty, WEEKLY_MARK_FOLDED_DATE_LIMIT } from "./weekly";

const modules = Object.fromEntries(Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
  path.startsWith("../") ? path.replace(/^\.\.\//, "./") : path.replace(/^\.\//, "./reports/"), loader,
]));
const NOW = Date.parse("2026-07-04T20:00:00.000Z");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/**
 * Pre-cutover characterization, not desired behavior. Each named limitation
 * has an implementation ticket in V26-1452; its test becomes the failing
 * desired-behavior regression before that boundary is changed. Keeping these
 * fixtures separate makes it impossible to mistake today's gaps for invariants.
 */
describe("reports pipeline pre-cutover limitations", () => {
  it("refuses a legacy month rebuild beyond its cap instead of dropping contributions", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const seeded = await seedStore(ctx, "UTC");
      const skuIds = [seeded.skuId];
      const sku = await ctx.db.get("productSku", seeded.skuId);
      if (!sku) throw new Error("Missing fixture SKU");
      // 130 distinct SKUs across 31 days: no duplicate day/SKU identities,
      // and comfortably within the existing 2,000-row per-day fold bound.
      for (let index = 1; index < 130; index += 1) {
        skuIds.push(await ctx.db.insert("productSku", {
          productId: sku.productId,
          storeId: seeded.storeId,
          sku: `CAP-${index}`,
          images: [],
          inventoryCount: 0,
          price: 1,
          quantityAvailable: 0,
        }));
      }
      for (let index = 0; index <= MAX_ROLLUP_SKU_DAY_ROWS; index += 1) {
        await ctx.db.insert("reportSkuDay", {
          storeId: seeded.storeId,
          operatingDate: addDaysToDate("2026-07-01", Math.floor(index / 130)),
          productSkuId: skuIds[index % 130],
          unitsSold: 1,
          unitsReturned: 0,
          grossSalesMinor: 1,
          netSalesMinor: 1,
          refundsMinor: 0,
          uncostedRevenueMinor: 0,
          grossProfitMinor: 1,
        });
      }
      await expect(rebuildPeriodRollup(ctx, seeded.storeId, "m:2026-07"))
        .rejects.toThrow("report_rollup_source_capacity");
      const rows = await ctx.db
        .query("reportPeriodSkuRollup")
        .withIndex("by_storeId_periodKey_productSkuId", (q) =>
          q.eq("storeId", seeded.storeId).eq("periodKey", "m:2026-07"),
        )
        .take(131);
      expect(rows).toHaveLength(0);
    });
  });

  it("captures the singleton's lost historical dates and second-cycle intent", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const seeded = await seedStore(ctx, "UTC");
      const firstClose = await seedDailyClose(ctx, seeded, {
        completedAt: NOW - 7 * 86_400_000,
        operatingDate: "2026-06-27",
        salesTotal: 0,
      });
      const secondClose = await seedDailyClose(ctx, seeded, {
        completedAt: NOW,
        operatingDate: "2026-07-04",
        salesTotal: 0,
      });
      const dates = Array.from({ length: 20 }, (_, index) =>
        addDaysToDate("2026-06-15", index),
      );
      const firstIntent = {
        closeId: firstClose,
        cycleStartDate: "2026-06-22",
        cutoffObservedAt: NOW - 7 * 86_400_000,
      };
      await markWeekDirty(ctx, seeded.storeId, "acceptance_requested", NOW, {
        foldedDates: dates.slice(0, 10),
        intent: firstIntent,
      });
      await markWeekDirty(ctx, seeded.storeId, "acceptance_requested", NOW + 1, {
        foldedDates: dates.slice(10),
        intent: {
          closeId: secondClose,
          cycleStartDate: "2026-06-29",
          cutoffObservedAt: NOW,
        },
      });
      const marker = await ctx.db
        .query("reportDirtyWeek")
        .withIndex("by_storeId", (q) => q.eq("storeId", seeded.storeId))
        .unique();
      expect(marker?.foldedDates).toEqual(dates.slice(-WEEKLY_MARK_FOLDED_DATE_LIMIT));
      expect(marker?.intent).toEqual(firstIntent);
    });
  });

  it("captures allowed work stranded behind saturated blocked-store windows", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    const allowed = await t.run(async (ctx) => {
      const seeded = await seedStore(ctx, "UTC");
      for (let index = 0; index < WEEKLY_DIRTY_BATCH; index += 1) {
        const blocked = await seedStore(ctx, "UTC");
        await ctx.db.insert("reportDirtyWeek", {
          storeId: blocked.storeId,
          reason: "day_folded",
          markedAt: index,
        });
        if (index === 0) {
          for (let day = 0; day < SWEEP_MARK_SCAN_LIMIT; day += 1) {
            await ctx.db.insert("reportDirtyDay", {
              storeId: blocked.storeId,
              operatingDate: addDaysToDate("2026-01-01", day),
              reason: "late_fact",
              markedAt: day,
            });
          }
        }
      }
      await ctx.db.insert("reportDirtyDay", {
        storeId: seeded.storeId,
        operatingDate: "2026-07-04",
        reason: "late_fact",
        markedAt: NOW,
      });
      await ctx.db.insert("reportDirtyWeek", {
        storeId: seeded.storeId,
        reason: "day_folded",
        markedAt: NOW,
      });
      return seeded.storeId;
    });
    vi.stubEnv(REPORTS_SWEEP_STORE_ALLOWLIST_ENV, String(allowed));
    const result = await t.run((ctx) => sweepWithCtx(ctx));
    expect(result).toMatchObject({
      daysFolded: 0,
      marksExamined: SWEEP_MARK_SCAN_LIMIT,
      skippedNotAllowed: SWEEP_MARK_SCAN_LIMIT,
      weeksRebuilt: 0,
    });
    await t.run(async (ctx) => {
      expect(await ctx.db.query("reportDirtyDay").withIndex(
        "by_storeId_operatingDate", (q) => q.eq("storeId", allowed),
      ).take(2)).toHaveLength(1);
      expect(await ctx.db.query("reportDirtyWeek").withIndex(
        "by_storeId", (q) => q.eq("storeId", allowed),
      ).unique()).not.toBeNull();
    });
  });

  it("captures a quiet store's legacy range remaining pending after a sweep", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    const seeded = await t.run((ctx) => seedStore(ctx, "UTC"));
    vi.stubEnv(REPORTS_SWEEP_STORE_ALLOWLIST_ENV, String(seeded.storeId));
    const request = await t.run((ctx) => requestRangeCore(ctx, {
      storeId: seeded.storeId,
      startDate: "2026-07-01",
      endDate: "2026-07-04",
    }));
    expect((await t.run((ctx) => sweepWithCtx(ctx))).rangesComputed).toBe(0);
    await t.run(async (ctx) => {
      const range = await ctx.db.query("reportRangeResult").withIndex(
        "by_storeId_requestKey", (q) => q.eq("storeId", seeded.storeId)
          .eq("requestKey", request.requestKey),
      ).unique();
      expect(range?.status).toBe("pending");
    });
  });

  it("captures Open Work creation without an independent weekly handoff", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const seeded = await seedStore(ctx, "UTC");
      const work = await createOperationalWorkItemWithCtx(ctx, {
        organizationId: seeded.organizationId,
        storeId: seeded.storeId,
        productSkuId: seeded.skuId,
        type: "synced_sale_inventory_review",
        status: "open",
        priority: "normal",
        title: "Inventory review",
      });
      expect(work?.status).toBe("open");
      expect(await ctx.db.query("reportDirtyWeek").withIndex(
        "by_storeId", (q) => q.eq("storeId", seeded.storeId),
      ).unique()).toBeNull();
    });
  });

  it("captures kinded headers consuming a touched store's whole legacy selection window", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    const seeded = await t.run((ctx) => seedStore(ctx, "UTC"));
    vi.stubEnv(REPORTS_SWEEP_STORE_ALLOWLIST_ENV, String(seeded.storeId));
    const legacyId = await t.run(async (ctx) => {
      const common = {
        storeId: seeded.storeId,
        startDate: "2026-07-01",
        endDate: "2026-07-04",
        status: "pending" as const,
        requestedAt: NOW,
        expiresAt: NOW + 86_400_000,
        foldVersion: REPORTS_FOLD_VERSION,
      };
      // The legacy sweep inspected only three headers of mixed request kinds.
      for (let index = 0; index < 3; index += 1) {
        await ctx.db.insert("reportRangeResult", {
          ...common,
          requestKey: `a-kind-${index}`,
          kind: "sku_movement",
          movementPhase: "queued",
          movementEligibleAt: NOW + 60_000,
        });
      }
      await ctx.db.insert("reportDirtyDay", {
        storeId: seeded.storeId,
        operatingDate: "2026-07-04",
        reason: "late_fact",
        markedAt: NOW,
      });
      return ctx.db.insert("reportRangeResult", {
        ...common,
        // Selection uses request-key order, not request time.
        requestKey: "z-legacy",
      });
    });
    expect(await t.run((ctx) => sweepWithCtx(ctx))).toMatchObject({
      daysFolded: 1,
      storesTouched: 1,
      rangesComputed: 0,
    });
    expect(await t.run((ctx) => ctx.db.get("reportRangeResult", legacyId)))
      .toMatchObject({ status: "pending" });
  });

  it("clears the reopened original from the day fold until a successor completes", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const seeded = await seedStore(ctx, "UTC");
      await seedDailyClose(ctx, seeded, {
        completedAt: NOW,
        operatingDate: "2026-07-04",
        salesTotal: 0,
        lifecycleStatus: "reopened",
      });
      await foldAndReplaceDay(ctx, seeded.storeId, "2026-07-04", NOW + 1, {
        deferRollups: true,
      });
      const day = await ctx.db.query("reportDay").withIndex(
        "by_storeId_operatingDate", (q) => q.eq("storeId", seeded.storeId)
          .eq("operatingDate", "2026-07-04"),
      ).unique();
      expect(day?.closeId).toBeUndefined();
      expect(day?.status).toBe("provisional");
    });
  });
});
