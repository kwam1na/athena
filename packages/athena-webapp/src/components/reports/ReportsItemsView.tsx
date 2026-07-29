import { useQuery } from "convex/react";
import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { Calendar as CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
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
import {
  getLocalDateFromOperatingDate,
  getLocalOperatingDate,
} from "@/lib/operations/operatingDate";
import { api } from "~/convex/_generated/api";
import type { ReportSkuSortBy } from "~/shared/reportsContract";
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
  onPeriodTypeChange,
  onPeriodDateChange,
  onSortByChange,
  onCursorChange,
}: {
  periodType: ReportPeriodType;
  periodDate: string;
  sortBy: ReportSkuSortBy;
  cursor: string | undefined;
  onPeriodTypeChange: (periodType: ReportPeriodType) => void;
  onPeriodDateChange: (periodDate: string) => void;
  onSortByChange: (sortBy: ReportSkuSortBy) => void;
  onCursorChange: (cursor: string | undefined) => void;
}) {
  const { activeStore } = useGetActiveStore();
  const { orgUrlSlug, storeUrlSlug } = useParams({ strict: false });
  const periodKey = periodKeyForSelection(periodType, periodDate);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const selectedDate = getLocalDateFromOperatingDate(periodDate);

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

  return (
    <div className="space-y-layout-md" data-testid="reports-items">
      <ReportBackLink />

      <div className="flex flex-wrap items-end gap-layout-sm">
        <div className="space-y-1">
          <Label htmlFor="items-period-type">Period</Label>
          <Select
            onValueChange={(value) => onPeriodTypeChange(value as ReportPeriodType)}
            value={periodType}
          >
            <SelectTrigger id="items-period-type" className="w-32">
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
        </div>
        <Popover onOpenChange={setIsDatePickerOpen} open={isDatePickerOpen}>
          <PopoverTrigger asChild>
            <Button
              aria-label={`Change anchor date, currently ${formatOperatingDate(periodDate)}`}
              className="h-auto justify-start gap-2 px-layout-sm py-layout-xs text-sm font-normal text-muted-foreground shadow-surface"
              variant="outline"
            >
              <CalendarIcon aria-hidden="true" className="h-4 w-4 shrink-0" />
              <span className="shrink-0">Anchor date</span>
              <span className="font-medium text-foreground">
                {formatOperatingDate(periodDate)}
              </span>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-0">
            <Calendar
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
        <div
          className="flex gap-1 rounded-md border border-border p-1"
          role="group"
          aria-label="Sort SKUs"
        >
          {(["revenue", "units"] as const satisfies readonly ReportSkuSortBy[]).map(
            (sort) => (
              <Button
                aria-pressed={sortBy === sort}
                className={cn(
                  "px-3",
                  sortBy === sort ? "" : "bg-transparent text-muted-foreground",
                )}
                key={sort}
                onClick={() => onSortByChange(sort)}
                size="sm"
                type="button"
                variant={sortBy === sort ? "default" : "ghost"}
              >
                {sort === "revenue" ? "Revenue" : "Units"}
              </Button>
            ),
          )}
        </div>
      </div>

      {isInitialLoad || result === undefined ? (
        <Skeleton className="h-64 w-full" data-testid="reports-items-loading" />
      ) : result.rows.length === 0 ? (
        <EmptyState title="No SKU activity" description="No SKUs sold in this period." />
      ) : (
        <>
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
                        // Carries the current URL (period, sort, cursor) so
                        // the detail page can return to this exact list.
                        search={{ o: getOrigin() }}
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
                      {formatOptionalMoney(row.netSalesMinor, activeStore?.currency ?? "USD")}
                    </TableCell>
                    <TableCell>{formatUnits(row.unitsSold)}</TableCell>
                    <TableCell>
                      {formatReportProfit(row.grossProfitMinor, activeStore?.currency ?? "USD")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex justify-end gap-layout-sm">
            {cursor ? (
              <Button
                onClick={() => onCursorChange(undefined)}
                type="button"
                variant="outline"
              >
                Back to start
              </Button>
            ) : null}
            {result.continueCursor ? (
              <Button
                onClick={() => onCursorChange(result.continueCursor ?? undefined)}
                type="button"
              >
                Next page
              </Button>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
