import { Link } from "@tanstack/react-router";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";

import { AnimatedHeight } from "@/components/common/AnimatedHeight";
import { OperationsSummaryMetric } from "@/components/operations/OperationsSummaryMetric";
import { formatOperationsMetricComparison } from "@/components/operations/operationsMetricFormatting";
import type { ReportPeriodSnapshot } from "~/shared/reportsContract";
import {
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
  periodLabel,
  priorWindowLabel,
  eodReviewLink,
  transactionsLink,
}: {
  snapshot: ReportPeriodSnapshot;
  currency: string;
  /** Prior-window values for the comparable metrics; omit when not comparable. */
  comparison?: { netSalesMinor?: number; unitsSold?: number };
  eodReviewLink?: {
    orgUrlSlug: string;
    search: Record<string, string>;
    storeUrlSlug: string;
  };
  periodLabel: string;
  priorWindowLabel: string;
  transactionsLink?: {
    orgUrlSlug: string;
    search: Record<string, string>;
    storeUrlSlug: string;
  };
}) {
  const shouldReduceMotion = Boolean(useReducedMotion());
  const periodStatus =
    eodReviewLink
      ? "Closed"
      : snapshot.unsettledDayCount === 0
      ? undefined
      : periodLabel === "Today"
        ? "In progress"
        : `${snapshot.unsettledDayCount.toLocaleString()} of ${snapshot.dayCount.toLocaleString()} reported ${
            snapshot.dayCount === 1 ? "day" : "days"
          } awaiting reconciliation`;
  const showPeriodStatus = Boolean(periodStatus || eodReviewLink);

  return (
    <section
      data-testid={`report-period-metrics-${periodLabel}`}
    >
      <AnimatedHeight
        animateFromZero
        testId="report-period-status-transition"
      >
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
                {eodReviewLink ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <Link
                      className="inline-flex items-center gap-1 rounded-sm font-medium text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      params={{
                        orgUrlSlug: eodReviewLink.orgUrlSlug,
                        storeUrlSlug: eodReviewLink.storeUrlSlug,
                      }}
                      search={eodReviewLink.search}
                      to="/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close"
                    >
                      View EOD Review
                      <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
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
          helper={
            comparison
              ? formatOperationsMetricComparison({
                  currentValue: snapshot.netSalesMinor,
                  priorValue: comparison.netSalesMinor,
                  priorWindowLabel,
                })
              : undefined
          }
          label="Net sales"
          link={
            transactionsLink
              ? {
                  ariaLabel: "Open transactions",
                  ...transactionsLink,
                  to: "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions",
                }
              : undefined
          }
          value={formatReportMoney(snapshot.netSalesMinor, currency)}
        />
        <OperationsSummaryMetric
          helper={
            comparison
              ? formatOperationsMetricComparison({
                  currentValue: snapshot.unitsSold,
                  priorValue: comparison.unitsSold,
                  priorWindowLabel,
                })
              : undefined
          }
          label="Units sold"
          value={formatUnits(snapshot.unitsSold)}
        />
        <OperationsSummaryMetric
          helper={
            snapshot.uncostedRevenueMinor > 0
              ? `${formatReportMoney(snapshot.uncostedRevenueMinor, currency)} without item cost`
              : reportProfitHelper(snapshot.grossProfitMinor)
          }
          label="Gross profit"
          value={formatReportProfit(snapshot.grossProfitMinor, currency)}
        />
        <OperationsSummaryMetric
          label="Refunds"
          value={formatReportMoney(snapshot.refundsMinor, currency)}
        />
      </div>
    </section>
  );
}
