/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";

import schema from "../schema";
import { markDirty } from "./marks";
import { seedStore } from "./reseedTestSupport";
import {
  claimDayWorkWithCtx,
  failDayWorkWithCtx,
  processDayWorkWithCtx,
  REPORT_DAY_LEASE_MS,
} from "./pipelineDays";
import {
  selectPipelineStores,
  REPORT_PIPELINE_STORES_PER_LANE,
} from "./pipelineDispatch";
import { REPORTS_SWEEP_STORE_ALLOWLIST_ENV } from "./sweeper";
import { recordReadCosts } from "./readCostTestSupport";

const modules = import.meta.glob("../**/*.ts");
afterEach(() => vi.unstubAllEnvs());

async function activeStore(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const seeded = await seedStore(ctx, "UTC");
    await ctx.db.insert("reportPipelineControl", {
      storeId: seeded.storeId,
      mode: "active",
      fence: 1,
      sourceWatermark: 0,
    });
    return seeded;
  });
}

describe("reports isolated day work", () => {
  it("retains the oldest obligation while fencing every new producer signal", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const { storeId } = await seedStore(ctx, "UTC");
      await markDirty(ctx, storeId, "2026-07-01", "day_open", 100);
      await markDirty(ctx, storeId, "2026-07-01", "close_accepted", 200);
      const mark = await ctx.db
        .query("reportDirtyDay")
        .withIndex("by_storeId_operatingDate", (q) =>
          q.eq("storeId", storeId).eq("operatingDate", "2026-07-01"),
        )
        .unique();
      expect(mark).toMatchObject({
        reason: "close_accepted",
        generation: 2,
        firstMarkedAt: 100,
        markedAt: 200,
        eligibleAt: 200,
      });
    });
  });

  it("rotates allowed stores independently of saturated foreign work", async () => {
    const t = convexTest(schema, modules);
    const ids = [];
    for (
      let index = 0;
      index < REPORT_PIPELINE_STORES_PER_LANE + 2;
      index += 1
    ) {
      ids.push((await activeStore(t)).storeId);
    }
    vi.stubEnv(REPORTS_SWEEP_STORE_ALLOWLIST_ENV, ids.join(","));
    const seen = new Set<string>();
    for (let pass = 0; pass < 2; pass += 1) {
      await t.run(async (ctx) => {
        const recorder = recordReadCosts(ctx);
        const stores = await selectPipelineStores(recorder.ctx, "fold", 100);
        expect(stores).toHaveLength(REPORT_PIPELINE_STORES_PER_LANE);
        stores.forEach((id) => seen.add(id));
        expect(Object.keys(recorder.snapshot().byTable)).toEqual([
          "reportPipelineCursor",
        ]);
      });
    }
    expect(seen.size).toBe(ids.length);
  });

  it("leases one day, recovers dropped dispatch, and refuses the old fence", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await activeStore(t);
    vi.stubEnv(REPORTS_SWEEP_STORE_ALLOWLIST_ENV, String(storeId));
    await t.run((ctx) =>
      markDirty(ctx, storeId, "2026-07-01", "late_fact", 100),
    );
    const first = await t.run((ctx) => claimDayWorkWithCtx(ctx, storeId, 100));
    expect(first).not.toBeNull();
    expect(
      await t.run((ctx) => claimDayWorkWithCtx(ctx, storeId, 101)),
    ).toBeNull();
    const recovered = await t.run((ctx) =>
      claimDayWorkWithCtx(ctx, storeId, 101 + REPORT_DAY_LEASE_MS),
    );
    expect(recovered?.dispatchFence).toBe(first!.dispatchFence + 1);
    expect(
      await t.run((ctx) =>
        processDayWorkWithCtx(ctx, first!, 102 + REPORT_DAY_LEASE_MS),
      ),
    ).toBe("stale");
    expect(
      await t.run((ctx) =>
        processDayWorkWithCtx(ctx, recovered!, 102 + REPORT_DAY_LEASE_MS),
      ),
    ).toBe("applied");
    const kinds = await t.run(async (ctx) =>
      (
        await ctx.db
          .query("reportPipelineWork")
          .withIndex("by_storeId_workKey", (q) => q.eq("storeId", storeId))
          .take(10)
      ).map((row) => row.kind),
    );
    expect(kinds.sort()).toEqual([
      "current",
      "overview",
      "resolve-week-date",
      "rollup",
    ]);
  });

  it("cannot clear a newer producer signal and backs poison work off behind another day", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await activeStore(t);
    vi.stubEnv(REPORTS_SWEEP_STORE_ALLOWLIST_ENV, String(storeId));
    await t.run((ctx) =>
      markDirty(ctx, storeId, "2026-07-01", "late_fact", 100),
    );
    const old = await t.run((ctx) => claimDayWorkWithCtx(ctx, storeId, 100));
    await t.run((ctx) =>
      markDirty(ctx, storeId, "2026-07-01", "close_accepted", 101),
    );
    expect(await t.run((ctx) => processDayWorkWithCtx(ctx, old!, 102))).toBe(
      "stale",
    );
    expect(
      await t.run((ctx) =>
        failDayWorkWithCtx(ctx, old!, "unexpected_failure", 102),
      ),
    ).toBe("stale");
    const fresh = await t.run((ctx) => claimDayWorkWithCtx(ctx, storeId, 102));
    expect(fresh?.generation).toBe(old!.generation + 1);
    expect(
      await t.run((ctx) =>
        failDayWorkWithCtx(ctx, fresh!, "capacity_exceeded", 103),
      ),
    ).toBe("applied");
    await t.run((ctx) =>
      markDirty(ctx, storeId, "2026-07-02", "late_fact", 104),
    );
    expect(
      (await t.run((ctx) => claimDayWorkWithCtx(ctx, storeId, 105)))
        ?.operatingDate,
    ).toBe("2026-07-02");
  });

  it("defers a reseeding store without consuming its dirty day", async () => {
    const t = convexTest(schema, modules);
    const { storeId } = await activeStore(t);
    vi.stubEnv(REPORTS_SWEEP_STORE_ALLOWLIST_ENV, String(storeId));
    await t.run(async (ctx) => {
      await markDirty(ctx, storeId, "2026-07-01", "reseed", 100);
      await ctx.db.patch("store", storeId, { reportingReseedStartedAt: 100 });
    });
    expect(
      await t.run((ctx) => claimDayWorkWithCtx(ctx, storeId, 101)),
    ).toBeNull();
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("reportDirtyDay")
          .withIndex("by_storeId_operatingDate", (q) =>
            q.eq("storeId", storeId),
          )
          .unique(),
      ),
    ).not.toBeNull();
  });
});
