import { OperationsSummaryMetric } from "@/components/operations/OperationsSummaryMetric";
import type { ReportTrustSummary } from "~/shared/reportsContract";
import { reportOldestUnreconciledPresentation } from "./reportFormat";

/**
 * Trust strip: reconciled/provisional/amended day counts and the oldest
 * unreconciled date, straight from `ReportOverviewData["trust"]` — same
 * metric-tile grid as `ReportPeriodMetrics`/`StorePulseSummaryView`.
 */
export function ReportTrustStrip({
  trust,
  today,
}: {
  trust: ReportTrustSummary;
  /** Operating date to measure staleness against; defaults to the local day. */
  today?: string;
}) {
  const oldestUnreconciled = reportOldestUnreconciledPresentation(
    trust.oldestUnreconciledDate,
    today ?? new Date().toISOString().slice(0, 10),
  );

  return (
    <div
      className="grid grid-cols-2 gap-layout-sm xl:grid-cols-4"
      data-testid="report-trust-strip"
    >
      <OperationsSummaryMetric
        label="Reconciled days"
        value={trust.reconciledDays.toLocaleString()}
      />
      <OperationsSummaryMetric
        label="Provisional days"
        value={trust.provisionalDays.toLocaleString()}
      />
      <OperationsSummaryMetric
        label="Amended days"
        value={trust.amendedDays.toLocaleString()}
      />
      <OperationsSummaryMetric
        helper={oldestUnreconciled.helper}
        label="Oldest unreconciled"
        value={oldestUnreconciled.value}
      />
    </div>
  );
}
