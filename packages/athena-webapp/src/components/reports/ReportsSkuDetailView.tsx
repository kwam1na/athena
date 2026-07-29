import { useQuery } from "convex/react";
import { Link, useParams } from "@tanstack/react-router";
import { ArrowDown, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OperationsSummaryMetric } from "@/components/operations/OperationsSummaryMetric";
import { getOrigin } from "@/lib/navigationUtils";
import { FadeIn } from "@/components/common/FadeIn";
import { ListPagination } from "@/components/common/ListPagination";
import { ReportBackLink } from "./ReportBackLink";
import { ReportDateRangeField } from "./ReportDateRangeField";
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

const REPORT_SKU_DETAIL_PAGE_SIZE = 10;

export function ReportsSkuDetailView({
  productSkuId,
  startDate,
  endDate,
  onRangeChange,
  onPageChange,
  page,
}: {
  productSkuId: string;
  startDate: string;
  endDate: string;
  onRangeChange: (next: { startDate: string; endDate: string }) => void;
  onPageChange: (page: number) => void;
  page: number;
}) {
  const { activeStore } = useGetActiveStore();
  const { orgUrlSlug, storeUrlSlug } = useParams({ strict: false });
  const currency = activeStore?.currency ?? "USD";

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
  const daysNewestFirst = detail
    ? [...detail.days].sort((left, right) =>
        right.operatingDate.localeCompare(left.operatingDate),
      )
    : [];
  const totalDays = daysNewestFirst.length;
  const pageCount = Math.max(
    1,
    Math.ceil(totalDays / REPORT_SKU_DETAIL_PAGE_SIZE),
  );
  const currentPage = Math.min(page, pageCount);
  const visibleDays = daysNewestFirst.slice(
    (currentPage - 1) * REPORT_SKU_DETAIL_PAGE_SIZE,
    currentPage * REPORT_SKU_DETAIL_PAGE_SIZE,
  );

  return (
    /* Rhythm: tight inside a cluster, generous between sections, so the page
       reads as identity / controls / results rather than one flat stack. */
    <FadeIn>
      <div
        className="space-y-layout-xl md:space-y-layout-2xl"
        data-testid="reports-sku-detail"
      >
        <div className="space-y-layout-lg">
          <ReportBackLink label="Back to items" />

          <header className="flex flex-col gap-layout-md sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-layout-xs">
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Product report
              </p>
              <div className="space-y-1">
                <h2
                  className="truncate text-2xl font-semibold tracking-tight text-foreground"
                  data-testid="reports-sku-detail-name"
                >
                  {detail
                    ? formatSkuDisplayName(detail.identity, productSkuId)
                    : "\u00A0"}
                </h2>
                <p className="truncate text-sm text-muted-foreground">
                  {detail
                    ? formatSkuSubtitle(detail.identity, productSkuId)
                    : "\u00A0"}
                </p>
              </div>
            </div>

            {/* Product management is adjacent to, but distinct from, this
                reporting identity. An explicit action keeps the heading from
                doing double duty as navigation. */}
            {detail?.identity?.productId ? (
              <Button
                asChild
                className="shrink-0 self-start"
                size="sm"
                variant="utility"
              >
                <Link
                  params={{
                    orgUrlSlug: orgUrlSlug!,
                    storeUrlSlug: storeUrlSlug!,
                    productSlug: detail.identity.productId,
                  }}
                  search={{ o: getOrigin() }}
                  to="/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug"
                >
                  View product
                  <ArrowUpRight aria-hidden="true" />
                </Link>
              </Button>
            ) : null}
          </header>

          <div className="flex flex-wrap">
            <ReportDateRangeField
              align="start"
              endDate={endDate}
              label="Reporting period"
              onSelect={onRangeChange}
              startDate={startDate}
            />
          </div>
        </div>

        {/* Nothing until the first result settles: these queries resolve fast
          enough that a skeleton appears and vanishes as a flash of its own.
          Refreshes keep the previous data on screen (see useStableReportQuery),
          so this branch is only ever the very first load. */}
        {isInitialLoad || detail === undefined ? null : detail === null ? (
          <EmptyState
            title="No activity"
            description="This SKU has no activity in the selected range."
          />
        ) : (
          <div
            aria-busy={isRefreshing}
            className={cn(
              "space-y-layout-xl transition-opacity duration-150 motion-reduce:transition-none",
              isRefreshing && "opacity-60",
            )}
            data-refreshing={isRefreshing ? "true" : undefined}
          >
            <div className="grid grid-cols-2 gap-layout-sm sm:grid-cols-4">
              <OperationsSummaryMetric
                label="Net sales"
                value={formatOptionalMoney(
                  detail.totals?.netSalesMinor,
                  currency,
                )}
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
                    ? formatReportProfit(
                        detail.totals.grossProfitMinor,
                        currency,
                      )
                    : "—"
                }
              />
              <OperationsSummaryMetric
                label="Refunds"
                value={formatOptionalMoney(
                  detail.totals?.refundsMinor,
                  currency,
                )}
              />
            </div>

            {detail.days.length === 0 ? (
              <EmptyState
                title="No days with activity"
                description="No days with activity in the selected range."
              />
            ) : (
              <div className="overflow-hidden rounded-lg border border-border bg-surface-raised shadow-surface">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead aria-sort="descending">
                        <span className="inline-flex items-center gap-1">
                          Date
                          <ArrowDown
                            aria-hidden="true"
                            className="h-3.5 w-3.5"
                          />
                        </span>
                      </TableHead>
                      <TableHead>Net sales</TableHead>
                      <TableHead>Units sold</TableHead>
                      <TableHead>Gross profit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleDays.map((day) => (
                      <TableRow key={day.operatingDate}>
                        <TableCell>
                          {formatOperatingDate(day.operatingDate)}
                        </TableCell>
                        <TableCell>
                          {formatOptionalMoney(day.netSalesMinor, currency)}
                        </TableCell>
                        <TableCell>{formatUnits(day.unitsSold)}</TableCell>
                        <TableCell>
                          {formatReportProfit(day.grossProfitMinor, currency)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {totalDays > REPORT_SKU_DETAIL_PAGE_SIZE ? (
                  <ListPagination
                    onPageChange={onPageChange}
                    page={currentPage}
                    pageCount={pageCount}
                    pageSize={REPORT_SKU_DETAIL_PAGE_SIZE}
                    totalItems={totalDays}
                  />
                ) : null}
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
    </FadeIn>
  );
}
