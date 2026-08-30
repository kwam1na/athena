import { makeFunctionReference, type FunctionReference } from "convex/server";
import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import {
  sweepWithCtx,
  maintainReportsWithCtx,
} from "./sweeper";
import { readStoreAllowlist } from "./pipelineAllowlist";
import { claimDayWorkWithCtx, type ReportDayClaim } from "./pipelineDays";
import { readPipelineControl } from "./pipelineControl";
import { claimReportWorkWithCtx, type ReportWorkKind } from "./pipelineWork";
import type { PipelineWorkerClaim } from "./pipelineWorkers";
import { recordPipelineBacklogWithCtx } from "./pipelineEvidence";
import { dispatchSummaryRangesWithCtx } from "./pipelineRange";
import { dispatchRetentionWithCtx } from "./pipelineRetention";

export const REPORT_PIPELINE_STORES_PER_LANE = 4;

/** Rotation depends only on configured allowlisted IDs, never a global work prefix. */
export async function selectPipelineStores(
  ctx: MutationCtx,
  lane: string,
  now: number,
): Promise<Id<"store">[]> {
  const stores = [...readStoreAllowlist()].sort().flatMap((raw) => {
    const id = ctx.db.normalizeId("store", raw);
    return id ? [id] : [];
  });
  if (stores.length === 0) return [];
  const cursor = await ctx.db
    .query("reportPipelineCursor")
    .withIndex("by_lane", (q) => q.eq("lane", lane))
    .unique();
  const next = cursor ? stores.findIndex((id) => id > cursor.lastStoreId) : 0;
  const offset = next < 0 ? 0 : next;
  const selected = [...stores.slice(offset), ...stores.slice(0, offset)].slice(
    0,
    REPORT_PIPELINE_STORES_PER_LANE,
  );
  const update = {
    lane,
    lastStoreId: selected[selected.length - 1],
    updatedAt: now,
  };
  if (cursor) await ctx.db.patch("reportPipelineCursor", cursor._id, update);
  else await ctx.db.insert("reportPipelineCursor", update);
  return selected;
}

export async function dispatchDayWorkWithCtx(ctx: MutationCtx, now: number) {
  let scheduled = 0;
  for (const storeId of await selectPipelineStores(ctx, "fold", now)) {
    const claim = await claimDayWorkWithCtx(ctx, storeId, now);
    if (!claim) continue;
    await ctx.scheduler.runAfter(
      0,
      makeFunctionReference<"action", ReportDayClaim>(
        "reports/pipelineDays:runDay",
      ),
      claim,
    );
    scheduled += 1;
  }
  return scheduled;
}

export const dispatchDays = internalMutation({
  args: {},
  returns: v.number(),
  handler: (ctx) => dispatchDayWorkWithCtx(ctx, Date.now()),
});

export async function dispatchProjectionWorkWithCtx(
  ctx: MutationCtx,
  kind: ReportWorkKind,
  worker: FunctionReference<
    "action",
    "public" | "internal",
    PipelineWorkerClaim
  >,
  now: number,
) {
  let scheduled = 0;
  let oldestAgeMs = 0;
  let saturatedStores = 0;
  for (const storeId of await selectPipelineStores(ctx, kind, now)) {
    const control = await readPipelineControl(ctx, storeId);
    if (
      control?.mode === "paused" ||
      (kind !== "close-evidence" &&
        kind !== "rollup" &&
        control?.mode !== "active") ||
      (kind === "rollup" && !control)
    )
      continue;
    const store = await ctx.db.get("store", storeId);
    if (!store || store.reportingReseedStartedAt !== undefined) continue;
    const result = await claimReportWorkWithCtx(ctx, { storeId, kind }, now);
    if (result.oldestAgeMs !== null) {
      await recordPipelineBacklogWithCtx(ctx, {
        storeId,
        lane: kind,
        now,
        eligibleSampleCount: result.claims.length + Number(result.hasMore),
        oldestAgeMs: result.oldestAgeMs,
        saturated: result.hasMore,
      });
    }
    oldestAgeMs = Math.max(oldestAgeMs, result.oldestAgeMs ?? 0);
    saturatedStores += Number(result.hasMore);
    for (const claim of result.claims) {
      await ctx.scheduler.runAfter(0, worker, {
        ...claim,
        controlFence: control?.fence ?? 0,
      });
      scheduled += 1;
    }
  }
  return { scheduled, oldestAgeMs, saturatedStores };
}

const dispatchOutcome = v.object({
  scheduled: v.number(),
  oldestAgeMs: v.number(),
  saturatedStores: v.number(),
});
export const dispatchResolveWeekDate = internalMutation({
  args: {},
  returns: dispatchOutcome,
  handler: (ctx) =>
    dispatchProjectionWorkWithCtx(
      ctx,
      "resolve-week-date",
      makeFunctionReference<"action", PipelineWorkerClaim>(
        "reports/pipelineWeekly:runResolveWeekDate",
      ),
      Date.now(),
    ),
});
export const dispatchCurrent = internalMutation({
  args: {},
  returns: dispatchOutcome,
  handler: (ctx) =>
    dispatchProjectionWorkWithCtx(
      ctx,
      "current",
      makeFunctionReference<"action", PipelineWorkerClaim>(
        "reports/pipelineWeekly:runCurrent",
      ),
      Date.now(),
    ),
});
export const dispatchAccept = internalMutation({
  args: {},
  returns: dispatchOutcome,
  handler: (ctx) =>
    dispatchProjectionWorkWithCtx(
      ctx,
      "accept",
      makeFunctionReference<"action", PipelineWorkerClaim>(
        "reports/pipelineWeekly:runAccept",
      ),
      Date.now(),
    ),
});
export const dispatchRefresh = internalMutation({
  args: {},
  returns: dispatchOutcome,
  handler: (ctx) =>
    dispatchProjectionWorkWithCtx(
      ctx,
      "refresh",
      makeFunctionReference<"action", PipelineWorkerClaim>(
        "reports/pipelineWeekly:runRefresh",
      ),
      Date.now(),
    ),
});
export const dispatchInventory = internalMutation({
  args: {},
  returns: dispatchOutcome,
  handler: (ctx) =>
    dispatchProjectionWorkWithCtx(
      ctx,
      "inventory",
      makeFunctionReference<"action", PipelineWorkerClaim>(
        "reports/weeklyInventoryWorker:runInventory",
      ),
      Date.now(),
    ),
});
export const dispatchRollup = internalMutation({
  args: {},
  returns: dispatchOutcome,
  handler: (ctx) =>
    dispatchProjectionWorkWithCtx(
      ctx,
      "rollup",
      makeFunctionReference<"action", PipelineWorkerClaim>(
        "reports/rollupWorkers:runRollup",
      ),
      Date.now(),
    ),
});

export const dispatchSummaryRanges = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const now = Date.now();
    let scheduled = 0;
    for (const storeId of await selectPipelineStores(
      ctx,
      "legacy-range",
      now,
    )) {
      scheduled += await dispatchSummaryRangesWithCtx(ctx, storeId, now);
    }
    return scheduled;
  },
});
export const dispatchRetention = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const now = Date.now();
    let scheduled = 0;
    for (const storeId of await selectPipelineStores(ctx, "retention", now))
      scheduled += await dispatchRetentionWithCtx(ctx, storeId, now);
    return scheduled;
  },
});

export const dispatchWeeklyRecovery = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    let scheduled = 0;
    for (const storeId of await selectPipelineStores(
      ctx,
      "weekly-recovery",
      Date.now(),
    )) {
      const control = await readPipelineControl(ctx, storeId);
      if (control?.mode !== "active") continue;
      const store = await ctx.db.get("store", storeId);
      if (!store || store.reportingReseedStartedAt !== undefined) continue;
      await ctx.scheduler.runAfter(
        0,
        makeFunctionReference<
          "mutation",
          { storeId: Id<"store">; controlFence: number }
        >("reports/pipelineWeeklyRecovery:runRecovery"),
        { storeId, controlFence: control.fence },
      );
      scheduled += 1;
    }
    return scheduled;
  },
});
export const dispatchCloseEvidence = internalMutation({
  args: {},
  returns: dispatchOutcome,
  handler: (ctx) =>
    dispatchProjectionWorkWithCtx(
      ctx,
      "close-evidence",
      makeFunctionReference<"action", PipelineWorkerClaim>(
        "reports/pipelineWorkers:runCloseEvidence",
      ),
      Date.now(),
    ),
});
export const dispatchOverview = internalMutation({
  args: {},
  returns: dispatchOutcome,
  handler: (ctx) =>
    dispatchProjectionWorkWithCtx(
      ctx,
      "overview",
      makeFunctionReference<"action", PipelineWorkerClaim>(
        "reports/pipelineWorkers:runOverview",
      ),
      Date.now(),
    ),
});

export const dispatchLegacy = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    let scheduled = 0;
    for (const storeId of await selectPipelineStores(
      ctx,
      "legacy",
      Date.now(),
    )) {
      const control = await readPipelineControl(ctx, storeId);
      if (control?.mode === "active" || control?.mode === "paused") continue;
      const store = await ctx.db.get("store", storeId);
      if (!store || store.reportingReseedStartedAt !== undefined) continue;
      await ctx.scheduler.runAfter(
        0,
        makeFunctionReference<"mutation", { storeId: Id<"store"> }>(
          "reports/pipelineDispatch:legacyStoreSweep",
        ),
        { storeId },
      );
      scheduled += 1;
    }
    return scheduled;
  },
});

export const legacyStoreSweep = internalMutation({
  args: { storeId: v.id("store") },
  returns: v.null(),
  handler: async (ctx, { storeId }) => {
    const control = await readPipelineControl(ctx, storeId);
    if (
      control?.mode === "active" ||
      control?.mode === "paused" ||
      !readStoreAllowlist().has(String(storeId))
    )
      return null;
    const store = await ctx.db.get("store", storeId);
    if (!store || store.reportingReseedStartedAt !== undefined) return null;
    await sweepWithCtx(ctx, { storeId, skipMaintenance: true });
    return null;
  },
});

export const maintenance = internalMutation({
  args: {},
  returns: v.object({
    rangesExpired: v.number(),
    movementWorkersScheduled: v.number(),
    movementChildrenExpired: v.number(),
    movementHeadersExpired: v.number(),
  }),
  handler: (ctx) => maintainReportsWithCtx(ctx, Date.now()),
});
