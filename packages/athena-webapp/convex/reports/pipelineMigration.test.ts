/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "../schema";
import { seedDailyClose, seedPosSale, seedStore } from "./reseedTestSupport";
import { REPORTS_SWEEP_STORE_ALLOWLIST_ENV } from "./sweeper";
import {
  beginPipelineMigrationWithCtx,
  stepPipelineMigrationWithCtx,
  activatePipelineWithCtx,
} from "./pipelineMigration";
import { recordFacts } from "./ingest";
import {
  applyRollupDayBatchWithCtx,
  initializeRollupEpochWithCtx,
} from "./rollupPipeline";
import { recordReadCosts } from "./readCostTestSupport";
import { claimReportWorkWithCtx, enqueueReportWork } from "./pipelineWork";
import { makeFunctionReference } from "convex/server";
import type { PipelineWorkerClaim } from "./pipelineWorkers";
import { normalizeReseedCursor, reseedStep } from "./reseed";
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
describe("reports pipeline guarded migration", () => {
  it("reconstructs and reactivates an active store through repeated reseeds", async () => {
    let now = Date.parse("2026-08-29T12:00:00Z");
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const t = convexTest(schema, modules);
    const s = await t.run(async (ctx) => {
      const s = await seedStore(ctx, "UTC");
      const controlId = await ctx.db.insert("reportPipelineControl", {
        storeId: s.storeId,
        mode: "active",
        fence: 7,
        sourceWatermark: 1,
        activeRollupEpoch: "prior",
      });
      await initializeRollupEpochWithCtx(
        ctx,
        { storeId: s.storeId, epoch: "prior" },
        now - 1000,
      );
      await ctx.db.patch("reportPipelineControl", controlId, {
        targetRollupEpoch: undefined,
      });
      await seedPosSale(ctx, s, {
        completedAt: Date.parse("2026-08-27T12:00:00Z"),
        lines: [{ quantity: 2, unitPrice: 500 }],
        transactionNumber: "reseed-active-sale",
      });
      return s;
    });
    vi.stubEnv(REPORTS_SWEEP_STORE_ALLOWLIST_ENV, String(s.storeId));
    let cursor = normalizeReseedCursor(undefined);
    let reseeded = false;
    for (let i = 0; i < 100; i++) {
      const progress = await t.run((ctx) => reseedStep(ctx, s.storeId, cursor));
      if (!progress.cursor) {
        reseeded = true;
        break;
      }
      cursor = progress.cursor;
    }
    expect(reseeded).toBe(true);
    let migration = (await t.run((ctx) =>
      ctx.db.query("reportPipelineMigration").first(),
    ))!;
    expect(migration).toMatchObject({
      epoch: `reseed-${now}`,
      resumeActivePipeline: true,
    });
    expect(
      await t.run((ctx) => ctx.db.query("reportRollupEpoch").take(2)),
    ).toHaveLength(1);
    // A repeated completion neither replaces resume authority nor starts a new generation.
    await t.run((ctx) =>
      reseedStep(ctx, s.storeId, {
        phase: "done",
        purgeTableIndex: 0,
        pageCursor: null,
      }),
    );
    expect(
      (await t.run((ctx) => ctx.db.query("reportPipelineMigration").first()))
        ?.generation,
    ).toBe(migration.generation);
    const previousMigration = migration;
    now += 1000;
    cursor = normalizeReseedCursor(undefined);
    reseeded = false;
    for (let i = 0; i < 100; i++) {
      const progress = await t.run((ctx) => reseedStep(ctx, s.storeId, cursor));
      if (!progress.cursor) {
        reseeded = true;
        break;
      }
      cursor = progress.cursor;
    }
    expect(reseeded).toBe(true);
    migration = (await t.run((ctx) =>
      ctx.db.query("reportPipelineMigration").first(),
    ))!;
    expect(migration).toMatchObject({
      epoch: `reseed-${now}`,
      resumeActivePipeline: true,
    });
    expect(
      await t.run((ctx) =>
        stepPipelineMigrationWithCtx(
          ctx,
          {
            storeId: s.storeId,
            epoch: previousMigration.epoch,
            generation: previousMigration.generation,
          },
          now,
        ),
      ),
    ).toBe("stale");
    const args = {
      storeId: s.storeId,
      epoch: migration.epoch,
      generation: migration.generation,
    };
    await expect(
      t.mutation(
        makeFunctionReference<"mutation", typeof args>(
          "reports/pipelineMigration:resumeAfterProof",
        ),
        args,
      ),
    ).rejects.toThrow("coverage");
    let ready = false;
    for (let i = 0; i < 100; i++) {
      const outcome = await t.run((ctx) =>
        stepPipelineMigrationWithCtx(ctx, args, now),
      );
      for (const obligation of await t.run((ctx) =>
        ctx.db.query("reportPeriodObligation").take(10),
      ))
        await t.run((ctx) =>
          applyRollupDayBatchWithCtx(
            ctx,
            {
              storeId: s.storeId,
              epoch: migration.epoch,
              operatingDate: obligation.operatingDate,
            },
            now,
          ),
        );
      if (outcome === "ready") {
        ready = true;
        break;
      }
    }
    expect(ready).toBe(true);
    expect(
      await t.run((ctx) => ctx.db.query("reportDay").first()),
    ).toMatchObject({
      operatingDate: "2026-08-27",
      netSalesMinor: 1000,
    });
    await t.mutation(
      makeFunctionReference<"mutation", typeof args>(
        "reports/pipelineMigration:resumeAfterProof",
      ),
      args,
    );
    expect(
      await t.run((ctx) => ctx.db.query("reportPipelineControl").first()),
    ).toMatchObject({ mode: "active", activeRollupEpoch: migration.epoch });
  });
  it("keeps reseed fenced and resumable if fresh migration creation fails", async () => {
    const now = 1000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const t = convexTest(schema, modules);
    const s = await t.run(async (ctx) => {
      const s = await seedStore(ctx, "UTC");
      await ctx.db.patch("store", s.storeId, { reportingReseedStartedAt: now });
      await ctx.db.insert("reportPipelineControl", {
        storeId: s.storeId,
        mode: "paused",
        fence: 7,
        sourceWatermark: 1,
        activeRollupEpoch: "prior",
      });
      await ctx.db.insert("reportRollupEpoch", {
        storeId: s.storeId,
        epoch: `reseed-${now}`,
        createdAt: now - 1,
        backfillCursor: null,
        backfillComplete: false,
      });
      return s;
    });
    vi.stubEnv(REPORTS_SWEEP_STORE_ALLOWLIST_ENV, String(s.storeId));
    await expect(
      t.run((ctx) =>
        reseedStep(ctx, s.storeId, {
          phase: "done",
          purgeTableIndex: 0,
          pageCursor: null,
        }),
      ),
    ).rejects.toThrow("report_rollup_epoch_reuse");
    expect(await t.run((ctx) => ctx.db.get("store", s.storeId))).toMatchObject({
      reportingReseedStartedAt: now,
    });
    expect(
      await t.run((ctx) => ctx.db.query("reportPipelineControl").first()),
    ).toMatchObject({ mode: "paused", fence: 7, activeRollupEpoch: "prior" });
    expect(
      await t.run((ctx) => ctx.db.query("reportPipelineMigration").first()),
    ).toBeNull();
    expect(
      await t.run((ctx) => ctx.db.query("reportPipelineWork").take(1)),
    ).toEqual([]);
  });
  it("stops automatic migration continuation at a durable blocked prerequisite", async () => {
    const t = convexTest(schema, modules);
    const s = await t.run((ctx) => seedStore(ctx, "UTC"));
    vi.stubEnv(REPORTS_SWEEP_STORE_ALLOWLIST_ENV, String(s.storeId));
    const args = { storeId: s.storeId, epoch: "blocked-input", generation: 1 };
    await t.run(async (ctx) => {
      await beginPipelineMigrationWithCtx(ctx, { ...args, dryRun: false }, 100);
      const closeId = await seedDailyClose(ctx, s, {
        operatingDate: "2026-08-01",
        completedAt: 100,
        salesTotal: 0,
      });
      await enqueueReportWork(
        ctx,
        { storeId: s.storeId, kind: "close-evidence", closeId },
        100,
      );
      const work = (await ctx.db.query("reportPipelineWork").first())!;
      await ctx.db.patch("reportPipelineWork", work._id, {
        status: "blocked",
        lastFailure: { code: "capacity_exceeded", at: 101 },
      });
      const migration = (await ctx.db
        .query("reportPipelineMigration")
        .first())!;
      await ctx.db.patch("reportPipelineMigration", migration._id, {
        phase: "canonical",
      });
    });
    const before = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").take(20),
    );
    await t.action(
      makeFunctionReference<"action", typeof args>(
        "reports/pipelineMigration:runMigration",
      ),
      args,
    );
    expect(
      await t.run((ctx) => ctx.db.query("reportPipelineMigration").first()),
    ).toMatchObject({ phase: "canonical", lastFailure: "close_work_blocked" });
    expect(
      await t.run((ctx) =>
        ctx.db.system.query("_scheduled_functions").take(20),
      ),
    ).toHaveLength(before.length);
  });
  it("invalidates activation when an accepted baseline changes after the paged proof", async () => {
    const t = convexTest(schema, modules);
    const s = await t.run((ctx) => seedStore(ctx, "UTC"));
    vi.stubEnv(REPORTS_SWEEP_STORE_ALLOWLIST_ENV, String(s.storeId));
    const args = { storeId: s.storeId, epoch: "accepted-fence", generation: 1 };
    await t.run((ctx) =>
      beginPipelineMigrationWithCtx(ctx, { ...args, dryRun: false }, 100),
    );
    for (let i = 0; i < 80; i++)
      if (
        (await t.run((ctx) =>
          stepPipelineMigrationWithCtx(ctx, args, 101 + i),
        )) === "ready"
      )
        break;
    expect(
      await t.run((ctx) => ctx.db.query("reportPipelineMigration").first()),
    ).toMatchObject({ phase: "ready", proofAcceptedWatermark: 0 });
    await t.run(async (ctx) => {
      const control = (await ctx.db.query("reportPipelineControl").first())!;
      await ctx.db.patch("reportPipelineControl", control._id, {
        acceptedWatermark: 1,
      });
    });
    await expect(
      t.run((ctx) => activatePipelineWithCtx(ctx, args, 200)),
    ).rejects.toThrow("coverage");
    expect(
      await t.run((ctx) => stepPipelineMigrationWithCtx(ctx, args, 201)),
    ).toBe("waiting");
    expect(
      await t.run((ctx) => ctx.db.query("reportPipelineMigration").first()),
    ).toMatchObject({ phase: "drain" });
    for (let i = 0; i < 80; i++)
      if (
        (await t.run((ctx) =>
          stepPipelineMigrationWithCtx(ctx, args, 202 + i),
        )) === "ready"
      )
        break;
    await t.mutation(
      makeFunctionReference<"mutation", typeof args>(
        "reports/pipelineMigration:resumeAfterProof",
      ),
      args,
    );
    expect(
      await t.run((ctx) => ctx.db.query("reportPipelineControl").first()),
    ).toMatchObject({ mode: "shadow" });
    await expect(
      t.run((ctx) =>
        beginPipelineMigrationWithCtx(
          ctx,
          {
            storeId: s.storeId,
            epoch: "never-active-resume",
            dryRun: false,
            resumeActivePipeline: true,
          },
          299,
        ),
      ),
    ).rejects.toThrow("pipeline_cannot_resume_never_active_store");
    expect(await t.run((ctx) => activatePipelineWithCtx(ctx, args, 300))).toBe(
      "active",
    );
  });
  it("recovers quiet source dates absent from both dirty work and canonical days", async () => {
    const now = Date.parse("2026-08-29T12:00:00Z");
    vi.spyOn(Date, "now").mockReturnValue(now);
    const t = convexTest(schema, modules);
    const s = await t.run(async (ctx) => {
      const s = await seedStore(ctx, "UTC");
      await seedDailyClose(ctx, s, {
        operatingDate: "2026-01-03",
        completedAt: now - 1000,
        salesTotal: 0,
      });
      await recordFacts(ctx, s.storeId, [
        {
          sourceDomain: "pos",
          sourceId: "quiet-fact",
          lineId: "one",
          factKind: "sale",
          occurredAt: Date.parse("2026-02-04T12:00:00Z"),
          currency: "GHS",
          grossAmountMinor: 10,
          netAmountMinor: 10,
          taxAmountMinor: 0,
          discountAmountMinor: 0,
          quantity: 1,
          productSkuId: s.skuId,
        },
      ]);
      for (const dirty of await ctx.db.query("reportDirtyDay").take(2))
        await ctx.db.delete("reportDirtyDay", dirty._id);
      return s;
    });
    vi.stubEnv(REPORTS_SWEEP_STORE_ALLOWLIST_ENV, String(s.storeId));
    const args = { storeId: s.storeId, epoch: "quiet-history", generation: 1 };
    await t.run((ctx) =>
      beginPipelineMigrationWithCtx(ctx, { ...args, dryRun: false }, now),
    );
    let ready = false;
    for (let i = 0; i < 100; i++) {
      const result = await t.run((ctx) =>
        stepPipelineMigrationWithCtx(ctx, args, now),
      );
      const claims = await t.run((ctx) =>
        claimReportWorkWithCtx(
          ctx,
          { storeId: s.storeId, kind: "close-evidence" },
          now,
        ),
      );
      const control = await t.run((ctx) =>
        ctx.db.query("reportPipelineControl").first(),
      );
      for (const claim of claims.claims)
        await t.mutation(
          makeFunctionReference<"mutation", PipelineWorkerClaim>(
            "reports/pipelineWorkers:applyCloseEvidence",
          ),
          { ...claim, controlFence: control!.fence },
        );
      const obligations = await t.run((ctx) =>
        ctx.db.query("reportPeriodObligation").take(10),
      );
      for (const operatingDate of new Set(
        obligations.map((row) => row.operatingDate),
      ))
        await t.run((ctx) =>
          applyRollupDayBatchWithCtx(
            ctx,
            { storeId: s.storeId, epoch: args.epoch, operatingDate },
            now,
          ),
        );
      if (result === "ready") {
        ready = true;
        break;
      }
    }
    expect(ready).toBe(true);
    const days = await t.run((ctx) => ctx.db.query("reportDay").take(3));
    expect(days.map((day) => day.operatingDate).sort()).toEqual([
      "2026-01-03",
      "2026-02-04",
    ]);
    expect(
      days.find((day) => day.operatingDate === "2026-02-04")?.netSalesMinor,
    ).toBe(10);
    expect(await t.run((ctx) => activatePipelineWithCtx(ctx, args, now))).toBe(
      "active",
    );
  });
  it("restarts failed proof explicitly and fences a rollback behind a fresh empty epoch", async () => {
    const t = convexTest(schema, modules);
    const s = await t.run((ctx) => seedStore(ctx, "UTC"));
    vi.stubEnv(REPORTS_SWEEP_STORE_ALLOWLIST_ENV, String(s.storeId));
    const args = { storeId: s.storeId, epoch: "old", generation: 1 };
    await t.run((ctx) =>
      beginPipelineMigrationWithCtx(ctx, { ...args, dryRun: false }, 100),
    );
    for (let i = 0; i < 80; i++)
      if (
        (await t.run((ctx) =>
          stepPipelineMigrationWithCtx(ctx, args, 101 + i),
        )) === "ready"
      )
        break;
    const before = await t.run((ctx) =>
      ctx.db.query("reportPipelineControl").first(),
    );
    await t.run((ctx) =>
      beginPipelineMigrationWithCtx(
        ctx,
        { ...args, dryRun: false, restartProof: true },
        200,
      ),
    );
    expect(
      await t.run((ctx) => ctx.db.query("reportPipelineMigration").first()),
    ).toMatchObject({ phase: "drain" });
    expect(
      await t.run((ctx) => ctx.db.query("reportRollupParity").first()),
    ).toBeNull();
    expect(
      (await t.run((ctx) => ctx.db.query("reportPipelineControl").first()))
        ?.fence,
    ).toBe(before?.fence);
    for (let i = 0; i < 80; i++)
      if (
        (await t.run((ctx) =>
          stepPipelineMigrationWithCtx(ctx, args, 201 + i),
        )) === "ready"
      )
        break;
    await t.run((ctx) => activatePipelineWithCtx(ctx, args, 300));
    await t.run((ctx) =>
      beginPipelineMigrationWithCtx(
        ctx,
        {
          storeId: s.storeId,
          epoch: "rollback-fresh",
          dryRun: false,
          rollback: true,
        },
        301,
      ),
    );
    expect(
      await t.run((ctx) => ctx.db.query("reportPipelineControl").first()),
    ).toMatchObject({
      mode: "shadow",
      activeRollupEpoch: "old",
      targetRollupEpoch: "rollback-fresh",
    });
    expect(
      await t.run((ctx) => ctx.db.query("reportEpochSkuRollup").first()),
    ).toBeNull();
    expect(
      await t.run((ctx) => stepPipelineMigrationWithCtx(ctx, args, 302)),
    ).toBe("stale");
    await expect(
      t.run((ctx) =>
        activatePipelineWithCtx(
          ctx,
          { ...args, epoch: "rollback-fresh", generation: 2 },
          303,
        ),
      ),
    ).rejects.toThrow("coverage");
  });
  it("retains the lost-observation boundary and fences old workers when resuming a legacy reseed cursor", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    const t = convexTest(schema, modules);
    const s = await t.run(async (ctx) => {
      const s = await seedStore(ctx, "UTC");
      await ctx.db.insert("reportPipelineControl", {
        storeId: s.storeId,
        mode: "active",
        fence: 7,
        sourceWatermark: 1,
        activeRollupEpoch: "prior",
      });
      await ctx.db.patch("store", s.storeId, { reportingReseedStartedAt: 900 });
      return s;
    });
    await t.run((ctx) =>
      reseedStep(ctx, s.storeId, {
        phase: "purge",
        purgeTableIndex: 1,
        pageCursor: null,
      }),
    );
    expect(
      await t.run((ctx) => ctx.db.query("reportPipelineControl").first()),
    ).toMatchObject({
      mode: "paused",
      fence: 8,
      activeRollupEpoch: "prior",
      acceptedReplayUnavailableBefore: 900,
    });
    await t.run((ctx) =>
      reseedStep(ctx, s.storeId, {
        phase: "purge",
        purgeTableIndex: 1,
        pageCursor: null,
      }),
    );
    expect(
      (await t.run((ctx) => ctx.db.query("reportPipelineControl").first()))
        ?.fence,
    ).toBe(8);
  });
  it("defaults to a read-only plan and never activates an unproved store", async () => {
    const t = convexTest(schema, modules);
    const s = await t.run((ctx) => seedStore(ctx, "UTC"));
    vi.stubEnv(REPORTS_SWEEP_STORE_ALLOWLIST_ENV, String(s.storeId));
    expect(
      await t.run((ctx) =>
        beginPipelineMigrationWithCtx(
          ctx,
          { storeId: s.storeId, epoch: "test-v2" },
          100,
        ),
      ),
    ).toMatchObject({ status: "planned" });
    expect(
      await t.run((ctx) => ctx.db.query("reportPipelineControl").first()),
    ).toBeNull();
    await expect(
      t.run((ctx) =>
        activatePipelineWithCtx(
          ctx,
          { storeId: s.storeId, epoch: "test-v2", generation: 1 },
          101,
        ),
      ),
    ).rejects.toThrow("coverage");
  });
  it("starts an empty target in shadow and refuses activation before all proof phases", async () => {
    const t = convexTest(schema, modules);
    const s = await t.run((ctx) => seedStore(ctx, "UTC"));
    vi.stubEnv(REPORTS_SWEEP_STORE_ALLOWLIST_ENV, String(s.storeId));
    expect(
      await t.run((ctx) =>
        beginPipelineMigrationWithCtx(
          ctx,
          { storeId: s.storeId, epoch: "test-v2", dryRun: false },
          100,
        ),
      ),
    ).toMatchObject({ status: "started", generation: 1 });
    const control = await t.run((ctx) =>
      ctx.db.query("reportPipelineControl").first(),
    );
    expect(control).toMatchObject({
      mode: "shadow",
      targetRollupEpoch: "test-v2",
    });
    expect(control?.activeRollupEpoch).toBeUndefined();
    await expect(
      t.run((ctx) =>
        activatePipelineWithCtx(
          ctx,
          { storeId: s.storeId, epoch: "test-v2", generation: 1 },
          101,
        ),
      ),
    ).rejects.toThrow("coverage");
  });
  it("walks a quiet store to proof, preserves source data, and activates only the proved epoch", async () => {
    const t = convexTest(schema, modules);
    const s = await t.run((ctx) => seedStore(ctx, "UTC"));
    vi.stubEnv(REPORTS_SWEEP_STORE_ALLOWLIST_ENV, String(s.storeId));
    const args = { storeId: s.storeId, epoch: "proved", generation: 1 };
    await t.run((ctx) =>
      beginPipelineMigrationWithCtx(ctx, { ...args, dryRun: false }, 100),
    );
    let ready = false;
    for (let i = 0; i < 80; i++) {
      const result = await t.run(async (ctx) => {
        const measured = recordReadCosts(ctx);
        const value = await stepPipelineMigrationWithCtx(
          measured.ctx,
          args,
          101 + i,
        );
        expect(measured.snapshot().total.returnedDocuments).toBeLessThan(2000);
        return value;
      });
      if (result === "ready") {
        ready = true;
        break;
      }
    }
    expect(ready).toBe(true);
    expect(await t.run((ctx) => activatePipelineWithCtx(ctx, args, 300))).toBe(
      "active",
    );
    expect(
      await t.run((ctx) => ctx.db.get("productSku", s.skuId)),
    ).not.toBeNull();
    expect(
      await t.run((ctx) => ctx.db.query("reportPipelineControl").first()),
    ).toMatchObject({ mode: "active", activeRollupEpoch: "proved" });
    expect(
      await t.run((ctx) => stepPipelineMigrationWithCtx(ctx, args, 301)),
    ).toBe("stale");
  });
  it("refolds dirty canonical input, proves a zero-built epoch, and rejects stale proof after a new source fact", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-08-29T12:00:00Z"));
    const now = Date.now(),
      date = "2026-08-29";
    const t = convexTest(schema, modules);
    const s = await t.run((ctx) => seedStore(ctx, "UTC"));
    vi.stubEnv(REPORTS_SWEEP_STORE_ALLOWLIST_ENV, String(s.storeId));
    const args = { storeId: s.storeId, epoch: "populated", generation: 1 };
    await t.run(async (ctx) => {
      await beginPipelineMigrationWithCtx(ctx, { ...args, dryRun: false }, now);
      await recordFacts(ctx, s.storeId, [
        {
          sourceDomain: "pos",
          sourceId: "migration-sale",
          lineId: "one",
          factKind: "sale",
          occurredAt: now - 1,
          currency: "GHS",
          grossAmountMinor: 10,
          netAmountMinor: 10,
          taxAmountMinor: 0,
          discountAmountMinor: 0,
          quantity: 1,
          productSkuId: s.skuId,
        },
      ]);
    });
    let ready = false;
    for (let i = 0; i < 100; i++) {
      const result = await t.run((ctx) =>
        stepPipelineMigrationWithCtx(ctx, args, now + i),
      );
      const input = await t.run((ctx) =>
        ctx.db.query("reportRollupInputCurrent").first(),
      );
      if (input) {
        const pending = await t.run((ctx) =>
          ctx.db.query("reportPeriodObligation").first(),
        );
        if (pending)
          await t.run((ctx) =>
            applyRollupDayBatchWithCtx(
              ctx,
              { storeId: s.storeId, epoch: args.epoch, operatingDate: date },
              now + i,
            ),
          );
      }
      if (result === "ready") {
        ready = true;
        break;
      }
    }
    expect(ready).toBe(true);
    const rollups = await t.run((ctx) =>
      ctx.db.query("reportEpochSkuRollup").take(4),
    );
    expect(rollups).toHaveLength(3);
    expect(rollups.every((row) => row.netSalesMinor === 10)).toBe(true);
    await t.run((ctx) =>
      recordFacts(ctx, s.storeId, [
        {
          sourceDomain: "pos",
          sourceId: "migration-sale-2",
          lineId: "one",
          factKind: "sale",
          occurredAt: now - 1,
          currency: "GHS",
          grossAmountMinor: 20,
          netAmountMinor: 20,
          taxAmountMinor: 0,
          discountAmountMinor: 0,
          quantity: 1,
          productSkuId: s.skuId,
        },
      ]),
    );
    await expect(
      t.run((ctx) => activatePipelineWithCtx(ctx, args, now + 200)),
    ).rejects.toThrow("coverage");
  });
});
