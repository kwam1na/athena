/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { getFunctionName } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  REPORTS_FOLD_VERSION,
  type ReportSkuDayMetrics,
} from "../../shared/reportsContract";
import { WEEKLY_REPORT_STORE_ALLOWLIST_ENV } from "../platform/capabilityCatalog";
import { recordReadCosts, type ReadCostSnapshot } from "./readCostTestSupport";
import { publishCloseLifecycleWithCtx } from "./closeEvidence";
import { markDirty } from "./marks";
import { markWeekDirty, materializeAcceptedWeek } from "./weekly";
import { rebuildRollupsForDates } from "./rollups";
import { REPORTS_SWEEP_STORE_ALLOWLIST_ENV, sweepWithCtx } from "./sweeper";
import {
  applyRollupDayBatchWithCtx,
  captureRollupInputWithCtx,
  initializeRollupEpochWithCtx,
  seedRollupEpochBatchWithCtx,
} from "./rollupPipeline";
import { readEpochPeriodResultWithCtx } from "./rollupPeriodRead";
import { seedStore as seedProductStore } from "./reseedTestSupport";
import * as dispatch from "./pipelineDispatch";
import { dispatchReportPipeline } from "./pipelineDispatchRoot";
import * as days from "./pipelineDays";
import * as workers from "./pipelineWorkers";
import * as weekly from "./pipelineWeekly";
import * as recovery from "./pipelineWeeklyRecovery";
import * as inventory from "./weeklyInventoryWorker";
import * as rollup from "./rollupWorkers";
import * as retention from "./pipelineRetention";
import * as ranges from "./pipelineRange";

const modules = import.meta.glob("../**/*.ts");
const NOW = Date.parse("2026-08-29T20:00:00.000Z");
const WEEK_DATES = [
  "2026-08-24",
  "2026-08-25",
  "2026-08-26",
  "2026-08-27",
  "2026-08-28",
  "2026-08-29",
];
const PADDING = 128 * 1024;
const EPOCH = "read-cost";
const METRICS: ReportSkuDayMetrics = {
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

type Sample = { phase: string; cost: ReadCostSnapshot };
function sum(samples: Sample[]): ReadCostSnapshot {
  const result: ReadCostSnapshot = {
    total: { calls: 0, returnedDocuments: 0, serializedBytes: 0 },
    byTable: {},
  };
  for (const { cost } of samples) {
    for (const key of [
      "calls",
      "returnedDocuments",
      "serializedBytes",
    ] as const)
      result.total[key] += cost.total[key];
    for (const [table, value] of Object.entries(cost.byTable)) {
      const target = (result.byTable[table] ??= {
        calls: 0,
        returnedDocuments: 0,
        serializedBytes: 0,
      });
      for (const key of [
        "calls",
        "returnedDocuments",
        "serializedBytes",
      ] as const)
        target[key] += value[key];
    }
  }
  return result;
}
type Registered = {
  _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
  isAction?: boolean;
  isMutation?: boolean;
};
const registry = new Map<string, Registered>();
for (const [moduleName, exports] of Object.entries({
  pipelineDispatch: dispatch,
  pipelineDays: days,
  pipelineWorkers: workers,
  pipelineWeekly: weekly,
  pipelineWeeklyRecovery: recovery,
  weeklyInventoryWorker: inventory,
  rollupWorkers: rollup,
  pipelineRetention: retention,
  pipelineRange: ranges,
})) {
  for (const [name, fn] of Object.entries(exports))
    if (typeof fn === "function" && "_handler" in fn)
      registry.set(
        `reports/${moduleName}:${name}`,
        fn as unknown as Registered,
      );
}

/**
 * Execute real registered handlers, including action -> mutation boundaries,
 * with each mutation in its own convex-test transaction. Only scheduler timing
 * is substituted: every scheduled target must resolve here or the test fails.
 * The recorder includes failed attempts and failure bookkeeping. It cannot see
 * Convex's internal/index reads, billing bytes, transport or production latency.
 */
function measuredPipeline(
  t: TestConvex<typeof schema>,
  clock: { now: number },
) {
  const samples: Sample[] = [];
  const queue: { name: string; args: unknown }[] = [];
  const recorded = async <T>(
    phase: string,
    work: (ctx: MutationCtx) => Promise<T>,
  ) =>
    t.run(async (ctx) => {
      const measured = recordReadCosts({
        ...ctx,
        scheduler: {
          ...ctx.scheduler,
          runAfter: vi.fn(async (_delay, reference, args) => {
            queue.push({ name: getFunctionName(reference), args });
            return "captured-schedule" as never;
          }),
        },
      });
      try {
        return await work(measured.ctx);
      } finally {
        samples.push({ phase, cost: measured.snapshot() });
      }
    });
  const execute = async (name: string, args: unknown): Promise<unknown> => {
    const fn = registry.get(name);
    if (!fn) throw new Error(`Unmeasured scheduled function: ${name}`);
    if (fn.isAction)
      return fn._handler(
        {
          runMutation: (
            reference: Parameters<typeof getFunctionName>[0],
            input: unknown,
          ) => execute(getFunctionName(reference), input),
        },
        args,
      );
    return recorded(name, (ctx) => fn._handler(ctx, args));
  };
  const flush = async () => {
    for (let count = 0; queue.length; count++) {
      if (count > 1000)
        throw new Error("Fixture scheduled queue did not quiesce");
      const next = queue.shift()!;
      await execute(next.name, next.args);
    }
  };
  return {
    samples,
    recorded,
    execute,
    flush,
    async tick() {
      await recorded("cron-dispatch", (ctx) =>
        dispatchReportPipeline(ctx),
      );
      await flush();
    },
    async drain(storeId: Id<"store">, scope: "all" | "rollup" = "all") {
      for (let round = 0; round < 100; round++) {
        await this.tick();
        // The bounded termination probe is charged to the aggregate too.
        const remaining = await recorded("completion-probe", async (ctx) => ({
          work: await ctx.db
            .query("reportPipelineWork")
            .withIndex("by_storeId_kind_createdAt", (q) =>
              scope === "rollup"
                ? q.eq("storeId", storeId).eq("kind", "rollup")
                : q.eq("storeId", storeId),
            )
            .first(),
          day: await ctx.db
            .query("reportDirtyDay")
            .withIndex("by_storeId_operatingDate", (q) =>
              q.eq("storeId", storeId),
            )
            .first(),
        }));
        if (!remaining.work && !remaining.day) return;
        clock.now += 6_001;
      }
      throw new Error("Fixture pipeline did not drain");
    },
  };
}

/** Same dates, zero facts/amounts, schedule, close shape and128KiB notes as U1. */
async function weeklyFixture(t: TestConvex<typeof schema>) {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("athenaUser", {
      email: "read-cost@test",
    });
    const organizationId = await ctx.db.insert("organization", {
      createdByUserId: userId,
      name: "Read cost",
      slug: "read-cost",
    });
    const verified = {
      status: "complete" as const,
      missingCount: 0,
      startedAt: NOW - 1,
      completedAt: NOW - 1,
    };
    const storeId = await ctx.db.insert("store", {
      createdByUserId: userId,
      organizationId,
      currency: "GHS",
      name: "Read cost",
      slug: "read-cost",
      weeklyObservedAtVerification: verified,
      weeklyReportingCycleAnchorVerification: verified,
    });
    await ctx.db.insert("storeSchedule", {
      storeId,
      organizationId,
      timezone: "UTC",
      weeklyWindows: [],
      weeklyClosedDays: [0],
      dateExceptions: [],
      reportingCycleStartsOn: 1,
      effectiveFrom: Date.parse("2026-01-01T00:00:00.000Z"),
      status: "active",
      source: "admin",
      createdAt: NOW,
      updatedAt: NOW,
    });
    const closeIds: Id<"dailyClose">[] = [];
    for (const operatingDate of WEEK_DATES) {
      const completedAt = Date.parse(`${operatingDate}T18:00:00.000Z`);
      const readiness = {
        status: "ready" as const,
        blockerCount: 0,
        reviewCount: 0,
        carryForwardCount: 0,
        readyCount: 0,
      };
      const closeId = await ctx.db.insert("dailyClose", {
        storeId,
        organizationId,
        operatingDate,
        status: "completed",
        lifecycleStatus: "active",
        isCurrent: true,
        readiness,
        summary: { salesTotal: 0 },
        sourceSubjects: [],
        carryForwardWorkItemIds: [],
        createdAt: completedAt,
        updatedAt: completedAt,
        completedAt,
        reportSnapshot: {
          snapshotContractVersion: 2,
          closeMetadata: {
            operatingDate,
            storeId,
            organizationId,
            completedAt,
            startAt: completedAt - 1,
            endAt: completedAt,
            carryForwardWorkItemIds: [],
            notes: "x".repeat(PADDING),
          },
          readiness,
          summary: {
            netCashVariance: 0,
            transactionCount: 0,
            paymentTotals: [],
          },
          expenseProductEvidence: {
            contractVersion: 1,
            expenseTotal: 0,
            products: [],
            sourceItemCount: 0,
            sourceTransactionCount: 0,
            status: "complete",
          },
          reviewedItems: [],
          carryForwardItems: [],
          carryForwardGroups: [],
          frozenSyncedSaleInventoryReviewGroups: [],
          readyItems: [],
          openWorkMembership: {
            completeness: "complete",
            observedLogicalCount: 0,
          },
          sourceSubjects: [],
        },
      });
      closeIds.push(closeId);
      await ctx.db.insert("reportDay", {
        storeId,
        operatingDate,
        currency: "GHS",
        status: "reconciled",
        unitsSold: 0,
        unitsReturned: 0,
        grossSalesMinor: 0,
        netSalesMinor: 0,
        refundsMinor: 0,
        uncostedRevenueMinor: 0,
        grossProfitMinor: 0,
        paymentsCollectedMinor: 0,
        paymentsRefundedMinor: 0,
        paymentAllocatedMinor: 0,
        paymentPosture: {
          allocatedMinor: 0,
          allocationCoverage: "complete",
          allocationOmittedMinor: 0,
          collectedMinor: 0,
          hasInvalidAllocation: false,
          refundedMinor: 0,
          unsettledMinor: 0,
        },
        flags: {
          hasUncostedRevenue: false,
          mixedCurrency: false,
          quarantinedFactCount: 0,
        },
        closeId,
        closeAcceptedAt: completedAt,
        closeVarianceMinor: 0,
        foldedAt: NOW + 1,
        foldVersion: REPORTS_FOLD_VERSION,
        factCount: 0,
        lastFactRecordedAt: completedAt,
      });
    }
    return { storeId, closeIds };
  });
}
function allow(storeId: Id<"store">) {
  vi.stubEnv(REPORTS_SWEEP_STORE_ALLOWLIST_ENV, String(storeId));
  vi.stubEnv(WEEKLY_REPORT_STORE_ALLOWLIST_ENV, String(storeId));
}
async function configure(t: TestConvex<typeof schema>, storeId: Id<"store">) {
  await t.run(async (ctx) => {
    const controlId = await ctx.db.insert("reportPipelineControl", {
      storeId,
      mode: "active",
      hasActivated: true,
      fence: 1,
      sourceWatermark: 0,
    });
    await initializeRollupEpochWithCtx(ctx, { storeId, epoch: EPOCH }, NOW);
    await ctx.db.patch("reportPipelineControl", controlId, {
      activeRollupEpoch: EPOCH,
    });
    await ctx.db.insert("operationalInventoryCoverage", {
      storeId,
      complete: true,
      updatedAt: NOW,
    });
  });
  await t.run((ctx) =>
    seedRollupEpochBatchWithCtx(ctx, { storeId, epoch: EPOCH }, NOW),
  );
}

describe("aggregate reports read-cost comparison (returned-payload proxy only)", () => {
  it("reduces total large-close bytes including producer, materializer, dispatcher, all workers and maintenance", async () => {
    const clock = { now: NOW };
    vi.spyOn(Date, "now").mockImplementation(() => clock.now);
    const baseline = convexTest(schema, modules);
    const legacy = await weeklyFixture(baseline);
    allow(legacy.storeId);
    await baseline.run((ctx) =>
      materializeAcceptedWeek({
        ctx,
        storeId: legacy.storeId,
        closeId: legacy.closeIds.at(-1)!,
        now: NOW,
      }),
    );
    await baseline.run((ctx) =>
      markWeekDirty(ctx, legacy.storeId, "day_folded", NOW),
    );
    await baseline.run((ctx) => sweepWithCtx(ctx));
    await baseline.run((ctx) =>
      markWeekDirty(ctx, legacy.storeId, "day_folded", NOW),
    );
    const legacyCost = await baseline.run(async (ctx) => {
      const r = recordReadCosts(ctx);
      await sweepWithCtx(r.ctx);
      return r.snapshot();
    });
    expect(legacyCost.byTable.dailyClose.returnedDocuments).toBeGreaterThan(12);
    const legacyRefreshes: Sample[] = [
      { phase: "legacy-week-refresh", cost: legacyCost },
    ];
    for (let repeat = 1; repeat < 3; repeat++) {
      await baseline.run((ctx) =>
        markWeekDirty(ctx, legacy.storeId, "day_folded", NOW),
      );
      const cost = await baseline.run(async (ctx) => {
        const recorder = recordReadCosts(ctx);
        await sweepWithCtx(recorder.ctx);
        return recorder.snapshot();
      });
      legacyRefreshes.push({ phase: "legacy-week-refresh", cost });
    }

    const optimized = convexTest(schema, modules);
    const next = await weeklyFixture(optimized);
    allow(next.storeId);
    await configure(optimized, next.storeId);
    const run = measuredPipeline(optimized, clock);
    await run.recorded("source-projection-publication", async (ctx) => {
      for (const closeId of next.closeIds) {
        // Conservative charge: production already holds this document in the
        // source transaction; this fixture includes a second hydration anyway.
        const close = await ctx.db.get("dailyClose", closeId);
        await publishCloseLifecycleWithCtx(ctx, close!, clock.now);
        await markDirty(
          ctx,
          next.storeId,
          close!.operatingDate,
          "close_accepted",
          clock.now,
        );
      }
    });
    await run.drain(next.storeId);
    const refreshOffset = run.samples.length;
    await run.recorded("existing-week-refresh-producer", (ctx) =>
      markWeekDirty(ctx, next.storeId, "day_folded", clock.now, {
        foldedDates: [WEEK_DATES[0]],
      }),
    );
    await run.drain(next.storeId);
    const busyRefresh = sum(run.samples.slice(refreshOffset));
    expect(busyRefresh.byTable.dailyClose?.returnedDocuments ?? 0).toBe(0);
    expect(busyRefresh.total.serializedBytes).toBeLessThan(
      legacyCost.total.serializedBytes * 0.4,
    );
    await run.recorded("period-query-core", async (ctx) => {
      const page = await readEpochPeriodResultWithCtx(
        ctx,
        { storeId: next.storeId, periodKey: "w:2026-W35", sortBy: "revenue" },
        null,
      );
      expect(page).toMatchObject({
        status: "ready",
        totalNetSalesMinor: 0,
        totalTransactions: 0,
      });
    });
    const inclusive = sum(run.samples);
    const materializers = sum(
      run.samples.filter(
        (sample) =>
          sample.phase === "reports/pipelineWorkers:applyCloseEvidence",
      ),
    );
    expect(materializers.byTable.dailyClose.returnedDocuments).toBe(
      next.closeIds.length,
    );
    expect(inclusive.total.serializedBytes).toBeLessThan(
      legacyCost.total.serializedBytes,
    );
    const phases = new Set(run.samples.map((sample) => sample.phase));
    for (const phase of [
      "reports/pipelineDays:foldOneDay",
      "reports/pipelineWeekly:applyCurrent",
      "reports/pipelineWeekly:applyAccept",
      "reports/pipelineWeekly:applyRefresh",
      "reports/rollupWorkers:applyRollup",
      "reports/pipelineWeeklyRecovery:runRecovery",
      "reports/pipelineRetention:applyRetention",
      "reports/pipelineDispatch:maintenance",
    ])
      expect(phases.has(phase), phase).toBe(true);
    // Match three busy day-folded refresh signals, not an idle optimized tick
    // against a busy legacy sweep. U1 has zero facts, so unchanged amounts here
    // are intentional; both implementations still resolve and refresh the week.
    const busyRefreshes: Sample[] = [
      { phase: "optimized-week-refresh", cost: busyRefresh },
    ];
    for (let repeat = 1; repeat < 3; repeat++) {
      const repeatOffset = run.samples.length;
      await run.recorded("existing-week-refresh-producer", (ctx) =>
        markWeekDirty(ctx, next.storeId, "day_folded", clock.now, {
          foldedDates: [WEEK_DATES[0]],
        }),
      );
      await run.drain(next.storeId);
      busyRefreshes.push({
        phase: "optimized-week-refresh",
        cost: sum(run.samples.slice(repeatOffset)),
      });
    }
    const legacyBusy = sum(legacyRefreshes);
    const optimizedBusy = sum(busyRefreshes);
    expect(optimizedBusy.byTable.dailyClose?.returnedDocuments ?? 0).toBe(0);
    expect(optimizedBusy.total.serializedBytes).toBeLessThan(
      legacyBusy.total.serializedBytes * 0.4,
    );
    // A subsequent no-source-change tick includes all idle lane/query overhead.
    const offset = run.samples.length;
    await run.tick();
    const recurring = sum(run.samples.slice(offset));
    expect(recurring.byTable.dailyClose?.returnedDocuments ?? 0).toBe(0);
    expect(recurring.total.serializedBytes).toBeLessThan(
      legacyCost.total.serializedBytes,
    );
    const accepted = await optimized.run((ctx) =>
      ctx.db
        .query("reportWeekAccepted")
        .withIndex("by_storeId_cycleStartDate", (q) =>
          q.eq("storeId", next.storeId),
        )
        .unique(),
    );
    expect(accepted).not.toBeNull();
    console.info("[reports-read-cost] inclusive large-close comparison", {
      fixture: "U1 six zero-fact closes,128KiB notes each",
      legacyWeeklySweep: legacyCost.total,
      optimizedIncludingInitialPublicationAndFold: inclusive.total,
      optimizedMaterializerSource: materializers.byTable.dailyClose,
      optimizedBusyExistingWeekRefresh: busyRefresh.total,
      legacyThreeBusyRefreshes: legacyBusy.total,
      optimizedThreeBusyRefreshes: optimizedBusy.total,
      optimizedIdleTick: recurring.total,
      measuredMutationCount: run.samples.length,
    });
  }, 60_000);

  it("reduces repeated period bytes including immutable capture, dispatch, workers and maintenance", async () => {
    const clock = { now: NOW };
    vi.spyOn(Date, "now").mockImplementation(() => clock.now);
    const changedDates = ["2026-08-10", "2026-08-11", "2026-08-12"];
    const t = convexTest(schema, modules);
    const fixture = await t.run(async (ctx) => {
      const seeded = await seedProductStore(ctx);
      const skuIds = [seeded.skuId, seeded.otherSkuId];
      for (let i = 2; i < 8; i++)
        skuIds.push(
          await ctx.db.insert("productSku", {
            storeId: seeded.storeId,
            productId: seeded.productId,
            sku: `COST-${i}`,
            images: [],
            price: 100,
            inventoryCount: 0,
            quantityAvailable: 0,
          }),
        );
      for (let day = 1; day <= 31; day++)
        for (const productSkuId of skuIds)
          await ctx.db.insert("reportSkuDay", {
            storeId: seeded.storeId,
            productSkuId,
            operatingDate: `2026-08-${String(day).padStart(2, "0")}`,
            ...METRICS,
          });
      await rebuildRollupsForDates(ctx, seeded.storeId, changedDates);
      return { ...seeded, skuIds };
    });
    allow(fixture.storeId);
    const baselineCosts: Sample[] = [];
    for (const operatingDate of changedDates) {
      await t.run(async (ctx) => {
        const row = await ctx.db
          .query("reportSkuDay")
          .withIndex("by_storeId_operatingDate_productSkuId", (q) =>
            q
              .eq("storeId", fixture.storeId)
              .eq("operatingDate", operatingDate)
              .eq("productSkuId", fixture.skuIds[0]),
          )
          .unique();
        await ctx.db.patch("reportSkuDay", row!._id, { netSalesMinor: 200 });
      });
      await t.run(async (ctx) => {
        const recorder = recordReadCosts(ctx);
        await rebuildRollupsForDates(recorder.ctx, fixture.storeId, [
          operatingDate,
        ]);
        baselineCosts.push({
          phase: "legacy-period",
          cost: recorder.snapshot(),
        });
      });
    }
    // Warm both compared projections outside the recurring window, exactly as
    // U1 does. The canonical fold map is supplied directly: U1 has no raw facts.
    for (const operatingDate of changedDates)
      await t.run(async (ctx) => {
        const row = await ctx.db
          .query("reportSkuDay")
          .withIndex("by_storeId_operatingDate_productSkuId", (q) =>
            q
              .eq("storeId", fixture.storeId)
              .eq("operatingDate", operatingDate)
              .eq("productSkuId", fixture.skuIds[0]),
          )
          .unique();
        await ctx.db.patch("reportSkuDay", row!._id, { netSalesMinor: 100 });
      });
    await configure(t, fixture.storeId);
    for (let day = 1; day <= 31; day++) {
      const operatingDate = `2026-08-${String(day).padStart(2, "0")}`;
      await t.run((ctx) =>
        captureRollupInputWithCtx(
          ctx,
          {
            storeId: fixture.storeId,
            operatingDate,
            revision: 1,
            skuDays: new Map(fixture.skuIds.map((id) => [id, METRICS])),
          },
          NOW,
        ),
      );
      for (let i = 0; i < 5; i++)
        if (
          (await t.run((ctx) =>
            applyRollupDayBatchWithCtx(
              ctx,
              { storeId: fixture.storeId, epoch: EPOCH, operatingDate },
              NOW,
            ),
          )) === "done"
        )
          break;
    }
    const warm = measuredPipeline(t, clock);
    // U1's period-only fixture intentionally has no weekly schedule or
    // verification. Do not claim that its unrelated weekly work becomes ready.
    // Charge all lane attempts, but wait only for this rollup obligation.
    await warm.drain(fixture.storeId, "rollup");
    const run = measuredPipeline(t, clock);
    for (const operatingDate of changedDates) {
      await t.run(async (ctx) => {
        const row = await ctx.db
          .query("reportSkuDay")
          .withIndex("by_storeId_operatingDate_productSkuId", (q) =>
            q
              .eq("storeId", fixture.storeId)
              .eq("operatingDate", operatingDate)
              .eq("productSkuId", fixture.skuIds[0]),
          )
          .unique();
        await ctx.db.patch("reportSkuDay", row!._id, { netSalesMinor: 200 });
      });
      await run.recorded("canonical-map-capture", (ctx) =>
        captureRollupInputWithCtx(
          ctx,
          {
            storeId: fixture.storeId,
            operatingDate,
            revision: 2,
            skuDays: new Map(
              fixture.skuIds.map((id, index) => [
                id,
                { ...METRICS, netSalesMinor: index === 0 ? 200 : 100 },
              ]),
            ),
          },
          clock.now,
        ),
      );
      await run.drain(fixture.storeId, "rollup");
    }
    const baselineCost = sum(baselineCosts);
    const optimizedCost = sum(run.samples);
    expect(baselineCost.byTable.reportSkuDay.returnedDocuments).toBe(
      8 * (1 + 7 + 31) * 3,
    );
    expect(optimizedCost.byTable.reportSkuDay?.returnedDocuments ?? 0).toBe(0);
    expect(optimizedCost.total.serializedBytes).toBeLessThan(
      baselineCost.total.serializedBytes * 0.4,
    );
    const monthly = await t.run((ctx) =>
      ctx.db
        .query("reportEpochSkuRollup")
        .withIndex("by_storeId_epoch_periodKey_productSkuId", (q) =>
          q
            .eq("storeId", fixture.storeId)
            .eq("epoch", EPOCH)
            .eq("periodKey", "m:2026-08")
            .eq("productSkuId", fixture.skuIds[0]),
        )
        .unique(),
    );
    expect(monthly?.netSalesMinor).toBe(3400);
    console.info("[reports-read-cost] inclusive repeated-period comparison", {
      fixture: "U1 eight SKUs ×31days, three single-SKU changes100→200",
      legacy: baselineCost.total,
      optimizedIncludingCaptureAndAllLaneOverhead: optimizedCost.total,
      optimizedPeriodOutput: optimizedCost.byTable.reportEpochSkuRollup,
    });
  }, 60_000);

  it("keeps the atomic2000-fact and2000-existing-SKU day within the planned payload/document probe", async () => {
    const clock = { now: NOW };
    vi.spyOn(Date, "now").mockImplementation(() => clock.now);
    const t = convexTest(schema, modules);
    const operatingDate = "2026-08-28";
    const fixture = await t.run(async (ctx) => {
      const seeded = await seedProductStore(ctx, "UTC");
      const skuIds = [seeded.skuId, seeded.otherSkuId];
      for (let i = 2; i < 2000; i++)
        skuIds.push(
          await ctx.db.insert("productSku", {
            storeId: seeded.storeId,
            productId: seeded.productId,
            sku: `MAX-${i}`,
            images: [],
            price: 100,
            inventoryCount: 0,
            quantityAvailable: 0,
          }),
        );
      for (const [index, productSkuId] of skuIds.entries()) {
        await ctx.db.insert("reportFact", {
          storeId: seeded.storeId,
          sourceDomain: "pos",
          sourceId: `max-sale-${index}`,
          lineId: `line-${index}`,
          factKind: "sale",
          fingerprint: `max-fingerprint-${index}`,
          fingerprintVersion: 2,
          occurredAt: NOW - 1,
          recordedAt: NOW - 1,
          observedAt: NOW - 1,
          operatingDate,
          currency: "GHS",
          grossAmountMinor: 100,
          netAmountMinor: 100,
          taxAmountMinor: 0,
          discountAmountMinor: 0,
          quantity: 1,
          unitCostMinor: 60,
          productSkuId,
        });
        await ctx.db.insert("reportSkuDay", {
          storeId: seeded.storeId,
          operatingDate,
          productSkuId,
          ...METRICS,
          netSalesMinor: 50,
        });
      }
      return seeded;
    });
    allow(fixture.storeId);
    await configure(t, fixture.storeId);
    const run = measuredPipeline(t, clock);
    await run.recorded("mark-max-day", (ctx) =>
      markDirty(ctx, fixture.storeId, operatingDate, "late_fact", NOW),
    );
    await run.execute("reports/pipelineDispatch:dispatchDays", {});
    await run.flush();
    const fold = run.samples.find(
      (sample) => sample.phase === "reports/pipelineDays:foldOneDay",
    );
    expect(fold).toBeDefined();
    expect(fold!.cost.byTable.reportFact.returnedDocuments).toBe(2000);
    expect(fold!.cost.byTable.reportSkuDay.returnedDocuments).toBe(2000);
    expect(fold!.cost.total.returnedDocuments).toBeLessThanOrEqual(4100);
    expect(fold!.cost.total.serializedBytes).toBeLessThanOrEqual(
      4 * 1024 * 1024,
    );
    const day = await t.run((ctx) =>
      ctx.db
        .query("reportDay")
        .withIndex("by_storeId_operatingDate", (q) =>
          q.eq("storeId", fixture.storeId).eq("operatingDate", operatingDate),
        )
        .unique(),
    );
    expect(day).toMatchObject({
      factCount: 2000,
      netSalesMinor: 200_000,
      unitsSold: 2000,
      grossProfitMinor: 80_000,
    });
    console.info("[reports-read-cost] maximum atomic day probe", {
      facts: 2000,
      existingSkuRows: 2000,
      cost: fold!.cost.total,
      note: "Serialized returned fixture payload only; not an assertion of Convex billing/read-limit bytes.",
    });
  }, 60_000);
});
