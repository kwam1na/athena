/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../schema";
import { seedStore } from "./reseedTestSupport";
import {
  applyRollupDayBatchWithCtx,
  captureRollupInputWithCtx,
  initializeRollupEpochWithCtx,
  seedRollupEpochBatchWithCtx,
} from "./rollupPipeline";
import {
  readEpochPeriodPageWithCtx,
  readEpochPeriodResultWithCtx,
} from "./rollupPeriodRead";
import { recordReadCosts } from "./readCostTestSupport";

const modules = import.meta.glob("../**/*.ts");
const NOW = 1000;
const DAY = "2026-08-10";
const EPOCH = "reader";
const metrics = {
  unitsSold: 1,
  unitsReturned: 0,
  grossSalesMinor: 100,
  netSalesMinor: 100,
  refundsMinor: 0,
  uncostedRevenueMinor: 0,
  grossProfitMinor: 40,
};
async function fixture() {
  const t = convexTest(schema, modules);
  const seeded = await t.run(async (ctx) => {
    const seeded = await seedStore(ctx, "UTC");
    const controlId = await ctx.db.insert("reportPipelineControl", {
      storeId: seeded.storeId,
      mode: "shadow",
      fence: 1,
      sourceWatermark: 0,
    });
    await initializeRollupEpochWithCtx(
      ctx,
      { storeId: seeded.storeId, epoch: EPOCH },
      NOW,
    );
    const skuIds = [seeded.skuId, seeded.otherSkuId];
    for (let i = 2; i < 41; i++)
      skuIds.push(
        await ctx.db.insert("productSku", {
          storeId: seeded.storeId,
          productId: seeded.productId,
          sku: `PAGE-${i}`,
          images: [],
          price: 100,
          inventoryCount: 0,
          quantityAvailable: 0,
        }),
      );
    await captureRollupInputWithCtx(
      ctx,
      {
        storeId: seeded.storeId,
        operatingDate: DAY,
        revision: 1,
        skuDays: new Map(skuIds.map((id) => [id, metrics])),
      },
      NOW,
    );
    await seedRollupEpochBatchWithCtx(
      ctx,
      { storeId: seeded.storeId, epoch: EPOCH },
      NOW,
    );
    await ctx.db.patch("reportPipelineControl", controlId, {
      mode: "active",
      activeRollupEpoch: EPOCH,
    });
    return { ...seeded, controlId, skuIds };
  });
  const args = {
    storeId: seeded.storeId,
    periodKey: "m:2026-08",
    sortBy: "revenue" as const,
  };
  const read = (cursor?: string) =>
    t.run((ctx) => readEpochPeriodPageWithCtx(ctx, { ...args, cursor }));
  const drain = async () => {
    for (let i = 0; i < 10; i++)
      if (
        (await t.run((ctx) =>
          applyRollupDayBatchWithCtx(
            ctx,
            { storeId: seeded.storeId, operatingDate: DAY, epoch: EPOCH },
            NOW,
          ),
        )) === "done"
      )
        return;
    throw new Error("fixture did not drain");
  };
  return { t, seeded, args, read, drain };
}

describe("epoch period publication reads", () => {
  it("uses canonical day totals without a close/fact fallback and withholds unknown or pending comparisons", async () => {
    const { t, seeded, args, drain } = await fixture();
    await drain();
    const dayId = await t.run((ctx) =>
      ctx.db.insert("reportDay", {
        storeId: seeded.storeId,
        operatingDate: DAY,
        currency: "GHS",
        status: "reconciled",
        ...metrics,
        paymentsCollectedMinor: 100,
        paymentsRefundedMinor: 0,
        paymentAllocatedMinor: 100,
        foldVersion: 1,
        factCount: 1,
        lastFactRecordedAt: NOW,
        flags: {
          mixedCurrency: false,
          hasUncostedRevenue: false,
          quarantinedFactCount: 0,
        },
      }),
    );
    expect(
      await t.run((ctx) => readEpochPeriodResultWithCtx(ctx, args, null)),
    ).toEqual({
      status: "blocked",
      reason: "repair_required",
      rows: [],
      continueCursor: null,
    });
    await t.run((ctx) =>
      ctx.db.patch("reportDay", dayId, { transactionCount: 1 }),
    );
    await t.run((ctx) =>
      ctx.db.insert("reportDirtyDay", {
        storeId: seeded.storeId,
        operatingDate: "2026-07-31",
        reason: "late_fact",
        markedAt: NOW,
      }),
    );
    await t.run(async (ctx) => {
      const recorder = recordReadCosts(ctx);
      const result = await readEpochPeriodResultWithCtx(recorder.ctx, args, {
        startDate: "2026-07-01",
        endDate: "2026-07-31",
      });
      expect(result).toMatchObject({
        status: "ready",
        totalNetSalesMinor: 100,
        totalUnitsSold: 1,
        totalTransactions: 1,
      });
      expect(result).not.toHaveProperty("priorPeriodTotals");
      expect(recorder.snapshot().byTable.dailyClose).toBeUndefined();
      expect(recorder.snapshot().byTable.reportFact).toBeUndefined();
    });
  });

  it("never falls back to legacy totals while paused, even before an epoch is active", async () => {
    const { t, seeded, read } = await fixture();
    await t.run((ctx) =>
      ctx.db.patch("reportPipelineControl", seeded.controlId, {
        mode: "paused",
        activeRollupEpoch: undefined,
      }),
    );
    expect((await read())?.status).toBe("pending");
  });

  it("hides all financial totals while pending or blocked, including ingestion after publication", async () => {
    const { t, seeded, read, drain } = await fixture();
    expect(await read()).toEqual({
      status: "pending",
      reason: "projection_pending",
      rows: [],
      continueCursor: null,
    });
    await drain();
    expect(await read()).toMatchObject({
      status: "ready",
      publicationRevision: 1,
    });
    await t.run((ctx) =>
      ctx.db.insert("reportDirtyDay", {
        storeId: seeded.storeId,
        operatingDate: DAY,
        reason: "late_fact",
        markedAt: NOW,
      }),
    );
    expect(await read()).toEqual({
      status: "pending",
      reason: "projection_pending",
      rows: [],
      continueCursor: null,
    });
    await t.run(async (ctx) => {
      const gate = await ctx.db
        .query("reportPeriodReadiness")
        .withIndex("by_storeId_epoch_periodKey", (q) =>
          q
            .eq("storeId", seeded.storeId)
            .eq("epoch", EPOCH)
            .eq("periodKey", "m:2026-08"),
        )
        .unique();
      await ctx.db.patch("reportPeriodReadiness", gate!._id, {
        status: "blocked",
      });
    });
    expect(await read()).toEqual({
      status: "blocked",
      reason: "repair_required",
      rows: [],
      continueCursor: null,
    });
  });

  it("pages a tie group larger than the legacy overfetch and forces a revision restart", async () => {
    const { t, seeded, read, drain } = await fixture();
    await drain();
    let cursor: string | undefined;
    let firstCursor = "";
    const ids: string[] = [];
    do {
      const result = await read(cursor);
      expect(result?.status).toBe("ready");
      if (result?.status !== "ready") throw new Error("fixture not ready");
      ids.push(...result.rows.map((row) => row.productSkuId));
      cursor = result.continueCursor ?? undefined;
      firstCursor ||= cursor ?? "";
    } while (cursor);
    expect(ids).toHaveLength(41);
    expect(new Set(ids).size).toBe(41);
    await t.run((ctx) =>
      captureRollupInputWithCtx(
        ctx,
        {
          storeId: seeded.storeId,
          operatingDate: DAY,
          revision: 2,
          skuDays: new Map([
            [seeded.skuId, { ...metrics, netSalesMinor: 500 }],
          ]),
        },
        NOW,
      ),
    );
    expect((await read(firstCursor))?.status).toBe("pending");
    await drain();
    expect(await read(firstCursor)).toEqual({
      status: "restart",
      reason: "period_changed",
      rows: [],
      continueCursor: null,
    });
    const altered = JSON.parse(atob(firstCursor));
    altered.storeId = "another-store";
    await expect(read(btoa(JSON.stringify(altered)))).rejects.toThrow(
      "current query context",
    );
  });

  it("binds cursors to the epoch and reads no mutable SKU-day or large closes", async () => {
    const { t, seeded, args, read, drain } = await fixture();
    await drain();
    const first = await read();
    if (first?.status !== "ready" || !first.continueCursor)
      throw new Error("fixture not ready");
    const oldEpoch = JSON.parse(atob(first.continueCursor));
    oldEpoch.epoch = "previous-epoch";
    expect((await read(btoa(JSON.stringify(oldEpoch))))?.status).toBe(
      "restart",
    );
    await t.run((ctx) =>
      ctx.db.patch("reportPipelineControl", seeded.controlId, {
        activeRollupEpoch: undefined,
      }),
    );
    expect((await read(first.continueCursor!))?.status).toBe("restart");
    await t.run((ctx) =>
      ctx.db.patch("reportPipelineControl", seeded.controlId, {
        activeRollupEpoch: EPOCH,
      }),
    );
    await t.run(async (ctx) => {
      const recorder = recordReadCosts(ctx);
      await readEpochPeriodPageWithCtx(recorder.ctx, args);
      const costs = recorder.snapshot().byTable;
      expect(costs.reportEpochSkuRollup.returnedDocuments).toBe(10);
      expect(costs.reportSkuDay?.returnedDocuments ?? 0).toBe(0);
      expect(costs.dailyClose?.returnedDocuments ?? 0).toBe(0);
      const control = await ctx.db.get(
        "reportPipelineControl",
        seeded.controlId,
      );
      expect(control?.activeRollupEpoch).toBe(EPOCH);
    });
  });
});
