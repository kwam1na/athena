import { OperationsSummaryMetric } from "@/components/operations/OperationsSummaryMetric";
import type { ReportPeriodSnapshot } from "~/shared/reportsContract";
import {
  formatReportMoney,
  formatReportProfit,
  formatUnits,
} from "./reportFormat";

/** One KPI section for a period snapshot (today / week-to-date / trailing-30) — metric tiles per `OperationsSummaryMetric`. */
export function ReportPeriodCard({
  title,
  snapshot,
  currency,
  comparisonHelper,
}: {
  title: string;
  snapshot: ReportPeriodSnapshot;
  currency: string;
  /** Rendered under "Net sales" — e.g. the vs-prior-week comparison chip text. */
  comparisonHelper?: string;
}) {
  return (
    <div className="space-y-layout-sm" data-testid={`report-period-card-${title}`}>
      <h3 className="text-base font-medium text-foreground">{title}</h3>
      <div className="grid grid-cols-2 gap-layout-sm">
        <OperationsSummaryMetric
          label="Net sales"
          value={formatReportMoney(snapshot.netSalesMinor, currency)}
          helper={comparisonHelper}
        />
        <OperationsSummaryMetric
          label="Units sold"
          value={formatUnits(snapshot.unitsSold)}
        />
        <OperationsSummaryMetric
          label="Gross profit"
          value={formatReportProfit(snapshot.grossProfitMinor, currency)}
          helper={
            snapshot.uncostedRevenueMinor > 0
              ? `${formatReportMoney(snapshot.uncostedRevenueMinor, currency)} uncosted`
              : undefined
          }
        />
        <OperationsSummaryMetric
          label="Refunds"
          value={formatReportMoney(snapshot.refundsMinor, currency)}
          helper={
            snapshot.unsettledDayCount > 0
              ? `${snapshot.unsettledDayCount} of ${snapshot.dayCount} day(s) unsettled`
              : `${snapshot.dayCount} day(s)`
          }
        />
      </div>
    </div>
  );
}
