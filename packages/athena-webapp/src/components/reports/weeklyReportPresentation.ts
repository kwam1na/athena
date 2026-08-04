import type { WeeklyReportProjection } from "./ReportsWeeklyView";

export function weeklyUpdatedAt(
  report: WeeklyReportProjection,
): number | null {
  const candidates = [
    report.materializedAt,
    report.acceptedAt,
    report.closePosture?.changedAt,
    report.amendment?.changedAt,
  ].filter((value): value is number => value !== undefined);
  return candidates.length > 0 ? Math.max(...candidates) : null;
}

/** Plain-language lifecycle derived only from durable Weekly projection state. */
export function weeklyLifecycleLabel(report: WeeklyReportProjection): string {
  const labels = {
    live: "In progress",
    awaiting_final_close: "Waiting for final Daily Close",
    materializing: "Updating report",
    accepted: "Final Daily Close accepted",
    reopened_awaiting_successor: "Daily Close reopened",
    successor_accepted: "New Daily Close accepted",
  } as const;
  return labels[report.lifecyclePosture];
}

/**
 * Completeness reasons whose copy tells the operator that totals are withheld
 * or unavailable. The numbers on the projection are still populated, so the
 * view must not render them beside that sentence — a figure printed under
 * "totals are unavailable" is the contradiction operators trust least.
 */
const WITHHELD_TOTALS_REASONS = new Set([
  "mixed_currency",
  "fact_cap_exceeded",
]);

/** Copy used wherever a withheld total would otherwise print a figure. */
export const WEEKLY_WITHHELD_VALUE_LABEL = "Unavailable";

/**
 * Keyed off the COMBINED verdict, not the scheduled lane's.
 *
 * The headline is now the whole labelled date range, so a limitation on either
 * lane limits the number on screen. Reading only the scheduled verdict would
 * print a confident total built partly from facts the server just said it
 * cannot total.
 */
export function weeklyTotalsWithheld(report: WeeklyReportProjection): boolean {
  return (
    !report.totalCompleteness.complete &&
    WITHHELD_TOTALS_REASONS.has(report.totalCompleteness.reason)
  );
}

/**
 * How a value drawn from `amendment?.summary ?? summary` should be named.
 * "Current" is only honest when an amendment supplies later truth; without
 * one the figure is the accepted baseline, or — before acceptance — the
 * week so far.
 */
export function weeklyValueLabelPrefix(
  report: WeeklyReportProjection,
): "Current" | "Accepted" | "Week to date" {
  if (report.current ?? report.amendment) return "Current";
  return report.lifecyclePosture === "live" ||
    report.lifecyclePosture === "awaiting_final_close" ||
    report.lifecyclePosture === "materializing"
    ? "Week to date"
    : "Accepted";
}

export function weeklyAmendmentLabel(report: WeeklyReportProjection): string {
  const labels = {
    none: "None",
    pending_recompute: "Updating",
    amended: "Updated after close",
  } as const;
  return labels[report.amendmentPosture];
}
