import { Card, CardContent } from "@/components/ui/card";
import type { ReportTrustSummary } from "~/shared/reportsContract";
import { formatOperatingDate } from "./reportFormat";

/**
 * Trust strip: reconciled/provisional/amended day counts and the oldest
 * unreconciled date, straight from `ReportOverviewData["trust"]`.
 */
export function ReportTrustStrip({ trust }: { trust: ReportTrustSummary }) {
  return (
    <Card data-testid="report-trust-strip">
      <CardContent className="flex flex-wrap items-center gap-layout-lg py-4">
        <TrustFigure label="Reconciled days" value={trust.reconciledDays} />
        <TrustFigure label="Provisional days" value={trust.provisionalDays} />
        <TrustFigure label="Amended days" value={trust.amendedDays} />
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">
            Oldest unreconciled
          </p>
          <p className="text-sm font-semibold">
            {trust.oldestUnreconciledDate
              ? formatOperatingDate(trust.oldestUnreconciledDate)
              : "None"}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function TrustFigure({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase text-muted-foreground">
        {label}
      </p>
      <p className="text-sm font-semibold">{value.toLocaleString()}</p>
    </div>
  );
}
