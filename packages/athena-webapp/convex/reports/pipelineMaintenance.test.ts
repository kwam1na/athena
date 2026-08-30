/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../schema";
import { seedStore } from "./reseedTestSupport";
import { purgePipelineBatchWithCtx } from "./pipelineMaintenance";
const modules = import.meta.glob("../**/*.ts");
describe("pipeline lifecycle purge", () => {
  it("fences workers, drains children before parents, and preserves other stores", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const s = await seedStore(ctx, "UTC"),
        other = await seedStore(ctx, "UTC");
      const control = await ctx.db.insert("reportPipelineControl", {
        storeId: s.storeId,
        mode: "active",
        fence: 3,
        sourceWatermark: 1,
        activeRollupEpoch: "old",
      });
      const inputId = await ctx.db.insert("reportRollupInput", {
        storeId: s.storeId,
        operatingDate: "2026-08-01",
        revision: 1,
        rowCount: 0,
        chunkCount: 3,
        digest: "fixture",
        createdAt: 1,
      });
      for (let i = 0; i < 3; i++)
        await ctx.db.insert("reportRollupInputChunk", {
          storeId: s.storeId,
          inputId,
          ordinal: i,
          rows: [],
        });
      const foreign = await ctx.db.insert("reportWeekInventory", {
        storeId: other.storeId,
        frameKey: "other",
        materializedAt: 1,
        attention: {
          carriedForwardCount: 0,
          completeness: "complete",
          groups: [],
          newCount: 0,
          observedCount: 0,
          overflow: false,
        },
      });
      return { storeId: s.storeId, inputId, control, foreign };
    });
    expect(
      await t.run((ctx) =>
        purgePipelineBatchWithCtx(ctx, { storeId: ids.storeId, limit: 2 }, 100),
      ),
    ).toMatchObject({ deleted: 2, hasMore: true });
    expect(
      await t.run((ctx) => ctx.db.get("reportRollupInput", ids.inputId)),
    ).not.toBeNull();
    expect(
      await t.run((ctx) => ctx.db.get("reportPipelineControl", ids.control)),
    ).toMatchObject({ mode: "paused", fence: 4, hasActivated: true });
    let done = false;
    for (let i = 0; i < 20; i++) {
      const result = await t.run((ctx) =>
        purgePipelineBatchWithCtx(
          ctx,
          { storeId: ids.storeId, limit: 2 },
          101 + i,
        ),
      );
      if (!result.hasMore) {
        done = true;
        break;
      }
    }
    expect(done).toBe(true);
    expect(
      await t.run((ctx) => ctx.db.get("reportRollupInput", ids.inputId)),
    ).toBeNull();
    expect(
      await t.run((ctx) => ctx.db.get("reportWeekInventory", ids.foreign)),
    ).not.toBeNull();
    expect(
      await t.run((ctx) => ctx.db.get("reportPipelineControl", ids.control)),
    ).toMatchObject({ mode: "paused", fence: 4 });
  });
});
