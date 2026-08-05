import { useQuery } from "convex/react";
import { Link, useParams } from "@tanstack/react-router";
import { useMemo } from "react";
import { ArrowDown, ArrowUpRight, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OperationsSummaryMetric } from "@/components/operations/OperationsSummaryMetric";
import { formatOperationsMetricComparison } from "@/components/operations/operationsMetricFormatting";
import { getOrigin } from "@/lib/navigationUtils";
import { FadeIn } from "@/components/common/FadeIn";
import { PageLevelHeader } from "@/components/common/PageLevelHeader";
import { ListPagination } from "@/components/common/ListPagination";
import { ReportDateRangeField } from "./ReportDateRangeField";
import { ReportMetricComparisonCrossfade } from "./ReportMetricComparisonCrossfade";
import { useStableReportQuery } from "./useStableReportQuery";
import {
  useReportsSharedDemoMode,
  useSharedDemoLiveReportsDay,
} from "./useReportsSharedDemoMode";
import {
  createSharedDemoSkuDayTransactions,
  createSharedDemoSkuDetail,
  isSharedDemoReportsSkuId,
} from "@/components/shared-demo/sharedDemoReportsFixture";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
  onTransactionDateChange,
  page,
  transactionDate,
}: {
  productSkuId: string;
  startDate: string;
  endDate: string;
  onRangeChange: (next: { startDate: string; endDate: string }) => void;
  onPageChange: (page: number) => void;
  onTransactionDateChange: (operatingDate: string | undefined) => void;
  page: number;
  transactionDate?: string;
}) {
  const { activeStore } = useGetActiveStore();
  const { orgUrlSlug, storeUrlSlug } = useParams({ strict: false });
  const currency = activeStore?.currency ?? "USD";
  const rangeKey = `${startDate}:${endDate}`;

  const { isSharedDemo, useLiveQuery } = useReportsSharedDemoMode();
  const { liveDay, liveStock, today } = useSharedDemoLiveReportsDay();
  // The SKU id is a route param, so it can be anything at all. Only a
  // shared-demo id reaches the fixture; everything else resolves to `null`,
  // which is the same "no activity" state the live query produces.
  const isDemoSku = isSharedDemo && isSharedDemoReportsSkuId(productSkuId);
  const liveDetail = useQuery(
    api.reports.queries.getSkuDetail,
    activeStore?._id && useLiveQuery
      ? {
        storeId: activeStore._id,
        productSkuId: productSkuId as Id<"productSku">,
        startDate,
        endDate,
      }
      : "skip",
  );
  const demoDetail = useMemo(
    () =>
      isSharedDemo
        ? isDemoSku
          ? createSharedDemoSkuDetail({
              productSkuId,
              startDate,
              endDate,
              liveDay,
              liveStock,
              today,
            })
          : null
        : undefined,
    [
      endDate,
      isDemoSku,
      isSharedDemo,
      liveDay,
      liveStock,
      productSkuId,
      startDate,
      today,
    ],
  );
  const {
    data: detail,
    dataContext: settledRangeKey,
    isInitialLoad,
    isRefreshing,
  } = useStableReportQuery(isSharedDemo ? demoDetail : liveDetail, rangeKey);
  const comparisonKey = settledRangeKey ?? rangeKey;
  const comparisonHelper = (
    currentValue: number | null | undefined,
    priorValue: number | null | undefined,
    missingComparisonLabel?: string,
  ) => (
    <ReportMetricComparisonCrossfade comparisonKey={comparisonKey}>
      {formatOperationsMetricComparison({
        currentValue,
        missingComparisonLabel,
        priorValue,
        priorWindowLabel: "prior period",
      })}
    </ReportMetricComparisonCrossfade>
  );
  const grossProfitHelper = () => {
    const totals = detail?.totals;
    if (!totals) return undefined;
    if (totals.grossProfitMinor === null) {
      return (
        <ReportMetricComparisonCrossfade comparisonKey={comparisonKey}>
          {reportProfitHelper(totals.grossProfitMinor)}
        </ReportMetricComparisonCrossfade>
      );
    }

    return comparisonHelper(
      totals.grossProfitMinor,
      detail.priorPeriodTotals?.grossProfitMinor,
      detail.priorPeriodTotals?.grossProfitMinor === null
        ? "Prior period profit unavailable"
        : undefined,
    );
  };
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
  /**
   * The demo's history has no transactions for today — the fixture stops at
   * yesterday — so today's evidence is read from the server like any other
   * store's. `reportFact` rows for the visitor's own sales are already there.
   * The lookup is what makes the read possible: the sheet is addressed by a
   * fixture sku id, and only the live day knows the real row behind it.
   */
  const demoLiveEvidenceSkuId =
    isSharedDemo && transactionDate === today
      ? liveDay?.querySkuIdByFixtureSkuId.get(productSkuId)
      : undefined;
  const liveTransactionEvidence = useQuery(
    api.reports.queries.listSkuDayTransactions,
    activeStore?._id && transactionDate && (useLiveQuery || demoLiveEvidenceSkuId)
      ? {
        storeId: activeStore._id,
        productSkuId: (demoLiveEvidenceSkuId ??
          productSkuId) as Id<"productSku">,
        operatingDate: transactionDate,
      }
      : "skip",
  );
  const demoTransactionEvidence = useMemo(
    () =>
      isSharedDemo && transactionDate
        ? isDemoSku
          ? createSharedDemoSkuDayTransactions({
              productSkuId,
              operatingDate: transactionDate,
              liveDay,
              today,
            })
          : { transactions: [], truncated: false }
        : undefined,
    [isDemoSku, isSharedDemo, liveDay, productSkuId, today, transactionDate],
  );
  const transactionEvidenceResult = demoLiveEvidenceSkuId
    ? liveTransactionEvidence
    : isSharedDemo
      ? demoTransactionEvidence
      : liveTransactionEvidence;
  const transactionEvidence = transactionDate
    ? transactionEvidenceResult
    : undefined;
  const selectedDateLabel = transactionDate
    ? formatOperatingDate(transactionDate)
    : "";
  const resolvedProductName = detail?.identity
    ? formatSkuDisplayName(detail.identity, productSkuId)
    : null;
  const transactionSheetProductName =
    resolvedProductName &&
      resolvedProductName !== productSkuId &&
      resolvedProductName !== detail?.identity?.sku
      ? resolvedProductName
      : "Product";
  const skuImageUrl = detail?.identity?.imageUrl;
  const unitMarginMinor =
    typeof detail?.identity?.netPriceMinor === "number" &&
      typeof detail.identity.unitCostMinor === "number"
      ? detail.identity.netPriceMinor - detail.identity.unitCostMinor
      : undefined;

  return (
    /* Rhythm: tight inside a cluster, generous between sections, so the page
       reads as identity / controls / results rather than one flat stack. */
    <FadeIn>
      <div
        className="space-y-layout-xl md:space-y-layout-2xl"
        data-testid="reports-sku-detail"
      >
        <div className="space-y-layout-xl">
          <PageLevelHeader
            showBackButton
            title="Reports"
          />

          <header
            className="flex min-w-0 items-start gap-layout-md"
            data-testid="reports-sku-identity"
          >
            <div
              className="flex w-28 shrink-0 flex-col gap-layout-xs"
              data-testid="reports-sku-identity-media"
            >
              <div className="aspect-square w-full overflow-hidden rounded-md bg-muted/30">
                {detail === undefined ? null : skuImageUrl ? (
                  <img
                    alt={resolvedProductName ?? "SKU"}
                    className="h-full w-full object-cover"
                    src={skuImageUrl}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-muted">
                    <Package
                      aria-label="SKU image unavailable"
                      className="h-8 w-8 text-muted-foreground"
                    />
                  </div>
                )}
              </div>

              {detail?.identity?.productId ? (
                <Button
                  asChild
                  className="h-8 w-full gap-1 px-2 text-xs [&_svg]:size-3.5"
                  size="sm"
                  variant="utility"
                >
                  <Link
                    params={{
                      orgUrlSlug: orgUrlSlug!,
                      storeUrlSlug: storeUrlSlug!,
                      productSlug: detail.identity.productId,
                    }}
                    search={{
                      o: getOrigin(),
                      variant: detail.identity.sku,
                    }}
                    to="/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug"
                  >
                    View product
                    <ArrowUpRight aria-hidden="true" />
                  </Link>
                </Button>
              ) : null}
            </div>

            <div className="min-w-0 flex-1 space-y-layout-md">
              <div
                className="min-w-0"
                data-testid="reports-sku-primary-identity"
              >
                <h2
                  className="truncate text-2xl font-semibold tracking-tight text-foreground"
                  data-testid="reports-sku-detail-name"
                >
                  {detail
                    ? formatSkuDisplayName(detail.identity, productSkuId)
                    : "\u00A0"}
                </h2>
              </div>
              {detail ? (
                <div
                  className="space-y-layout-xs"
                  data-testid="reports-sku-details"
                >
                  <p className="flex min-w-0 items-baseline gap-2 text-xs text-muted-foreground">
                    <span className="font-medium uppercase tracking-wide">
                      SKU
                    </span>
                    <span className="truncate text-foreground">
                      {formatSkuSubtitle(detail.identity, productSkuId)}
                    </span>
                  </p>
                  <div aria-label="Pricing and stock" role="group">
                    <dl className="flex min-w-0 flex-wrap items-baseline gap-x-layout-lg gap-y-layout-xs">
                      {/*
                        Stock on hand sits with the SKU's own attributes, ABOVE
                        the reporting-period control — not among the period
                        metrics below it. Those cards all answer "in this
                        range", and every one of their helper lines compares
                        against the prior period. Available is a right-now
                        fact the date picker cannot change, so placing it there
                        would make that control look like it governs a number
                        it does not.
                      */}
                      {detail.identity?.quantityAvailable !== undefined ? (
                        <div className="flex min-w-0 items-baseline gap-1.5">
                          <dt className="text-xs text-muted-foreground">
                            Available
                          </dt>
                          <dd className="font-numeric text-sm tabular-nums text-foreground">
                            {formatUnits(detail.identity.quantityAvailable)}
                          </dd>
                        </div>
                      ) : null}
                      <div className="flex min-w-0 items-baseline gap-1.5">
                        <dt className="text-xs text-muted-foreground">
                          Net price
                        </dt>
                        <dd className="font-numeric text-sm tabular-nums text-foreground">
                          {formatOptionalMoney(
                            detail.identity?.netPriceMinor,
                            currency,
                          )}
                        </dd>
                      </div>
                      <div className="flex min-w-0 items-baseline gap-1.5">
                        <dt className="text-xs text-muted-foreground">
                          Unit cost
                        </dt>
                        <dd className="font-numeric text-sm tabular-nums text-foreground">
                          {formatOptionalMoney(
                            detail.identity?.unitCostMinor,
                            currency,
                          )}
                        </dd>
                      </div>
                      <div className="flex min-w-0 items-baseline gap-1.5">
                        <dt className="text-xs text-muted-foreground">
                          Unit margin
                        </dt>
                        <dd className="font-numeric text-sm tabular-nums text-foreground">
                          {formatOptionalMoney(unitMarginMinor, currency)}
                        </dd>
                      </div>
                    </dl>
                  </div>
                </div>
              ) : null}
            </div>
          </header>
        </div>

        <div
          className="space-y-layout-sm"
          data-testid="reports-sku-summary"
        >
          <div className="flex flex-wrap">
            <ReportDateRangeField
              align="start"
              endDate={endDate}
              label="Reporting period"
              onSelect={onRangeChange}
              startDate={startDate}
            />
          </div>

          {detail ? (
            <div
              aria-busy={isRefreshing}
              className={cn(
                "grid grid-cols-2 gap-layout-sm transition-opacity duration-150 motion-reduce:transition-none sm:grid-cols-4",
                isRefreshing && "opacity-60",
              )}
            >
              <OperationsSummaryMetric
                formatValue={(value) =>
                  formatOptionalMoney(value, currency)
                }
                helper={
                  detail.totals
                    ? comparisonHelper(
                      detail.totals.netSalesMinor,
                      detail.priorPeriodTotals?.netSalesMinor,
                    )
                    : undefined
                }
                label="Net sales"
                value={detail.totals?.netSalesMinor ?? "—"}
                valueTransitionFromZero="fade"
              />
              <OperationsSummaryMetric
                formatValue={formatUnits}
                helper={
                  detail.totals
                    ? comparisonHelper(
                      detail.totals.unitsSold,
                      detail.priorPeriodTotals?.unitsSold,
                    )
                    : undefined
                }
                label="Units sold"
                value={detail.totals?.unitsSold ?? "—"}
                valueTransitionFromZero="fade"
              />
              <OperationsSummaryMetric
                formatValue={(value) =>
                  formatReportProfit(value, currency)
                }
                helper={grossProfitHelper()}
                label="Gross profit"
                value={detail.totals?.grossProfitMinor ?? "—"}
                valueTransitionFromZero="fade"
              />
              <OperationsSummaryMetric
                formatValue={(value) =>
                  formatOptionalMoney(value, currency)
                }
                helper={
                  detail.totals
                    ? comparisonHelper(
                      detail.totals.refundsMinor,
                      detail.priorPeriodTotals?.refundsMinor,
                    )
                    : undefined
                }
                label="Refunds"
                value={detail.totals?.refundsMinor ?? "—"}
                valueTransitionFromZero="fade"
              />
            </div>
          ) : null}
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
                          <button
                            className="inline-flex items-center gap-2 text-left font-medium text-foreground transition-colors hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                            onClick={() =>
                              onTransactionDateChange(day.operatingDate)
                            }
                            type="button"
                            aria-label={`View transactions for ${formatOperatingDate(day.operatingDate)}`}
                          >
                            {formatOperatingDate(day.operatingDate)}
                          </button>
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

        <Sheet
          onOpenChange={(open) => {
            if (!open) onTransactionDateChange(undefined);
          }}
          open={transactionDate !== undefined}
        >
          <SheetContent
            className="flex w-[min(100vw,72rem)] max-w-[calc(100vw-1rem)] flex-col overflow-hidden border-border bg-surface-raised p-0 shadow-overlay sm:max-w-6xl"
            side="right"
          >
            <SheetHeader className="border-b border-border px-layout-xl py-layout-lg pr-12">
              <SheetTitle>Transactions for {selectedDateLabel}</SheetTitle>
              <SheetDescription>
                {transactionEvidence ? (
                  <>
                    {`${transactionEvidence.transactions.length} ${transactionEvidence.transactions.length === 1
                      ? "transaction"
                      : "transactions"
                      } attached to `}
                    <span className="font-medium text-foreground">
                      {transactionSheetProductName}
                    </span>{" "}
                    on the selected operating day.
                  </>
                ) : (
                  <>
                    Loading transaction evidence for{" "}
                    <span className="font-medium text-foreground">
                      {transactionSheetProductName}
                    </span>
                    .
                  </>
                )}
              </SheetDescription>
            </SheetHeader>

            <div
              className="min-h-0 flex-1 overflow-y-auto bg-surface-raised p-layout-lg md:p-layout-xl"
              data-testid="sku-transaction-report-body"
            >
              <div
                className="overflow-hidden rounded-lg border border-border bg-background/60 shadow-surface"
                data-testid="sku-transaction-report-table"
              >
                {transactionEvidence === undefined ? (
                  <p className="p-layout-lg text-sm text-muted-foreground">
                    Loading transactions…
                  </p>
                ) : transactionEvidence.transactions.length === 0 ? (
                  <div className="p-layout-lg">
                    <EmptyState
                      description="No attached POS or storefront transactions were found."
                      title="No transaction evidence"
                    />
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    <div
                      className="hidden grid-cols-[minmax(11rem,1.2fr)_minmax(7rem,0.65fr)_minmax(6rem,0.55fr)_minmax(9rem,0.8fr)_minmax(13rem,1.15fr)_minmax(8rem,0.7fr)] gap-layout-lg px-layout-xl py-layout-md text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground md:grid"
                      data-testid="sku-transaction-report-header"
                    >
                      <span>Transaction</span>
                      <span>Channel</span>
                      <span>Quantity</span>
                      <span>Net sale</span>
                      <span>Performance</span>
                      <span className="text-right">Time</span>
                    </div>

                    {transactionEvidence.transactions.map((transaction) => {
                      const isPos = transaction.sourceDomain === "pos";
                      const linkLabel = `${transaction.reference}, ${isPos ? "POS transaction" : "Storefront order"}`;
                      const performanceUnavailable =
                        transaction.costMinor === null ||
                        transaction.grossProfitMinor === null;
                      const showStatus =
                        transaction.status.trim().toLowerCase() !== "completed";

                      return (
                        <div
                          className="grid grid-cols-1 gap-layout-sm px-layout-xl py-layout-md text-sm md:grid-cols-[minmax(11rem,1.2fr)_minmax(7rem,0.65fr)_minmax(6rem,0.55fr)_minmax(9rem,0.8fr)_minmax(13rem,1.15fr)_minmax(8rem,0.7fr)] md:items-center md:gap-layout-lg"
                          data-sku-transaction-report-row=""
                          key={`${transaction.sourceDomain}:${transaction.sourceId}`}
                        >
                          <div
                            className="min-w-0"
                            data-sku-transaction-report-column="transaction"
                          >
                            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                              <Link
                                className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-4 transition-colors hover:text-primary hover:underline active:text-primary"
                                params={
                                  isPos
                                    ? {
                                      orgUrlSlug: orgUrlSlug!,
                                      storeUrlSlug: storeUrlSlug!,
                                      transactionId:
                                        transaction.sourceId as Id<"posTransaction">,
                                    }
                                    : {
                                      orgUrlSlug: orgUrlSlug!,
                                      storeUrlSlug: storeUrlSlug!,
                                      orderSlug:
                                        transaction.sourceId as Id<"onlineOrder">,
                                    }
                                }
                                search={{ o: getOrigin() }}
                                to={
                                  isPos
                                    ? "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/$transactionId"
                                    : "/$orgUrlSlug/store/$storeUrlSlug/orders/$orderSlug"
                                }
                                aria-label={linkLabel}
                              >
                                #{transaction.reference}
                                <ArrowUpRight
                                  aria-hidden="true"
                                  className="h-3 w-3"
                                />
                              </Link>
                              {showStatus ? (
                                <span className="text-xs capitalize text-muted-foreground">
                                  {transaction.status}
                                </span>
                              ) : null}
                            </div>
                            {transaction.hasRefunds ||
                              transaction.hasAdjustments ? (
                              <p className="mt-1 text-xs text-muted-foreground">
                                {[
                                  transaction.hasRefunds
                                    ? "Refund activity"
                                    : null,
                                  transaction.hasAdjustments
                                    ? "Adjustments applied"
                                    : null,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </p>
                            ) : null}
                          </div>

                          <div
                            className="min-w-0 text-muted-foreground md:text-foreground"
                            data-sku-transaction-report-column="channel"
                          >
                            <span className="mr-2 text-xs text-muted-foreground md:hidden">
                              Channel
                            </span>
                            {isPos ? "POS" : "Storefront"}
                          </div>

                          <div
                            className="min-w-0 font-numeric tabular-nums text-foreground"
                            data-sku-transaction-report-column="quantity"
                          >
                            <span className="mr-2 text-xs font-sans text-muted-foreground md:hidden">
                              Quantity
                            </span>
                            {formatUnits(transaction.quantity)}
                          </div>

                          <div
                            className="min-w-0 font-numeric tabular-nums text-foreground"
                            data-sku-transaction-report-column="net-sale"
                          >
                            <span className="mr-2 text-xs font-sans text-muted-foreground md:hidden">
                              Net sale
                            </span>
                            {formatOptionalMoney(
                              transaction.netSalesMinor,
                              currency,
                            )}
                          </div>

                          <div
                            className="grid min-w-0 grid-cols-2 gap-layout-md"
                            data-sku-transaction-report-column="performance"
                          >
                            <div className="min-w-0">
                              <p className="text-xs text-muted-foreground">
                                Cost
                              </p>
                              <p className="font-numeric leading-6 text-foreground tabular-nums">
                                {formatOptionalMoney(
                                  transaction.costMinor,
                                  currency,
                                )}
                              </p>
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs text-muted-foreground">
                                Profit
                              </p>
                              <p className="font-numeric leading-6 text-foreground tabular-nums">
                                {formatReportProfit(
                                  transaction.grossProfitMinor,
                                  currency,
                                )}
                              </p>
                            </div>
                            {performanceUnavailable ? (
                              <span className="sr-only">
                                Historical cost is unavailable for this
                                transaction.
                              </span>
                            ) : null}
                          </div>

                          <div
                            className="min-w-0 font-numeric leading-6 text-muted-foreground tabular-nums md:text-right md:text-foreground"
                            data-sku-transaction-report-column="time"
                          >
                            <span className="mr-2 text-xs font-sans text-muted-foreground md:hidden">
                              Time
                            </span>
                            {new Intl.DateTimeFormat("en-US", {
                              hour: "numeric",
                              minute: "2-digit",
                            }).format(transaction.occurredAt)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {transactionEvidence?.truncated ? (
                <p className="mt-layout-md rounded-md bg-muted p-layout-sm text-xs text-muted-foreground">
                  This day has more transaction evidence than can be shown here.
                  The visible results are incomplete.
                </p>
              ) : null}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </FadeIn>
  );
}
