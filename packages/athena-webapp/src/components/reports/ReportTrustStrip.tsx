import type { ReportTrustSummary } from "~/shared/reportsContract";
import { reportOldestUnreconciledPresentation } from "./reportFormat";

/**
 * A quiet, window-independent summary of recent reporting status. This is
 * informational context, not an operational workspace, so normal and
 * exceptional states share one readable line instead of competing KPI cards.
 */
export function ReportTrustStrip({
  reportedDayCount,
  trust,
  today,
}: {
  reportedDayCount: number;
  trust: ReportTrustSummary;
  /** Operating date to measure staleness against; defaults to the local day. */
  today?: string;
}) {
  if (trust.projectionStatus === "pending" || trust.projectionStatus === "blocked") {
    return (
      <p className="text-sm leading-6 text-muted-foreground" data-testid="report-trust-summary" role="status">
        {trust.projectionStatus === "blocked" ? "Report update delayed." : "Reports updating."}
        {" Showing the last completed snapshot."}
      </p>
    );
  }
  const oldestUnreconciled = reportOldestUnreconciledPresentation(
    trust.oldestUnreconciledDate,
    today ?? new Date().toISOString().slice(0, 10),
  );
  const classifiedDayCount =
    trust.reconciledDays + trust.provisionalDays + trust.amendedDays;
  const inProgressDayCount = Math.max(
    0,
    reportedDayCount - classifiedDayCount,
  );
  const reportedDayLabel = reportedDayCount === 1 ? "day" : "days";
  const segments = [
    "30-day trend",
    `${trust.reconciledDays.toLocaleString()} of ${reportedDayCount.toLocaleString()} reported ${reportedDayLabel} reconciled`,
  ];

  if (inProgressDayCount === 1 && oldestUnreconciled.value === "Today") {
    segments.push("Today in progress");
  } else if (inProgressDayCount > 0) {
    segments.push(`${inProgressDayCount.toLocaleString()} in progress`);
  }

  if (trust.provisionalDays > 0) {
    segments.push(
      `${trust.provisionalDays.toLocaleString()} awaiting reconciliation`,
    );
  }

  if (trust.amendedDays > 0) {
    segments.push(
      `${trust.amendedDays.toLocaleString()} amended after close`,
    );
  }

  if (
    trust.oldestUnreconciledDate &&
    oldestUnreconciled.value !== "Today" &&
    oldestUnreconciled.helper
  ) {
    segments.push(`Oldest unsettled ${oldestUnreconciled.helper}`);
  }

  return (
    <p
      className="text-sm leading-6 text-muted-foreground"
      data-testid="report-trust-summary"
    >
      {segments.join(" · ")}
    </p>
  );
}
