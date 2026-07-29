import { useQuery } from "convex/react";
import { Link, useParams } from "@tanstack/react-router";
import { ArrowDown } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { getOrigin } from "@/lib/navigationUtils";
import { ListPagination } from "@/components/common/ListPagination";
import { useStableReportQuery } from "./useStableReportQuery";
import { EmptyState } from "@/components/states/empty/empty-state";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { api } from "~/convex/_generated/api";
import { ReportDateRangeField } from "./ReportDateRangeField";
import {
  formatOperatingDate,
  formatReportMoney,
  formatUnits,
  reportDaySettlementPresentation,
} from "./reportFormat";

const REPORT_DAYS_PAGE_SIZE = 14;

/**
 * Day drill-down: `listDays` over a bounded range, per-day status badge and
 * close variance. Selecting a day links into the Items view scoped to that
 * day's `d:` period key (via `periodType`/`periodDate`, see
 * `reports/items/index.tsx`).
 */
export function ReportDaysPanel({
  startDate,
  endDate,
  onRangeChange,
  onPageChange,
  page,
}: {
  startDate: string;
  endDate: string;
  onRangeChange: (next: { startDate: string; endDate: string }) => void;
  onPageChange: (page: number) => void;
  page: number;
}) {
  const { activeStore } = useGetActiveStore();
  const { orgUrlSlug, storeUrlSlug } = useParams({ strict: false });
  const {
    data: days,
    isInitialLoad,
    isRefreshing,
  } = useStableReportQuery(
    useQuery(
      api.reports.queries.listDays,
      activeStore?._id
        ? { storeId: activeStore._id, startDate, endDate }
        : "skip",
    ),
  );
  const daysNewestFirst = days
    ? [...days].sort((left, right) =>
        right.operatingDate.localeCompare(left.operatingDate),
      )
    : days;
  const totalDays = daysNewestFirst?.length ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalDays / REPORT_DAYS_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visibleDays = daysNewestFirst?.slice(
    (currentPage - 1) * REPORT_DAYS_PAGE_SIZE,
    currentPage * REPORT_DAYS_PAGE_SIZE,
  );

  return (
    <section className="space-y-layout-sm" data-testid="report-days-panel">
      <div className="flex flex-col gap-layout-sm sm:flex-row sm:items-end sm:justify-between">
        <h3 className="text-base font-medium text-foreground">Days</h3>
        <div className="flex flex-wrap">
          <ReportDateRangeField
            endDate={endDate}
            onSelect={onRangeChange}
            startDate={startDate}
          />
        </div>
      </div>
      {/* Nothing until the first result settles: these queries resolve fast
          enough that a skeleton appears and vanishes as a flash of its own.
          Refreshes keep the previous data on screen (see useStableReportQuery),
          so this branch is only ever the very first load. */}
      {isInitialLoad ||
      daysNewestFirst === undefined ? null : daysNewestFirst.length === 0 ? (
        <EmptyState
          title="No days in range"
          description="Choose a different date range."
        />
      ) : (
        <div
          aria-busy={isRefreshing}
          className={cn(
            "overflow-hidden rounded-lg border border-border bg-surface-raised shadow-surface",
            "transition-opacity duration-150 motion-reduce:transition-none",
            isRefreshing && "opacity-60",
          )}
          data-refreshing={isRefreshing ? "true" : undefined}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead aria-sort="descending">
                  <span className="inline-flex items-center gap-1">
                    Date
                    <ArrowDown aria-hidden="true" className="h-3.5 w-3.5" />
                  </span>
                </TableHead>
                <TableHead className="text-right">Net sales</TableHead>
                <TableHead className="text-right">Units sold</TableHead>
                <TableHead className="text-right">Against close</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleDays?.map((day) => {
                const settlement = reportDaySettlementPresentation({
                  closeVarianceMinor: day.closeVarianceMinor,
                  currency: day.currency,
                  postCloseNetSalesDeltaMinor: day.postCloseNetSalesDeltaMinor,
                  status: day.status,
                });

                return (
                  <TableRow
                    // `data-attention` marks days whose folded sales disagree
                    // with the accepted close, or that moved after sign-off.
                    // The signal is carried by the toned amount and caption in
                    // the settlement cell, not by a row treatment.
                    data-attention={
                      settlement.needsAttention ? "true" : undefined
                    }
                    data-status={day.status}
                    key={day.operatingDate}
                  >
                    <TableCell>
                      <Link
                        params={{
                          orgUrlSlug: orgUrlSlug!,
                          storeUrlSlug: storeUrlSlug!,
                        }}
                        search={{
                          periodType: "day",
                          periodDate: day.operatingDate,
                          // Carries the current URL so the items workspace
                          // can offer a way back to this day list.
                          o: getOrigin(),
                        }}
                        to="/$orgUrlSlug/store/$storeUrlSlug/reports/items"
                      >
                        {formatOperatingDate(day.operatingDate)}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right font-numeric tabular-nums">
                      {formatReportMoney(day.netSalesMinor, day.currency)}
                    </TableCell>
                    <TableCell className="text-right font-numeric tabular-nums">
                      {formatUnits(day.unitsSold)}
                    </TableCell>
                    <TableCell className="space-y-0.5 text-right">
                      <span
                        className={cn(
                          "block font-numeric text-sm tabular-nums",
                          settlement.tone,
                        )}
                      >
                        {settlement.amount}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {settlement.caption}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {totalDays > REPORT_DAYS_PAGE_SIZE ? (
            <ListPagination
              onPageChange={onPageChange}
              page={currentPage}
              pageCount={pageCount}
              pageSize={REPORT_DAYS_PAGE_SIZE}
              totalItems={totalDays}
            />
          ) : null}
        </div>
      )}
    </section>
  );
}
