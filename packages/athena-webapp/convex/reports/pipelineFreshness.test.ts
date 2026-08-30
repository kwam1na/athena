/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../schema";
import { seedStore } from "./reseedTestSupport";
import { markDirty } from "./marks";
import {
  enqueueReportWork,
  claimReportWorkWithCtx,
  failReportWorkWithCtx,
} from "./pipelineWork";
import { overviewProjectionStatus } from "./pipelineFreshness";

const modules = import.meta.glob("../**/*.ts");
describe("overview pending work posture", () => {
  it("does not present a paused or rebuilding formerly active snapshot as current", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const { storeId } = await seedStore(ctx, "UTC");
      const id = await ctx.db.insert("reportPipelineControl", {
        storeId,
        mode: "paused",
        fence: 2,
        sourceWatermark: 1,
        activeRollupEpoch: "old",
      });
      expect(await overviewProjectionStatus(ctx, storeId)).toBe("pending");
      await ctx.db.patch("reportPipelineControl", id, {
        activeRollupEpoch: undefined,
        hasActivated: true,
      });
      expect(await overviewProjectionStatus(ctx, storeId)).toBe("pending");
      await ctx.db.patch("reportPipelineControl", id, {
        mode: "shadow",
        targetRollupEpoch: "rebuild",
      });
      expect(await overviewProjectionStatus(ctx, storeId)).toBe("pending");
    });
  });
  it("distinguishes ready, dirty-day pending and downstream blocked without source reads", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const { storeId } = await seedStore(ctx, "UTC");
      expect(await overviewProjectionStatus(ctx, storeId)).toBe("ready");
      await markDirty(ctx, storeId, "2026-07-01", "late_fact", 100);
      expect(await overviewProjectionStatus(ctx, storeId)).toBe("pending");
      await enqueueReportWork(ctx, { storeId, kind: "overview" }, 100);
      const { claims } = await claimReportWorkWithCtx(
        ctx,
        { storeId, kind: "overview" },
        100,
      );
      await failReportWorkWithCtx(
        ctx,
        claims[0],
        { code: "capacity_exceeded", blocked: true },
        101,
      );
      expect(await overviewProjectionStatus(ctx, storeId)).toBe("blocked");
    });
  });
});
