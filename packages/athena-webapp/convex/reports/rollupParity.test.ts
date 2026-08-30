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
import { verifyRollupParityBatchWithCtx } from "./rollupParity";
import { recordReadCosts } from "./readCostTestSupport";
import type { ReportSkuDayMetrics } from "../../shared/reportsContract";

const modules = import.meta.glob("../**/*.ts");
const DAY = "2026-08-10";
const metrics = {
  unitsSold: 1,
  unitsReturned: 0,
  grossSalesMinor: 100,
  netSalesMinor: 100,
  refundsMinor: 0,
  uncostedRevenueMinor: 0,
  grossProfitMinor: 40,
};
async function fixture(skuCount = 2, dates = [DAY]) {
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
      { storeId: seeded.storeId, epoch: "parity" },
      1,
    );
    const skuIds = [seeded.skuId, seeded.otherSkuId];
    for (let i = 2; i < skuCount; i++)
      skuIds.push(
        await ctx.db.insert("productSku", {
          storeId: seeded.storeId,
          productId: seeded.productId,
          sku: `PROOF-${i}`,
          images: [],
          price: 100,
          inventoryCount: 0,
          quantityAvailable: 0,
        }),
      );
    for (const operatingDate of dates)
      await captureRollupInputWithCtx(
        ctx,
        {
          storeId: seeded.storeId,
          operatingDate,
          revision: 1,
          skuDays: new Map<string, ReportSkuDayMetrics>(
            skuIds.map((id, index) => [
              id,
              { ...metrics, grossProfitMinor: index === 1 ? null : 40 },
            ]),
          ),
        },
        2,
      );
    return { ...seeded, controlId };
  });
  const args = { storeId: seeded.storeId, epoch: "parity" };
  for (let i = 0; i < 10; i++) {
    if (await t.run((ctx) => seedRollupEpochBatchWithCtx(ctx, args, 3))) break;
    if (i === 9) throw new Error("fixture seed did not complete");
  }
  const drain = async () => {
    for (const operatingDate of dates) {
      let finished = false;
      for (let i = 0; i < 10; i++)
        if (
          (await t.run((ctx) =>
            applyRollupDayBatchWithCtx(ctx, { ...args, operatingDate }, 10),
          )) === "done"
        ) {
          finished = true;
          break;
        }
      if (!finished) throw new Error("fixture did not drain");
    }
  };
  let maxReads = 0;
  const verify = async (restart = false) => {
    for (let i = 0; i < 1000; i++) {
      const state = await t.run(async (ctx) => {
        const recorder = recordReadCosts(ctx);
        const result = await verifyRollupParityBatchWithCtx(
          recorder.ctx,
          { ...args, restart: restart && i === 0 },
          20,
        );
        maxReads = Math.max(
          maxReads,
          recorder.snapshot().total.returnedDocuments,
        );
        expect(recorder.snapshot().total.returnedDocuments).toBeLessThanOrEqual(
          100,
        );
        return result;
      });
      if (state !== "pending") return state;
    }
    throw new Error("proof did not finish");
  };
  return { t, seeded, args, drain, verify, maxReads: () => maxReads };
}
describe("bounded target epoch parity proof", () => {
  it("resumes across immutable chunk boundaries and rolls proof progress back on transaction failure", async () => {
    const { t, args, drain, verify } = await fixture(101);
    await drain();
    await expect(
      t.run(async (ctx) => {
        await verifyRollupParityBatchWithCtx(ctx, args, 20);
        throw new Error("proof transaction failed");
      }),
    ).rejects.toThrow("proof transaction failed");
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("reportRollupParity")
          .withIndex("by_storeId_epoch", (q) =>
            q.eq("storeId", args.storeId).eq("epoch", args.epoch),
          )
          .unique(),
      ),
    ).toBeNull();
    expect(await verify()).toBe("ready");
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("reportRollupParity")
          .withIndex("by_storeId_epoch", (q) =>
            q.eq("storeId", args.storeId).eq("epoch", args.epoch),
          )
          .unique(),
      ),
    ).toMatchObject({ inputRows: 101, checkpointRows: 101, outputRows: 303 });
  });

  it("proves a full month with at most 100 returned documents per transaction", async () => {
    const { drain, verify, maxReads } = await fixture(
      3,
      Array.from(
        { length: 31 },
        (_, i) => `2026-08-${String(i + 1).padStart(2, "0")}`,
      ),
    );
    await drain();
    expect(await verify()).toBe("ready");
    expect(maxReads()).toBeGreaterThanOrEqual(93);
    expect(maxReads()).toBeLessThanOrEqual(100);
  });

  it.each(["extra-checkpoint", "orphan-output", "nonfinite-input"] as const)(
    "refuses %s instead of skipping it",
    async (kind) => {
      const { t, seeded, args, drain, verify } = await fixture();
      await drain();
      await t.run(async (ctx) => {
        if (kind === "extra-checkpoint")
          await ctx.db.insert("reportRollupCheckpoint", {
            ...args,
            operatingDate: "2026-08-11",
            productSkuId: seeded.skuId,
            revision: 1,
            ...metrics,
          });
        else if (kind === "orphan-output")
          await ctx.db.insert("reportEpochSkuRollup", {
            ...args,
            periodKey: "m:2026-07",
            productSkuId: seeded.skuId,
            ...metrics,
            knownProfitMinor: 40,
            unknownProfitDays: 0,
            contributingDays: 1,
            revenueSortKey: -100,
            unitsSortKey: -1,
          });
        else {
          const pointer = await ctx.db
            .query("reportRollupInputCurrent")
            .withIndex("by_storeId_operatingDate", (q) =>
              q.eq("storeId", seeded.storeId),
            )
            .first();
          const chunk = await ctx.db
            .query("reportRollupInputChunk")
            .withIndex("by_inputId_ordinal", (q) =>
              q.eq("inputId", pointer!.inputId),
            )
            .first();
          await ctx.db.patch("reportRollupInputChunk", chunk!._id, {
            rows: chunk!.rows.map((row) => ({
              ...row,
              grossProfitMinor: Number.NaN,
            })),
          });
        }
      });
      expect(await verify()).toBe("blocked");
    },
  );

  it("proves inputs, checkpoints and exact output including unknown profit before readiness", async () => {
    const { t, seeded, args, drain, verify } = await fixture();
    expect(await verify()).toBe("blocked");
    await drain();
    expect(await verify(true)).toBe("ready");
    const proof = await t.run((ctx) =>
      ctx.db
        .query("reportRollupParity")
        .withIndex("by_storeId_epoch", (q) =>
          q.eq("storeId", seeded.storeId).eq("epoch", args.epoch),
        )
        .unique(),
    );
    expect(proof).toMatchObject({
      phase: "ready",
      controlFence: 2,
      sourceWatermark: 1,
      inputRows: 2,
      checkpointRows: 2,
      outputRows: 6,
    });
  });

  it.each(["input", "checkpoint", "output", "missing-output"] as const)(
    "blocks a corrupt %s without modifying the target to fit",
    async (kind) => {
      const { t, seeded, drain, verify } = await fixture();
      await drain();
      await t.run(async (ctx) => {
        if (kind === "input") {
          const pointer = await ctx.db
            .query("reportRollupInputCurrent")
            .withIndex("by_storeId_operatingDate", (q) =>
              q.eq("storeId", seeded.storeId),
            )
            .first();
          const chunk = await ctx.db
            .query("reportRollupInputChunk")
            .withIndex("by_inputId_ordinal", (q) =>
              q.eq("inputId", pointer!.inputId),
            )
            .first();
          await ctx.db.patch("reportRollupInputChunk", chunk!._id, {
            rows: chunk!.rows.map((row) => ({ ...row, netSalesMinor: 999 })),
          });
        } else if (kind === "checkpoint") {
          const row = await ctx.db
            .query("reportRollupCheckpoint")
            .withIndex("by_storeId_epoch_operatingDate_productSkuId", (q) =>
              q.eq("storeId", seeded.storeId),
            )
            .first();
          await ctx.db.patch("reportRollupCheckpoint", row!._id, {
            grossProfitMinor: 999,
          });
        } else {
          const row = await ctx.db
            .query("reportEpochSkuRollup")
            .withIndex("by_storeId_epoch_periodKey_productSkuId", (q) =>
              q.eq("storeId", seeded.storeId),
            )
            .first();
          if (kind === "missing-output")
            await ctx.db.delete("reportEpochSkuRollup", row!._id);
          else
            await ctx.db.patch("reportEpochSkuRollup", row!._id, {
              knownProfitMinor: 999,
            });
        }
      });
      expect(await verify()).toBe("blocked");
    },
  );

  it("restarts on source or control drift and never reuses a stale ready proof", async () => {
    const { t, seeded, args, drain, verify } = await fixture();
    await drain();
    expect(await verify()).toBe("ready");
    await t.run((ctx) =>
      captureRollupInputWithCtx(
        ctx,
        {
          storeId: seeded.storeId,
          operatingDate: DAY,
          revision: 2,
          skuDays: new Map([[seeded.skuId, metrics]]),
        },
        30,
      ),
    );
    expect(
      await t.run((ctx) => verifyRollupParityBatchWithCtx(ctx, args, 31)),
    ).toBe("blocked");
    await drain();
    expect(await verify(true)).toBe("ready");
    await t.run((ctx) =>
      ctx.db.patch("reportPipelineControl", seeded.controlId, { fence: 3 }),
    );
    expect(
      await t.run((ctx) => verifyRollupParityBatchWithCtx(ctx, args, 40)),
    ).toBe("pending");
    expect(await verify()).toBe("ready");
  });
});
