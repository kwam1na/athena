/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "../schema";
import type { MutationCtx } from "../_generated/server";
import { seedStore } from "./reseedTestSupport";
import {
  captureRollupInputWithCtx,
  initializeRollupEpochWithCtx,
} from "./rollupPipeline";
import { applyRollupWithCtx } from "./rollupWorkers";
import { claimReportWorkWithCtx } from "./pipelineWork";
import type { PipelineWorkerClaim } from "./pipelineWorkers";
import { REPORTS_SWEEP_STORE_ALLOWLIST_ENV } from "./sweeper";
import { readEpochPeriodResultWithCtx } from "./rollupPeriodRead";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../")
      ? path.replace(/^\.\.\//, "./")
      : path.replace(/^\.\//, "./reports/"),
    loader,
  ]),
);
const NOW = Date.parse("2026-08-29T12:00:00Z");
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
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
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
      { storeId: seeded.storeId, epoch: "worker" },
      NOW,
    );
    await captureRollupInputWithCtx(
      ctx,
      {
        storeId: seeded.storeId,
        operatingDate: DAY,
        revision: 1,
        skuDays: new Map([[seeded.skuId, measures]]),
      },
      NOW,
    );
    const result = await claimReportWorkWithCtx(
      ctx,
      { storeId: seeded.storeId, kind: "rollup" },
      NOW,
    );
    return {
      ...seeded,
      controlId,
      claim: { ...result.claims[0], controlFence: 2 },
    };
  });
  vi.stubEnv(REPORTS_SWEEP_STORE_ALLOWLIST_ENV, String(seeded.storeId));
  return { t, seeded };
}
function schedulingCtx(
  ctx: MutationCtx,
  scheduled: PipelineWorkerClaim[],
): MutationCtx {
  return {
    ...ctx,
    scheduler: {
      ...ctx.scheduler,
      runAfter: vi.fn(async (_delay, _reference, args) => {
        scheduled.push(args as PipelineWorkerClaim);
        return "scheduled" as never;
      }),
    },
  };
}

describe("fenced rollup worker", () => {
  it.each(["missing chunk", "missing readiness", "invalid header"] as const)(
    "blocks %s without partial public totals and recovers on a valid new generation",
    async (failure) => {
      const { t, seeded } = await fixture();
      vi.spyOn(Date, "now").mockReturnValue(NOW);
      await t.run(async (ctx) => {
        await ctx.db.patch("reportPipelineControl", seeded.controlId, {
          mode: "active",
          activeRollupEpoch: "worker",
        });
        const epoch = await ctx.db
          .query("reportRollupEpoch")
          .withIndex("by_storeId_epoch", (q) =>
            q.eq("storeId", seeded.storeId).eq("epoch", "worker"),
          )
          .unique();
        await ctx.db.patch("reportRollupEpoch", epoch!._id, {
          backfillComplete: true,
        });
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
        if (failure === "missing chunk")
          await ctx.db.delete("reportRollupInputChunk", chunk!._id);
        else if (failure === "invalid header")
          await ctx.db.patch("reportRollupInput", pointer!.inputId, {
            chunkCount: 0,
          });
        else {
          const gate = await ctx.db
            .query("reportPeriodReadiness")
            .withIndex("by_storeId_epoch_periodKey", (q) =>
              q
                .eq("storeId", seeded.storeId)
                .eq("epoch", "worker")
                .eq("periodKey", "m:2026-08"),
            )
            .unique();
          await ctx.db.delete("reportPeriodReadiness", gate!._id);
        }
      });
      await t.action(
        makeFunctionReference<"action", PipelineWorkerClaim>(
          "reports/rollupWorkers:runRollup",
        ),
        seeded.claim,
      );
      expect(
        await t.run((ctx) =>
          ctx.db.get("reportPipelineWork", seeded.claim.workId),
        ),
      ).toMatchObject({
        status: "blocked",
        lastFailure: { code: "invalid_evidence" },
      });
      expect(
        await t.run((ctx) =>
          readEpochPeriodResultWithCtx(
            ctx,
            {
              storeId: seeded.storeId,
              periodKey: "m:2026-08",
              sortBy: "revenue",
            },
            null,
          ),
        ),
      ).toEqual({
        status: "blocked",
        reason: "repair_required",
        rows: [],
        continueCursor: null,
      });
      const next = await t.run(async (ctx) => {
        await captureRollupInputWithCtx(
          ctx,
          {
            storeId: seeded.storeId,
            operatingDate: DAY,
            revision: 2,
            skuDays: new Map([[seeded.skuId, measures]]),
          },
          NOW,
        );
        return claimReportWorkWithCtx(
          ctx,
          { storeId: seeded.storeId, kind: "rollup" },
          NOW,
        );
      });
      const scheduled = next.claims.map((claim) => ({
        ...claim,
        controlFence: 2,
      }));
      expect(
        await t.mutation(
          makeFunctionReference<
            "mutation",
            PipelineWorkerClaim & { code: "invalid_evidence" }
          >("reports/rollupWorkers:recordRollupFailure"),
          { ...seeded.claim, code: "invalid_evidence" },
        ),
      ).toBe("stale");
      expect(
        (
          await t.run((ctx) =>
            readEpochPeriodResultWithCtx(
              ctx,
              {
                storeId: seeded.storeId,
                periodKey: "m:2026-08",
                sortBy: "revenue",
              },
              null,
            ),
          )
        )?.status,
      ).toBe("pending");
      for (let i = 0; i < scheduled.length; i++) {
        if (i > 5) throw new Error("unbounded continuation");
        await t.run((ctx) =>
          applyRollupWithCtx(schedulingCtx(ctx, scheduled), scheduled[i], NOW),
        );
      }
      expect(
        (
          await t.run((ctx) =>
            readEpochPeriodResultWithCtx(
              ctx,
              {
                storeId: seeded.storeId,
                periodKey: "m:2026-08",
                sortBy: "revenue",
              },
              null,
            ),
          )
        )?.status,
      ).toBe("ready");
    },
  );

  it("commits one chunk with durable continuation, rejects duplicate delivery and then acknowledges", async () => {
    const { t, seeded } = await fixture();
    const scheduled: PipelineWorkerClaim[] = [];
    const evidence = () =>
      t.run((ctx) =>
        ctx.db
          .query("scheduledRunLedger")
          .withIndex("by_storeId_cronFamily_window", (q) =>
            q
              .eq("storeId", seeded.storeId)
              .eq("cronFamily", "reports-pipeline-rollup"),
          )
          .unique(),
      );
    expect(
      await t.run((ctx) =>
        applyRollupWithCtx(schedulingCtx(ctx, scheduled), seeded.claim, NOW),
      ),
    ).toBe("applied");
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].generation).toBeGreaterThan(seeded.claim.generation);
    expect(await evidence()).toMatchObject({
      processedCount: 1,
      snapshotCounts: { applied: 1 },
    });
    expect(
      await t.run((ctx) =>
        applyRollupWithCtx(schedulingCtx(ctx, scheduled), seeded.claim, NOW),
      ),
    ).toBe("stale");
    expect(await evidence()).toMatchObject({
      processedCount: 1,
      snapshotCounts: { applied: 1 },
    });
    for (let i = 0; i < scheduled.length; i++) {
      if (i > 5) throw new Error("unbounded continuation");
      await t.run((ctx) =>
        applyRollupWithCtx(schedulingCtx(ctx, scheduled), scheduled[i], NOW),
      );
      expect(await evidence()).toMatchObject({
        processedCount: i + 2,
        snapshotCounts: { applied: i + 2 },
      });
    }
    await t.run(async (ctx) => {
      expect(
        await ctx.db.get("reportPipelineWork", seeded.claim.workId),
      ).toBeNull();
      const output = await ctx.db
        .query("reportEpochSkuRollup")
        .withIndex("by_storeId_epoch_periodKey_productSkuId", (q) =>
          q
            .eq("storeId", seeded.storeId)
            .eq("epoch", "worker")
            .eq("periodKey", "m:2026-08"),
        )
        .unique();
      expect(output?.netSalesMinor).toBe(100);
    });
  });

  it("refuses a superseded generation and post-claim control changes before output", async () => {
    const { t, seeded } = await fixture();
    const scheduled: PipelineWorkerClaim[] = [];
    await t.run((ctx) =>
      ctx.db.patch("reportPipelineControl", seeded.controlId, { fence: 3 }),
    );
    expect(
      await t.run((ctx) =>
        applyRollupWithCtx(schedulingCtx(ctx, scheduled), seeded.claim, NOW),
      ),
    ).toBe("deferred");
    await t.run((ctx) =>
      captureRollupInputWithCtx(
        ctx,
        {
          storeId: seeded.storeId,
          operatingDate: DAY,
          revision: 2,
          skuDays: new Map([
            [seeded.skuId, { ...measures, netSalesMinor: 999 }],
          ]),
        },
        NOW,
      ),
    );
    expect(
      await t.run((ctx) =>
        applyRollupWithCtx(schedulingCtx(ctx, scheduled), seeded.claim, NOW),
      ),
    ).toBe("stale");
    expect(scheduled).toHaveLength(0);
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("reportEpochSkuRollup")
          .withIndex("by_storeId_epoch_periodKey_productSkuId", (q) =>
            q.eq("storeId", seeded.storeId),
          )
          .first(),
      ),
    ).toBeNull();
  });

  it("rolls a thrown continuation handoff back and records failure separately without partial output", async () => {
    const { t, seeded } = await fixture();
    await expect(
      t.run((ctx) =>
        applyRollupWithCtx(
          {
            ...ctx,
            scheduler: {
              ...ctx.scheduler,
              runAfter: vi.fn(async () => {
                throw new Error("handoff fault");
              }),
            },
          },
          seeded.claim,
          NOW,
        ),
      ),
    ).rejects.toThrow("handoff fault");
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("reportEpochSkuRollup")
          .withIndex("by_storeId_epoch_periodKey_productSkuId", (q) =>
            q.eq("storeId", seeded.storeId),
          )
          .first(),
      ),
    ).toBeNull();
    vi.spyOn(Date, "now").mockReturnValue(NOW + 60_001);
    await t.mutation(
      makeFunctionReference<
        "mutation",
        PipelineWorkerClaim & { code: "unexpected_failure" }
      >("reports/rollupWorkers:recordRollupFailure"),
      { ...seeded.claim, code: "unexpected_failure" },
    );
    expect(
      await t.run((ctx) =>
        ctx.db.get("reportPipelineWork", seeded.claim.workId),
      ),
    ).toMatchObject({
      attempts: 1,
      status: "pending",
      lastFailure: { code: "unexpected_failure" },
    });
  });
});
