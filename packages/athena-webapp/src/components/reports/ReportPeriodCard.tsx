import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OperationsSummaryMetric } from "@/components/operations/OperationsSummaryMetric";
import type { ReportPeriodSnapshot } from "~/shared/reportsContract";
import {
  formatReportMoney,
  formatReportProfit,
  formatUnits,
} from "./reportFormat";

/** One KPI card for a period snapshot (today / week-to-date / trailing-30). */
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
    <Card data-testid={`report-period-card-${title}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-layout-sm">
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
      </CardContent>
    </Card>
  );
}
