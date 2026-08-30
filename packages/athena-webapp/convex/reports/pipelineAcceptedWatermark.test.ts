/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../schema";
import { seedStore } from "./reseedTestSupport";
import {
  acceptedScheduleProofChanged,
  bumpAcceptedWatermarkWithCtx,
} from "./pipelineAcceptedWatermark";
import { upsertStoreScheduleCommandWithCtx } from "../inventory/storeSchedule";
import { ensureSharedDemoStoreScheduleWithCtx } from "../sharedDemo/registerBaseline";
const modules = import.meta.glob("../**/*.ts");

describe("accepted baseline proof watermark", () => {
  it("invalidates an active schedule writer atomically but ignores a candidate", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const store = await seedStore(ctx);
      const controlId = await ctx.db.insert("reportPipelineControl", {
        storeId: store.storeId,
        mode: "active",
        fence: 1,
        sourceWatermark: 0,
        acceptedWatermark: 0,
      });
      return { ...store, controlId };
    });
    const args = {
      storeId: seeded.storeId,
      timezone: "UTC",
      weeklyWindows: [],
      weeklyClosedDays: [],
      dateExceptions: [],
      effectiveFrom: 0,
    };
    expect(
      await t.run((ctx) =>
        upsertStoreScheduleCommandWithCtx(ctx, {
          ...args,
          status: "candidate",
        }),
      ),
    ).toMatchObject({ kind: "ok" });
    expect(
      await t.run((ctx) =>
        ctx.db.get("reportPipelineControl", seeded.controlId),
      ),
    ).toMatchObject({ acceptedWatermark: 0 });
    expect(
      await t.run((ctx) => upsertStoreScheduleCommandWithCtx(ctx, args)),
    ).toMatchObject({ kind: "ok" });
    expect(
      await t.run((ctx) =>
        ctx.db.get("reportPipelineControl", seeded.controlId),
      ),
    ).toMatchObject({ acceptedWatermark: 1 });
    expect(
      await t.run((ctx) => ctx.db.query("reportPipelineWork").first()),
    ).toMatchObject({ kind: "current", status: "pending" });
  });

  it("ignores timestamp, timezone-version, candidate, and default-anchor-only changes", () => {
    const base = {
      storeId: "store" as never,
      timezone: "UTC",
      weeklyClosedDays: [0],
      dateExceptions: [],
      effectiveFrom: 0,
      status: "active" as const,
      updatedAt: 0,
    };
    const metadataOnly = {
      ...base,
      reportingCycleStartsOn: 1,
      updatedAt: 1,
      timezoneVersionId: "timezone",
    };
    expect(acceptedScheduleProofChanged(base, metadataOnly)).toBe(false);
    expect(
      acceptedScheduleProofChanged(null, { ...base, status: "candidate" }),
    ).toBe(false);
    expect(
      acceptedScheduleProofChanged(base, { ...base, effectiveTo: 100 }),
    ).toBe(true);
    expect(
      acceptedScheduleProofChanged(base, {
        ...base,
        timezone: "America/New_York",
      }),
    ).toBe(true);
    expect(
      acceptedScheduleProofChanged(base, { ...base, weeklyClosedDays: [] }),
    ).toBe(true);
  });

  it("invalidates semantic demo schedule replacement but not timestamp-only refresh", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const store = await seedStore(ctx);
      const source = (await ctx.db.get("store", store.storeId))!;
      const controlId = await ctx.db.insert("reportPipelineControl", {
        storeId: store.storeId,
        mode: "shadow",
        fence: 1,
        sourceWatermark: 0,
        acceptedWatermark: 0,
      });
      return { ...store, actorUserId: source.createdByUserId, controlId };
    });
    const schedule = await t.run((ctx) =>
      ensureSharedDemoStoreScheduleWithCtx(ctx, { ...seeded, now: 1 }),
    );
    expect(
      await t.run((ctx) =>
        ctx.db.get("reportPipelineControl", seeded.controlId),
      ),
    ).toMatchObject({ acceptedWatermark: 1 });
    await t.run((ctx) =>
      ensureSharedDemoStoreScheduleWithCtx(ctx, { ...seeded, now: 2 }),
    );
    expect(
      await t.run((ctx) =>
        ctx.db.get("reportPipelineControl", seeded.controlId),
      ),
    ).toMatchObject({ acceptedWatermark: 1 });
    await t.run((ctx) =>
      ctx.db.patch("storeSchedule", schedule._id, { weeklyClosedDays: [1] }),
    );
    await t.run((ctx) =>
      ensureSharedDemoStoreScheduleWithCtx(ctx, { ...seeded, now: 3 }),
    );
    expect(
      await t.run((ctx) =>
        ctx.db.get("reportPipelineControl", seeded.controlId),
      ),
    ).toMatchObject({ acceptedWatermark: 2 });
  });
  it("does not create rollout state for an unconfigured store", async () => {
    const t = convexTest(schema, modules);
    const store = await t.run((ctx) => seedStore(ctx));
    await t.run((ctx) => bumpAcceptedWatermarkWithCtx(ctx, store.storeId));
    expect(
      await t.run((ctx) => ctx.db.query("reportPipelineControl").first()),
    ).toBeNull();
  });

  it("advances exactly once per mutation and rolls back with its writer", async () => {
    const t = convexTest(schema, modules);
    const { storeId, controlId } = await t.run(async (ctx) => {
      const store = await seedStore(ctx);
      const controlId = await ctx.db.insert("reportPipelineControl", {
        storeId: store.storeId,
        mode: "shadow",
        fence: 1,
        sourceWatermark: 0,
      });
      return { storeId: store.storeId, controlId };
    });
    await t.run((ctx) => bumpAcceptedWatermarkWithCtx(ctx, storeId));
    expect(
      await t.run((ctx) => ctx.db.get("reportPipelineControl", controlId)),
    ).toMatchObject({ acceptedWatermark: 1 });
    await expect(
      t.run(async (ctx) => {
        await bumpAcceptedWatermarkWithCtx(ctx, storeId);
        throw new Error("writer failed");
      }),
    ).rejects.toThrow("writer failed");
    expect(
      await t.run((ctx) => ctx.db.get("reportPipelineControl", controlId)),
    ).toMatchObject({ acceptedWatermark: 1 });
    await t.run((ctx) => bumpAcceptedWatermarkWithCtx(ctx, storeId));
    expect(
      await t.run((ctx) => ctx.db.get("reportPipelineControl", controlId)),
    ).toMatchObject({ acceptedWatermark: 2 });
  });
});
