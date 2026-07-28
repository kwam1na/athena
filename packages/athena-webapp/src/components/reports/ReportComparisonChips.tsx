import { cn } from "@/lib/utils";
import type { ReportOverviewData } from "~/shared/reportsContract";
import { formatBasisPoints } from "./reportFormat";

function chipTone(bp: number | null) {
  if (bp === null) return "text-muted-foreground";
  if (bp > 0) return "text-success";
  if (bp < 0) return "text-destructive";
  return "text-muted-foreground";
}

/**
 * Renders the overview's `comparisons` block. Every key on the type is
 * rendered explicitly — TypeScript makes a missing key a compile error, so
 * "—" only ever means "value is null", never "we forgot a field".
 */
export function ReportComparisonChips({
  comparisons,
}: {
  comparisons: ReportOverviewData["comparisons"];
}) {
  return (
    <dl className="flex flex-wrap gap-layout-md" data-testid="report-comparison-chips">
      <div>
        <dt className="text-xs font-medium uppercase text-muted-foreground">
          Net sales vs prior week
        </dt>
        <dd
          className={cn("text-sm font-semibold", chipTone(comparisons.netSalesVsPriorWeekBp))}
        >
          {formatBasisPoints(comparisons.netSalesVsPriorWeekBp)}
        </dd>
      </div>
      <div>
        <dt className="text-xs font-medium uppercase text-muted-foreground">
          Units sold vs prior week
        </dt>
        <dd
          className={cn("text-sm font-semibold", chipTone(comparisons.unitsSoldVsPriorWeekBp))}
        >
          {formatBasisPoints(comparisons.unitsSoldVsPriorWeekBp)}
        </dd>
      </div>
    </dl>
  );
}
