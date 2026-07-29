import { OperationsSummaryMetric } from "@/components/operations/OperationsSummaryMetric";
import { formatOperationsMetricComparison } from "@/components/operations/operationsMetricFormatting";
import type { ReportPeriodSnapshot } from "~/shared/reportsContract";
import {
  formatReportMoney,
  formatReportProfit,
  formatUnits,
  reportProfitHelper,
} from "./reportFormat";

/**
 * The overview's headline metrics for ONE selected window.
 *
 * Deliberately a single flat row rather than a card per period: showing
 * today, week-to-date and trailing-30 side by side produced twelve equally
 * weighted tiles with no focal point. The window is chosen above (see
 * `ReportsOverviewView`), matching how Store Pulse switches its range, and
 * the comparison rides in each metric's helper the way Daily Operations
 * does — which also states "no activity last week" plainly instead of
 * rendering a bare -100%.
 */
export function ReportPeriodMetrics({
  snapshot,
  currency,
  comparison,
  periodLabel,
  priorWindowLabel,
}: {
  snapshot: ReportPeriodSnapshot;
  currency: string;
  /** Prior-window values for the comparable metrics; omit when not comparable. */
  comparison?: { netSalesMinor?: number; unitsSold?: number };
  periodLabel: string;
  priorWindowLabel: string;
}) {
  const unsettledHelper =
    snapshot.unsettledDayCount > 0
      ? `${snapshot.unsettledDayCount} of ${snapshot.dayCount} day(s) unsettled`
      : `${snapshot.dayCount} day(s) settled`;

  return (
    <div
      className="grid gap-layout-md [grid-template-columns:repeat(auto-fit,minmax(min(14rem,100%),1fr))] md:gap-layout-lg"
      data-testid={`report-period-metrics-${periodLabel}`}
    >
      <OperationsSummaryMetric
        helper={
          comparison
            ? formatOperationsMetricComparison({
                currentValue: snapshot.netSalesMinor,
                priorValue: comparison.netSalesMinor,
                priorWindowLabel,
              })
            : unsettledHelper
        }
        label="Net sales"
        value={formatReportMoney(snapshot.netSalesMinor, currency)}
      />
      <OperationsSummaryMetric
        helper={
          comparison
            ? formatOperationsMetricComparison({
                currentValue: snapshot.unitsSold,
                priorValue: comparison.unitsSold,
                priorWindowLabel,
              })
            : undefined
        }
        label="Units sold"
        value={formatUnits(snapshot.unitsSold)}
      />
      <OperationsSummaryMetric
        helper={
          snapshot.uncostedRevenueMinor > 0
            ? `${formatReportMoney(snapshot.uncostedRevenueMinor, currency)} without item cost`
            : reportProfitHelper(snapshot.grossProfitMinor)
        }
        label="Gross profit"
        value={formatReportProfit(snapshot.grossProfitMinor, currency)}
      />
      <OperationsSummaryMetric
        helper={comparison ? unsettledHelper : undefined}
        label="Refunds"
        value={formatReportMoney(snapshot.refundsMinor, currency)}
      />
    </div>
  );
}
