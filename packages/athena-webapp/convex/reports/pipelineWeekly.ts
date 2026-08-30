import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import {
  internalAction,
  internalMutation,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import {
  hasCompletedWeeklyObservedAtVerification,
  isCloseWithinWeeklyAcceptanceFloor,
} from "../platform/capabilityCatalog";
import { isActiveAcceptedClose } from "./closeEvidence";
import { addDaysToDate } from "./rollups";
import {
  enqueueReportWork,
  completeReportWorkWithCtx,
  failReportWorkWithCtx,
} from "./pipelineWork";
import {
  admitPipelineWork,
  runPipelineMutation,
  pipelineWorkerClaimFields,
  pipelineWorkerOutcome,
  type PipelineWorkerClaim,
} from "./pipelineWorkers";
import {
  recordPipelineOutcomeWithCtx,
  type PipelineTerminalDisposition,
} from "./pipelineEvidence";
import {
  materializeAcceptedWeek,
  rebuildCurrentWeek,
  refreshAcceptedWeek,
  resolvePeriodForOperatingDate,
  WEEKLY_CLOSE_VERSION_LIMIT,
} from "./weekly";

export type WeeklyCycleFrame = { cycleStartDate: string; cycleEndDate: string };
/** Exact indexed probes: an old acceptance cannot silence unrelated cycles. */
export async function hasPendingWeeklyWorkWithCtx(
  ctx: Pick<QueryCtx, "db">,
  storeId: Id<"store">,
  frame: WeeklyCycleFrame | null,
  includeCurrent = true,
  includeInventory = false,
) {
  if (
    includeInventory &&
    (await ctx.db
      .query("reportPipelineWork")
      .withIndex("by_storeId_kind_createdAt", (q) =>
        q.eq("storeId", storeId).eq("kind", "inventory"),
      )
      .first())
  )
    return true;
  if (
    includeCurrent &&
    (await ctx.db
      .query("reportPipelineWork")
      .withIndex("by_storeId_kind_createdAt", (q) =>
        q.eq("storeId", storeId).eq("kind", "current"),
      )
      .first())
  )
    return true;
  for (const kind of ["accept", "refresh"] as const) {
    const row = frame
      ? await ctx.db
          .query("reportPipelineWork")
          .withIndex("by_storeId_kind_cycleStartDate", (q) =>
            q
              .eq("storeId", storeId)
              .eq("kind", kind)
              .eq("cycleStartDate", frame.cycleStartDate),
          )
          .first()
      : await ctx.db
          .query("reportPipelineWork")
          .withIndex("by_storeId_kind_createdAt", (q) =>
            q.eq("storeId", storeId).eq("kind", kind),
          )
          .first();
    if (row) return true;
  }
  const date = frame
    ? await ctx.db
        .query("reportPipelineWork")
        .withIndex("by_storeId_kind_operatingDate", (q) =>
          q
            .eq("storeId", storeId)
            .eq("kind", "resolve-week-date")
            .gte("operatingDate", frame.cycleStartDate)
            .lte("operatingDate", frame.cycleEndDate),
        )
        .first()
    : await ctx.db
        .query("reportPipelineWork")
        .withIndex("by_storeId_kind_createdAt", (q) =>
          q.eq("storeId", storeId).eq("kind", "resolve-week-date"),
        )
        .first();
  if (date) return true;
  if (!frame) return false;
  return Boolean(
    await ctx.db
      .query("reportDirtyDay")
      .withIndex("by_storeId_operatingDate", (q) =>
        q
          .eq("storeId", storeId)
          .gte("operatingDate", frame.cycleStartDate)
          .lte("operatingDate", frame.cycleEndDate),
      )
      .first(),
  );
}

type WeeklyOutcome =
  { status: "done"; disposition: string } | { status: "blocked"; code: string };

/** Seven-day immutable frames have at most seven distinct starts covering a date. */
const WEEKLY_ACCEPTED_OVERLAP_LIMIT = 7;

export async function resolveWeekDateWithCtx(
  ctx: MutationCtx,
  storeId: Id<"store">,
  operatingDate: string,
  now: number,
): Promise<WeeklyOutcome> {
  const candidates = await ctx.db
    .query("reportWeekAccepted")
    .withIndex("by_storeId_cycleStartDate", (q) =>
      q
        .eq("storeId", storeId)
        .gte("cycleStartDate", addDaysToDate(operatingDate, -6))
        .lte("cycleStartDate", operatingDate),
    )
    .take(WEEKLY_ACCEPTED_OVERLAP_LIMIT + 1);
  if (candidates.length > WEEKLY_ACCEPTED_OVERLAP_LIMIT)
    return { status: "blocked", code: "capacity_exceeded" };
  const accepted = candidates.filter(
    (frame) => operatingDate <= frame.cycleEndDate,
  );
  if (accepted.length > 0) {
    for (const frame of accepted)
      await enqueueReportWork(
        ctx,
        { storeId, kind: "refresh", cycleStartDate: frame.cycleStartDate },
        now,
      );
    return { status: "done", disposition: "existing-frame" };
  }
  const period = await resolvePeriodForOperatingDate(
    ctx,
    storeId,
    operatingDate,
  );
  if (period.kind !== "resolved")
    return period.reason === "missing_schedule"
      ? { status: "done", disposition: "outside-schedule-history" }
      : { status: "blocked", code: period.reason };
  if (period.finalScheduledDate !== operatingDate)
    return { status: "done", disposition: "not-final-date" };
  const versions = await ctx.db
    .query("reportCloseEvidence")
    .withIndex("by_storeId_operatingDate", (q) =>
      q.eq("storeId", storeId).eq("operatingDate", operatingDate),
    )
    .take(WEEKLY_CLOSE_VERSION_LIMIT + 1);
  if (versions.length > WEEKLY_CLOSE_VERSION_LIMIT)
    return { status: "blocked", code: "capacity_exceeded" };
  const close = versions
    .filter(isActiveAcceptedClose)
    .sort(
      (a, b) =>
        (b.completedAt ?? b.sourceUpdatedAt) -
        (a.completedAt ?? a.sourceUpdatedAt),
    )[0];
  if (!close) {
    const day = await ctx.db
      .query("reportDay")
      .withIndex("by_storeId_operatingDate", (q) =>
        q.eq("storeId", storeId).eq("operatingDate", operatingDate),
      )
      .unique();
    if (day?.closeId && !versions.some((row) => row.closeId === day.closeId)) {
      await enqueueReportWork(
        ctx,
        { storeId, kind: "close-evidence", closeId: day.closeId },
        now,
      );
      return { status: "blocked", code: "missing_evidence" };
    }
    return { status: "done", disposition: "no-active-close" };
  }
  if (close.completedAt === undefined)
    return { status: "blocked", code: "missing_evidence" };
  const store = await ctx.db.get("store", storeId);
  if (!store || !isCloseWithinWeeklyAcceptanceFloor(store, close.completedAt))
    return { status: "done", disposition: "before-acceptance-floor" };
  // Enqueue preserves cutoff write-once; retrying never uses updatedAt/now.
  await enqueueReportWork(
    ctx,
    {
      storeId,
      kind: "accept",
      cycleStartDate: period.startDate,
      closeId: close.closeId,
      cutoffObservedAt: close.completedAt,
    },
    now,
  );
  return { status: "done", disposition: "acceptance-handed-off" };
}

async function acceptWithCtx(
  ctx: MutationCtx,
  row: Extract<Doc<"reportPipelineWork">, { kind: "accept" }>,
  now: number,
): Promise<WeeklyOutcome> {
  const baseline = await ctx.db
    .query("reportWeekAccepted")
    .withIndex("by_storeId_cycleStartDate", (q) =>
      q.eq("storeId", row.storeId).eq("cycleStartDate", row.cycleStartDate),
    )
    .unique();
  if (baseline)
    return {
      status: "done",
      disposition:
        baseline.closeId === row.closeId
          ? "already-accepted-same-identity"
          : "cycle-owned-by-immutable-baseline",
    };
  const header = await ctx.db
    .query("reportCloseEvidence")
    .withIndex("by_closeId", (q) => q.eq("closeId", row.closeId))
    .unique();
  if (!header || header.storeId !== row.storeId) {
    await enqueueReportWork(
      ctx,
      { storeId: row.storeId, kind: "close-evidence", closeId: row.closeId },
      now,
    );
    return { status: "blocked", code: "missing_evidence" };
  }
  if (!isActiveAcceptedClose(header)) {
    await enqueueReportWork(
      ctx,
      {
        storeId: row.storeId,
        kind: "refresh",
        cycleStartDate: row.cycleStartDate,
      },
      now,
    );
    await enqueueReportWork(
      ctx,
      {
        storeId: row.storeId,
        kind: "resolve-week-date",
        operatingDate: header.operatingDate,
      },
      now,
    );
    return { status: "done", disposition: "obsolete-reopened-or-superseded" };
  }
  const store = await ctx.db.get("store", row.storeId);
  if (!store || !hasCompletedWeeklyObservedAtVerification(store))
    return { status: "blocked", code: "coverage_incomplete" };
  if (!isCloseWithinWeeklyAcceptanceFloor(store, row.cutoffObservedAt))
    return { status: "done", disposition: "before-acceptance-floor" };
  const period = await resolvePeriodForOperatingDate(
    ctx,
    row.storeId,
    header.operatingDate,
  );
  if (period.kind !== "resolved")
    return { status: "blocked", code: period.reason };
  if (
    period.startDate !== row.cycleStartDate ||
    period.finalScheduledDate !== header.operatingDate
  ) {
    await enqueueReportWork(
      ctx,
      {
        storeId: row.storeId,
        kind: "resolve-week-date",
        operatingDate: header.operatingDate,
      },
      now,
    );
    return { status: "done", disposition: "schedule-no-longer-eligible" };
  }
  const result = await materializeAcceptedWeek({
    ctx,
    storeId: row.storeId,
    closeId: row.closeId,
    cycleStartDate: row.cycleStartDate,
    cutoffObservedAt: row.cutoffObservedAt,
    acceptedAt: row.cutoffObservedAt,
    now,
  });
  return result === "created" || result === "existing"
    ? { status: "done", disposition: result }
    : {
        status: "blocked",
        code:
          result === "incomplete"
            ? "coverage_incomplete"
            : "matching_fold_pending",
      };
}

export async function processWeeklyWorkWithCtx(
  ctx: MutationCtx,
  claim: PipelineWorkerClaim,
  now: number,
) {
  const admission = await admitPipelineWork(ctx, claim, now);
  if (admission.status !== "ready") return admission.status;
  const row = admission.row;
  let outcome: WeeklyOutcome;
  switch (row.kind) {
    case "resolve-week-date":
      outcome = await resolveWeekDateWithCtx(
        ctx,
        row.storeId,
        row.operatingDate,
        now,
      );
      break;
    case "accept":
      outcome = await acceptWithCtx(ctx, row, now);
      break;
    case "current": {
      const rebuilt = await rebuildCurrentWeek(ctx, row.storeId, now);
      outcome =
        rebuilt === "rebuilt"
          ? { status: "done", disposition: "rebuilt" }
          : { status: "blocked", code: "coverage_incomplete" };
      break;
    }
    case "refresh": {
      const accepted = await ctx.db
        .query("reportWeekAccepted")
        .withIndex("by_storeId_cycleStartDate", (q) =>
          q.eq("storeId", row.storeId).eq("cycleStartDate", row.cycleStartDate),
        )
        .unique();
      outcome =
        !accepted || (await refreshAcceptedWeek(ctx, accepted, now))
          ? {
              status: "done",
              disposition: accepted ? "refreshed" : "no-baseline",
            }
          : { status: "blocked", code: "matching_fold_pending" };
      break;
    }
    default:
      return "stale" as const;
  }
  if (outcome.status === "blocked") {
    await failReportWorkWithCtx(
      ctx,
      claim,
      { code: outcome.code, blocked: true },
      now,
    );
    await recordPipelineOutcomeWithCtx(ctx, {
      storeId: claim.storeId,
      lane: claim.kind,
      now,
      outcome: "blocked",
    });
    return "blocked" as const;
  }
  const result = await completeReportWorkWithCtx(ctx, claim, now);
  const terminalDispositions: Record<string, PipelineTerminalDisposition> = {
    "outside-schedule-history": "outside_schedule_history",
    "obsolete-reopened-or-superseded": "obsolete_close",
    "cycle-owned-by-immutable-baseline": "cycle_owned",
    "before-acceptance-floor": "before_acceptance_floor",
    "schedule-no-longer-eligible": "schedule_changed",
    "no-active-close": "no_active_close",
  };
  if (result === "applied")
    await recordPipelineOutcomeWithCtx(ctx, {
      storeId: claim.storeId,
      lane: claim.kind,
      now,
      outcome: "applied",
      terminalDisposition: terminalDispositions[outcome.disposition],
    });
  return result;
}

export const applyResolveWeekDate = internalMutation({
  args: pipelineWorkerClaimFields,
  returns: pipelineWorkerOutcome,
  handler: (ctx, claim) =>
    claim.kind === "resolve-week-date"
      ? processWeeklyWorkWithCtx(ctx, claim, Date.now())
      : Promise.resolve("stale" as const),
});
export const runResolveWeekDate = internalAction({
  args: pipelineWorkerClaimFields,
  returns: v.null(),
  handler: (ctx, claim) =>
    runPipelineMutation(
      ctx,
      claim,
      makeFunctionReference<"mutation", PipelineWorkerClaim>(
        "reports/pipelineWeekly:applyResolveWeekDate",
      ),
    ),
});
export const applyCurrent = internalMutation({
  args: pipelineWorkerClaimFields,
  returns: pipelineWorkerOutcome,
  handler: (ctx, claim) =>
    claim.kind === "current"
      ? processWeeklyWorkWithCtx(ctx, claim, Date.now())
      : Promise.resolve("stale" as const),
});
export const runCurrent = internalAction({
  args: pipelineWorkerClaimFields,
  returns: v.null(),
  handler: (ctx, claim) =>
    runPipelineMutation(
      ctx,
      claim,
      makeFunctionReference<"mutation", PipelineWorkerClaim>(
        "reports/pipelineWeekly:applyCurrent",
      ),
    ),
});
export const applyAccept = internalMutation({
  args: pipelineWorkerClaimFields,
  returns: pipelineWorkerOutcome,
  handler: (ctx, claim) =>
    claim.kind === "accept"
      ? processWeeklyWorkWithCtx(ctx, claim, Date.now())
      : Promise.resolve("stale" as const),
});
export const runAccept = internalAction({
  args: pipelineWorkerClaimFields,
  returns: v.null(),
  handler: (ctx, claim) =>
    runPipelineMutation(
      ctx,
      claim,
      makeFunctionReference<"mutation", PipelineWorkerClaim>(
        "reports/pipelineWeekly:applyAccept",
      ),
    ),
});
export const applyRefresh = internalMutation({
  args: pipelineWorkerClaimFields,
  returns: pipelineWorkerOutcome,
  handler: (ctx, claim) =>
    claim.kind === "refresh"
      ? processWeeklyWorkWithCtx(ctx, claim, Date.now())
      : Promise.resolve("stale" as const),
});
export const runRefresh = internalAction({
  args: pipelineWorkerClaimFields,
  returns: v.null(),
  handler: (ctx, claim) =>
    runPipelineMutation(
      ctx,
      claim,
      makeFunctionReference<"mutation", PipelineWorkerClaim>(
        "reports/pipelineWeekly:applyRefresh",
      ),
    ),
});
