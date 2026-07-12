import type {
  ReportDateRange,
  ReportPeriodDescriptor,
  ReportPeriodPreset,
} from "../../shared/reportingContract";

const DAY_MS = 86_400_000;

function localDate(at: number, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: timezone,
    year: "numeric",
  }).formatToParts(new Date(at));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function shiftDate(date: string, days: number) {
  return new Date(Date.parse(`${date}T12:00:00.000Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

function weekday(date: string) {
  return new Date(`${date}T12:00:00.000Z`).getUTCDay();
}

function comparisonFor(range: ReportDateRange): ReportDateRange {
  return {
    startDate: shiftDate(range.startDate, -7),
    endDate: shiftDate(range.endDate, -7),
  };
}

export function resolveReportPeriod(args: {
  asOf: number;
  preset: ReportPeriodPreset;
  timezone: string;
  customRange?: ReportDateRange;
  operatingDate?: string;
  operatingDayStartsAt?: number;
  scheduleVersionId?: string;
}): ReportPeriodDescriptor {
  const today = args.operatingDate ?? localDate(args.asOf, args.timezone);
  let current: ReportDateRange;
  let comparison: ReportDateRange | null;
  if (args.preset === "custom") {
    if (!args.customRange) throw new Error("Custom range is required");
    if (args.customRange.startDate > args.customRange.endDate) {
      throw new Error("Custom range start date must be on or before end date");
    }
    current = args.customRange;
    comparison = null;
  } else if (args.preset === "week_to_date") {
    const mondayOffset = (weekday(today) + 6) % 7;
    current = { startDate: shiftDate(today, -mondayOffset), endDate: today };
    comparison = comparisonFor(current);
  } else if (args.preset === "prior_week") {
    const mondayOffset = (weekday(today) + 6) % 7;
    const endDate = shiftDate(today, -mondayOffset - 1);
    current = { startDate: shiftDate(endDate, -6), endDate };
    comparison = comparisonFor(current);
  } else if (args.preset === "trailing_30_days") {
    current = { startDate: shiftDate(today, -29), endDate: today };
    comparison = {
      startDate: shiftDate(current.startDate, -30),
      endDate: shiftDate(current.endDate, -30),
    };
  } else {
    current = { startDate: today, endDate: today };
    comparison = comparisonFor(current);
  }
  return {
    preset: args.preset,
    timezone: args.timezone,
    evaluatedAt: args.asOf,
    current,
    comparison,
    partialOperatingDates:
      current.startDate <= today && today <= current.endDate ? [today] : [],
    operatingDate: today,
    scheduleVersionId: args.scheduleVersionId,
    sameElapsed: {
      comparisonOperatingDate: comparison?.endDate ?? null,
      currentCutoffAt: args.asOf,
      elapsedOperatingMs: args.operatingDayStartsAt === undefined
        ? null
        : Math.max(0, args.asOf - args.operatingDayStartsAt),
    },
  };
}
