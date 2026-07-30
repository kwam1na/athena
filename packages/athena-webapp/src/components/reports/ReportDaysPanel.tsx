import { useQuery } from "convex/react";
import { Link, useParams } from "@tanstack/react-router";
import { ArrowDown, RotateCcw } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
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
} from "./reportFormat";
import { ReportSkuMixChart } from "./ReportSkuMixChart";

const REPORT_DAYS_PAGE_SIZE = 14;

/**
 * Day drill-down: `listDays` over a bounded range, paired with the unit mix
 * across product SKUs in that same range. Selecting a day links into the
 * Items view scoped to that day's `d:` period key (via
 * `periodType`/`periodDate`, see `reports/items/index.tsx`).
 */
export function ReportDaysPanel({
  canResetRange,
  startDate,
  endDate,
  onRangeChange,
  onRangeReset,
  onPageChange,
  page,
}: {
  canResetRange: boolean;
  startDate: string;
  endDate: string;
  onRangeChange: (next: { startDate: string; endDate: string }) => void;
  onRangeReset: () => void;
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
  const {
    data: skuMix,
    isRefreshing: isSkuMixRefreshing,
  } = useStableReportQuery(
    useQuery(
      api.reports.queries.listRangeSkuMix,
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
  const placeholderRowCount = Math.max(
    0,
    REPORT_DAYS_PAGE_SIZE - (visibleDays?.length ?? 0),
  );
  const isSelectedDay = (operatingDate: string) =>
    startDate === operatingDate && endDate === operatingDate;
  const selectDay = (operatingDate: string) => {
    if (isSelectedDay(operatingDate)) {
      onRangeReset();
      return;
    }
    onRangeChange({
      startDate: operatingDate,
      endDate: operatingDate,
    });
  };

  return (
    <section className="space-y-layout-sm" data-testid="report-days-panel">
      <div className="flex flex-wrap items-center justify-end gap-layout-xs">
        {canResetRange ? (
          <Button
            aria-label="Reset date range to default"
            className="h-auto gap-2 px-layout-sm py-layout-xs text-sm font-normal text-muted-foreground"
            onClick={onRangeReset}
            variant="ghost"
          >
            <RotateCcw aria-hidden="true" className="h-4 w-4" />
            Reset range
          </Button>
        ) : null}
        <ReportDateRangeField
          endDate={endDate}
          onSelect={onRangeChange}
          startDate={startDate}
        />
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
          className="grid items-stretch gap-layout-3xl lg:grid-cols-2"
          data-testid="report-days-content-grid"
        >
          <div className="flex min-w-0 flex-col gap-layout-sm">
            <div>
              <h3
                className="text-base font-medium text-foreground"
                data-testid="report-days-heading"
                id="report-days-heading"
              >
                Days
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Net sales and units sold by operating date
              </p>
            </div>
            <div
              aria-busy={isRefreshing}
              aria-labelledby="report-days-heading"
              className={cn(
                "flex-1 overflow-hidden rounded-lg border border-border bg-surface-raised shadow-surface",
                "transition-opacity duration-150 motion-reduce:transition-none",
                isRefreshing && "opacity-60",
              )}
              data-refreshing={isRefreshing ? "true" : undefined}
              data-testid="report-days-table-card"
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
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleDays?.map((day) => (
                    <TableRow
                      aria-label={`${isSelectedDay(day.operatingDate) ? "Reset date range from" : "Show reports for"} ${formatOperatingDate(day.operatingDate)}`}
                      className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      data-state={
                        isSelectedDay(day.operatingDate)
                          ? "selected"
                          : undefined
                      }
                      data-status={day.status}
                      key={day.operatingDate}
                      onClick={(event) => {
                        const target = event.target;
                        if (
                          target instanceof Element &&
                          target.closest("a")
                        ) {
                          return;
                        }
                        selectDay(day.operatingDate);
                      }}
                      onKeyDown={(event) => {
                        if (
                          event.target !== event.currentTarget ||
                          (event.key !== "Enter" && event.key !== " ")
                        ) {
                          return;
                        }
                        event.preventDefault();
                        selectDay(day.operatingDate);
                      }}
                      role="button"
                      tabIndex={0}
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
                    </TableRow>
                  ))}
                  {Array.from({ length: placeholderRowCount }, (_, index) => (
                    <TableRow
                      aria-hidden="true"
                      className="invisible pointer-events-none"
                      data-testid="report-day-placeholder-row"
                      key={`placeholder-${index}`}
                    >
                      <TableCell>{"\u00a0"}</TableCell>
                      <TableCell>{"\u00a0"}</TableCell>
                      <TableCell>{"\u00a0"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <ListPagination
                onPageChange={onPageChange}
                page={currentPage}
                pageCount={pageCount}
                pageSize={REPORT_DAYS_PAGE_SIZE}
                totalItems={totalDays}
              />
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-layout-sm">
            <div>
              <h3
                className="text-base font-medium text-foreground"
                id="report-sku-mix-heading"
              >
                Products sold
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Share of units sold by product in this date range
              </p>
            </div>
            <ReportSkuMixChart
              data={skuMix}
              isRefreshing={isSkuMixRefreshing}
            />
          </div>
        </div>
      )}
    </section>
  );
}
