/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../schema";
import { seedStore } from "./reseedTestSupport";
import {
  captureRollupInputWithCtx,
  initializeRollupEpochWithCtx,
} from "./rollupPipeline";
import { cleanupObsoleteRollupInputBatchWithCtx } from "./rollupMaintenance";
import { recordReadCosts } from "./readCostTestSupport";
const modules = import.meta.glob("../**/*.ts");
const DAY = "2026-08-10";
const measures = {
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
      { storeId: seeded.storeId, epoch: "gc" },
      1,
    );
    const oldInputId = await captureRollupInputWithCtx(
      ctx,
      {
        storeId: seeded.storeId,
        operatingDate: DAY,
        revision: 1,
        skuDays: new Map([[seeded.skuId, measures]]),
      },
      2,
    );
    const inputId = await captureRollupInputWithCtx(
      ctx,
      {
        storeId: seeded.storeId,
        operatingDate: DAY,
        revision: 2,
        skuDays: new Map([[seeded.skuId, { ...measures, netSalesMinor: 200 }]]),
      },
      3,
    );
    return { ...seeded, controlId, oldInputId: oldInputId!, inputId: inputId! };
  });
  const scan = async () => {
    let cursor: string | null = null;
    for (let i = 0; i < 20; i++) {
      const result = await t.run(async (ctx) => {
        const recorder = recordReadCosts(ctx);
        const result = await cleanupObsoleteRollupInputBatchWithCtx(
          recorder.ctx,
          { storeId: seeded.storeId, cursor },
          10,
        );
        expect(recorder.snapshot().total.returnedDocuments).toBeLessThanOrEqual(
          30,
        );
        expect(result.deletedChunks).toBeLessThanOrEqual(20);
        return result;
      });
      cursor = result.cursor;
      if (result.done) return;
    }
    throw new Error("cleanup did not finish");
  };
  return { t, seeded, scan };
}
describe("obsolete immutable input retention", () => {
  it("retains unknown current ownership and foreign child ownership", async () => {
    const { t, seeded, scan } = await fixture();
    const pointer = await t.run((ctx) =>
      ctx.db
        .query("reportRollupInputCurrent")
        .withIndex("by_storeId_operatingDate", (q) =>
          q.eq("storeId", seeded.storeId),
        )
        .unique(),
    );
    await t.run((ctx) =>
      ctx.db.delete("reportRollupInputCurrent", pointer!._id),
    );
    await scan();
    expect(
      await t.run((ctx) => ctx.db.get("reportRollupInput", seeded.oldInputId)),
    ).not.toBeNull();
    await t.run(async (ctx) => {
      await ctx.db.insert("reportRollupInputCurrent", {
        storeId: seeded.storeId,
        operatingDate: DAY,
        revision: 2,
        inputId: seeded.inputId,
      });
      const foreign = await seedStore(ctx, "UTC");
      await ctx.db.insert("reportRollupInputChunk", {
        storeId: foreign.storeId,
        inputId: seeded.oldInputId,
        ordinal: 999,
        rows: [],
      });
    });
    await scan();
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("reportRollupInputChunk")
          .withIndex("by_inputId_ordinal", (q) =>
            q.eq("inputId", seeded.oldInputId),
          )
          .take(3),
      ),
    ).toHaveLength(2);
  });

  it("deletes obsolete children before headers in bounded pages and keeps current input", async () => {
    const { t, seeded, scan } = await fixture();
    await t.run(async (ctx) => {
      // Deliberately exceed a normal input's 20-chunk cap to test cleanup's
      // independent continuation budget, not a producer validation bypass.
      for (let ordinal = 1; ordinal < 25; ordinal++)
        await ctx.db.insert("reportRollupInputChunk", {
          storeId: seeded.storeId,
          inputId: seeded.oldInputId,
          ordinal,
          rows: [],
        });
    });
    const first = await t.run((ctx) =>
      cleanupObsoleteRollupInputBatchWithCtx(
        ctx,
        { storeId: seeded.storeId, cursor: null },
        10,
      ),
    );
    expect(first).toMatchObject({
      done: false,
      deletedChunks: 20,
      deletedInputs: 0,
      cursor: null,
    });
    expect(
      await t.run((ctx) => ctx.db.get("reportRollupInput", seeded.oldInputId)),
    ).not.toBeNull();
    await scan();
    expect(
      await t.run((ctx) => ctx.db.get("reportRollupInput", seeded.oldInputId)),
    ).toBeNull();
    expect(
      await t.run((ctx) => ctx.db.get("reportRollupInput", seeded.inputId)),
    ).not.toBeNull();
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("reportRollupInputChunk")
          .withIndex("by_inputId_ordinal", (q) =>
            q.eq("inputId", seeded.oldInputId),
          )
          .first(),
      ),
    ).toBeNull();
  });

  it.each(["configured-state", "unknown-epoch-state", "proof"] as const)(
    "retains every %s reference, even an obsolete proof during drift",
    async (kind) => {
      const { t, seeded, scan } = await fixture();
      await t.run(async (ctx) => {
        if (kind === "proof")
          await ctx.db.insert("reportRollupParity", {
            storeId: seeded.storeId,
            epoch: "old-proof",
            controlFence: 1,
            sourceWatermark: 1,
            phase: "inputs",
            inputId: seeded.oldInputId,
            cursor: null,
            chunkOrdinal: 0,
            rowOffset: 0,
            inputRows: 0,
            checkpointRows: 0,
            outputRows: 0,
            updatedAt: 1,
          });
        else
          await ctx.db.insert("reportRollupDayState", {
            storeId: seeded.storeId,
            epoch: kind === "configured-state" ? "gc" : "unknown",
            operatingDate: DAY,
            inputId: seeded.oldInputId,
            revision: 1,
            phase: "apply",
            nextChunk: 0,
            deleteCursor: null,
            updatedAt: 1,
          });
      });
      await scan();
      expect(
        await t.run((ctx) =>
          ctx.db.get("reportRollupInput", seeded.oldInputId),
        ),
      ).not.toBeNull();
      expect(
        await t.run((ctx) =>
          ctx.db
            .query("reportRollupInputChunk")
            .withIndex("by_inputId_ordinal", (q) =>
              q.eq("inputId", seeded.oldInputId),
            )
            .first(),
        ),
      ).not.toBeNull();
    },
  );

  it("preserves paused/reseeding stores and rolls child deletions back on failure", async () => {
    const { t, seeded, scan } = await fixture();
    await t.run((ctx) =>
      ctx.db.patch("reportPipelineControl", seeded.controlId, {
        mode: "paused",
      }),
    );
    await scan();
    expect(
      await t.run((ctx) => ctx.db.get("reportRollupInput", seeded.oldInputId)),
    ).not.toBeNull();
    await t.run(async (ctx) => {
      await ctx.db.patch("reportPipelineControl", seeded.controlId, {
        mode: "shadow",
      });
      await ctx.db.patch("store", seeded.storeId, {
        reportingReseedStartedAt: 1,
      });
    });
    await scan();
    expect(
      await t.run((ctx) => ctx.db.get("reportRollupInput", seeded.oldInputId)),
    ).not.toBeNull();
    await t.run((ctx) =>
      ctx.db.patch("store", seeded.storeId, {
        reportingReseedStartedAt: undefined,
      }),
    );
    await expect(
      t.run(async (ctx) => {
        await cleanupObsoleteRollupInputBatchWithCtx(
          ctx,
          { storeId: seeded.storeId, cursor: null },
          10,
        );
        throw new Error("cleanup failed");
      }),
    ).rejects.toThrow("cleanup failed");
    expect(
      await t.run((ctx) => ctx.db.get("reportRollupInput", seeded.oldInputId)),
    ).not.toBeNull();
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("reportRollupInputChunk")
          .withIndex("by_inputId_ordinal", (q) =>
            q.eq("inputId", seeded.oldInputId),
          )
          .first(),
      ),
    ).not.toBeNull();
  });
});
