import {
  dayPeriodKey,
  monthPeriodKey,
  weekPeriodKey,
  type ReportPeriodKey,
} from "~/shared/reportsContract";

export const REPORT_PERIOD_TYPES = ["day", "week", "month"] as const;
export type ReportPeriodType = (typeof REPORT_PERIOD_TYPES)[number];

export const REPORT_PERIOD_TYPE_LABELS: Record<ReportPeriodType, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
};

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
