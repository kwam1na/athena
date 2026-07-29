import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Calendar as CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { api } from "~/convex/_generated/api";
import {
  getLocalDateFromOperatingDate,
  getLocalOperatingDate,
} from "@/lib/operations/operatingDate";
import { formatOperatingDate, formatOptionalMoney, formatReportProfit, formatUnits } from "./reportFormat";

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
          aria-label={`Change ${label.toLowerCase()}, currently ${formatOperatingDate(operatingDate)}`}
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
 * Custom range: `requestRange` mutation, then SUBSCRIBE to `getRangeResult`
 * — no polling loop, the query re-runs on its own once the sweeper
 * (slice C) materializes the range.
 */
export function ReportCustomRangePanel({
  startDate,
  endDate,
  requestKey,
  onStartDateChange,
  onEndDateChange,
  onRequestKeyChange,
}: {
  startDate: string;
  endDate: string;
  requestKey: string | undefined;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
  onRequestKeyChange: (requestKey: string) => void;
}) {
  const { activeStore } = useGetActiveStore();
  const requestRange = useMutation(api.reports.customRange.requestRange);
  const [isRequesting, setIsRequesting] = useState(false);

  const result = useQuery(
    api.reports.queries.getRangeResult,
    activeStore?._id && requestKey
      ? { storeId: activeStore._id, requestKey }
      : "skip",
  );

  const canSubmit = Boolean(activeStore?._id) && startDate <= endDate;
  const startBoundary = getLocalDateFromOperatingDate(startDate);
  const endBoundary = getLocalDateFromOperatingDate(endDate);

  return (
    <section className="space-y-layout-sm" data-testid="report-custom-range-panel">
      <div className="flex flex-col gap-layout-sm sm:flex-row sm:items-end sm:justify-between">
        <h3 className="text-base font-medium text-foreground">Custom range</h3>
        <div className="flex flex-wrap items-center gap-layout-sm">
          <ReportDateField
            boundary={endBoundary ? { after: endBoundary } : undefined}
            label="Start date"
            onSelect={onStartDateChange}
            operatingDate={startDate}
          />
          <ReportDateField
            boundary={startBoundary ? { before: startBoundary } : undefined}
            label="End date"
            onSelect={onEndDateChange}
            operatingDate={endDate}
          />
          <Button
            disabled={!canSubmit || isRequesting}
            onClick={() => {
              if (!activeStore?._id) return;
              setIsRequesting(true);
              requestRange({ storeId: activeStore._id, startDate, endDate })
                .then((response) => onRequestKeyChange(response.requestKey))
                .finally(() => setIsRequesting(false));
            }}
            type="button"
          >
            Build report
          </Button>
        </div>
      </div>
      {!requestKey ? (
        <p className="text-sm text-muted-foreground">
          Choose a date range and build a report to see totals and top SKUs.
        </p>
      ) : result === undefined ? (
        <Skeleton className="h-32 w-full" data-testid="report-custom-range-loading" />
      ) : result === null ? (
        <p className="text-sm text-muted-foreground">Report request not found.</p>
      ) : result.status === "pending" ? (
        <p role="status" className="text-sm text-muted-foreground">
          Building report for {result.startDate} – {result.endDate}…
        </p>
      ) : result.status === "failed" ? (
        <p role="alert" className="text-sm text-destructive">
          {result.failureReason ?? "The report could not be built."}
        </p>
      ) : (
        <div className="space-y-layout-md" data-testid="report-custom-range-completed">
          {result.totals ? (
            <dl className="grid grid-cols-2 gap-layout-sm sm:grid-cols-4">
              <RangeStat label="Net sales" value={formatOptionalMoney(result.totals.netSalesMinor, activeStore?.currency ?? "USD")} />
              <RangeStat label="Units sold" value={formatUnits(result.totals.unitsSold)} />
              <RangeStat
                label="Gross profit"
                value={formatReportProfit(result.totals.grossProfitMinor, activeStore?.currency ?? "USD")}
              />
              <RangeStat label="Days" value={`${result.totals.dayCount} (${result.totals.unsettledDayCount} unsettled)`} />
            </dl>
          ) : null}
          {result.topSkus && result.topSkus.length > 0 ? (
            <div className="overflow-hidden rounded-lg border border-border bg-surface-raised shadow-surface">
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
                  {result.topSkus.map((row) => (
                    <TableRow key={row.productSkuId}>
                      <TableCell>{row.productSkuId}</TableCell>
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
          ) : null}
        </div>
      )}
    </section>
  );
}

function RangeStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-numeric text-sm font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
