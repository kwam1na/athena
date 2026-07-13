import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  isValidStoreTimezone,
  resolveStoreCalendarRangeForDate,
  resolveStoreOperatingRangeForDate,
  resolveStoreOperatingWindowsForDate,
  resolveStoreScheduleContext,
  type StoreScheduleDraft,
  type StoreScheduleContextWindow,
} from "../lib/storeScheduleTime";
import { resolveStoreTimeAuthority } from "./storeTimeAuthority";

type PeriodCtx = Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">;

type OperatingSlice = { startsAt: number; endsAt: number };

const REPORTING_REFERENCE_LOOKBACK_DAYS = 366;

function reportingDateAt(occurrenceAt: number, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: timezone,
    year: "numeric",
  }).formatToParts(new Date(occurrenceAt));
  const values = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

export function resolveReportingFinancialPeriod(args: {
  occurrenceAt: number;
  schedule: StoreScheduleDraft | null;
  timezoneAuthority: {
    timezone: string;
    timezoneVersionId: string;
    timezoneVersionHash: string;
  } | null;
}) {
  if (!args.timezoneAuthority) {
    return {
      kind: "missing_timezone_authority" as const,
      occurrenceAt: args.occurrenceAt,
    };
  }
  if (
    !isValidStoreTimezone(args.timezoneAuthority.timezone) ||
    !args.timezoneAuthority.timezoneVersionId.trim() ||
    !args.timezoneAuthority.timezoneVersionHash.trim()
  ) {
    return {
      kind: "invalid_timezone_authority" as const,
      occurrenceAt: args.occurrenceAt,
      timezoneVersionId: args.timezoneAuthority.timezoneVersionId,
    };
  }
  // Store timezone authority owns financial dating. A mismatched schedule is
  // untrusted optional context and must never suppress otherwise valid money.
  const contextualSchedule =
    args.schedule?.timezone === args.timezoneAuthority.timezone
      ? args.schedule
      : null;
  const schedule = contextualSchedule
    ? resolveStoreScheduleContext({
        at: args.occurrenceAt,
        schedule: contextualSchedule,
      })
    : null;
  const scheduleContext = !schedule || schedule.kind !== "resolved"
    ? { kind: "unavailable" as const }
    : schedule.phase === "closed"
      ? {
          kind: "closed" as const,
          operatingDate: schedule.operatingDate,
          scheduleVersionId: schedule.scheduleVersionId,
        }
      : schedule.isOpen
        ? {
            kind: "within_hours" as const,
            operatingDate: schedule.operatingDate,
            scheduleVersionId: schedule.scheduleVersionId,
          }
        : {
            kind: "outside_hours" as const,
            operatingDate: schedule.operatingDate,
            phase: schedule.phase,
            scheduleVersionId: schedule.scheduleVersionId,
          };

  return {
    kind: "resolved" as const,
    occurrenceAt: args.occurrenceAt,
    recognitionAt: args.occurrenceAt,
    reportingDate: reportingDateAt(
      args.occurrenceAt,
      args.timezoneAuthority.timezone,
    ),
    scheduleContext,
    timezone: args.timezoneAuthority.timezone,
    timezoneVersionHash: args.timezoneAuthority.timezoneVersionHash,
    timezoneVersionId: args.timezoneAuthority.timezoneVersionId,
  };
}

export async function resolveReportingFinancialPeriodWithCtx(
  ctx: PeriodCtx,
  args: {
    occurrenceAt: number;
    organizationId: Id<"organization">;
    storeId: Id<"store">;
  },
) {
  const [timezoneVersions, activeSchedule, supersededSchedule] = await Promise.all([
    ctx.db
      .query("storeTimezoneVersion")
      .withIndex("by_storeId_effectiveFrom", (q) =>
        q.eq("storeId", args.storeId).lte("effectiveFrom", args.occurrenceAt),
      )
      .order("desc")
      .take(2),
    latestEffectiveSchedule(ctx, args.storeId, args.occurrenceAt, "active"),
    latestEffectiveSchedule(ctx, args.storeId, args.occurrenceAt, "superseded"),
  ]);
  const authority = resolveStoreTimeAuthority({
    occurrenceAt: args.occurrenceAt,
    organizationId: String(args.organizationId),
    storeId: String(args.storeId),
    versions: timezoneVersions.map((version) => ({
      ...version,
      _id: String(version._id),
      authorizedByUserId: String(version.authorizedByUserId),
      organizationId: String(version.organizationId),
      storeId: String(version.storeId),
    })),
  });
  if (authority.kind !== "resolved") return authority;

  const schedule = [activeSchedule, supersededSchedule]
    .filter((candidate): candidate is Doc<"storeSchedule"> =>
      candidate !== null &&
      candidate.effectiveFrom <= args.occurrenceAt &&
      (candidate.effectiveTo === undefined || args.occurrenceAt < candidate.effectiveTo),
    )
    .sort((left, right) => right.effectiveFrom - left.effectiveFrom)[0] ?? null;

  return resolveReportingFinancialPeriod({
    occurrenceAt: args.occurrenceAt,
    schedule,
    timezoneAuthority: authority,
  });
}

function shiftDate(date: string, days: number) {
  return new Date(Date.parse(`${date}T12:00:00.000Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

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

export function resolveReportingReferencePeriod(args: {
  occurrenceAt: number;
  schedule: StoreScheduleDraft | null;
}) {
  const current = resolveReportingOperatingPeriod(args);
  if (current.kind === "resolved") {
    return { ...current, referenceAt: args.occurrenceAt };
  }
  if (!args.schedule || !current.operatingDate) return current;

  for (let offset = 1; offset <= REPORTING_REFERENCE_LOOKBACK_DAYS; offset += 1) {
    const operatingDate = shiftDate(current.operatingDate, -offset);
    const range = resolveStoreOperatingRangeForDate({
      operatingDate,
      schedule: args.schedule,
    });
    if (range.kind !== "resolved") continue;
    return {
      ...range,
      kind: "resolved" as const,
      occurrenceAt: args.occurrenceAt,
      operatingDate,
      referenceAt: range.endAt,
      scheduleVersionId: String(args.schedule._id),
      timezone: args.schedule.timezone,
      startsAt: range.startAt,
      endsAt: range.endAt,
    };
  }

  return current;
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

export async function resolveReportingReferencePeriodWithCtx(
  ctx: PeriodCtx,
  args: { occurrenceAt: number; storeId: Id<"store"> },
) {
  const current = await resolveReportingOperatingPeriodWithCtx(ctx, args);
  if (current.kind === "resolved") {
    return { ...current, referenceAt: args.occurrenceAt };
  }
  if (!current.operatingDate) return current;

  for (let offset = 1; offset <= REPORTING_REFERENCE_LOOKBACK_DAYS; offset += 1) {
    const operatingDate = shiftDate(current.operatingDate, -offset);
    const range = await resolveReportingOperatingDateRangeWithCtx(ctx, {
      operatingDate,
      storeId: args.storeId,
    });
    if (range.kind !== "resolved") continue;
    return {
      endsAt: range.endAt,
      kind: "resolved" as const,
      occurrenceAt: args.occurrenceAt,
      operatingDate,
      referenceAt: range.endAt,
      scheduleVersionId: String(range.scheduleVersionId),
      startsAt: range.startAt,
      timezone: range.timezone,
      windowCount: range.windowCount,
    };
  }

  return current;
}

/** Resolve the store-local calendar reference used by financial presets.
 * Opening-hours configuration is intentionally not part of this boundary. */
export async function resolveReportingCalendarReferenceWithCtx(
  ctx: PeriodCtx,
  args: { occurrenceAt: number; storeId: Id<"store"> },
) {
  const store = await ctx.db.get("store", args.storeId);
  if (!store) {
    return { kind: "missing_store" as const, occurrenceAt: args.occurrenceAt };
  }
  const period = await resolveReportingFinancialPeriodWithCtx(ctx, {
    occurrenceAt: args.occurrenceAt,
    organizationId: store.organizationId,
    storeId: args.storeId,
  });
  if (period.kind !== "resolved") return period;
  return {
    kind: "resolved" as const,
    occurrenceAt: args.occurrenceAt,
    operatingDate: period.reportingDate,
    referenceAt: args.occurrenceAt,
    scheduleContext: period.scheduleContext,
    timezone: period.timezone,
    timezoneVersionHash: period.timezoneVersionHash,
    timezoneVersionId: period.timezoneVersionId,
  };
}

export async function resolveReportingCalendarDateRangeWithCtx(
  ctx: PeriodCtx,
  args: { reportingDate: string; storeId: Id<"store"> },
) {
  const versions = await ctx.db
    .query("storeTimezoneVersion")
    .withIndex("by_storeId_effectiveFrom", (q) => q.eq("storeId", args.storeId))
    .order("desc")
    .take(100);
  for (const version of versions) {
    const range = resolveStoreCalendarRangeForDate({
      localDate: args.reportingDate,
      timezone: version.timezone,
    });
    if (
      range.kind !== "resolved" ||
      version.effectiveFrom > range.startAt ||
      (version.effectiveTo !== undefined && range.startAt >= version.effectiveTo)
    ) {
      continue;
    }
    return {
      ...range,
      reportingDate: args.reportingDate,
      timezone: version.timezone,
      timezoneVersionHash: version.contentHash,
      timezoneVersionId: version._id,
    };
  }
  return { kind: "missing_timezone_authority" as const, reportingDate: args.reportingDate };
}

/** Resolve an operating-date evidence window from the schedule version that
 * actually governed that date. This is intentionally server-owned: callers
 * must not manufacture UTC-midnight boundaries for store-local evidence. */
export async function resolveReportingOperatingDateRangeWithCtx(
  ctx: PeriodCtx,
  args: { operatingDate: string; storeId: Id<"store"> },
) {
  const schedules = (await Promise.all(
    (["active", "superseded"] as const).map((status) =>
      ctx.db.query("storeSchedule")
        .withIndex("by_storeId_status_effectiveFrom", (q) =>
          q.eq("storeId", args.storeId).eq("status", status),
        )
        .order("desc")
        .take(100),
    ),
  )).flat().sort((left, right) => right.effectiveFrom - left.effectiveFrom);
  for (const schedule of schedules) {
    const range = resolveStoreOperatingRangeForDate({
      operatingDate: args.operatingDate,
      schedule,
    });
    if (range.kind !== "resolved") continue;
    if (schedule.effectiveFrom > range.startAt ||
      (schedule.effectiveTo !== undefined && range.startAt >= schedule.effectiveTo)) continue;
    return {
      endAt: range.endAt,
      kind: "resolved" as const,
      operatingDate: args.operatingDate,
      scheduleVersionId: schedule._id,
      startAt: range.startAt,
      timezone: schedule.timezone,
      windowCount: range.windowCount,
    };
  }
  return { kind: "missing_schedule" as const, operatingDate: args.operatingDate };
}
