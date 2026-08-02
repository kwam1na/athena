import type { WeeklyReportProjection } from "./ReportsWeeklyView";

/** Plain-language lifecycle derived only from durable Weekly projection state. */
export function weeklyLifecycleLabel(report: WeeklyReportProjection): string {
  const labels = {
    live: "Live week to date",
    awaiting_final_close: "Awaiting final Daily Close",
    materializing: "Materializing scheduled activity",
    accepted: "Accepted week",
    reopened_awaiting_successor: "Reopened — awaiting a successor close",
    successor_accepted: "Accepted — successor close recorded",
  } as const;
  return labels[report.lifecyclePosture];
}

export function weeklyAmendmentLabel(report: WeeklyReportProjection): string {
  const labels = {
    none: "No amendment",
    pending_recompute: "Recomputing amendment",
    amended: "Amended",
  } as const;
  return labels[report.amendmentPosture];
}
