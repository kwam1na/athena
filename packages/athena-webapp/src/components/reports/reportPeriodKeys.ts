import {
  dayPeriodKey,
  monthPeriodKey,
  REPORT_DRILLDOWN_RANGE_MAX_DAYS,
  trailingSixMonthsStart,
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
  "trailing6Months",
] as const;
export type ReportOverviewWindow =
  (typeof REPORT_OVERVIEW_WINDOWS)[number];

/**
 * Range-picker preset windows — deliberately decoupled from
 * `REPORT_OVERVIEW_WINDOWS`. The window enum drives the overview tabs, while
 * this list drives `ReportDateRangeField` presets, so a new window can land on
 * the tabs before every preset surface (days table, SKU detail, Units moved,
 * SKU mix) can serve its span. Append a window here only when all of those
 * surfaces admit it (R3). `trailing6Months` was appended in U7 as the
 * delivery's final wire, once every one of those surfaces served the full
 * 184-day span.
 */
export const REPORT_DATE_RANGE_PRESET_WINDOWS = [
  "today",
  "weekToDate",
  "trailing30",
  "trailing3Months",
  "trailing6Months",
] as const satisfies readonly ReportOverviewWindow[];

export const REPORT_OVERVIEW_WINDOW_LABELS: Record<
  ReportOverviewWindow,
  string
> = {
  today: "Today",
  weekToDate: "Week to date",
  trailing30: "Trailing 30 days",
  trailing3Months: "Trailing 3 months",
  trailing6Months: "Trailing 6 months",
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

const REPORT_DAYS_MAX_SPAN = REPORT_DRILLDOWN_RANGE_MAX_DAYS;

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
 * reporting query's 184-day drill-down read budget
 * (`REPORT_DRILLDOWN_RANGE_MAX_DAYS`). A distant selection starts a fresh
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
    case "trailing6Months":
      return {
        startDate: trailingSixMonthsStart(anchorDate),
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

/** Move the selected calendar date by one period without skipping short months. */
export function adjacentItemsPeriodDate(
  periodType: ReportPeriodType,
  periodDate: string,
  direction: -1 | 1,
): string {
  if (periodType !== "month") {
    return addOperatingDays(
      periodDate,
      direction * (periodType === "week" ? 7 : 1),
    );
  }

  const date = operatingDateToUtc(periodDate);
  const year = date.getUTCFullYear();
  const targetMonth = date.getUTCMonth() + direction;
  const lastDay = new Date(Date.UTC(year, targetMonth + 1, 0)).getUTCDate();
  return utcToOperatingDate(
    new Date(Date.UTC(year, targetMonth, Math.min(date.getUTCDate(), lastDay))),
  );
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
