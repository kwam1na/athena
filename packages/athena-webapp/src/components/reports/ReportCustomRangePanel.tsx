import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { formatOptionalMoney, formatReportProfit, formatUnits } from "./reportFormat";

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

  return (
    <Card data-testid="report-custom-range-panel">
      <CardHeader className="flex flex-col gap-layout-sm sm:flex-row sm:items-end sm:justify-between">
        <CardTitle className="text-base font-semibold">Custom range</CardTitle>
        <div className="flex flex-wrap items-end gap-layout-sm">
          <div className="space-y-1">
            <Label htmlFor="report-range-start">Start date</Label>
            <Input
              id="report-range-start"
              max={endDate}
              onChange={(event) => onStartDateChange(event.target.value)}
              type="date"
              value={startDate}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="report-range-end">End date</Label>
            <Input
              id="report-range-end"
              min={startDate}
              onChange={(event) => onEndDateChange(event.target.value)}
              type="date"
              value={endDate}
            />
          </div>
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
      </CardHeader>
      <CardContent>
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
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RangeStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase text-muted-foreground">{label}</dt>
      <dd className="text-sm font-semibold">{value}</dd>
    </div>
  );
}
