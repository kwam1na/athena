import { useQuery } from "convex/react";
import { useParams } from "@tanstack/react-router";
import { useMemo } from "react";

import { AnimatedDataState } from "@/components/common/AnimatedDataState";
import { FadeIn } from "@/components/common/FadeIn";
import { EmptyState } from "@/components/states/empty/empty-state";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { api } from "~/convex/_generated/api";
import type { ReportSkuSortBy } from "~/shared/reportsContract";
import { ReportBackLink } from "./ReportBackLink";
import {
  ReportsItemsPerformance,
  type ReportsItemsVariant,
} from "./ReportsItemsPerformance";
import { ReportsItemsTable } from "./ReportsItemsTable";
import {
  periodKeyForSelection,
  type ReportPeriodType,
} from "./reportPeriodKeys";
import { useReportsSharedDemoMode } from "./useReportsSharedDemoMode";
import { createSharedDemoPeriodSkus } from "@/components/shared-demo/sharedDemoReportsFixture";
import { useStableReportQuery } from "./useStableReportQuery";

export function ReportsItemsView({
  periodType,
  periodDate,
  sortBy,
  cursor,
  cursorTrail,
  onPeriodTypeChange,
  onPeriodDateChange,
  onSortByChange,
  onCursorChange,
  variant = "card",
}: {
  periodType: ReportPeriodType;
  periodDate: string;
  sortBy: ReportSkuSortBy;
  cursor: string | undefined;
  cursorTrail: string[];
  onPeriodTypeChange: (periodType: ReportPeriodType) => void;
  onPeriodDateChange: (periodDate: string) => void;
  onSortByChange: (sortBy: ReportSkuSortBy) => void;
  onCursorChange: (cursor: string | undefined, cursorTrail: string[]) => void;
  variant?: ReportsItemsVariant;
}) {
  const { activeStore } = useGetActiveStore();
  const { orgUrlSlug, storeUrlSlug } = useParams({ strict: false });
  const periodKey = periodKeyForSelection(periodType, periodDate);
  const currentPage = cursor ? cursorTrail.length + 2 : 1;
  const { isSharedDemo, useLiveQuery } = useReportsSharedDemoMode();
  const liveResult = useQuery(
    api.reports.queries.listPeriodSkus,
    activeStore?._id && useLiveQuery
      ? { storeId: activeStore._id, periodKey, sortBy, cursor }
      : "skip",
  );
  // `periodKey` comes from route search and is never trusted: the fixture
  // answers an unparseable key with an empty period rather than throwing.
  const demoResult = useMemo(
    () =>
      isSharedDemo
        ? createSharedDemoPeriodSkus({ periodKey, sortBy, cursor })
        : undefined,
    [cursor, isSharedDemo, periodKey, sortBy],
  );
  const {
    data: result,
    dataContext: settledPeriodKey,
    isInitialLoad,
    isRefreshing,
  } = useStableReportQuery(
    isSharedDemo ? demoResult : liveResult,
    periodKey,
  );

  function handlePageChange(page: number) {
    if (page === 1) {
      onCursorChange(undefined, []);
      return;
    }
    if (page === currentPage - 1) {
      onCursorChange(cursorTrail.at(-1), cursorTrail.slice(0, -1));
      return;
    }
    if (page === currentPage + 1 && result?.continueCursor) {
      onCursorChange(
        result.continueCursor,
        cursor ? [...cursorTrail, cursor] : [],
      );
    }
  }

  const hasActivity = (result?.rows.length ?? 0) > 0;

  return (
    <FadeIn>
      <div
        className="space-y-layout-xl"
        data-testid="reports-items"
      >
        <ReportBackLink />

        <ReportsItemsPerformance
          comparisonPeriodKey={settledPeriodKey ?? periodKey}
          currency={activeStore?.currency ?? "USD"}
          hasActivity={hasActivity}
          isTodayInProgress={result?.isTodayInProgress ?? false}
          onPeriodDateChange={onPeriodDateChange}
          onPeriodTypeChange={onPeriodTypeChange}
          onSortByChange={onSortByChange}
          orgUrlSlug={orgUrlSlug!}
          periodDate={periodDate}
          periodType={periodType}
          priorPeriodTotals={result?.priorPeriodTotals}
          sortBy={sortBy}
          storeUrlSlug={storeUrlSlug!}
          totalNetSalesMinor={result?.totalNetSalesMinor}
          totalTransactions={result?.totalTransactions}
          totalUnitsSold={result?.totalUnitsSold}
          updatedAt={result?.updatedAt}
          variant={variant}
        />

        {isInitialLoad || result === undefined ? null : (
          <AnimatedDataState
            stateKey={hasActivity ? "data" : "empty"}
            testId="items-results-state"
          >
            {hasActivity ? (
              <ReportsItemsTable
                continueCursor={result.continueCursor}
                currency={activeStore?.currency ?? "USD"}
                currentPage={currentPage}
                cursor={cursor}
                isRefreshing={isRefreshing}
                onPageChange={handlePageChange}
                orgUrlSlug={orgUrlSlug!}
                periodDate={periodDate}
                periodType={periodType}
                rows={result.rows}
                storeUrlSlug={storeUrlSlug!}
              />
            ) : (
              <section
                aria-label="Item sales results"
                className="rounded-xl border border-border bg-surface-raised px-layout-md py-layout-2xl shadow-surface md:px-layout-lg"
              >
                <EmptyState
                  title="No item sales"
                  description="No items were sold in this period."
                />
              </section>
            )}
          </AnimatedDataState>
        )}
      </div>
    </FadeIn>
  );
}
