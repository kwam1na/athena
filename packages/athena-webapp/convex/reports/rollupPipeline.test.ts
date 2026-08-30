/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import type { ReportSkuDayMetrics } from "../../shared/reportsContract";
import { seedStore } from "./reseedTestSupport";
import {
  applyRollupDayBatchWithCtx,
  captureRollupInputWithCtx,
  initializeRollupEpochWithCtx,
  seedRollupEpochBatchWithCtx,
  ROLLUP_INPUT_CHUNK_SIZE,
} from "./rollupPipeline";
import { recordReadCosts } from "./readCostTestSupport";

const modules = import.meta.glob("../**/*.ts");
const NOW = 1_000_000;
const DAY = "2026-08-10";
const EPOCH = "test-epoch";
const measures = (
  netSalesMinor = 100,
  grossProfitMinor: number | null = 40,
): ReportSkuDayMetrics => ({
  unitsSold: 1,
  unitsReturned: 0,
  grossSalesMinor: netSalesMinor,
  netSalesMinor,
  refundsMinor: 0,
  uncostedRevenueMinor: grossProfitMinor === null ? netSalesMinor : 0,
  grossProfitMinor,
});
async function setup(t: TestConvex<typeof schema>, skuCount = 2) {
  return t.run(async (ctx) => {
    const seeded = await seedStore(ctx, "UTC");
    await ctx.db.insert("reportPipelineControl", {
      storeId: seeded.storeId,
      mode: "shadow",
      fence: 1,
      sourceWatermark: 0,
    });
    const skuIds = [seeded.skuId, seeded.otherSkuId];
    for (let index = 2; index < skuCount; index += 1)
      skuIds.push(
        await ctx.db.insert("productSku", {
          images: [],
          inventoryCount: 0,
          price: 100,
          productId: seeded.productId,
          quantityAvailable: 0,
          sku: `ROLLUP-${index}`,
          storeId: seeded.storeId,
        }),
      );
    await initializeRollupEpochWithCtx(
      ctx,
      { storeId: seeded.storeId, epoch: EPOCH },
      NOW,
    );
    return { ...seeded, skuIds };
  });
}
async function capture(
  t: TestConvex<typeof schema>,
  storeId: Id<"store">,
  rows: Map<string, ReportSkuDayMetrics>,
  revision = 1,
  operatingDate = DAY,
) {
  return t.run((ctx) =>
    captureRollupInputWithCtx(
      ctx,
      { storeId, operatingDate, revision, skuDays: rows },
      NOW + revision,
    ),
  );
}
async function drain(
  t: TestConvex<typeof schema>,
  storeId: Id<"store">,
  operatingDate = DAY,
  epoch = EPOCH,
) {
  for (let index = 0; index < 100; index += 1) {
    const result = await t.run((ctx) =>
      applyRollupDayBatchWithCtx(
        ctx,
        { storeId, operatingDate, epoch },
        NOW + 100,
      ),
    );
    if (result === "done") return;
  }
  throw new Error("Rollup fixture did not drain bounded batches");
}
async function output(
  t: TestConvex<typeof schema>,
  storeId: Id<"store">,
  periodKey = "m:2026-08",
  epoch = EPOCH,
) {
  return t.run((ctx) =>
    ctx.db
      .query("reportEpochSkuRollup")
      .withIndex("by_storeId_epoch_periodKey_productSkuId", (q) =>
        q.eq("storeId", storeId).eq("epoch", epoch).eq("periodKey", periodKey),
      )
      .take(5001),
  );
}

describe("immutable input and checkpointed period rollups", () => {
  it("builds from zero, applies corrections/deletions once, and reverses unknown profit", async () => {
    const t = convexTest(schema, modules);
    const { storeId, skuIds } = await setup(t);
    await capture(
      t,
      storeId,
      new Map([
        [skuIds[0], measures()],
        [skuIds[1], measures(200, null)],
      ]),
    );
    await drain(t, storeId);
    await capture(
      t,
      storeId,
      new Map([[skuIds[0], measures(50, null)]]),
      1,
      "2026-08-11",
    );
    await drain(t, storeId, "2026-08-11");
    let rows = await output(t, storeId);
    expect(rows.find((row) => row.productSkuId === skuIds[0])).toMatchObject({
      netSalesMinor: 150,
      grossProfitMinor: null,
      knownProfitMinor: 40,
      unknownProfitDays: 1,
      contributingDays: 2,
    });
    await capture(
      t,
      storeId,
      new Map([[skuIds[0], measures(80, 20)]]),
      2,
      "2026-08-11",
    );
    await drain(t, storeId, "2026-08-11");
    await capture(t, storeId, new Map([[skuIds[0], measures(120, 60)]]), 2);
    await drain(t, storeId);
    rows = await output(t, storeId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      netSalesMinor: 200,
      grossProfitMinor: 80,
      unknownProfitDays: 0,
      contributingDays: 2,
    });
    await drain(t, storeId);
    expect(await output(t, storeId)).toEqual(rows);
    await capture(t, storeId, new Map(), 3);
    await drain(t, storeId);
    expect((await output(t, storeId))[0]).toMatchObject({
      netSalesMinor: 80,
      grossProfitMinor: 20,
      contributingDays: 1,
    });
  });

  it("captures the in-memory fold and ignores mutable SKU-day ingestion between pages", async () => {
    const t = convexTest(schema, modules);
    const { storeId, skuIds } = await setup(t, ROLLUP_INPUT_CHUNK_SIZE + 1);
    await capture(t, storeId, new Map(skuIds.map((id) => [id, measures()])));
    expect(
      await t.run((ctx) =>
        applyRollupDayBatchWithCtx(
          ctx,
          { storeId, epoch: EPOCH, operatingDate: DAY },
          NOW,
        ),
      ),
    ).toBe("more");
    await t.run(async (ctx) => {
      await ctx.db.insert("reportSkuDay", {
        storeId,
        operatingDate: DAY,
        productSkuId: skuIds.at(-1)!,
        ...measures(9999, 9999),
      });
    });
    await drain(t, storeId);
    expect(
      (await output(t, storeId)).every((row) => row.netSalesMinor === 100),
    ).toBe(true);
    await expect(
      capture(t, storeId, new Map([[skuIds[0], measures(1, 1)]]), 1),
    ).rejects.toThrow("report_rollup_input_conflict");
  });

  it("reconciles a newer input from partially applied checkpoints and keeps periods pending until deletion finishes", async () => {
    const t = convexTest(schema, modules);
    const { storeId, skuIds } = await setup(t, ROLLUP_INPUT_CHUNK_SIZE + 1);
    await capture(t, storeId, new Map(skuIds.map((id) => [id, measures()])));
    await t.run((ctx) =>
      applyRollupDayBatchWithCtx(
        ctx,
        { storeId, epoch: EPOCH, operatingDate: DAY },
        NOW,
      ),
    );
    await capture(t, storeId, new Map([[skuIds[0], measures(75, null)]]), 2);
    await t.run((ctx) =>
      applyRollupDayBatchWithCtx(
        ctx,
        { storeId, epoch: EPOCH, operatingDate: DAY },
        NOW,
      ),
    );
    const pending = await t.run((ctx) =>
      ctx.db
        .query("reportPeriodReadiness")
        .withIndex("by_storeId_epoch_periodKey", (q) =>
          q
            .eq("storeId", storeId)
            .eq("epoch", EPOCH)
            .eq("periodKey", "m:2026-08"),
        )
        .unique(),
    );
    expect(pending).toMatchObject({
      status: "pending",
      pendingDays: 1,
      publicationRevision: 0,
    });
    await drain(t, storeId);
    expect(await output(t, storeId)).toMatchObject([
      {
        productSkuId: skuIds[0],
        netSalesMinor: 75,
        grossProfitMinor: null,
        contributingDays: 1,
      },
    ]);
    const ready = await t.run((ctx) =>
      ctx.db
        .query("reportPeriodReadiness")
        .withIndex("by_storeId_epoch_periodKey", (q) =>
          q
            .eq("storeId", storeId)
            .eq("epoch", EPOCH)
            .eq("periodKey", "m:2026-08"),
        )
        .unique(),
    );
    expect(ready).toMatchObject({
      status: "ready",
      pendingDays: 0,
      publicationRevision: 1,
    });
  });

  it("rolls back delta and checkpoint writes together on failure", async () => {
    const t = convexTest(schema, modules);
    const { storeId, skuIds } = await setup(t);
    await capture(t, storeId, new Map([[skuIds[0], measures()]]));
    await expect(
      t.run(async (ctx) => {
        await applyRollupDayBatchWithCtx(
          ctx,
          { storeId, epoch: EPOCH, operatingDate: DAY },
          NOW,
        );
        throw new Error("injected_after_delta");
      }),
    ).rejects.toThrow("injected_after_delta");
    expect(await output(t, storeId)).toEqual([]);
    await drain(t, storeId);
    expect((await output(t, storeId))[0].netSalesMinor).toBe(100);
  });

  // convex-test scans its in-memory tables for indexed queries: these 4030
  // real contributions take ~89s under local V8 and exceeded 180s in hosted
  // coverage. Bound simulator time without changing cardinality, assertions,
  // or production worker batches; this is not a production latency budget.
  it("repairs over 4000 source SKU-day contributions into an isolated epoch without touching legacy totals", async () => {
    const t = convexTest(schema, modules);
    const { storeId, skuIds } = await setup(t, 130);
    for (let day = 1; day <= 31; day += 1) {
      const date = `2026-08-${String(day).padStart(2, "0")}`;
      await capture(
        t,
        storeId,
        new Map(skuIds.map((id) => [id, measures()])),
        1,
        date,
      );
    }
    await t.run(async (ctx) => {
      await ctx.db.insert("reportPeriodSkuRollup", {
        storeId,
        periodKey: "m:2026-08",
        productSkuId: skuIds[0],
        ...measures(777, 777),
        revenueSortKey: -777,
        unitsSortKey: -1,
      });
      await initializeRollupEpochWithCtx(
        ctx,
        { storeId, epoch: "repair" },
        NOW,
      );
    });
    for (let index = 0; index < 10; index += 1) {
      const done = await t.run((ctx) =>
        seedRollupEpochBatchWithCtx(ctx, { storeId, epoch: "repair" }, NOW),
      );
      if (done) break;
      if (index === 9) throw new Error("Repair seed did not drain");
    }
    for (let day = 1; day <= 31; day += 1)
      await drain(
        t,
        storeId,
        `2026-08-${String(day).padStart(2, "0")}`,
        "repair",
      );
    const rows = await output(t, storeId, "m:2026-08", "repair");
    expect(rows).toHaveLength(130);
    expect(
      rows.every(
        (row) => row.netSalesMinor === 3100 && row.grossProfitMinor === 1240,
      ),
    ).toBe(true);
    const legacy = await t.run((ctx) =>
      ctx.db.query("reportPeriodSkuRollup").first(),
    );
    expect(legacy?.netSalesMinor).toBe(777);
  }, 360_000);

  it("keeps recurring reads proportional to one changed day's contributions", async () => {
    const t = convexTest(schema, modules);
    const { storeId, skuIds } = await setup(t);
    for (const date of [DAY, "2026-08-11", "2026-08-12"]) {
      await capture(
        t,
        storeId,
        new Map(skuIds.map((id) => [id, measures()])),
        1,
        date,
      );
      await drain(t, storeId, date);
    }
    await capture(
      t,
      storeId,
      new Map([
        [skuIds[0], measures(101)],
        [skuIds[1], measures()],
      ]),
      2,
    );
    await t.run(async (ctx) => {
      const recorder = recordReadCosts(ctx);
      await applyRollupDayBatchWithCtx(
        recorder.ctx,
        { storeId, epoch: EPOCH, operatingDate: DAY },
        NOW,
      );
      const cost = recorder.snapshot();
      expect(cost.byTable.reportSkuDay).toBeUndefined();
      expect(cost.byTable.reportEpochSkuRollup.returnedDocuments).toBe(3);
      expect(cost.total.returnedDocuments).toBeLessThan(40);
    });
  });
});
