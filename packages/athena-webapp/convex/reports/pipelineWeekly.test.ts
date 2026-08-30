/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "../schema";
import { seedDailyClose, seedStore } from "./reseedTestSupport";
import {
  publishCloseLifecycleWithCtx,
  materializeCloseEvidenceWithCtx,
} from "./closeEvidence";
import { enqueueReportWork, claimReportWorkWithCtx } from "./pipelineWork";
import {
  processWeeklyWorkWithCtx,
  hasPendingWeeklyWorkWithCtx,
  resolveWeekDateWithCtx,
} from "./pipelineWeekly";
import { maintainWeeklyWorkWithCtx } from "./pipelineWeeklyRecovery";
import {
  markWeekDirty,
  rebuildCurrentWeek,
  materializeAcceptedWeek,
  refreshAcceptedWeek,
  resolveAcceptedWeekClosePosture,
} from "./weekly";
import { recordReadCosts } from "./readCostTestSupport";
import {
  REPORTS_SWEEP_STORE_ALLOWLIST_ENV,
  foldAndReplaceDay,
} from "./sweeper";
import { reopenDailyCloseWithCtx } from "../operations/dailyClose";
import type { MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import type { SeededStore } from "./reseedTestSupport";
import { isAcceptedClose } from "./reseed";
import { upsertStoreScheduleCommandWithCtx } from "../inventory/storeSchedule";
import { addDaysToDate } from "./rollups";
import { verifyAcceptedBaselinePageWithCtx } from "./pipelineAcceptedParity";
import {
  applyCloseEvidence,
  type PipelineWorkerClaim,
} from "./pipelineWorkers";

const modules = import.meta.glob("../**/*.ts");
const NOW = Date.parse("2026-08-29T20:00:00Z");
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
async function fixture() {
  const t = convexTest(schema, modules);
  const store = await t.run(async (ctx) => {
    const store = await seedStore(ctx, "UTC");
    await ctx.db.patch("store", store.storeId, {
      weeklyObservedAtVerification: {
        status: "complete",
        missingCount: 0,
        startedAt: NOW,
        completedAt: NOW,
      },
    });
    await ctx.db.insert("reportPipelineControl", {
      storeId: store.storeId,
      mode: "active",
      fence: 1,
      sourceWatermark: 0,
    });
    await ctx.db.insert("storeSchedule", {
      storeId: store.storeId,
      organizationId: store.organizationId,
      timezone: "UTC",
      weeklyWindows: [],
      weeklyClosedDays: [0],
      dateExceptions: [],
      reportingCycleStartsOn: 1,
      effectiveFrom: Date.parse("2026-01-01"),
      status: "active",
      source: "admin",
      createdAt: NOW,
      updatedAt: NOW,
    });
    return store;
  });
  vi.stubEnv(REPORTS_SWEEP_STORE_ALLOWLIST_ENV, String(store.storeId));
  return { t, store };
}

async function frozenClose(
  ctx: MutationCtx,
  store: SeededStore,
  operatingDate = "2026-08-29",
  completedAt = NOW,
  evidence?: Pick<
    NonNullable<Doc<"dailyClose">["reportSnapshot"]>,
    | "expenseProductEvidence"
    | "frozenSyncedSaleInventoryReviewGroups"
    | "openWorkMembership"
  >,
) {
  const closeId = await seedDailyClose(ctx, store, {
    operatingDate,
    completedAt,
    salesTotal: 0,
    lifecycleStatus: "active",
  });
  const close = (await ctx.db.get("dailyClose", closeId))!;
  await ctx.db.patch("dailyClose", closeId, {
    reportSnapshot: {
      closeMetadata: {
        storeId: store.storeId,
        organizationId: store.organizationId,
        operatingDate,
        startAt: completedAt - 1000,
        endAt: completedAt,
        completedAt,
        carryForwardWorkItemIds: [],
      },
      readiness: close.readiness,
      summary: { netCashVariance: 0, transactionCount: 0, paymentTotals: [] },
      reviewedItems: [],
      carryForwardItems: [],
      readyItems: [],
      sourceSubjects: [],
      expenseProductEvidence: {
        contractVersion: 1,
        status: "complete",
        expenseTotal: 0,
        sourceItemCount: 0,
        sourceTransactionCount: 0,
        products: [],
      },
      openWorkMembership: { completeness: "complete", observedLogicalCount: 0 },
      frozenSyncedSaleInventoryReviewGroups: [],
      ...evidence,
    },
  });
  const source = (await ctx.db.get("dailyClose", closeId))!;
  const header = await publishCloseLifecycleWithCtx(ctx, source, NOW);
  await materializeCloseEvidenceWithCtx(ctx, {
    storeId: store.storeId,
    closeId,
    expectedGeneration: header.expectedGeneration,
  });
  await foldAndReplaceDay(ctx, store.storeId, operatingDate, NOW + 1);
  return closeId;
}

describe("exact weekly pipeline", () => {
  it("hands one date to every overlapping immutable accepted frame after a valid anchor change", async () => {
    const { t, store } = await fixture();
    const firstCloseAt = Date.parse("2026-08-09T12:00:00Z");
    const secondCloseAt = Date.parse("2026-08-11T12:00:00Z");
    const firstScheduleId = await t.run(async (ctx) => {
      const schedule = (await ctx.db.query("storeSchedule").first())!;
      await ctx.db.patch("storeSchedule", schedule._id, {
        weeklyClosedDays: [],
      });
      const closeId = await frozenClose(ctx, store, "2026-08-09", firstCloseAt);
      expect(
        await materializeAcceptedWeek({
          ctx,
          storeId: store.storeId,
          closeId,
          cutoffObservedAt: firstCloseAt,
          now: firstCloseAt + 1,
        }),
      ).toBe("created");
      return schedule._id;
    });
    const changeAt = Date.parse("2026-08-09T14:00:00Z");
    vi.spyOn(Date, "now").mockReturnValue(changeAt);
    const changed = await t.run((ctx) =>
      upsertStoreScheduleCommandWithCtx(ctx, {
        storeId: store.storeId,
        timezone: "UTC",
        weeklyWindows: [],
        weeklyClosedDays: [],
        dateExceptions: [],
        reportingCycleStartsOn: 3,
        effectiveFrom: changeAt,
        supersedesScheduleId: firstScheduleId,
      }),
    );
    expect(changed).toMatchObject({
      kind: "ok",
      data: {
        effectiveFrom: Date.parse("2026-08-10T00:00:00Z"),
        reportingCycleStartsOn: 3,
      },
    });
    await t.run(async (ctx) => {
      const closeId = await frozenClose(
        ctx,
        store,
        "2026-08-11",
        secondCloseAt,
      );
      expect(
        await materializeAcceptedWeek({
          ctx,
          storeId: store.storeId,
          closeId,
          cutoffObservedAt: secondCloseAt,
          now: secondCloseAt + 1,
        }),
      ).toBe("created");
    });
    const baselines = await t.run((ctx) =>
      ctx.db
        .query("reportWeekAccepted")
        .withIndex("by_storeId_cycleStartDate", (q) =>
          q.eq("storeId", store.storeId),
        )
        .take(8),
    );
    expect(
      baselines.map(({ cycleStartDate, cycleEndDate }) => [
        cycleStartDate,
        cycleEndDate,
      ]),
    ).toEqual([
      ["2026-08-03", "2026-08-09"],
      ["2026-08-05", "2026-08-11"],
    ]);
    const work = await t.run((ctx) =>
      enqueueReportWork(
        ctx,
        {
          storeId: store.storeId,
          kind: "resolve-week-date",
          operatingDate: "2026-08-07",
        },
        NOW + 10,
      ),
    );
    const claim = await t.run(async (ctx) =>
      (
        await claimReportWorkWithCtx(
          ctx,
          {
            storeId: store.storeId,
            kind: "resolve-week-date",
          },
          NOW + 10,
        )
      ).claims.find((candidate) => candidate.workId === work.workId)!,
    );
    expect(claim).toBeDefined();
    const readCosts = await t.run(async (ctx) => {
      const reads = recordReadCosts(ctx);
      expect(
        await processWeeklyWorkWithCtx(
          reads.ctx,
          { ...claim, controlFence: 1 },
          NOW + 11,
        ),
      ).toBe("applied");
      return reads.snapshot();
    });
    const refreshes = await t.run((ctx) =>
      ctx.db
        .query("reportPipelineWork")
        .withIndex("by_storeId_kind_cycleStartDate", (q) =>
          q.eq("storeId", store.storeId).eq("kind", "refresh"),
        )
        .take(8),
    );
    expect(
      refreshes
        .map((row) => (row.kind === "refresh" ? row.cycleStartDate : null))
        .sort(),
    ).toEqual(["2026-08-03", "2026-08-05"]);
    expect(
      await t.run((ctx) => ctx.db.get("reportPipelineWork", work.workId)),
    ).toBeNull();
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("reportWeekAccepted")
          .withIndex("by_storeId_cycleStartDate", (q) =>
            q.eq("storeId", store.storeId),
          )
          .take(8),
      ),
    ).toEqual(baselines);
    expect(readCosts.byTable.reportWeekAccepted?.returnedDocuments).toBe(2);
    expect(readCosts.byTable.dailyClose).toBeUndefined();
    expect(readCosts.total.returnedDocuments).toBeLessThan(20);
    console.info(
      "overlapping accepted-frame handoff read proxy",
      readCosts.total,
    );
  });

  it("preserves more than16 historical date handoffs without singleton truncation", async () => {
    const { t, store } = await fixture();
    await t.run((ctx) =>
      markWeekDirty(ctx, store.storeId, "day_folded", NOW, {
        foldedDates: Array.from(
          { length: 23 },
          (_, i) => `2026-07-${String(i + 1).padStart(2, "0")}`,
        ),
      }),
    );
    const work = await t.run((ctx) =>
      ctx.db.query("reportPipelineWork").take(512),
    );
    expect(work.filter((w) => w.kind === "resolve-week-date")).toHaveLength(23);
    expect(
      await t.run((ctx) => ctx.db.query("reportDirtyWeek").take(512)),
    ).toHaveLength(0);
  });

  it("bounds accepted overlap lookup to seven starts and refuses an eighth before any handoff", async () => {
    const { t, store } = await fixture();
    const firstFrameId = await t.run(async (ctx) => {
      const closeId = await frozenClose(ctx, store);
      expect(
        await materializeAcceptedWeek({
          ctx,
          storeId: store.storeId,
          closeId,
          cutoffObservedAt: NOW,
          now: NOW + 1,
        }),
      ).toBe("created");
      const { _id, _creationTime, ...baseline } = (await ctx.db
        .query("reportWeekAccepted")
        .first())!;
      let firstFrameId = _id;
      for (let offset = -1; offset <= 7; offset++) {
        const cycleStartDate = addDaysToDate("2026-08-01", offset);
        const id = await ctx.db.insert("reportWeekAccepted", {
          ...baseline,
          cycleStartDate,
          cycleEndDate: addDaysToDate(cycleStartDate, 6),
        });
        if (offset === 0) firstFrameId = id;
      }
      return firstFrameId;
    });
    await t.run(async (ctx) => {
      const reads = recordReadCosts(ctx);
      expect(
        await resolveWeekDateWithCtx(
          reads.ctx,
          store.storeId,
          "2026-08-07",
          NOW + 2,
        ),
      ).toEqual({ status: "done", disposition: "existing-frame" });
      expect(
        reads.snapshot().byTable.reportWeekAccepted?.returnedDocuments,
      ).toBe(7);
    });
    const readRefreshes = () =>
      t.run((ctx) =>
        ctx.db
          .query("reportPipelineWork")
          .withIndex("by_storeId_kind_cycleStartDate", (q) =>
            q.eq("storeId", store.storeId).eq("kind", "refresh"),
          )
          .take(16),
      );
    const refreshes = await readRefreshes();
    expect(
      refreshes.map((row) =>
        row.kind === "refresh" ? row.cycleStartDate : null,
      ),
    ).toEqual(
      Array.from({ length: 7 }, (_, i) => addDaysToDate("2026-08-01", i)),
    );
    await t.run(async (ctx) => {
      const { _id, _creationTime, ...fields } = (await ctx.db.get(
        "reportWeekAccepted",
        firstFrameId,
      ))!;
      await ctx.db.insert("reportWeekAccepted", fields);
    });
    await t.run(async (ctx) => {
      const reads = recordReadCosts(ctx);
      expect(
        await resolveWeekDateWithCtx(
          reads.ctx,
          store.storeId,
          "2026-08-07",
          NOW + 3,
        ),
      ).toEqual({ status: "blocked", code: "capacity_exceeded" });
      expect(
        reads.snapshot().byTable.reportWeekAccepted?.returnedDocuments,
      ).toBe(8);
      expect(reads.snapshot().byTable.reportPipelineWork).toBeUndefined();
    });
    expect(await readRefreshes()).toEqual(refreshes);
  });

  it("terminates obsolete acceptance and does not defer an unrelated cycle", async () => {
    const { t, store } = await fixture();
    const closeId = await t.run(async (ctx) => {
      const id = await seedDailyClose(ctx, store, {
        operatingDate: "2026-08-22",
        completedAt: NOW - 604800000,
        salesTotal: 0,
      });
      await ctx.db.patch("dailyClose", id, {
        lifecycleStatus: "reopened",
        reopenedAt: NOW,
      });
      await publishCloseLifecycleWithCtx(
        ctx,
        (await ctx.db.get("dailyClose", id))!,
        NOW,
      );
      await enqueueReportWork(
        ctx,
        {
          storeId: store.storeId,
          kind: "accept",
          cycleStartDate: "2026-08-17",
          closeId: id,
          cutoffObservedAt: NOW - 604800000,
        },
        NOW,
      );
      return id;
    });
    const claim = await t.run(
      async (ctx) =>
        (
          await claimReportWorkWithCtx(
            ctx,
            { storeId: store.storeId, kind: "accept" },
            NOW,
          )
        ).claims[0],
    );
    const result = await t.run((ctx) =>
      processWeeklyWorkWithCtx(ctx, { ...claim, controlFence: 1 }, NOW + 1),
    );
    expect(result).toBe("applied");
    const rows = await t.run((ctx) =>
      ctx.db.query("reportPipelineWork").take(512),
    );
    expect(rows.some((w) => w.kind === "accept" && w.closeId === closeId)).toBe(
      false,
    );
    expect(
      rows.some(
        (w) => w.kind === "refresh" && w.cycleStartDate === "2026-08-17",
      ),
    ).toBe(true);
    expect(
      await t.run((ctx) =>
        hasPendingWeeklyWorkWithCtx(
          ctx,
          store.storeId,
          { cycleStartDate: "2026-08-24", cycleEndDate: "2026-08-30" },
          false,
        ),
      ),
    ).toBe(false);
    const ledger = await t.run((ctx) =>
      ctx.db.query("scheduledRunLedger").take(512),
    );
    expect(
      ledger.find((row) => row.cronFamily === "reports-pipeline-accept")
        ?.snapshotCounts?.terminal_obsolete_close,
    ).toBe(1);
  });

  it("isolated close worker repairs a missing header using one owned source document", async () => {
    const { t, store } = await fixture();
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const claim = await t.run(async (ctx) => {
      const closeId = await seedDailyClose(ctx, store, {
        operatingDate: "2026-08-29",
        completedAt: NOW,
        salesTotal: 0,
      });
      await enqueueReportWork(
        ctx,
        { storeId: store.storeId, kind: "close-evidence", closeId },
        NOW,
      );
      return (
        await claimReportWorkWithCtx(
          ctx,
          { storeId: store.storeId, kind: "close-evidence" },
          NOW,
        )
      ).claims[0];
    });
    const result = await t.run(async (ctx) => {
      const r = recordReadCosts(ctx);
      const fn = applyCloseEvidence as unknown as {
        _handler: (
          ctx: MutationCtx,
          claim: PipelineWorkerClaim,
        ) => Promise<string>;
      };
      await fn._handler(r.ctx, { ...claim, controlFence: 1 });
      return r.snapshot();
    });
    expect(result.byTable.dailyClose?.returnedDocuments).toBe(1);
    expect(
      await t.run((ctx) => ctx.db.query("reportCloseEvidence").take(512)),
    ).toHaveLength(1);
    expect(
      (await t.run((ctx) => ctx.db.get("reportPipelineWork", claim.workId)))
        ?.generation,
    ).toBeGreaterThan(claim.generation);
  });

  it("recovery rotates beyond16 closes and repairs missing compact coverage one source at a time", async () => {
    const { t, store } = await fixture();
    await t.run(async (ctx) => {
      for (let i = 1; i <= 20; i++)
        await seedDailyClose(ctx, store, {
          operatingDate: `2026-07-${String(i).padStart(2, "0")}`,
          completedAt: NOW - i,
          salesTotal: 0,
        });
    });
    for (let i = 0; i < 42; i++) {
      const reads = await t.run(async (ctx) => {
        const r = recordReadCosts(ctx);
        await maintainWeeklyWorkWithCtx(
          r.ctx,
          store.storeId,
          NOW + i * 3600000,
        );
        return r.snapshot();
      });
      expect(
        reads.byTable.dailyClose?.returnedDocuments ?? 0,
      ).toBeLessThanOrEqual(1);
    }
    expect(
      await t.run((ctx) => ctx.db.query("reportCloseEvidence").take(512)),
    ).toHaveLength(20);
  });

  it("current financial rebuilding does not hydrate closes or Open Work after activation", async () => {
    const { t, store } = await fixture();
    const reads = await t.run(async (ctx) => {
      const r = recordReadCosts(ctx);
      await rebuildCurrentWeek(r.ctx, store.storeId, NOW);
      return r.snapshot();
    });
    expect(reads.byTable.dailyClose).toBeUndefined();
    expect(reads.byTable.operationalWorkItem).toBeUndefined();
  });

  it("resolves two old cycles independently and preserves original acceptance cutoff across retry", async () => {
    const { t, store } = await fixture();
    const closes = await t.run(async (ctx) => {
      const first = await frozenClose(
        ctx,
        store,
        "2026-08-15",
        NOW - 14 * 86400000,
      );
      const second = await frozenClose(
        ctx,
        store,
        "2026-08-22",
        NOW - 7 * 86400000,
      );
      for (const date of ["2026-08-15", "2026-08-22"])
        expect(
          (await resolveWeekDateWithCtx(ctx, store.storeId, date, NOW)).status,
        ).toBe("done");
      return [first, second];
    });
    const work = await t.run((ctx) =>
      ctx.db.query("reportPipelineWork").take(512),
    );
    expect(work.filter((row) => row.kind === "accept")).toHaveLength(2);
    const claims = await t.run(
      async (ctx) =>
        (
          await claimReportWorkWithCtx(
            ctx,
            { storeId: store.storeId, kind: "accept", limit: 2 },
            NOW,
          )
        ).claims,
    );
    for (const claim of claims)
      expect(
        await t.run((ctx) =>
          processWeeklyWorkWithCtx(ctx, { ...claim, controlFence: 1 }, NOW + 2),
        ),
      ).toBe("applied");
    const baselines = await t.run((ctx) =>
      ctx.db.query("reportWeekAccepted").take(512),
    );
    expect(baselines.map((row) => row.closeId).sort()).toEqual(closes.sort());
    expect(baselines.map((row) => row.cutoffObservedAt).sort()).toEqual(
      [NOW - 14 * 86400000, NOW - 7 * 86400000].sort(),
    );
    for (const claim of claims)
      expect(
        await t.run((ctx) =>
          processWeeklyWorkWithCtx(ctx, { ...claim, controlFence: 1 }, NOW + 3),
        ),
      ).toBe("stale");
  });

  it("separates terminal out-of-history dates from retryable missing timezone and capped schedules", async () => {
    const { t, store } = await fixture();
    expect(
      await t.run((ctx) =>
        resolveWeekDateWithCtx(ctx, store.storeId, "2025-01-04", NOW),
      ),
    ).toEqual({ status: "done", disposition: "outside-schedule-history" });
    const schedule = await t.run((ctx) =>
      ctx.db.query("storeSchedule").first(),
    );
    await t.run((ctx) =>
      ctx.db.patch("storeSchedule", schedule!._id, { timezone: "" }),
    );
    expect(
      await t.run((ctx) =>
        resolveWeekDateWithCtx(ctx, store.storeId, "2026-08-29", NOW),
      ),
    ).toEqual({ status: "blocked", code: "missing_timezone" });
    await t.run(async (ctx) => {
      const { _id, _creationTime, ...fields } = schedule!;
      for (let i = 0; i < 100; i++)
        await ctx.db.insert("storeSchedule", {
          ...fields,
          status: "candidate",
        });
    });
    expect(
      await t.run((ctx) =>
        resolveWeekDateWithCtx(ctx, store.storeId, "2026-08-29", NOW),
      ),
    ).toEqual({ status: "blocked", code: "schedule_history_cap" });
  });

  it("retries matching-fold lag at the original cutoff and only amends late facts", async () => {
    const { t, store } = await fixture();
    const closeId = await t.run((ctx) => frozenClose(ctx, store));
    const day = (await t.run((ctx) => ctx.db.query("reportDay").first()))!;
    await t.run(async (ctx) => {
      await ctx.db.patch("reportDay", day._id, { foldedAt: NOW - 1 });
      await resolveWeekDateWithCtx(ctx, store.storeId, "2026-08-29", NOW);
    });
    const claim = await t.run(
      async (ctx) =>
        (
          await claimReportWorkWithCtx(
            ctx,
            { storeId: store.storeId, kind: "accept" },
            NOW,
          )
        ).claims[0],
    );
    expect(
      await t.run((ctx) =>
        processWeeklyWorkWithCtx(ctx, { ...claim, controlFence: 1 }, NOW + 1),
      ),
    ).toBe("blocked");
    const retained = await t.run((ctx) =>
      ctx.db.get("reportPipelineWork", claim.workId),
    );
    expect(retained).toMatchObject({ kind: "accept", cutoffObservedAt: NOW });
    await t.run(async (ctx) => {
      await ctx.db.patch("dailyClose", closeId, { updatedAt: NOW + 2000 });
      await ctx.db.patch("reportDay", day._id, { foldedAt: NOW + 3000 });
    });
    const retry = await t.run(
      async (ctx) =>
        (
          await claimReportWorkWithCtx(
            ctx,
            { storeId: store.storeId, kind: "accept" },
            NOW + 6000,
          )
        ).claims[0],
    );
    expect(
      await t.run((ctx) =>
        processWeeklyWorkWithCtx(
          ctx,
          { ...retry, controlFence: 1 },
          NOW + 6001,
        ),
      ),
    ).toBe("applied");
    const accepted = (await t.run((ctx) =>
      ctx.db.query("reportWeekAccepted").first(),
    ))!;
    await t.run(async (ctx) => {
      await ctx.db.insert("reportFact", {
        storeId: store.storeId,
        sourceDomain: "pos",
        sourceId: "late",
        lineId: "late",
        factKind: "sale",
        fingerprint: "late",
        fingerprintVersion: 2,
        occurredAt: NOW - 1,
        recordedAt: NOW + 10000,
        observedAt: NOW + 10000,
        operatingDate: "2026-08-29",
        currency: "GHS",
        grossAmountMinor: 100,
        netAmountMinor: 100,
        taxAmountMinor: 0,
        discountAmountMinor: 0,
        quantity: 1,
      });
      await foldAndReplaceDay(ctx, store.storeId, "2026-08-29", NOW + 10001);
      expect(await refreshAcceptedWeek(ctx, accepted, NOW + 10002)).toBe(true);
    });
    const amended = (await t.run((ctx) =>
      ctx.db.get("reportWeekAccepted", accepted._id),
    ))!;
    expect(amended.cutoffObservedAt).toBe(NOW);
    expect(amended.baselineFingerprint).toBe(accepted.baselineFingerprint);
    expect(amended.included.netSalesMinor).toBe(0);
    expect(amended.amendment?.included.netSalesMinor).toBe(100);
  });

  it("financial-frame-only changes enqueue inventory even when no Open Work marker exists", async () => {
    const { t, store } = await fixture();
    await t.run((ctx) => rebuildCurrentWeek(ctx, store.storeId, NOW));
    await t.run(async (ctx) => {
      const work = await ctx.db
        .query("reportPipelineWork")
        .withIndex("by_storeId_kind_createdAt", (q) =>
          q.eq("storeId", store.storeId).eq("kind", "inventory"),
        )
        .first();
      if (work) await ctx.db.delete("reportPipelineWork", work._id);
    });
    await t.run((ctx) => rebuildCurrentWeek(ctx, store.storeId, NOW + 1000));
    expect(
      (await t.run((ctx) => ctx.db.query("reportPipelineWork").take(512))).some(
        (row) => row.kind === "inventory",
      ),
    ).toBe(false);
    await t.run((ctx) =>
      rebuildCurrentWeek(ctx, store.storeId, NOW + 7 * 86400000),
    );
    expect(
      (await t.run((ctx) => ctx.db.query("reportPipelineWork").take(512))).some(
        (row) => row.kind === "inventory",
      ),
    ).toBe(true);
  });

  it("an independently reopened successor cannot remain the active accepted close", async () => {
    const { t, store } = await fixture();
    const ids = await t.run(async (ctx) => {
      const original = await frozenClose(ctx, store);
      await ctx.db.patch("dailyClose", original, {
        lifecycleStatus: "superseded",
      });
      await publishCloseLifecycleWithCtx(
        ctx,
        (await ctx.db.get("dailyClose", original))!,
        NOW + 1,
      );
      const successor = await frozenClose(ctx, store, "2026-08-29", NOW + 10);
      await ctx.db.patch("dailyClose", successor, {
        lifecycleStatus: "reopened",
        reopenedAt: NOW + 20,
      });
      await publishCloseLifecycleWithCtx(
        ctx,
        (await ctx.db.get("dailyClose", successor))!,
        NOW + 20,
      );
      return { original, successor };
    });
    const posture = await t.run((ctx) =>
      resolveAcceptedWeekClosePosture(
        ctx,
        { storeId: store.storeId, closeId: ids.original, acceptedAt: NOW },
        "2026-08-29",
      ),
    );
    expect(posture?.status).toBe("reopened_awaiting_successor");
    expect(posture?.currentCloseId).toBeUndefined();
  });

  it("retains missing compact and matching-final-fold work without publishing acceptance", async () => {
    const { t, store } = await fixture();
    const closeId = await t.run((ctx) => frozenClose(ctx, store));
    await t.run(async (ctx) => {
      const header = (await ctx.db
        .query("reportCloseEvidence")
        .withIndex("by_closeId", (q) => q.eq("closeId", closeId))
        .unique())!;
      await ctx.db.patch("reportCloseEvidence", header._id, {
        publishedGeneration: undefined,
      });
    });
    expect(
      await t.run((ctx) =>
        materializeAcceptedWeek({
          ctx,
          storeId: store.storeId,
          closeId,
          cutoffObservedAt: NOW,
          cycleStartDate: "2026-08-24",
          now: NOW + 1,
        }),
      ),
    ).toBe("incomplete");
    expect(
      await t.run((ctx) => ctx.db.query("reportWeekAccepted").take(512)),
    ).toHaveLength(0);
  });

  it("real approved source reopen clears active fold close and refreshes immutable baseline posture", async () => {
    const { t, store } = await fixture();
    vi.spyOn(Date, "now").mockReturnValue(NOW + 100);
    const closeId = await t.run((ctx) => frozenClose(ctx, store));
    expect(
      await t.run((ctx) =>
        materializeAcceptedWeek({
          ctx,
          storeId: store.storeId,
          closeId,
          cutoffObservedAt: NOW,
          now: NOW + 1,
        }),
      ),
    ).toBe("created");
    const before = (await t.run((ctx) =>
      ctx.db.query("reportWeekAccepted").first(),
    ))!;
    const proof = await t.run(async (ctx) => {
      const staffId = await ctx.db.insert("staffProfile", {
        storeId: store.storeId,
        organizationId: store.organizationId,
        fullName: "Manager",
        firstName: "Test",
        lastName: "Manager",
        status: "active",
      });
      const credential = await ctx.db.insert("staffCredential", {
        storeId: store.storeId,
        organizationId: store.organizationId,
        staffProfileId: staffId,
        username: "manager",
        status: "active",
      });
      return ctx.db.insert("approvalProof", {
        storeId: store.storeId,
        actionKey: "operations.daily_close.reopen",
        subjectType: "daily_close",
        subjectId: closeId,
        requiredRole: "manager",
        approvedByStaffProfileId: staffId,
        approvedByCredentialId: credential,
        createdAt: NOW,
        expiresAt: NOW + 60000,
      });
    });
    const reopened = await t.run((ctx) =>
      reopenDailyCloseWithCtx(ctx, {
        dailyCloseId: closeId,
        storeId: store.storeId,
        actorUserId: store.userId,
        approvalProofId: proof,
        reason: "Correction",
      }),
    );
    expect(reopened.kind).toBe("ok");
    await t.run(async (ctx) => {
      await foldAndReplaceDay(ctx, store.storeId, "2026-08-29", NOW + 200);
      const dirty = await ctx.db.query("reportDirtyDay").first();
      if (dirty) await ctx.db.delete("reportDirtyDay", dirty._id);
      expect(await refreshAcceptedWeek(ctx, before, NOW + 200)).toBe(true);
    });
    const after = (await t.run((ctx) =>
      ctx.db.get("reportWeekAccepted", before._id),
    ))!;
    expect(after.baselineFingerprint).toBe(before.baselineFingerprint);
    expect(after.cutoffObservedAt).toBe(NOW);
    expect(after.closePosture?.status).toBe("reopened_awaiting_successor");
    expect(
      (await t.run((ctx) => ctx.db.query("reportDay").first()))?.closeId,
    ).toBeUndefined();
    expect(
      isAcceptedClose(
        (await t.run((ctx) => ctx.db.get("dailyClose", closeId)))!,
      ),
    ).toBe(false);
  });

  it("reads maximum-cardinality seven-close evidence once within the4000-fact acceptance budget", async () => {
    const { t, store } = await fixture();
    const { closeId, expectedChunks } = await t.run(async (ctx) => {
      const schedule = await ctx.db.query("storeSchedule").first();
      await ctx.db.patch("storeSchedule", schedule!._id, {
        reportingCycleStartsOn: 0,
        weeklyClosedDays: [],
      });
      const skuIds = [];
      for (let i = 0; i < 1000; i++)
        skuIds.push(
          await ctx.db.insert("productSku", {
            storeId: store.storeId,
            productId: store.productId,
            sku: `MAX-${i}`,
            images: [],
            inventoryCount: 0,
            quantityAvailable: 0,
            price: 1,
          }),
        );
      const products = skuIds.slice(0, 200).map((productSkuId, i) => ({
        productSkuId,
        productName: `Maximum expense product ${i}`,
        productSku: `MAX-${i}`,
        quantity: 1,
        spend: 1,
      }));
      const groups = [];
      for (const productSkuId of skuIds) {
        const workItemId = await ctx.db.insert("operationalWorkItem", {
          storeId: store.storeId,
          organizationId: store.organizationId,
          type: "synced_sale_inventory_review",
          status: "open",
          priority: "normal",
          approvalState: "not_required",
          title: "Maximum-cardinality fixture",
          createdAt: NOW - 1,
        });
        groups.push({
          key: `synced-sale-inventory-review:${productSkuId}`,
          productSkuId,
          membershipCompleteness: "complete" as const,
          oldestActionableAt: NOW - 1,
          members: [{ createdAt: NOW - 1, workItemId }],
        });
      }
      const closeIds: Doc<"dailyClose">["_id"][] = [];
      let chunks = 0;
      for (let date = 23; date <= 29; date++) {
        const closeId = await frozenClose(ctx, store, `2026-08-${date}`, NOW, {
          expenseProductEvidence: {
            contractVersion: 1,
            status: "complete",
            expenseTotal: 200,
            sourceItemCount: 200,
            sourceTransactionCount: 1,
            products,
          },
          openWorkMembership: {
            completeness: "complete",
            observedLogicalCount: 1000,
          },
          frozenSyncedSaleInventoryReviewGroups: groups,
        });
        closeIds.push(closeId);
        const header = await ctx.db
          .query("reportCloseEvidence")
          .withIndex("by_closeId", (q) => q.eq("closeId", closeId))
          .unique();
        chunks += header?.chunkCount ?? 0;
      }
      return { closeId: closeIds[closeIds.length - 1], expectedChunks: chunks };
    });
    await t.run(async (ctx) => {
      for (let i = 0; i < 4000; i++)
        await ctx.db.insert("reportFact", {
          storeId: store.storeId,
          sourceDomain: "pos",
          sourceId: `sale-${i}`,
          lineId: `line-${i}`,
          factKind: "sale",
          fingerprint: `fact-${i}`,
          fingerprintVersion: 2,
          occurredAt: NOW - 1,
          recordedAt: NOW - 1,
          observedAt: NOW - 1,
          operatingDate: i < 2000 ? "2026-08-28" : "2026-08-29",
          currency: "GHS",
          grossAmountMinor: 1,
          netAmountMinor: 1,
          taxAmountMinor: 0,
          discountAmountMinor: 0,
          quantity: 1,
        });
      await foldAndReplaceDay(ctx, store.storeId, "2026-08-28", NOW + 1);
      await foldAndReplaceDay(ctx, store.storeId, "2026-08-29", NOW + 1);
    });
    const measured = await t.run(async (ctx) => {
      const r = recordReadCosts(ctx);
      const outcome = await materializeAcceptedWeek({
        ctx: r.ctx,
        storeId: store.storeId,
        closeId,
        cutoffObservedAt: NOW,
        now: NOW + 2,
      });
      return { outcome, cost: r.snapshot() };
    });
    console.info(
      "maximum-cardinality weekly acceptance fixture read proxy",
      measured.cost.total,
    );
    expect(measured.outcome).toBe("created");
    expect(measured.cost.byTable.reportFact.returnedDocuments).toBe(4000);
    expect(
      measured.cost.byTable.reportCloseEvidenceChunk.returnedDocuments,
    ).toBe(expectedChunks);
    expect(measured.cost.total.returnedDocuments).toBeLessThan(4500);
    expect(measured.cost.total.serializedBytes).toBeLessThan(4 * 1024 * 1024);
    expect(measured.cost.byTable.dailyClose).toBeUndefined();
    const accepted = await t.run((ctx) =>
      ctx.db
        .query("reportWeekAccepted")
        .withIndex("by_storeId_cycleStartDate", (q) =>
          q.eq("storeId", store.storeId).eq("cycleStartDate", "2026-08-23"),
        )
        .unique(),
    );
    expect(accepted?.closeEvidence?.expenses).toMatchObject({
      coveredSpendMinor: 1400,
      coverage: { status: "complete", usableDayCount: 7 },
    });
    const acceptedWatermark = () =>
      t.run((ctx) =>
        ctx.db
          .query("reportPipelineControl")
          .withIndex("by_storeId", (q) => q.eq("storeId", store.storeId))
          .unique(),
      );
    expect(await acceptedWatermark()).toMatchObject({ acceptedWatermark: 1 });
    expect(
      await t.run((ctx) =>
        materializeAcceptedWeek({
          ctx,
          storeId: store.storeId,
          closeId,
          cutoffObservedAt: NOW,
          now: NOW + 3,
        }),
      ),
    ).toBe("existing");
    expect(await acceptedWatermark()).toMatchObject({ acceptedWatermark: 1 });
    const parity = await t.run(async (ctx) => {
      const recorder = recordReadCosts(ctx);
      const value = await verifyAcceptedBaselinePageWithCtx(recorder.ctx, {
        storeId: store.storeId,
        cursor: null,
      });
      return { value, costs: recorder.snapshot() };
    });
    expect(parity.value.issues).toEqual([]);
    expect(
      parity.costs.byTable.reportCloseEvidenceChunk.returnedDocuments,
    ).toBe(expectedChunks);
    expect(parity.costs.total.returnedDocuments).toBeLessThan(4500);
    expect(parity.costs.total.serializedBytes).toBeLessThan(4 * 1024 * 1024);
    console.info(
      "maximum-cardinality accepted parity fixture read proxy",
      parity.costs.total,
    );
  });
});
