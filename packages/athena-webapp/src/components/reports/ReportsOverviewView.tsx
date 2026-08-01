import { useQuery } from "convex/react";
import { useNavigate, useParams } from "@tanstack/react-router";

import { EmptyState } from "@/components/states/empty/empty-state";
import { FadeIn } from "@/components/common/FadeIn";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { cn } from "@/lib/utils";
import { getOrigin } from "@/lib/navigationUtils";
import { api } from "~/convex/_generated/api";
import {
  isReportingTodayInProgress,
  type ReportOverviewData,
} from "~/shared/reportsContract";
import { ReportPeriodMetrics } from "./ReportPeriodMetrics";
import { ReportFreshness } from "./ReportFreshness";
import { ReportTrendChart } from "./ReportTrendChart";
import { ReportTrustStrip } from "./ReportTrustStrip";
import { useStableReportQuery } from "./useStableReportQuery";
import {
  dateRangeForOverviewWindow,
  REPORT_OVERVIEW_WINDOWS,
  REPORT_OVERVIEW_WINDOW_LABELS,
  type ReportOverviewWindow,
} from "./reportPeriodKeys";

/**
 * Prior-window values for comparable windows. Today compares with the
 * previous calendar day, week-to-date with the prior week, and trailing-30
 * remains context-only.
 */
function comparisonFor(
  overview: ReportOverviewData,
  window: ReportOverviewWindow,
):
  | {
      netSalesMinor?: number;
      unitsSold?: number;
      priorWindowLabel: string;
    }
  | undefined {
  if (window === "today") {
    return {
      netSalesMinor: overview.yesterday.netSalesMinor,
      unitsSold: overview.yesterday.unitsSold,
      priorWindowLabel: "yesterday",
    };
  }

  if (window !== "weekToDate") return undefined;

  return {
    netSalesMinor: overview.priorWeek.netSalesMinor,
    unitsSold: overview.priorWeek.unitsSold,
    priorWindowLabel: "prior week",
  };
}

/**
 * Overview tab. Subscribes to `reports.queries.getOverview` ONLY — one
 * query, one document — per the contract's read budget.
 */
export function ReportsOverviewView({
  selectedWindow,
  onSelectedWindowChange,
}: {
  selectedWindow: ReportOverviewWindow;
  onSelectedWindowChange: (window: ReportOverviewWindow) => void;
}) {
  const { activeStore } = useGetActiveStore();
  const navigate = useNavigate();
  const { orgUrlSlug, storeUrlSlug } = useParams({ strict: false });
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
  const comparison = comparisonFor(overview, selectedWindow);
  const anchorDay = overview.dailyTrend.at(-1);
  const anchorOperatingDate = anchorDay?.operatingDate;
  const isAnchorDayInProgress = isReportingTodayInProgress(anchorDay?.status);
  const isAnchorDayClosed =
    anchorDay?.status === "reconciled" || anchorDay?.status === "amended";
  const transactionsRange = anchorOperatingDate
    ? dateRangeForOverviewWindow(selectedWindow, anchorOperatingDate)
    : undefined;
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
        <div className="space-y-layout-lg">
          <div className="flex flex-wrap items-center justify-between gap-layout-sm">
            <Tabs
              onValueChange={(next) =>
                onSelectedWindowChange(next as ReportOverviewWindow)
              }
              value={selectedWindow}
            >
              <TabsList
                aria-label="Report period"
                className="h-auto flex-wrap justify-start gap-1 border border-border bg-surface-raised p-1 text-muted-foreground shadow-surface"
                size="sm"
              >
                {REPORT_OVERVIEW_WINDOWS.map((window) => (
                  <TabsTrigger
                    className="min-h-8 px-3 data-[state=active]:bg-primary-soft data-[state=active]:text-primary data-[state=active]:shadow-none"
                    key={window}
                    size="sm"
                    value={window}
                  >
                    {REPORT_OVERVIEW_WINDOW_LABELS[window]}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            <ReportFreshness
              delayedDataLabel="Overview data"
              updatedAt={overview.updatedAt}
            />
          </div>

          <ReportPeriodMetrics
            comparison={comparison}
            currency={currency}
            dailyOperationsLink={
              selectedWindow === "today" &&
              isAnchorDayInProgress &&
              anchorOperatingDate &&
              orgUrlSlug &&
              storeUrlSlug
                ? {
                    orgUrlSlug,
                    search: {
                      o: getOrigin(),
                      operatingDate: anchorOperatingDate,
                    },
                    storeUrlSlug,
                  }
                : undefined
            }
            eodReviewLink={
              selectedWindow === "today" &&
              isAnchorDayClosed &&
              anchorOperatingDate &&
              orgUrlSlug &&
              storeUrlSlug
                ? {
                    orgUrlSlug,
                    search: {
                      o: getOrigin(),
                      operatingDate: anchorOperatingDate,
                    },
                    storeUrlSlug,
                  }
                : undefined
            }
            periodLabel={REPORT_OVERVIEW_WINDOW_LABELS[selectedWindow]}
            priorWindowLabel={comparison?.priorWindowLabel ?? "prior period"}
            snapshot={overview[selectedWindow]}
            transactionsLink={
              transactionsRange && orgUrlSlug && storeUrlSlug
                ? {
                    orgUrlSlug,
                    search: {
                      endDate: transactionsRange.endDate,
                      o: getOrigin(),
                      startDate: transactionsRange.startDate,
                      ...(selectedWindow === "today" && isAnchorDayInProgress
                        ? {}
                        : { order: "oldestFirst" }),
                    },
                    storeUrlSlug,
                  }
                : undefined
            }
          />
        </div>

        <ReportTrendChart
          currency={currency}
          dailyTrend={overview.dailyTrend}
          onDaySelect={(operatingDate) => {
            if (!orgUrlSlug || !storeUrlSlug) return;
            void navigate({
              params: { orgUrlSlug, storeUrlSlug },
              search: {
                o: getOrigin(),
                periodDate: operatingDate,
                periodType: "day",
              },
              to: "/$orgUrlSlug/store/$storeUrlSlug/reports/items",
            });
          }}
          summary={
            <ReportTrustStrip
              reportedDayCount={overview.trailing30.dayCount}
              today={overview.dailyTrend.at(-1)?.operatingDate}
              trust={overview.trust}
            />
          }
        />
      </section>
    </FadeIn>
  );
}
