import { useNavigate, useParams } from "@tanstack/react-router";

import { EmptyState } from "@/components/states/empty/empty-state";
import { FadeIn } from "@/components/common/FadeIn";
import { Tabs } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { getOrigin } from "@/lib/navigationUtils";
import {
  isReportingTodayInProgress,
  type ReportOverviewData,
} from "~/shared/reportsContract";
import { ReportPeriodMetrics } from "./ReportPeriodMetrics";
import {
  ReportSegmentedTabsList,
  ReportSegmentedTabsTrigger,
} from "./ReportSegmentedTabs";
import { ReportFreshness } from "./ReportFreshness";
import { ReportTrendChart } from "./ReportTrendChart";
import { ReportTrustStrip } from "./ReportTrustStrip";
import {
  dateRangeForOverviewWindow,
  REPORT_OVERVIEW_WINDOWS,
  REPORT_OVERVIEW_WINDOW_LABELS,
  type ReportOverviewWindow,
} from "./reportPeriodKeys";

/**
 * Prior-window values for every selectable overview period. These snapshots
 * are materialized with the overview so the page keeps its one-document read
 * boundary.
 */
function comparisonFor(
  overview: ReportOverviewData,
  window: ReportOverviewWindow,
):
  | {
      snapshot: ReportOverviewData["today"];
      priorWindowLabel: string;
    }
  | undefined {
  switch (window) {
    case "today":
      return {
        snapshot: overview.yesterday,
        priorWindowLabel: "yesterday",
      };
    case "weekToDate":
      return {
        snapshot: overview.priorWeek,
        priorWindowLabel: "prior week",
      };
    case "trailing30":
      return {
        snapshot: overview.priorTrailing30,
        priorWindowLabel: "previous 30 days",
      };
    case "trailing3Months":
      return {
        snapshot: overview.priorTrailing3Months,
        priorWindowLabel: "previous 3 months",
      };
    case "trailing6Months":
      return {
        snapshot: overview.priorTrailing6Months,
        priorWindowLabel: "previous 6 months",
      };
    default: {
      // Exhaustiveness guard: a window value with no explicit case above is a
      // compile error here, and a runtime escape (e.g. a stale URL value that
      // slipped past validation) must not silently compare against the wrong
      // prior period. Fail loudly in dev; show "no comparison" in production.
      const unhandled: never = window;
      if (import.meta.env.DEV) {
        throw new Error(
          `comparisonFor: unhandled overview window "${String(unhandled)}"`,
        );
      }
      return undefined;
    }
  }
}

/**
 * Overview tab.
 *
 * The overview document arrives as a PROP from the route shell, which already
 * sources it to gate the whole page — this view holds no query of its own.
 * Deliberate, and load-bearing for layout stability: when this view re-derived
 * the same document through its own hook instances, those instances settled
 * one commit after the route's on a fresh mount. For that commit the view
 * returned null while its sibling panels (which render their reserved shells
 * dataless) painted at the top of the page, then everything shifted down —
 * a measured 0.21 layout shift on every entry to this tab in the shared demo.
 * One source, one settle: siblings can no longer disagree about whether the
 * page has data.
 */
export function ReportsOverviewView({
  isRefreshing,
  overview,
  selectedWindow,
  onSelectedWindowChange,
}: {
  isRefreshing: boolean;
  /** Settled by the route; `null` means no reporting data materialized yet. */
  overview: ReportOverviewData | null;
  selectedWindow: ReportOverviewWindow;
  onSelectedWindowChange: (window: ReportOverviewWindow) => void;
}) {
  const navigate = useNavigate();
  const { orgUrlSlug, storeUrlSlug } = useParams({ strict: false });

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
              <ReportSegmentedTabsList aria-label="Report period">
                {REPORT_OVERVIEW_WINDOWS.map((window) => (
                  <ReportSegmentedTabsTrigger
                    key={window}
                    value={window}
                  >
                    {REPORT_OVERVIEW_WINDOW_LABELS[window]}
                  </ReportSegmentedTabsTrigger>
                ))}
              </ReportSegmentedTabsList>
            </Tabs>

            <ReportFreshness
              delayedDataLabel="Overview data"
              updatedAt={overview.updatedAt}
            />
          </div>

          <ReportPeriodMetrics
            comparison={comparison?.snapshot}
            comparisonKey={selectedWindow}
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
