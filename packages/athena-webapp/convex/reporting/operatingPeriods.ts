import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  resolveStoreOperatingRangeForDate,
  resolveStoreOperatingWindowsForDate,
  resolveStoreScheduleContext,
  type StoreScheduleDraft,
  type StoreScheduleContextWindow,
} from "../lib/storeScheduleTime";

type PeriodCtx = Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">;

type OperatingSlice = { startsAt: number; endsAt: number };

function operatingDuration(windows: StoreScheduleContextWindow[]) {
  return windows.reduce(
    (total, window) => total + Math.max(0, window.endsAt - window.startsAt),
    0,
  );
}

function elapsedOperatingTime(
  windows: StoreScheduleContextWindow[],
  asOf: number,
) {
  return windows.reduce((total, window) => {
    const elapsedInWindow = Math.max(
      0,
      Math.min(asOf, window.endsAt) - window.startsAt,
    );
    return total + elapsedInWindow;
  }, 0);
}

function takeOperatingTime(
  windows: StoreScheduleContextWindow[],
  requestedDurationMs: number,
) {
  const slices: OperatingSlice[] = [];
  let remaining = Math.max(0, requestedDurationMs);
  for (const window of windows) {
    if (remaining <= 0) break;
    const duration = Math.max(0, window.endsAt - window.startsAt);
    const included = Math.min(duration, remaining);
    if (included > 0) {
      slices.push({
        startsAt: window.startsAt,
        endsAt: window.startsAt + included,
      });
      remaining -= included;
    }
  }
  return { remaining, slices };
}

export function buildSameElapsedOperatingComparison(args: {
  asOf: number;
  comparison: {
    operatingDate: string;
    schedule: StoreScheduleDraft | null;
  };
  current: {
    operatingDate: string;
    schedule: StoreScheduleDraft | null;
  };
}) {
  const current = resolveStoreOperatingWindowsForDate(args.current);
  const comparison = resolveStoreOperatingWindowsForDate(args.comparison);
  if (current.kind !== "resolved" || comparison.kind !== "resolved") {
    return {
      comparisonKind: comparison.kind,
      currentKind: current.kind,
      kind: "unavailable" as const,
    };
  }

  const currentTotalOperatingMs = operatingDuration(current.windows);
  const elapsedOperatingMs = Math.min(
    currentTotalOperatingMs,
    elapsedOperatingTime(current.windows, args.asOf),
  );
  const comparisonTotalOperatingMs = operatingDuration(comparison.windows);
  const comparisonSelection = takeOperatingTime(
    comparison.windows,
    elapsedOperatingMs,
  );
  const comparisonElapsedOperatingMs =
    elapsedOperatingMs - comparisonSelection.remaining;

  return {
    comparison: {
      elapsedOperatingMs: comparisonElapsedOperatingMs,
      operatingDate: args.comparison.operatingDate,
      partial: comparisonElapsedOperatingMs < comparisonTotalOperatingMs,
      scheduleVersionId: comparison.scheduleVersionId,
      slices: comparisonSelection.slices,
      totalOperatingMs: comparisonTotalOperatingMs,
      truncated: comparisonSelection.remaining > 0,
    },
    current: {
      elapsedOperatingMs,
      operatingDate: args.current.operatingDate,
      partial: elapsedOperatingMs < currentTotalOperatingMs,
      scheduleVersionId: current.scheduleVersionId,
      totalOperatingMs: currentTotalOperatingMs,
    },
    equivalent: comparisonSelection.remaining === 0,
    kind: "resolved" as const,
  };
}

export function resolveReportingOperatingPeriod(args: {
  occurrenceAt: number;
  schedule: StoreScheduleDraft | null;
}) {
  if (!args.schedule) {
    return {
      kind: "missing_schedule" as const,
      occurrenceAt: args.occurrenceAt,
    };
  }

  const context = resolveStoreScheduleContext({
    at: args.occurrenceAt,
    schedule: args.schedule,
  });
  if (context.kind !== "resolved") {
    return {
      kind: "missing_schedule" as const,
      occurrenceAt: args.occurrenceAt,
    };
  }

  const range = resolveStoreOperatingRangeForDate({
    operatingDate: context.operatingDate,
    schedule: args.schedule,
  });

  if (range.kind !== "resolved") {
    return {
      kind: range.kind,
      occurrenceAt: args.occurrenceAt,
      operatingDate: context.operatingDate,
      scheduleVersionId: String(args.schedule._id),
      timezone: args.schedule.timezone,
    };
  }

  return {
    kind: "resolved" as const,
    occurrenceAt: args.occurrenceAt,
    operatingDate: context.operatingDate,
    scheduleVersionId: String(args.schedule._id),
    timezone: args.schedule.timezone,
    startsAt: range.startAt,
    endsAt: range.endAt,
    windowCount: range.windowCount,
  };
}

async function latestEffectiveSchedule(
  ctx: PeriodCtx,
  storeId: Id<"store">,
  occurrenceAt: number,
  status: "active" | "superseded",
) {
  return await ctx.db
    .query("storeSchedule")
    .withIndex("by_storeId_status_effectiveFrom", (q) =>
      q.eq("storeId", storeId).eq("status", status).lte("effectiveFrom", occurrenceAt),
    )
    .order("desc")
    .first();
}

export async function resolveReportingOperatingPeriodWithCtx(
  ctx: PeriodCtx,
  args: { occurrenceAt: number; storeId: Id<"store"> },
) {
  const candidates = await Promise.all([
    latestEffectiveSchedule(ctx, args.storeId, args.occurrenceAt, "active"),
    latestEffectiveSchedule(ctx, args.storeId, args.occurrenceAt, "superseded"),
  ]);
  const schedule = candidates
    .filter((candidate): candidate is Doc<"storeSchedule"> => {
      return (
        candidate !== null &&
        candidate.effectiveFrom <= args.occurrenceAt &&
        (candidate.effectiveTo === undefined || args.occurrenceAt < candidate.effectiveTo)
      );
    })
    .sort((left, right) => right.effectiveFrom - left.effectiveFrom)[0];

  return resolveReportingOperatingPeriod({
    occurrenceAt: args.occurrenceAt,
    schedule: schedule ?? null,
  });
}
