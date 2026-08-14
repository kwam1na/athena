import { Link } from "@tanstack/react-router";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";

import { AnimatedHeight } from "@/components/common/AnimatedHeight";
import { OperationsSummaryMetric } from "@/components/operations/OperationsSummaryMetric";
import { formatOperationsMetricComparison } from "@/components/operations/operationsMetricFormatting";
import {
  settledTransactionCount,
  unitsPerTransaction,
  type ReportPeriodSnapshot,
} from "~/shared/reportsContract";
import { ReportMetricComparisonCrossfade } from "./ReportMetricComparisonCrossfade";
import {
  formatBasketSize,
  formatReportMoney,
  formatReportProfit,
  formatUnits,
  reportProfitHelper,
} from "./reportFormat";

/**
 * The overview's headline metrics for ONE selected window.
 *
 * Deliberately a single flat row rather than a card per period: showing
 * today, week-to-date and trailing-30 side by side produced twelve equally
 * weighted tiles with no focal point. The window is chosen above (see
 * `ReportsOverviewView`), matching how Store Pulse switches its range, and
 * the comparison rides in each metric's helper the way Daily Operations
 * does — which also states "no activity last week" plainly instead of
 * rendering a bare -100%.
 */
export function ReportPeriodMetrics({
  snapshot,
  currency,
  comparison,
  comparisonKey,
  dailyOperationsLink,
  periodLabel,
  periodRangeLabel,
  priorWindowLabel,
  eodReviewLink,
  transactionsLink,
}: {
  snapshot: ReportPeriodSnapshot;
  currency: string;
  /** Materialized prior-window values for all headline metrics. */
  comparison?: ReportPeriodSnapshot;
  comparisonKey: string;
  dailyOperationsLink?: {
    orgUrlSlug: string;
    search: Record<string, string>;
    storeUrlSlug: string;
  };
  eodReviewLink?: {
    orgUrlSlug: string;
    search: Record<string, string>;
    storeUrlSlug: string;
  };
  periodLabel: string;
  periodRangeLabel?: string;
  priorWindowLabel: string;
  transactionsLink?: {
    orgUrlSlug: string;
    search: Record<string, string>;
    storeUrlSlug: string;
  };
}) {
  const shouldReduceMotion = Boolean(useReducedMotion());
  const statusLink = eodReviewLink
    ? {
        ...eodReviewLink,
        label: "View EOD Review",
        to: "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close" as const,
      }
    : dailyOperationsLink
      ? {
          ...dailyOperationsLink,
          label: "View Daily Operations",
          to: "/$orgUrlSlug/store/$storeUrlSlug/operations" as const,
        }
      : undefined;
  const periodStatus = eodReviewLink
    ? "Closed"
    : dailyOperationsLink
      ? "In progress"
      : snapshot.unsettledDayCount === 0
        ? undefined
        : periodLabel === "Today"
          ? "In progress"
          : `${snapshot.unsettledDayCount.toLocaleString()} of ${snapshot.dayCount.toLocaleString()} reported ${
              snapshot.dayCount === 1 ? "day" : "days"
            } awaiting reconciliation`;
  const showPeriodStatus = Boolean(
    periodStatus || periodRangeLabel || statusLink,
  );
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
        priorWindowLabel,
      })}
    </ReportMetricComparisonCrossfade>
  );
  /**
   * Transactions and the basket size derived from them.
   *
   * Both read through the SAME coverage rule (`settledTransactionCount`), so
   * they can never disagree about whether the evidence is whole — a stated
   * count beside a withheld ratio derived from it would read as a bug.
   *
   * Coverage is the seam: units are folded from facts the instant a sale
   * lands, while a day's transaction count is only complete once that day is
   * closed. Neither number is approximated across it; the shared helper below
   * says which days are missing rather than leaving a bare dash.
   */
  const settledTransactions = settledTransactionCount(snapshot);
  const basketSize = unitsPerTransaction(snapshot);
  const coveredDayCount = snapshot.transactionCoveredDayCount;
  const hasFullCoverage =
    coveredDayCount !== undefined && coveredDayCount === snapshot.dayCount;
  const coverageHelper =
    hasFullCoverage || snapshot.dayCount === 0 ? undefined : (
      <ReportMetricComparisonCrossfade comparisonKey={comparisonKey}>
        {coveredDayCount === undefined
          ? "Awaiting close"
          : snapshot.dayCount === 1
            ? "Available after close"
            : `${coveredDayCount.toLocaleString()} of ${snapshot.dayCount.toLocaleString()} days closed`}
      </ReportMetricComparisonCrossfade>
    );
  const transactionsHelper =
    settledTransactions === null
      ? coverageHelper
      : comparison
        ? comparisonHelper(
            settledTransactions,
            settledTransactionCount(comparison),
          )
        : undefined;
  const basketSizeHelper =
    basketSize === null
      ? coverageHelper
      : comparison
        ? comparisonHelper(basketSize, unitsPerTransaction(comparison))
        : undefined;
  const grossProfitHelper =
    snapshot.grossProfitMinor === null
      ? (
          <ReportMetricComparisonCrossfade comparisonKey={comparisonKey}>
            {snapshot.uncostedRevenueMinor > 0
              ? `${formatReportMoney(snapshot.uncostedRevenueMinor, currency)} without item cost`
              : reportProfitHelper(snapshot.grossProfitMinor)}
          </ReportMetricComparisonCrossfade>
        )
      : comparison
        ? comparisonHelper(
            snapshot.grossProfitMinor,
            comparison.grossProfitMinor,
            comparison.grossProfitMinor === null
              ? "Prior period profit unavailable"
              : undefined,
          )
        : undefined;

  return (
    <section data-testid={`report-period-metrics-${periodLabel}`}>
      <AnimatedHeight animateFromZero testId="report-period-status-transition">
        <AnimatePresence initial={false}>
          {showPeriodStatus ? (
            <motion.div
              animate={{ opacity: 1 }}
              className="pb-layout-md"
              data-motion="period-status"
              exit={{ opacity: 0 }}
              initial={{ opacity: 0 }}
              key="period-status"
              transition={
                shouldReduceMotion
                  ? { duration: 0 }
                  : { duration: 0.18, ease: [0.23, 1, 0.32, 1] }
              }
            >
              <div
                className="flex min-h-5 flex-wrap items-center gap-x-2 text-xs leading-5 text-muted-foreground"
                data-testid="report-period-status"
              >
                {periodStatus ? <span>{periodStatus}</span> : null}
                {periodStatus && periodRangeLabel ? (
                  <span aria-hidden="true">·</span>
                ) : null}
                {periodRangeLabel ? <span>{periodRangeLabel}</span> : null}
                {statusLink ? (
                  <>
                    {periodStatus || periodRangeLabel ? (
                      <span aria-hidden="true">·</span>
                    ) : null}
                    <Link
                      className="inline-flex items-center gap-1 rounded-sm font-medium text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      params={{
                        orgUrlSlug: statusLink.orgUrlSlug,
                        storeUrlSlug: statusLink.storeUrlSlug,
                      }}
                      search={statusLink.search}
                      to={statusLink.to}
                    >
                      {statusLink.label}
                      <ArrowUpRight
                        aria-hidden="true"
                        className="h-3.5 w-3.5"
                      />
                    </Link>
                  </>
                ) : null}
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </AnimatedHeight>
      <div className="grid gap-layout-md [grid-template-columns:repeat(auto-fit,minmax(min(14rem,100%),1fr))] md:gap-layout-lg">
        <OperationsSummaryMetric
          className="h-full"
          formatValue={(value) => formatReportMoney(value, currency)}
          helper={
            comparison
              ? comparisonHelper(
                  snapshot.netSalesMinor,
                  comparison.netSalesMinor,
                )
              : undefined
          }
          label="Net sales"
          value={snapshot.netSalesMinor}
          valueTestId="overview-net-sales-number"
          valueTransitionFromZero="fade"
        />
        <OperationsSummaryMetric
          className="h-full"
          formatValue={formatUnits}
          helper={
            comparison
              ? comparisonHelper(snapshot.unitsSold, comparison.unitsSold)
              : undefined
          }
          label="Units sold"
          value={snapshot.unitsSold}
          valueTestId="overview-units-sold-number"
          valueTransitionFromZero="fade"
        />
        {/*
          Sits between its two related figures on purpose: units sold ÷
          transactions = units per sale reads left to right, so the ratio is a
          number you can check rather than one you take on faith. It also owns
          the transactions link now — the control belongs beside what it
          describes, not on Net sales two tiles away.
        */}
        <OperationsSummaryMetric
          className="h-full"
          formatValue={formatUnits}
          helper={transactionsHelper}
          label="Transactions"
          link={
            transactionsLink
              ? {
                  ariaLabel: "Open transactions",
                  ...transactionsLink,
                  to: "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions",
                }
              : undefined
          }
          value={settledTransactions ?? formatUnits(null)}
          valueTestId="overview-transactions-number"
          valueTransitionFromZero="fade"
        />
        <OperationsSummaryMetric
          className="h-full"
          formatValue={formatBasketSize}
          helper={basketSizeHelper}
          label="Units per sale"
          value={basketSize ?? formatBasketSize(null)}
          valueTestId="overview-units-per-sale-number"
          valueTransitionFromZero="fade"
        />
        <OperationsSummaryMetric
          className="h-full"
          formatValue={(value) => formatReportProfit(value, currency)}
          helper={grossProfitHelper}
          label="Gross profit"
          value={snapshot.grossProfitMinor ?? formatReportProfit(null, currency)}
          valueTestId="overview-gross-profit-number"
          valueTransitionFromZero="fade"
        />
      </div>
    </section>
  );
}
