import { useQuery } from "convex/react";
import { useParams } from "@tanstack/react-router";

import { AnimatedDataState } from "@/components/common/AnimatedDataState";
import { FadeIn } from "@/components/common/FadeIn";
import { EmptyState } from "@/components/states/empty/empty-state";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { api } from "~/convex/_generated/api";
import type { ReportSkuSortBy } from "~/shared/reportsContract";
import { ReportBackLink } from "./ReportBackLink";
import { ReportsItemsPerformance } from "./ReportsItemsPerformance";
import { ReportsItemsTable } from "./ReportsItemsTable";
import {
  periodKeyForSelection,
  type ReportPeriodType,
} from "./reportPeriodKeys";
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
}) {
  const { activeStore } = useGetActiveStore();
  const { orgUrlSlug, storeUrlSlug } = useParams({ strict: false });
  const periodKey = periodKeyForSelection(periodType, periodDate);
  const currentPage = cursor ? cursorTrail.length + 2 : 1;
  const {
    data: result,
    isInitialLoad,
    isRefreshing,
  } = useStableReportQuery(
    useQuery(
      api.reports.queries.listPeriodSkus,
      activeStore?._id
        ? { storeId: activeStore._id, periodKey, sortBy, cursor }
        : "skip",
    ),
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
          currency={activeStore?.currency ?? "USD"}
          hasActivity={hasActivity}
          onPeriodDateChange={onPeriodDateChange}
          onPeriodTypeChange={onPeriodTypeChange}
          onSortByChange={onSortByChange}
          periodDate={periodDate}
          periodType={periodType}
          sortBy={sortBy}
          totalNetSalesMinor={result?.totalNetSalesMinor}
          totalTransactions={result?.totalTransactions}
          totalUnitsSold={result?.totalUnitsSold}
          updatedAt={result?.updatedAt}
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
