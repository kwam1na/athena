import { OperationsSummaryMetric } from "@/components/operations/OperationsSummaryMetric";
import type { ReportTrustSummary } from "~/shared/reportsContract";
import { formatOperatingDate } from "./reportFormat";

/**
 * Trust strip: reconciled/provisional/amended day counts and the oldest
 * unreconciled date, straight from `ReportOverviewData["trust"]` — same
 * metric-tile grid as `ReportPeriodMetrics`/`StorePulseSummaryView`.
 */
export function ReportTrustStrip({ trust }: { trust: ReportTrustSummary }) {
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
        label="Oldest unreconciled"
        value={
          trust.oldestUnreconciledDate
            ? formatOperatingDate(trust.oldestUnreconciledDate)
            : "None"
        }
      />
    </div>
  );
}
