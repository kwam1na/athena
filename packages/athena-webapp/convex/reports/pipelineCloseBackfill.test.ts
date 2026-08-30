/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../schema";
import { seedDailyClose, seedStore } from "./reseedTestSupport";
import {
  backfillCloseWeeklyPageWithCtx,
  verifyCloseCoveragePageWithCtx,
} from "./pipelineCloseBackfill";
import { materializeCloseEvidenceWithCtx } from "./closeEvidence";
import { recordReadCosts } from "./readCostTestSupport";
import { enqueueReportWork } from "./pipelineWork";
const modules = import.meta.glob("../**/*.ts");
const NOW = Date.parse("2026-08-29T20:00:00Z");

describe("bounded close and weekly migration", () => {
  it("retains canonical work for a quiet close without a day and preserves a leased retry", async () => {
    const t = convexTest(schema, modules);
    const store = await t.run(async (ctx) => {
      const store = await seedStore(ctx);
      await seedDailyClose(ctx, store, {
        operatingDate: "2026-01-03",
        completedAt: NOW - 1000,
        salesTotal: 0,
      });
      return store;
    });
    expect(await t.run((ctx) => ctx.db.query("reportDay").first())).toBeNull();
    expect(
      await t.run((ctx) => ctx.db.query("reportDirtyDay").first()),
    ).toBeNull();
    const args = {
      storeId: store.storeId,
      phase: "closes" as const,
      cursor: null,
      now: NOW,
    };
    await t.run((ctx) => backfillCloseWeeklyPageWithCtx(ctx, args));
    const mark = await t.run((ctx) =>
      ctx.db
        .query("reportDirtyDay")
        .withIndex("by_storeId_operatingDate", (q) =>
          q.eq("storeId", store.storeId).eq("operatingDate", "2026-01-03"),
        )
        .unique(),
    );
    expect(mark).toMatchObject({
      operatingDate: "2026-01-03",
      reason: "fold_version_bump",
    });
    if (!mark) throw new Error("Missing canonical obligation");
    await t.run((ctx) =>
      ctx.db.patch("reportDirtyDay", mark._id, {
        claimedAt: NOW,
        eligibleAt: NOW + 60000,
        dispatchFence: 4,
      }),
    );
    const leased = await t.run((ctx) => ctx.db.get("reportDirtyDay", mark._id));
    await t.run((ctx) =>
      backfillCloseWeeklyPageWithCtx(ctx, { ...args, now: NOW + 1 }),
    );
    expect(
      await t.run((ctx) => ctx.db.get("reportDirtyDay", mark._id)),
    ).toEqual(leased);
  });

  it("resumes all-history pages and rolls back handoffs when the parent checkpoint fails", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const store = await seedStore(ctx);
      for (let index = 1; index <= 19; index++)
        await seedDailyClose(ctx, store, {
          operatingDate: `2026-07-${String(index).padStart(2, "0")}`,
          completedAt: NOW - index,
          salesTotal: 0,
        });
      return store;
    });
    await expect(
      t.run(async (ctx) => {
        await backfillCloseWeeklyPageWithCtx(ctx, {
          storeId: seeded.storeId,
          phase: "closes",
          cursor: null,
          now: NOW,
        });
        throw new Error("checkpoint failure");
      }),
    ).rejects.toThrow("checkpoint failure");
    expect(
      await t.run((ctx) => ctx.db.query("reportCloseEvidence").take(1)),
    ).toEqual([]);
    let cursor: string | null = null;
    for (let index = 0; index < 19; index++) {
      const page = await t.run((ctx) =>
        backfillCloseWeeklyPageWithCtx(ctx, {
          storeId: seeded.storeId,
          phase: "closes",
          cursor,
          now: NOW + index,
        }),
      );
      expect(page.processed).toBe(1);
      cursor = page.nextCursor;
      if (index === 18) expect(page.nextPhase).toBe("days");
    }
    expect(
      await t.run((ctx) => ctx.db.query("reportCloseEvidence").take(20)),
    ).toHaveLength(19);
  });

  it("refuses foreign companion ownership and a legacy cutoff conflict without partial conversion", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const store = await seedStore(ctx);
      const foreign = await seedStore(ctx);
      const closeId = await seedDailyClose(ctx, store, {
        operatingDate: "2026-08-29",
        completedAt: NOW,
        salesTotal: 0,
      });
      return { ...store, foreignId: foreign.storeId, closeId };
    });
    await t.run((ctx) =>
      backfillCloseWeeklyPageWithCtx(ctx, {
        storeId: seeded.storeId,
        phase: "closes",
        cursor: null,
        now: NOW,
      }),
    );
    await t.run(async (ctx) => {
      const header = (await ctx.db.query("reportCloseEvidence").first())!;
      await ctx.db.patch("reportCloseEvidence", header._id, {
        storeId: seeded.foreignId,
      });
    });
    expect(
      (
        await t.run((ctx) =>
          verifyCloseCoveragePageWithCtx(ctx, {
            storeId: seeded.storeId,
            cursor: null,
          }),
        )
      ).issues[0]?.reason,
    ).toBe("ownership_mismatch");
    await expect(
      t.run((ctx) =>
        backfillCloseWeeklyPageWithCtx(ctx, {
          storeId: seeded.storeId,
          phase: "closes",
          cursor: null,
          now: NOW,
        }),
      ),
    ).rejects.toThrow("ownership_mismatch");
    await t.run(async (ctx) => {
      await enqueueReportWork(
        ctx,
        {
          storeId: seeded.storeId,
          kind: "accept",
          cycleStartDate: "2026-08-24",
          closeId: seeded.closeId,
          cutoffObservedAt: NOW - 100,
        },
        NOW,
      );
      await ctx.db.insert("reportDirtyWeek", {
        storeId: seeded.storeId,
        reason: "acceptance_requested",
        markedAt: NOW,
        intent: {
          cycleStartDate: "2026-08-24",
          closeId: seeded.closeId,
          cutoffObservedAt: NOW,
        },
      });
    });
    const before = await t.run((ctx) =>
      ctx.db.query("reportPipelineWork").take(10),
    );
    await expect(
      t.run((ctx) =>
        backfillCloseWeeklyPageWithCtx(ctx, {
          storeId: seeded.storeId,
          phase: "legacy-week",
          cursor: null,
          now: NOW,
        }),
      ),
    ).rejects.toThrow("cutoff_conflict");
    expect(
      await t.run((ctx) => ctx.db.query("reportPipelineWork").take(10)),
    ).toEqual(before);
  });
  it("replays a one-close page without resetting work and detects lifecycle changes", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const store = await seedStore(ctx);
      const closeId = await seedDailyClose(ctx, store, {
        operatingDate: "2026-08-29",
        completedAt: NOW,
        salesTotal: 0,
      });
      return { ...store, closeId };
    });
    const page = await t.run(async (ctx) => {
      const r = recordReadCosts(ctx);
      const result = await backfillCloseWeeklyPageWithCtx(r.ctx, {
        storeId: seeded.storeId,
        phase: "closes",
        cursor: null,
        now: NOW,
      });
      return { result, reads: r.snapshot() };
    });
    expect(page.reads.byTable.dailyClose.returnedDocuments).toBe(1);
    const before = await t.run((ctx) =>
      ctx.db.query("reportPipelineWork").take(10),
    );
    await t.run((ctx) =>
      backfillCloseWeeklyPageWithCtx(ctx, {
        storeId: seeded.storeId,
        phase: "closes",
        cursor: null,
        now: NOW + 1,
      }),
    );
    expect(
      await t.run((ctx) => ctx.db.query("reportPipelineWork").take(10)),
    ).toEqual(before);
    expect(
      (
        await t.run((ctx) =>
          verifyCloseCoveragePageWithCtx(ctx, {
            storeId: seeded.storeId,
            cursor: null,
          }),
        )
      ).issues[0]?.reason,
    ).toBe("pending");
    await t.run((ctx) =>
      materializeCloseEvidenceWithCtx(ctx, {
        storeId: seeded.storeId,
        closeId: seeded.closeId,
        expectedGeneration: 1,
      }),
    );
    expect(
      (
        await t.run((ctx) =>
          verifyCloseCoveragePageWithCtx(ctx, {
            storeId: seeded.storeId,
            cursor: null,
          }),
        )
      ).issues,
    ).toEqual([]);
    await t.run((ctx) =>
      ctx.db.patch("dailyClose", seeded.closeId, {
        lifecycleStatus: "reopened",
        reopenedAt: NOW + 2,
      }),
    );
    expect(
      (
        await t.run((ctx) =>
          verifyCloseCoveragePageWithCtx(ctx, {
            storeId: seeded.storeId,
            cursor: null,
          }),
        )
      ).issues[0]?.reason,
    ).toBe("source_changed");
    await t.run((ctx) =>
      backfillCloseWeeklyPageWithCtx(ctx, {
        storeId: seeded.storeId,
        phase: "closes",
        cursor: null,
        now: NOW + 3,
      }),
    );
    expect(
      (await t.run((ctx) => ctx.db.query("reportCloseEvidence").first()))
        ?.expectedGeneration,
    ).toBe(2);
  });

  it("preserves legacy intent cutoff and every retained historical date without touching baselines", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const store = await seedStore(ctx);
      const closeId = await seedDailyClose(ctx, store, {
        operatingDate: "2026-08-29",
        completedAt: NOW,
        salesTotal: 0,
      });
      await ctx.db.insert("reportDirtyWeek", {
        storeId: store.storeId,
        reason: "acceptance_requested",
        markedAt: NOW,
        intent: {
          cycleStartDate: "2026-08-24",
          closeId,
          cutoffObservedAt: NOW - 100,
        },
        foldedDates: ["2026-01-03", "2026-02-07", "2026-03-07"],
      });
      return store;
    });
    const args = {
      storeId: seeded.storeId,
      phase: "legacy-week" as const,
      cursor: null,
      now: NOW,
    };
    expect(
      (await t.run((ctx) => backfillCloseWeeklyPageWithCtx(ctx, args))).done,
    ).toBe(true);
    const before = await t.run((ctx) =>
      ctx.db.query("reportPipelineWork").take(10),
    );
    expect(
      before.filter((row) => row.kind === "resolve-week-date"),
    ).toHaveLength(3);
    expect(before.find((row) => row.kind === "accept")).toMatchObject({
      cutoffObservedAt: NOW - 100,
    });
    await t.run((ctx) => backfillCloseWeeklyPageWithCtx(ctx, args));
    expect(
      await t.run((ctx) => ctx.db.query("reportPipelineWork").take(10)),
    ).toEqual(before);
    expect(
      await t.run((ctx) => ctx.db.query("reportWeekAccepted").take(1)),
    ).toEqual([]);
    expect(
      await t.run((ctx) => ctx.db.query("reportDirtyWeek").take(1)),
    ).toHaveLength(1);
  });
});
