import {
  localDateAt,
  localDateStartAt,
  type StoreScheduleDraft,
} from "../lib/storeScheduleTime";

const DAY_MS = 86_400_000;

type WeeklySchedule = Pick<
  StoreScheduleDraft,
  | "_id"
  | "dateExceptions"
  | "effectiveFrom"
  | "effectiveTo"
  | "reportingCycleStartsOn"
  | "weeklyClosedDays"
>;

function parseDate(localDate: string) {
  const date = new Date(`${localDate}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function shiftDate(localDate: string, days: number) {
  const date = parseDate(localDate);
  if (!date) throw new Error(`Invalid local date: ${localDate}`);
  return new Date(date.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

function weekday(localDate: string) {
  const date = parseDate(localDate);
  if (!date) throw new Error(`Invalid local date: ${localDate}`);
  return date.getUTCDay();
}

function scheduleForDate(args: {
  localDate: string;
  schedules: WeeklySchedule[];
  timezone: string;
}) {
  const at = localDateStartAt(args.localDate, args.timezone);
  if (at === null) return null;
  return (
    args.schedules
      .filter(
        (schedule) =>
          schedule.effectiveFrom <= at &&
          (schedule.effectiveTo === undefined || at < schedule.effectiveTo),
      )
      .sort((left, right) => right.effectiveFrom - left.effectiveFrom)[0] ??
    null
  );
}

function isIncludedDate(schedule: WeeklySchedule, localDate: string) {
  const exception = schedule.dateExceptions.find(
    (candidate) => candidate.localDate === localDate,
  );
  if (exception) return !exception.closed;
  return !schedule.weeklyClosedDays.includes(weekday(localDate));
}

export type WeeklyPeriod =
  | {
      kind: "unavailable";
      reason: "missing_schedule" | "missing_timezone" | "schedule_history_cap";
    }
  | {
      kind: "resolved";
      startDate: string;
      endDate: string;
      includedDates: string[];
      finalScheduledDate: string | null;
      automaticFinalizationReason: "no_scheduled_dates" | null;
      dates: Array<{
        localDate: string;
        included: boolean;
        scheduleVersionId: string | null;
      }>;
    };

/**
 * Resolves weekly report membership from schedule days and exceptions only.
 * Operating-hour windows deliberately do not participate in financial totals.
 *
 * Fact dates are deliberately not an input: partitioning observed activity into
 * included versus outside-schedule buckets belongs to the folder in `weekly.ts`,
 * which walks the resolved seven-date frame and can tell "outside the frame"
 * apart from "inside the frame but not scheduled".
 */
export function resolveWeeklyPeriod(args: {
  referenceAt: number;
  timezone: string | null;
  schedules: WeeklySchedule[];
}): WeeklyPeriod {
  if (!args.timezone)
    return { kind: "unavailable", reason: "missing_timezone" };

  const referenceDate = localDateAt(args.referenceAt, args.timezone);
  const referenceSchedule = scheduleForDate({
    localDate: referenceDate,
    schedules: args.schedules,
    timezone: args.timezone,
  });
  if (!referenceSchedule)
    return { kind: "unavailable", reason: "missing_schedule" };

  const anchor = referenceSchedule.reportingCycleStartsOn ?? 1;
  const startDate = shiftDate(
    referenceDate,
    -((weekday(referenceDate) - anchor + 7) % 7),
  );
  const dates = Array.from({ length: 7 }, (_, offset) => {
    const localDate = shiftDate(startDate, offset);
    const schedule = scheduleForDate({
      localDate,
      schedules: args.schedules,
      timezone: args.timezone!,
    });
    return {
      localDate,
      included: schedule ? isIncludedDate(schedule, localDate) : false,
      scheduleVersionId: schedule?._id ? String(schedule._id) : null,
    };
  });
  if (dates.some((date) => date.scheduleVersionId === null)) {
    return { kind: "unavailable", reason: "missing_schedule" };
  }
  const includedDates = dates
    .filter((date) => date.included)
    .map((date) => date.localDate);

  return {
    kind: "resolved",
    startDate,
    endDate: shiftDate(startDate, 6),
    dates,
    includedDates,
    finalScheduledDate: includedDates.at(-1) ?? null,
    automaticFinalizationReason:
      includedDates.length === 0 ? "no_scheduled_dates" : null,
  };
}
