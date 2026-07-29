import { useQuery } from "convex/react";
import { Link, useParams } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { useState } from "react";
import { Calendar as CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { OperationsSummaryMetric } from "@/components/operations/OperationsSummaryMetric";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { getOrigin } from "@/lib/navigationUtils";
import { ReportBackLink } from "./ReportBackLink";
import { useStableReportQuery } from "./useStableReportQuery";
import { cn } from "@/lib/utils";
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
import {
  getLocalDateFromOperatingDate,
  getLocalOperatingDate,
} from "@/lib/operations/operatingDate";
import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import {
  formatOperatingDate,
  formatOptionalMoney,
  formatReportProfit,
  formatSkuDisplayName,
  formatSkuSubtitle,
  formatUnits,
  reportProfitHelper,
  reportProfitUnavailableNote,
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
      <PopoverContent align="start" className="w-auto p-0">
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
  const { orgUrlSlug, storeUrlSlug } = useParams({ strict: false });
  const currency = activeStore?.currency ?? "USD";
  const startBoundary = getLocalDateFromOperatingDate(startDate);
  const endBoundary = getLocalDateFromOperatingDate(endDate);

  const {
    data: detail,
    isInitialLoad,
    isRefreshing,
  } = useStableReportQuery(
    useQuery(
      api.reports.queries.getSkuDetail,
      activeStore?._id
        ? {
            storeId: activeStore._id,
            productSkuId: productSkuId as Id<"productSku">,
            startDate,
            endDate,
          }
        : "skip",
    ),
  );

  return (
    /* Rhythm: tight inside a cluster, generous between sections, so the page
       reads as identity / controls / results rather than one flat stack. */
    <div
      className="space-y-layout-xl md:space-y-layout-2xl"
      data-testid="reports-sku-detail"
    >
      <div className="space-y-layout-sm">
        <ReportBackLink label="Back to items" />

        <div className="space-y-1">
          {/* Out to the product's detail page, carrying this page as the
              origin so its back control returns here. The product id stands
              in for the slug, matching how the products table links. */}
          {detail?.identity?.productId ? (
            <Link
              className="group inline-flex items-center gap-1.5"
              params={{
                orgUrlSlug: orgUrlSlug!,
                storeUrlSlug: storeUrlSlug!,
                productSlug: detail.identity.productId,
              }}
              search={{ o: getOrigin() }}
              to="/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug"
            >
              <h2
                className="text-xl font-medium text-foreground"
                data-testid="reports-sku-detail-name"
              >
                {formatSkuDisplayName(detail?.identity, productSkuId)}
              </h2>
              <ArrowUpRight
                aria-hidden="true"
                className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
              />
              <span className="sr-only">Open product</span>
            </Link>
          ) : (
            <h2
              className="text-xl font-medium text-foreground"
              data-testid="reports-sku-detail-name"
            >
              {formatSkuDisplayName(detail?.identity, productSkuId)}
            </h2>
          )}
          <p className="text-sm text-muted-foreground">
            {formatSkuSubtitle(detail?.identity, productSkuId)}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-layout-sm">
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
      </div>

      {isInitialLoad || detail === undefined ? (
        <Skeleton className="h-64 w-full" data-testid="reports-sku-detail-loading" />
      ) : detail === null ? (
        <EmptyState title="No activity" description="This SKU has no activity in the selected range." />
      ) : (
        <div
          aria-busy={isRefreshing}
          className={cn(
            "space-y-layout-xl transition-opacity duration-150 motion-reduce:transition-none",
            // Runs once when the detail first resolves (see ReportsItemsView).
            "motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200",
            isRefreshing && "opacity-60",
          )}
          data-refreshing={isRefreshing ? "true" : undefined}
        >
          <div className="grid grid-cols-2 gap-layout-sm sm:grid-cols-4">
            <OperationsSummaryMetric
              label="Net sales"
              value={formatOptionalMoney(detail.totals?.netSalesMinor, currency)}
            />
            <OperationsSummaryMetric
              label="Units sold"
              value={formatUnits(detail.totals?.unitsSold)}
            />
            <OperationsSummaryMetric
              helper={
                detail.totals
                  ? reportProfitHelper(detail.totals.grossProfitMinor)
                  : undefined
              }
              label="Gross profit"
              value={
                detail.totals
                  ? formatReportProfit(detail.totals.grossProfitMinor, currency)
                  : "—"
              }
            />
            <OperationsSummaryMetric
              label="Refunds"
              value={formatOptionalMoney(detail.totals?.refundsMinor, currency)}
            />
          </div>

          {detail.days.length === 0 ? (
            <EmptyState title="No days with activity" description="No days with activity in the selected range." />
          ) : (
            <div className="overflow-hidden rounded-lg border border-border bg-surface-raised shadow-surface">
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
            </div>
          )}

          {detail.days.some((day) => day.grossProfitMinor === null) ? (
            <p className="text-xs text-muted-foreground">
              {reportProfitUnavailableNote}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
