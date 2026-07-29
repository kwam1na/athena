import { useQuery } from "convex/react";
import { useState } from "react";

import { EmptyState } from "@/components/states/empty/empty-state";
import { FadeIn } from "@/components/common/FadeIn";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { cn } from "@/lib/utils";
import { api } from "~/convex/_generated/api";
import type { ReportOverviewData } from "~/shared/reportsContract";
import { ReportPeriodMetrics } from "./ReportPeriodMetrics";
import { ReportTrendChart } from "./ReportTrendChart";
import { ReportTrustStrip } from "./ReportTrustStrip";
import { useStableReportQuery } from "./useStableReportQuery";

const OVERVIEW_WINDOWS = [
  { label: "Today", value: "today" },
  { label: "Week to date", value: "weekToDate" },
  { label: "Trailing 30 days", value: "trailing30" },
] as const;

type OverviewWindow = (typeof OVERVIEW_WINDOWS)[number]["value"];

/**
 * Prior-window values for the selected window. Only week-to-date has a
 * like-for-like predecessor in the payload; today and trailing-30 show
 * settlement context instead of an invented comparison.
 */
function comparisonFor(
  overview: ReportOverviewData,
  window: OverviewWindow,
): { netSalesMinor?: number; unitsSold?: number } | undefined {
  if (window !== "weekToDate") return undefined;

  return {
    netSalesMinor: overview.priorWeek.netSalesMinor,
    unitsSold: overview.priorWeek.unitsSold,
  };
}

/**
 * Overview tab. Subscribes to `reports.queries.getOverview` ONLY — one
 * query, one document — per the contract's read budget.
 */
export function ReportsOverviewView() {
  const { activeStore } = useGetActiveStore();
  const [selectedWindow, setSelectedWindow] = useState<OverviewWindow>("today");
  const {
    data: overview,
    isInitialLoad,
    isRefreshing,
  } = useStableReportQuery(
    useQuery(
      api.reports.queries.getOverview,
      activeStore?._id ? { storeId: activeStore._id } : "skip",
    ),
  );

  // Nothing until the first result settles: these queries resolve fast
  // enough that a skeleton appears and vanishes as a flash of its own.
  // Refreshes keep the previous data on screen (see useStableReportQuery),
  // so this branch is only ever the very first load.
  if (activeStore === null || isInitialLoad || overview === undefined) {
    return null;
  }

  if (overview === null) {
    return (
      <EmptyState
        description="This store has no reporting data materialized yet. Check back once activity has been recorded."
        title="No report data yet"
      />
    );
  }

  const { currency } = overview;
  const activeWindow = OVERVIEW_WINDOWS.find(
    (option) => option.value === selectedWindow,
  )!;

  return (
    <FadeIn>
      <section
        aria-busy={isRefreshing}
        className={cn(
          "space-y-layout-xl md:space-y-layout-2xl",
          "transition-opacity duration-150 motion-reduce:transition-none",
          isRefreshing && "opacity-60",
        )}
        data-refreshing={isRefreshing ? "true" : undefined}
        data-testid="reports-overview"
      >
        <div className="space-y-layout-md">
          <Tabs
            onValueChange={(next) => setSelectedWindow(next as OverviewWindow)}
            value={selectedWindow}
          >
            <TabsList
              aria-label="Report period"
              className="h-auto flex-wrap justify-start gap-1 border border-border bg-surface-raised p-1 text-muted-foreground shadow-surface"
              size="sm"
            >
              {OVERVIEW_WINDOWS.map((option) => (
                <TabsTrigger
                  className="min-h-8 px-3 data-[state=active]:bg-primary-soft data-[state=active]:text-primary data-[state=active]:shadow-none"
                  key={option.value}
                  size="sm"
                  value={option.value}
                >
                  {option.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <ReportPeriodMetrics
            comparison={comparisonFor(overview, selectedWindow)}
            currency={currency}
            periodLabel={activeWindow.label}
            priorWindowLabel="prior week"
            snapshot={overview[selectedWindow]}
          />
        </div>

        <ReportTrendChart
          currency={currency}
          dailyTrend={overview.dailyTrend}
        />
        <ReportTrustStrip trust={overview.trust} />
      </section>
    </FadeIn>
  );
}
