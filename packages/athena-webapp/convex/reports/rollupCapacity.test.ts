/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../schema";
import { seedStore } from "./reseedTestSupport";
import { rebuildPeriodRollup } from "./rollups";
import {
  applyRollupDayBatchWithCtx,
  captureRollupInputWithCtx,
  initializeRollupEpochWithCtx,
} from "./rollupPipeline";
import { stableStringHash } from "./fingerprint";
const modules = import.meta.glob("../**/*.ts");
const measures = {
  unitsSold: 1,
  unitsReturned: 0,
  grossSalesMinor: 100,
  netSalesMinor: 100,
  refundsMinor: 0,
  uncostedRevenueMinor: 0,
  grossProfitMinor: 40,
};
describe("period rollup completeness sentinels", () => {
  it("refuses a corrupted chunk count instead of publishing an empty period", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const seeded = await seedStore(ctx, "UTC");
      await ctx.db.insert("reportPipelineControl", {
        storeId: seeded.storeId,
        mode: "shadow",
        fence: 1,
        sourceWatermark: 0,
      });
      await initializeRollupEpochWithCtx(
        ctx,
        { storeId: seeded.storeId, epoch: "shape" },
        1,
      );
      const inputId = await captureRollupInputWithCtx(
        ctx,
        {
          storeId: seeded.storeId,
          operatingDate: "2026-08-10",
          revision: 1,
          skuDays: new Map([[seeded.skuId, measures]]),
        },
        1,
      );
      await ctx.db.patch("reportRollupInput", inputId!, { chunkCount: 0 });
      return seeded;
    });
    await expect(
      t.run((ctx) =>
        applyRollupDayBatchWithCtx(
          ctx,
          {
            storeId: seeded.storeId,
            epoch: "shape",
            operatingDate: "2026-08-10",
          },
          2,
        ),
      ),
    ).rejects.toThrow("report_rollup_invalid_input");
  });

  it("does not treat an equal short digest as exact immutable input identity", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const seeded = await seedStore(ctx, "UTC");
      await ctx.db.insert("reportPipelineControl", {
        storeId: seeded.storeId,
        mode: "shadow",
        fence: 1,
        sourceWatermark: 0,
      });
      const inputId = await captureRollupInputWithCtx(
        ctx,
        {
          storeId: seeded.storeId,
          operatingDate: "2026-08-10",
          revision: 1,
          skuDays: new Map([[seeded.skuId, measures]]),
        },
        1,
      );
      const different = { ...measures, netSalesMinor: 999 };
      // Simulate a digest collision without depending on a particular collision.
      await ctx.db.patch("reportRollupInput", inputId!, {
        digest: stableStringHash(
          JSON.stringify([{ productSkuId: seeded.skuId, ...different }]),
        ),
      });
      return seeded;
    });
    await expect(
      t.run((ctx) =>
        captureRollupInputWithCtx(
          ctx,
          {
            storeId: seeded.storeId,
            operatingDate: "2026-08-10",
            revision: 1,
            skuDays: new Map([
              [seeded.skuId, { ...measures, netSalesMinor: 999 }],
            ]),
          },
          2,
        ),
      ),
    ).rejects.toThrow("report_rollup_input_conflict");
  });

  it("refuses a supposedly new epoch with leftover readiness state", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const seeded = await seedStore(ctx, "UTC");
      await ctx.db.insert("reportPipelineControl", {
        storeId: seeded.storeId,
        mode: "shadow",
        fence: 1,
        sourceWatermark: 0,
      });
      await ctx.db.insert("reportPeriodReadiness", {
        storeId: seeded.storeId,
        epoch: "residue",
        periodKey: "m:2026-08",
        status: "ready",
        pendingDays: 0,
        publicationRevision: 5,
        updatedAt: 1,
      });
      return seeded;
    });
    await expect(
      t.run((ctx) =>
        initializeRollupEpochWithCtx(
          ctx,
          { storeId: seeded.storeId, epoch: "residue" },
          2,
        ),
      ),
    ).rejects.toThrow("report_rollup_epoch_not_empty");
  });

  it("refuses more than 4000 existing output rows before any reconciliation write", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const seeded = await seedStore(ctx, "UTC");
      for (let index = 0; index < 4001; index++) {
        const productSkuId =
          index === 0
            ? seeded.skuId
            : await ctx.db.insert("productSku", {
                storeId: seeded.storeId,
                productId: seeded.productId,
                sku: `CAP-${index}`,
                images: [],
                price: 100,
                inventoryCount: 0,
                quantityAvailable: 0,
              });
        await ctx.db.insert("reportPeriodSkuRollup", {
          storeId: seeded.storeId,
          productSkuId,
          periodKey: "m:2026-08",
          ...measures,
          revenueSortKey: -100,
          unitsSortKey: -1,
        });
      }
      return seeded;
    });
    await expect(
      t.run((ctx) => rebuildPeriodRollup(ctx, seeded.storeId, "m:2026-08")),
    ).rejects.toThrow("report_rollup_output_capacity");
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("reportPeriodSkuRollup")
          .withIndex("by_storeId_periodKey_productSkuId", (q) =>
            q.eq("storeId", seeded.storeId).eq("periodKey", "m:2026-08"),
          )
          .take(4002),
      ),
    ).toHaveLength(4001);
  }, 30_000);

  it("refuses invalid immutable input before any header, chunk or work write", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const seeded = await seedStore(ctx, "UTC");
      await ctx.db.insert("reportPipelineControl", {
        storeId: seeded.storeId,
        mode: "shadow",
        fence: 1,
        sourceWatermark: 0,
      });
      return seeded;
    });
    await expect(
      t.run((ctx) =>
        captureRollupInputWithCtx(
          ctx,
          {
            storeId: seeded.storeId,
            operatingDate: "2026-08-10",
            revision: 1,
            skuDays: new Map([
              [seeded.skuId, { ...measures, netSalesMinor: Number.NaN }],
            ]),
          },
          1,
        ),
      ),
    ).rejects.toThrow("report_rollup_invalid_input");
    await t.run(async (ctx) => {
      expect(
        await ctx.db
          .query("reportRollupInput")
          .withIndex("by_storeId_operatingDate_revision", (q) =>
            q.eq("storeId", seeded.storeId),
          )
          .first(),
      ).toBeNull();
      expect(
        await ctx.db
          .query("reportPipelineWork")
          .withIndex("by_storeId_kind_eligibleAt", (q) =>
            q.eq("storeId", seeded.storeId),
          )
          .first(),
      ).toBeNull();
    });
  });
});
