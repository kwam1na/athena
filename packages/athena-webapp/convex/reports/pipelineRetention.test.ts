/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "../schema";
import { seedDailyClose, seedStore } from "./reseedTestSupport";
import { publishCloseLifecycleWithCtx } from "./closeEvidence";
import { makeFunctionReference } from "convex/server";
import type { Id } from "../_generated/dataModel";
import { dispatchRetentionWithCtx } from "./pipelineRetention";
import { REPORTS_SWEEP_STORE_ALLOWLIST_ENV } from "./pipelineAllowlist";
const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../")
      ? path.replace(/^\.\.\//, "./")
      : path.replace(/^\.\//, "./reports/"),
    loader,
  ]),
);
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
describe("bounded retention", () => {
  it("retains a poisoned close but advances to healthy later cleanup", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const s = await seedStore(ctx, "UTC"),
        other = await seedStore(ctx, "UTC");
      await ctx.db.insert("reportPipelineControl", {
        storeId: s.storeId,
        mode: "active",
        fence: 1,
        sourceWatermark: 0,
      });
      const headers = [];
      for (let i = 0; i < 2; i++) {
        const closeId = await seedDailyClose(ctx, s, {
          operatingDate: `2026-08-0${i + 1}`,
          completedAt: 100,
          salesTotal: 0,
        });
        const source = (await ctx.db.get("dailyClose", closeId))!;
        const header = await publishCloseLifecycleWithCtx(ctx, source, 1000);
        await ctx.db.patch("reportCloseEvidence", header._id, {
          expectedGeneration: 2,
        });
        const childId = await ctx.db.insert("reportCloseEvidenceChunk", {
          storeId: i === 0 ? other.storeId : s.storeId,
          headerId: header._id,
          generation: 1,
          ordinal: 0,
          items: [],
        });
        headers.push({ headerId: header._id, childId });
      }
      return { storeId: s.storeId, headers };
    });
    vi.stubEnv(REPORTS_SWEEP_STORE_ALLOWLIST_ENV, String(ids.storeId));
    const run = async (now: number) => {
      vi.mocked(Date.now).mockReturnValue(now);
      await t.run((ctx) => dispatchRetentionWithCtx(ctx, ids.storeId, now));
      const row = await t.run((ctx) =>
        ctx.db
          .query("reportPipelineRetention")
          .withIndex("by_storeId_lane", (q) =>
            q.eq("storeId", ids.storeId).eq("lane", "close"),
          )
          .unique(),
      );
      await t.action(
        makeFunctionReference<
          "action",
          {
            storeId: Id<"store">;
            workId: Id<"reportPipelineRetention">;
            lane: "close";
            fence: number;
            controlFence: number;
          }
        >("reports/pipelineRetention:runRetention"),
        {
          storeId: ids.storeId,
          workId: row!._id,
          lane: "close",
          fence: row!.fence,
          controlFence: 1,
        },
      );
    };
    await run(1000);
    expect(
      await t.run((ctx) =>
        ctx.db.get("reportCloseEvidence", ids.headers[0].headerId),
      ),
    ).toMatchObject({ cleanupBlocked: true });
    expect(
      await t.run((ctx) =>
        ctx.db.get("reportCloseEvidenceChunk", ids.headers[0].childId),
      ),
    ).not.toBeNull();
    await run(901001);
    expect(
      await t.run((ctx) =>
        ctx.db.get("reportCloseEvidenceChunk", ids.headers[1].childId),
      ),
    ).toBeNull();
  });
  it("leases separate close/input cleanup lanes and reclaims dropped dispatch", async () => {
    const t = convexTest(schema, modules);
    const s = await t.run(async (ctx) => {
      const seeded = await seedStore(ctx, "UTC");
      await ctx.db.insert("reportPipelineControl", {
        storeId: seeded.storeId,
        mode: "active",
        fence: 1,
        sourceWatermark: 0,
      });
      return seeded;
    });
    vi.stubEnv(REPORTS_SWEEP_STORE_ALLOWLIST_ENV, String(s.storeId));
    expect(
      await t.run((ctx) => dispatchRetentionWithCtx(ctx, s.storeId, 100)),
    ).toBe(2);
    expect(
      await t.run((ctx) => dispatchRetentionWithCtx(ctx, s.storeId, 101)),
    ).toBe(0);
    expect(
      await t.run((ctx) => dispatchRetentionWithCtx(ctx, s.storeId, 60101)),
    ).toBe(2);
    expect(
      await t.run((ctx) => ctx.db.query("reportPipelineRetention").take(3)),
    ).toHaveLength(2);
  });
});
