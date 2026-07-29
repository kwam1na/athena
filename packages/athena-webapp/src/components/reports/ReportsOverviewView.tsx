import { useQuery } from "convex/react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/states/empty/empty-state";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { api } from "~/convex/_generated/api";
import { formatBasisPoints } from "./reportFormat";
import { ReportComparisonChips } from "./ReportComparisonChips";
import { ReportPeriodCard } from "./ReportPeriodCard";
import { ReportTrendChart } from "./ReportTrendChart";
import { ReportTrustStrip } from "./ReportTrustStrip";

/**
 * Overview tab. Subscribes to `reports.queries.getOverview` ONLY — one
 * query, one document — per the contract's read budget.
 */
export function ReportsOverviewView() {
  const { activeStore } = useGetActiveStore();
  const overview = useQuery(
    api.reports.queries.getOverview,
    activeStore?._id ? { storeId: activeStore._id } : "skip",
  );

  if (activeStore === null || overview === undefined) {
    return (
      <div
        className="space-y-layout-xl md:space-y-layout-2xl"
        role="status"
        aria-label="Loading report overview"
      >
        <div className="grid grid-cols-1 gap-layout-md lg:grid-cols-3">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (overview === null) {
    return (
      <EmptyState
        title="No report data yet"
        description="This store has no reporting data materialized yet. Check back once activity has been recorded."
      />
    );
  }

  const { currency } = overview;

  return (
    <section
      className="space-y-layout-xl md:space-y-layout-2xl"
      data-testid="reports-overview"
    >
      <ReportComparisonChips comparisons={overview.comparisons} />
      <div className="grid grid-cols-1 gap-layout-lg lg:grid-cols-3">
        <ReportPeriodCard
          currency={currency}
          snapshot={overview.today}
          title="Today"
        />
        <ReportPeriodCard
          comparisonHelper={`${formatBasisPoints(overview.comparisons.netSalesVsPriorWeekBp)} vs prior week`}
          currency={currency}
          snapshot={overview.weekToDate}
          title="Week to date"
        />
        <ReportPeriodCard
          currency={currency}
          snapshot={overview.trailing30}
          title="Trailing 30 days"
        />
      </div>
      <ReportTrendChart currency={currency} dailyTrend={overview.dailyTrend} />
      <ReportTrustStrip trust={overview.trust} />
    </section>
  );
}
