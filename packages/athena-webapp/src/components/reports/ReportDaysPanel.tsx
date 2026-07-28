import { useQuery } from "convex/react";
import { Link, useParams } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/states/empty/empty-state";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { api } from "~/convex/_generated/api";
import { ReportDayStatusBadge } from "./ReportStatusBadge";
import { formatOperatingDate, formatOptionalMoney, formatReportMoney, formatUnits } from "./reportFormat";

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
  const days = useQuery(
    api.reports.queries.listDays,
    activeStore?._id
      ? { storeId: activeStore._id, startDate, endDate }
      : "skip",
  );

  return (
    <Card data-testid="report-days-panel">
      <CardHeader className="flex flex-col gap-layout-sm sm:flex-row sm:items-end sm:justify-between">
        <CardTitle className="text-base font-semibold">Days</CardTitle>
        <div className="flex flex-wrap gap-layout-sm">
          <div className="space-y-1">
            <Label htmlFor="report-days-start">From</Label>
            <Input
              id="report-days-start"
              max={endDate}
              onChange={(event) =>
                onRangeChange({ startDate: event.target.value, endDate })
              }
              type="date"
              value={startDate}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="report-days-end">To</Label>
            <Input
              id="report-days-end"
              min={startDate}
              onChange={(event) =>
                onRangeChange({ startDate, endDate: event.target.value })
              }
              type="date"
              value={endDate}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {days === undefined ? (
          <Skeleton className="h-48 w-full" data-testid="report-days-loading" />
        ) : days.length === 0 ? (
          <EmptyState title="No days in range" description="Choose a different date range." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Net sales</TableHead>
                <TableHead>Units sold</TableHead>
                <TableHead>Close variance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {days.map((day) => (
                <TableRow key={day.operatingDate}>
                  <TableCell>
                    <Link
                      params={{ orgUrlSlug: orgUrlSlug!, storeUrlSlug: storeUrlSlug! }}
                      search={{ periodType: "day", periodDate: day.operatingDate }}
                      to="/$orgUrlSlug/store/$storeUrlSlug/reports/items"
                    >
                      {formatOperatingDate(day.operatingDate)}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <ReportDayStatusBadge status={day.status} />
                  </TableCell>
                  <TableCell>{formatReportMoney(day.netSalesMinor, day.currency)}</TableCell>
                  <TableCell>{formatUnits(day.unitsSold)}</TableCell>
                  <TableCell>
                    {formatOptionalMoney(day.closeVarianceMinor, day.currency)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
