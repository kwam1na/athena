import { useQuery } from "convex/react";
import { Link, useParams } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
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
import { api } from "~/convex/_generated/api";
import type { ReportSkuSortBy } from "~/shared/reportsContract";
import {
  REPORT_PERIOD_TYPE_LABELS,
  REPORT_PERIOD_TYPES,
  periodKeyForSelection,
  type ReportPeriodType,
} from "./reportPeriodKeys";
import { formatOptionalMoney, formatReportProfit, formatUnits } from "./reportFormat";

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

  const result = useQuery(
    api.reports.queries.listPeriodSkus,
    activeStore?._id
      ? { storeId: activeStore._id, periodKey, sortBy, cursor }
      : "skip",
  );

  return (
    <div className="space-y-layout-md" data-testid="reports-items">
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
        <div className="space-y-1">
          <Label htmlFor="items-period-date">Anchor date</Label>
          <Input
            id="items-period-date"
            onChange={(event) => onPeriodDateChange(event.target.value)}
            type="date"
            value={periodDate}
          />
        </div>
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

      {result === undefined ? (
        <Skeleton className="h-64 w-full" data-testid="reports-items-loading" />
      ) : result.rows.length === 0 ? (
        <EmptyState title="No SKU activity" description="No SKUs sold in this period." />
      ) : (
        <>
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
                      params={{
                        orgUrlSlug: orgUrlSlug!,
                        storeUrlSlug: storeUrlSlug!,
                        productSkuId: row.productSkuId,
                      }}
                      to="/$orgUrlSlug/store/$storeUrlSlug/reports/items/$productSkuId"
                    >
                      {row.productSkuId}
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
