import { useQuery } from "convex/react";
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
import { EmptyState } from "@/components/states/empty/empty-state";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import { formatOperatingDate, formatOptionalMoney, formatReportProfit, formatUnits } from "./reportFormat";

export function ReportsSkuDetailView({
  productSkuId,
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
}: {
  productSkuId: string;
  startDate: string;
  endDate: string;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
}) {
  const { activeStore } = useGetActiveStore();
  const currency = activeStore?.currency ?? "USD";

  const detail = useQuery(
    api.reports.queries.getSkuDetail,
    activeStore?._id
      ? {
          storeId: activeStore._id,
          productSkuId: productSkuId as Id<"productSku">,
          startDate,
          endDate,
        }
      : "skip",
  );

  return (
    <div className="space-y-layout-md" data-testid="reports-sku-detail">
      <div className="flex flex-wrap items-end gap-layout-sm">
        <div className="space-y-1">
          <Label htmlFor="sku-detail-start">Start date</Label>
          <Input
            id="sku-detail-start"
            max={endDate}
            onChange={(event) => onStartDateChange(event.target.value)}
            type="date"
            value={startDate}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sku-detail-end">End date</Label>
          <Input
            id="sku-detail-end"
            min={startDate}
            onChange={(event) => onEndDateChange(event.target.value)}
            type="date"
            value={endDate}
          />
        </div>
      </div>

      {detail === undefined ? (
        <Skeleton className="h-64 w-full" data-testid="reports-sku-detail-loading" />
      ) : detail === null ? (
        <EmptyState title="No activity" description="This SKU has no activity in the selected range." />
      ) : (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold">Totals</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-layout-sm sm:grid-cols-4">
              <Stat
                label="Net sales"
                value={formatOptionalMoney(detail.totals?.netSalesMinor, currency)}
              />
              <Stat label="Units sold" value={formatUnits(detail.totals?.unitsSold)} />
              <Stat
                label="Gross profit"
                value={
                  detail.totals
                    ? formatReportProfit(detail.totals.grossProfitMinor, currency)
                    : "—"
                }
              />
              <Stat
                label="Refunds"
                value={formatOptionalMoney(detail.totals?.refundsMinor, currency)}
              />
            </CardContent>
          </Card>

          {detail.days.length === 0 ? (
            <EmptyState title="No days with activity" description="No days with activity in the selected range." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Net sales</TableHead>
                  <TableHead>Units sold</TableHead>
                  <TableHead>Gross profit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.days.map((day) => (
                  <TableRow key={day.operatingDate}>
                    <TableCell>{formatOperatingDate(day.operatingDate)}</TableCell>
                    <TableCell>{formatOptionalMoney(day.netSalesMinor, currency)}</TableCell>
                    <TableCell>{formatUnits(day.unitsSold)}</TableCell>
                    <TableCell>{formatReportProfit(day.grossProfitMinor, currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold">{value}</p>
    </div>
  );
}
