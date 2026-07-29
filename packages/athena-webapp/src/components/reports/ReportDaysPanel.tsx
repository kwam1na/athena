import { useState } from "react";
import { useQuery } from "convex/react";
import { Link, useParams } from "@tanstack/react-router";
import { Calendar as CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { getOrigin } from "@/lib/navigationUtils";
import { useStableReportQuery } from "./useStableReportQuery";
import { EmptyState } from "@/components/states/empty/empty-state";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { api } from "~/convex/_generated/api";
import {
  getLocalDateFromOperatingDate,
  getLocalOperatingDate,
} from "@/lib/operations/operatingDate";
import {
  formatOperatingDate,
  formatReportMoney,
  formatUnits,
  reportDaySettlementPresentation,
} from "./reportFormat";

/** Single-date popover trigger, same shape as `DailyOperationsView`'s operating-date picker. */
function ReportDateField({
  boundary,
  label,
  onSelect,
  operatingDate,
}: {
  boundary?: { after: Date } | { before: Date };
  label: string;
  onSelect: (operatingDate: string) => void;
  operatingDate: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedDate = getLocalDateFromOperatingDate(operatingDate);

  return (
    <Popover onOpenChange={setIsOpen} open={isOpen}>
      <PopoverTrigger asChild>
        <Button
          aria-label={`Change ${label.toLowerCase()} date, currently ${formatOperatingDate(operatingDate)}`}
          className="h-auto justify-start gap-2 px-layout-sm py-layout-xs text-sm font-normal text-muted-foreground shadow-surface"
          variant="outline"
        >
          <CalendarIcon aria-hidden="true" className="h-4 w-4 shrink-0" />
          <span className="shrink-0">{label}</span>
          <span className="font-medium text-foreground">
            {formatOperatingDate(operatingDate)}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-0">
        <Calendar
          defaultMonth={selectedDate}
          disabled={boundary}
          mode="single"
          onSelect={(date) => {
            if (!date) return;
            onSelect(getLocalOperatingDate(date));
            setIsOpen(false);
          }}
          selected={selectedDate}
        />
      </PopoverContent>
    </Popover>
  );
}

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
}: {
  startDate: string;
  endDate: string;
  onRangeChange: (next: { startDate: string; endDate: string }) => void;
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
  const startBoundary = getLocalDateFromOperatingDate(startDate);
  const endBoundary = getLocalDateFromOperatingDate(endDate);

  return (
    <section className="space-y-layout-sm" data-testid="report-days-panel">
      <div className="flex flex-col gap-layout-sm sm:flex-row sm:items-end sm:justify-between">
        <h3 className="text-base font-medium text-foreground">Days</h3>
        <div className="flex flex-wrap gap-layout-sm">
          <ReportDateField
            boundary={endBoundary ? { after: endBoundary } : undefined}
            label="From"
            onSelect={(next) => onRangeChange({ startDate: next, endDate })}
            operatingDate={startDate}
          />
          <ReportDateField
            boundary={startBoundary ? { before: startBoundary } : undefined}
            label="To"
            onSelect={(next) => onRangeChange({ startDate, endDate: next })}
            operatingDate={endDate}
          />
        </div>
      </div>
      {isInitialLoad || days === undefined ? (
        <Skeleton className="h-48 w-full" data-testid="report-days-loading" />
      ) : days.length === 0 ? (
        <EmptyState title="No days in range" description="Choose a different date range." />
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
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Net sales</TableHead>
                <TableHead className="text-right">Units sold</TableHead>
                <TableHead className="text-right">Against close</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {days.map((day) => {
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
                    data-attention={settlement.needsAttention ? "true" : undefined}
                    data-status={day.status}
                    key={day.operatingDate}
                  >
                    <TableCell>
                      <Link
                        params={{ orgUrlSlug: orgUrlSlug!, storeUrlSlug: storeUrlSlug! }}
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
        </div>
      )}
    </section>
  );
}
