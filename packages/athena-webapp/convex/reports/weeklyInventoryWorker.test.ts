/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "../schema";
import type { Doc, Id } from "../_generated/dataModel";
import { seedStore } from "./reseedTestSupport";
import { recordReadCosts } from "./readCostTestSupport";
import { claimReportWorkWithCtx } from "./pipelineWork";
import {
  financialFrameKey,
  enqueueWeeklyInventoryFrameWithCtx,
  readCurrentWeeklyInventoryWithCtx,
} from "./weeklyInventoryProjection";
import {
  insertOperationalWorkItemWithInventoryWithCtx,
  patchOperationalWorkItemWithInventoryWithCtx,
  setInventoryCoverageWithCtx,
} from "../operations/inventoryContributions";
import { applyInventoryWithCtx } from "./weeklyInventoryWorker";

const modules = import.meta.glob("../**/*.ts");
const NOW = Date.parse("2026-08-24T12:00:00Z");
const metrics = {
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
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

async function fixture() {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  const t = convexTest(schema, modules);
  const seeded = await t.run(async (ctx) => {
    const store = await seedStore(ctx, "UTC");
    await ctx.db.insert("reportPipelineControl", {
      storeId: store.storeId,
      mode: "active",
      fence: 1,
      sourceWatermark: NOW,
    });
    const scheduleId = await ctx.db.insert("storeSchedule", {
      storeId: store.storeId,
      organizationId: store.organizationId,
      timezone: "UTC",
      weeklyWindows: [],
      weeklyClosedDays: [],
      dateExceptions: [],
      reportingCycleStartsOn: 1,
      effectiveFrom: 0,
      status: "active",
      source: "admin",
      createdAt: NOW,
      updatedAt: NOW,
    });
    const currentId = await ctx.db.insert("reportWeekCurrent", {
      storeId: store.storeId,
      availability: "available",
      cycleStartDate: "2026-08-24",
      cycleEndDate: "2026-08-30",
      currency: "GHS",
      metricVersion: 1,
      materializedAt: NOW,
      included: metrics,
      outsideSchedule: metrics,
      scheduleLineage: [
        {
          localDate: "2026-08-24",
          included: true,
          scheduleVersionId: scheduleId,
          dayStatus: "open",
          dayAvailable: true,
          activityPosture: "recorded",
        },
      ],
      completeness: { complete: true, reason: "complete" },
    });
    const workId = await insertOperationalWorkItemWithInventoryWithCtx(ctx, {
      storeId: store.storeId,
      organizationId: store.organizationId,
      type: "synced_sale_inventory_review",
      status: "open",
      priority: "normal",
      approvalState: "not_required",
      title: "Private",
      createdAt: NOW,
      productSkuId: store.skuId,
    });
    await setInventoryCoverageWithCtx(ctx, store.storeId, true, NOW);
    return { ...store, currentId, scheduleId, workId };
  });
  vi.stubEnv("REPORTS_SWEEP_STORE_ALLOWLIST", String(seeded.storeId));
  return { t, ...seeded };
}

async function claim(
  t: ReturnType<typeof convexTest>,
  storeId: Id<"store">,
  now = NOW,
) {
  const result = await t.run((ctx) =>
    claimReportWorkWithCtx(ctx, { storeId, kind: "inventory" }, now),
  );
  expect(result.claims).toHaveLength(1);
  return { ...result.claims[0], controlFence: 1 };
}

describe("frame-fenced current inventory", () => {
  it("publishes compact source-only changes without reading full Operations documents", async () => {
    const { t, storeId, currentId, workId } = await fixture();
    const first = await claim(t, storeId);
    const measured = await t.run(async (ctx) => {
      const recorder = recordReadCosts(ctx);
      expect(await applyInventoryWithCtx(recorder.ctx, first, NOW)).toBe(
        "applied",
      );
      return recorder.snapshot();
    });
    expect(measured.byTable.operationalWorkItem).toBeUndefined();
    expect(measured.byTable.oversizedOperationalWorkRepair).toBeUndefined();
    expect(measured.total.serializedBytes).toBeLessThan(12_000);
    expect(await t.run((ctx) => applyInventoryWithCtx(ctx, first, NOW))).toBe(
      "stale",
    );
    await t.run(async (ctx) => {
      const current = (await ctx.db.get("reportWeekCurrent", currentId))!;
      expect(
        (await readCurrentWeeklyInventoryWithCtx(ctx, current)).newCount,
      ).toBe(1);
      await patchOperationalWorkItemWithInventoryWithCtx(ctx, workId, {
        status: "completed",
      });
      expect(
        (await readCurrentWeeklyInventoryWithCtx(ctx, current)).completeness,
      ).toBe("unavailable");
    });
    const second = await claim(t, storeId);
    expect(await t.run((ctx) => applyInventoryWithCtx(ctx, second, NOW))).toBe(
      "applied",
    );
    await t.run(async (ctx) => {
      const current = (await ctx.db.get("reportWeekCurrent", currentId))!;
      expect(
        (await readCurrentWeeklyInventoryWithCtx(ctx, current)).observedCount,
      ).toBe(0);
      expect(current.materializedAt).toBe(NOW);
    });
  });

  it("creates work for a quiet calendar frame and refuses an older in-flight frame", async () => {
    const { t, storeId, currentId } = await fixture();
    const first = await claim(t, storeId);
    await t.run((ctx) => applyInventoryWithCtx(ctx, first, NOW));
    await t.run(async (ctx) => {
      expect(await ctx.db.query("reportPipelineWork").take(2)).toEqual([]);
      await ctx.db.patch("reportWeekCurrent", currentId, {
        cycleStartDate: "2026-08-31",
        cycleEndDate: "2026-09-06",
      });
      await enqueueWeeklyInventoryFrameWithCtx(ctx, { storeId, now: NOW + 1 });
      expect(
        (
          await readCurrentWeeklyInventoryWithCtx(
            ctx,
            (await ctx.db.get("reportWeekCurrent", currentId))!,
          )
        ).completeness,
      ).toBe("unavailable");
    });
    const old = await claim(t, storeId, NOW + 2);
    await t.run(async (ctx) => {
      await ctx.db.patch("reportWeekCurrent", currentId, {
        cycleStartDate: "2026-09-07",
        cycleEndDate: "2026-09-13",
      });
      await enqueueWeeklyInventoryFrameWithCtx(ctx, { storeId, now: NOW + 3 });
    });
    expect(await t.run((ctx) => applyInventoryWithCtx(ctx, old, NOW + 4))).toBe(
      "stale",
    );
    const currentClaim = await claim(t, storeId, NOW + 4);
    expect(
      await t.run((ctx) => applyInventoryWithCtx(ctx, currentClaim, NOW + 4)),
    ).toBe("applied");
    await t.run(async (ctx) => {
      expect(
        (
          await readCurrentWeeklyInventoryWithCtx(
            ctx,
            (await ctx.db.get("reportWeekCurrent", currentId))!,
          )
        ).carriedForwardCount,
      ).toBe(1);
    });
  });

  it("binds schedule changes but not financial/day-status changes, and hides retained frames with missing schedule evidence", async () => {
    const { t, storeId, currentId, scheduleId } = await fixture();
    await t.run(async (ctx) => {
      const current = (await ctx.db.get("reportWeekCurrent", currentId))!;
      if (current.availability === "unavailable")
        throw new Error("fixture unavailable");
      expect(
        financialFrameKey({
          ...current,
          materializedAt: NOW + 2,
        } as Doc<"reportWeekCurrent">),
      ).toBe(financialFrameKey(current));
      expect(
        financialFrameKey({
          ...current,
          scheduleLineage: current.scheduleLineage.map((day) => ({
            ...day,
            dayClosed: true,
          })),
        }),
      ).toBe(financialFrameKey(current));
      const schedule = (await ctx.db.get("storeSchedule", scheduleId))!;
      const { _id: _id, _creationTime: _creationTime, ...fields } = schedule;
      const changedScheduleId = await ctx.db.insert("storeSchedule", {
        ...fields,
        timezone: "America/New_York",
      });
      expect(
        financialFrameKey({
          ...current,
          scheduleLineage: current.scheduleLineage.map((day) => ({
            ...day,
            scheduleVersionId: changedScheduleId,
          })),
        }),
      ).not.toBe(financialFrameKey(current));
      await ctx.db.patch("reportWeekCurrent", currentId, {
        completeness: { complete: false, reason: "missing_timezone" },
      });
      await enqueueWeeklyInventoryFrameWithCtx(ctx, { storeId, now: NOW });
    });
    const token = await claim(t, storeId);
    expect(await t.run((ctx) => applyInventoryWithCtx(ctx, token, NOW))).toBe(
      "applied",
    );
    await t.run(async (ctx) => {
      expect(
        (
          await readCurrentWeeklyInventoryWithCtx(
            ctx,
            (await ctx.db.get("reportWeekCurrent", currentId))!,
          )
        ).completeness,
      ).toBe("unavailable");
    });
  });

  it("blocks missing compact coverage rather than acknowledging a manufactured empty result", async () => {
    const { t, storeId } = await fixture();
    await t.run((ctx) => setInventoryCoverageWithCtx(ctx, storeId, false, NOW));
    const token = await claim(t, storeId);
    expect(await t.run((ctx) => applyInventoryWithCtx(ctx, token, NOW))).toBe(
      "blocked",
    );
    expect(
      await t.run((ctx) => ctx.db.query("reportPipelineWork").unique()),
    ).toMatchObject({
      status: "blocked",
      lastFailure: { code: "coverage_incomplete" },
    });
  });
});
