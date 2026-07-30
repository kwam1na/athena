import { useQuery } from "convex/react";
import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { Calendar as CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { FadeIn } from "@/components/common/FadeIn";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useStableReportQuery } from "./useStableReportQuery";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/states/empty/empty-state";
import { cn } from "@/lib/utils";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { getOrigin } from "@/lib/navigationUtils";
import { ReportBackLink } from "./ReportBackLink";
import { ReportCalendar } from "./ReportCalendar";
import { ReportFreshness } from "./ReportFreshness";
import { ListPagination } from "@/components/common/ListPagination";
import {
  getLocalDateFromOperatingDate,
  getLocalOperatingDate,
} from "@/lib/operations/operatingDate";
import { api } from "~/convex/_generated/api";
import {
  REPORT_SKU_PAGE_SIZE,
  type ReportSkuSortBy,
} from "~/shared/reportsContract";
import {
  REPORT_PERIOD_TYPE_LABELS,
  REPORT_PERIOD_TYPES,
  periodKeyForSelection,
  type ReportPeriodType,
} from "./reportPeriodKeys";
import {
  formatOperatingDate,
  formatOptionalMoney,
  formatReportProfit,
  formatSkuDisplayName,
  formatSkuSubtitle,
  formatUnits,
} from "./reportFormat";

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
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const selectedDate = getLocalDateFromOperatingDate(periodDate);
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

  return (
    /* Same rhythm as the SKU detail page: tight inside a cluster, generous
       between sections. */
    <FadeIn className="space-y-layout-xl md:space-y-layout-2xl">
      <div
        className="space-y-layout-xl md:space-y-layout-2xl"
        data-testid="reports-items"
      >
        <div className="space-y-layout-sm">
          <ReportBackLink />

          <div
            className="flex w-full min-w-0 flex-col gap-1 rounded-xl border border-border bg-surface-raised p-1 sm:w-fit sm:flex-row sm:items-center"
            data-testid="items-report-controls"
          >
            <div
              aria-labelledby="items-period-controls-label"
              className="flex min-w-0 items-center"
              role="group"
            >
              <span
                className="shrink-0 px-2 text-xs font-medium text-muted-foreground"
                id="items-period-controls-label"
              >
                Period
              </span>
              <Select
                onValueChange={(value) =>
                  onPeriodTypeChange(value as ReportPeriodType)
                }
                value={periodType}
              >
                <SelectTrigger
                  aria-label="Period type"
                  className="h-9 w-28 rounded-lg border-0 bg-transparent px-3 shadow-none focus:ring-2 focus:ring-ring focus:ring-offset-0"
                  id="items-period-type"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REPORT_PERIOD_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {REPORT_PERIOD_TYPE_LABELS[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span
                aria-hidden="true"
                className="mx-1 h-5 w-px shrink-0 bg-border"
              />
              <span className="shrink-0 px-2 text-xs font-medium text-muted-foreground">
                Anchor date
              </span>
              <Popover
                onOpenChange={setIsDatePickerOpen}
                open={isDatePickerOpen}
              >
                <PopoverTrigger asChild>
                  <Button
                    aria-label={`Change anchor date, currently ${formatOperatingDate(periodDate)}`}
                    className="h-9 min-w-0 flex-1 justify-start rounded-lg px-3 text-sm font-medium text-foreground transition-[background-color,transform] duration-100 hover:bg-accent active:scale-[0.98] motion-reduce:transition-none sm:flex-none"
                    variant="ghost"
                  >
                    <CalendarIcon
                      aria-hidden="true"
                      className="h-4 w-4 shrink-0 text-muted-foreground"
                    />
                    <span className="truncate">
                      {formatOperatingDate(periodDate)}
                    </span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto p-0">
                  <ReportCalendar
                    defaultMonth={selectedDate}
                    mode="single"
                    onSelect={(date) => {
                      if (!date) return;
                      onPeriodDateChange(getLocalOperatingDate(date));
                      setIsDatePickerOpen(false);
                    }}
                    selected={selectedDate}
                  />
                </PopoverContent>
              </Popover>
            </div>

            <span
              aria-hidden="true"
              className="h-px w-full shrink-0 bg-border sm:mx-1 sm:h-5 sm:w-px"
            />
            <div
              aria-labelledby="items-sort-controls-label"
              className="flex w-full items-center gap-1 rounded-lg p-0.5 sm:w-auto"
              role="group"
            >
              <span
                className="shrink-0 px-2 text-xs font-medium text-muted-foreground"
                id="items-sort-controls-label"
              >
                Rank by
              </span>
              {(
                [
                  "revenue",
                  "units",
                ] as const satisfies readonly ReportSkuSortBy[]
              ).map((sort) => (
                <Button
                  aria-pressed={sortBy === sort}
                  className={cn(
                    "h-8 flex-1 rounded-md px-3 transition-[background-color,color,transform,box-shadow] duration-100 active:scale-[0.97] motion-reduce:transition-none sm:flex-none",
                    sortBy !== sort &&
                      "bg-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                  key={sort}
                  onClick={() => onSortByChange(sort)}
                  size="sm"
                  type="button"
                  variant={sortBy === sort ? "primary-soft" : "ghost"}
                >
                  {sort === "revenue" ? "Revenue" : "Units"}
                </Button>
              ))}
            </div>
          </div>
          {result !== undefined ? (
            <div className="flex justify-end">
              <ReportFreshness updatedAt={result.updatedAt} />
            </div>
          ) : null}
        </div>

        {/* Nothing until the first result settles: these queries resolve fast
          enough that a skeleton appears and vanishes as a flash of its own.
          Refreshes keep the previous data on screen (see useStableReportQuery),
          so this branch is only ever the very first load. */}
        {isInitialLoad || result === undefined ? null : result.rows.length ===
          0 ? (
          <EmptyState
            title="No SKU activity"
            description="No SKUs sold in this period."
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
                  <TableHead>SKU</TableHead>
                  <TableHead>Net sales</TableHead>
                  <TableHead>Units sold</TableHead>
                  <TableHead>Gross profit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.rows.map((row) => (
                  <TableRow key={row.productSkuId}>
                    <TableCell>
                      <Link
                        className="block min-w-0"
                        params={{
                          orgUrlSlug: orgUrlSlug!,
                          storeUrlSlug: storeUrlSlug!,
                          productSkuId: row.productSkuId,
                        }}
                        // Apply this report's period on the detail page while
                        // carrying the full list URL for an exact return.
                        search={{
                          o: getOrigin(),
                          periodDate,
                          periodType,
                        }}
                        to="/$orgUrlSlug/store/$storeUrlSlug/reports/items/$productSkuId"
                      >
                        <span className="block truncate font-medium text-foreground">
                          {formatSkuDisplayName(row.identity, row.productSkuId)}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {formatSkuSubtitle(row.identity, row.productSkuId)}
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell>
                      {formatOptionalMoney(
                        row.netSalesMinor,
                        activeStore?.currency ?? "USD",
                      )}
                    </TableCell>
                    <TableCell>{formatUnits(row.unitsSold)}</TableCell>
                    <TableCell>
                      {formatReportProfit(
                        row.grossProfitMinor,
                        activeStore?.currency ?? "USD",
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {cursor || result.continueCursor ? (
              <ListPagination
                currentItems={result.rows.length}
                hasNextPage={result.continueCursor !== null}
                mode="cursor"
                onPageChange={handlePageChange}
                page={currentPage}
                pageSize={REPORT_SKU_PAGE_SIZE}
              />
            ) : null}
          </div>
        )}
      </div>
    </FadeIn>
  );
}
