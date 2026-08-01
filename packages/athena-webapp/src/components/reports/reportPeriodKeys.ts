import {
  dayPeriodKey,
  monthPeriodKey,
  trailingThreeMonthsStart,
  weekPeriodKey,
  type ReportPeriodKey,
} from "~/shared/reportsContract";

export const REPORT_PERIOD_TYPES = ["day", "week", "month"] as const;
export type ReportPeriodType = (typeof REPORT_PERIOD_TYPES)[number];

export const REPORT_OVERVIEW_WINDOWS = [
  "today",
  "weekToDate",
  "trailing30",
  "trailing3Months",
] as const;
export type ReportOverviewWindow =
  (typeof REPORT_OVERVIEW_WINDOWS)[number];

export const REPORT_OVERVIEW_WINDOW_LABELS: Record<
  ReportOverviewWindow,
  string
> = {
  today: "Today",
  weekToDate: "Week to date",
  trailing30: "Trailing 30 days",
  trailing3Months: "Trailing 3 months",
};

export const REPORT_PERIOD_TYPE_LABELS: Record<ReportPeriodType, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
};

export type ReportDateRange = {
  startDate: string;
  endDate: string;
};

const REPORT_DAYS_MAX_SPAN = 92;

function operatingDateToUtc(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function utcToOperatingDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addOperatingDays(value: string, days: number): string {
  const date = operatingDateToUtc(value);
  date.setUTCDate(date.getUTCDate() + days);
  return utcToOperatingDate(date);
}

/**
 * Keeps the rendered day scope stable while a new selection fits inside the
 * reporting query's 92-day read budget. A distant selection starts a fresh
 * scope instead of creating an invalid, ever-growing query range.
 */
export function tableRangeIncludingSelection(
  tableRange: ReportDateRange,
  selectedRange: ReportDateRange,
): ReportDateRange {
  const expandedRange = {
    startDate:
      selectedRange.startDate < tableRange.startDate
        ? selectedRange.startDate
        : tableRange.startDate,
    endDate:
      selectedRange.endDate > tableRange.endDate
        ? selectedRange.endDate
        : tableRange.endDate,
  };
  const inclusiveDays =
    Math.floor(
      (operatingDateToUtc(expandedRange.endDate).getTime() -
        operatingDateToUtc(expandedRange.startDate).getTime()) /
        86_400_000,
    ) + 1;

  return inclusiveDays <= REPORT_DAYS_MAX_SPAN
    ? expandedRange
    : selectedRange;
}

function isoWeekStart(value: string): string {
  const date = operatingDateToUtc(value);
  const day = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
  return addOperatingDays(value, 1 - day);
}

export function dateRangeForOverviewWindow(
  window: ReportOverviewWindow,
  anchorDate: string,
): ReportDateRange {
  switch (window) {
    case "today":
      return { startDate: anchorDate, endDate: anchorDate };
    case "weekToDate":
      return { startDate: isoWeekStart(anchorDate), endDate: anchorDate };
    case "trailing30":
      return {
        startDate: addOperatingDays(anchorDate, -29),
        endDate: anchorDate,
      };
    case "trailing3Months":
      return {
        startDate: trailingThreeMonthsStart(anchorDate),
        endDate: anchorDate,
      };
  }
}

export function dateRangeForItemsPeriod(
  periodType: ReportPeriodType,
  periodDate: string,
): ReportDateRange {
  switch (periodType) {
    case "day":
      return { startDate: periodDate, endDate: periodDate };
    case "week": {
      const startDate = isoWeekStart(periodDate);
      return { startDate, endDate: addOperatingDays(startDate, 6) };
    }
    case "month": {
      const date = operatingDateToUtc(periodDate);
      const year = date.getUTCFullYear();
      const month = date.getUTCMonth();
      return {
        startDate: utcToOperatingDate(new Date(Date.UTC(year, month, 1))),
        endDate: utcToOperatingDate(new Date(Date.UTC(year, month + 1, 0))),
      };
    }
  }
}

/** Builds the `d:`/`w:`/`m:` period key via the contract's own helpers. */
export function periodKeyForSelection(
  periodType: ReportPeriodType,
  periodDate: string,
): ReportPeriodKey {
  switch (periodType) {
    case "day":
      return dayPeriodKey(periodDate);
    case "week":
      return weekPeriodKey(periodDate);
    case "month":
      return monthPeriodKey(periodDate);
  }
}

/** Today's calendar date (UTC label) — a reasonable default anchor. */
export function todayOperatingDateGuess(): string {
  return new Date().toISOString().slice(0, 10);
}
