import { Link, useParams } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import type {
  ReportWeekCompleteness,
  ReportWeekAmendmentPosture,
  ReportWeekLifecyclePosture,
  ReportWeekLineage,
  ReportWeekMetrics,
  ReportWeekSummary,
} from "~/shared/reportsContract";
import {
  formatOperatingDate,
  formatOptionalMoney,
  formatReportDateRange,
  formatReportMoney,
  formatReportProfit,
  formatUnits,
  reportProfitHelper,
} from "./reportFormat";
import {
  weeklyOwnerReturnState,
  type ReportsWeeklySearch,
} from "./reportRouteSearch";
import {
  weeklyAmendmentLabel,
  weeklyLifecycleLabel,
} from "./weeklyReportPresentation";

/**
 * The server-owned weekly projection shown by both active and history reads.
 * Lifecycle and inventory are optional during the compatibility rollout; the
 * view never manufactures a conclusion when an older projection omits them.
 */
export type WeeklyReportProjection = {
  reportId?: string;
  cycleStartDate: string;
  cycleEndDate: string;
  currency: string;
  included: ReportWeekMetrics;
  summary: ReportWeekSummary;
  outsideSchedule: ReportWeekMetrics;
  scheduleLineage: ReportWeekLineage[];
  completeness: ReportWeekCompleteness;
  lifecyclePosture: ReportWeekLifecyclePosture;
  amendmentPosture: ReportWeekAmendmentPosture;
  closePosture?: {
    status: "accepted" | "reopened_awaiting_successor" | "successor_accepted";
    acceptedCloseId: string;
    changedAt: number;
  };
  amendment?: {
    changedAt: number;
    currentFingerprint: string;
    includedNetSalesDeltaMinor: number;
    outsideSchedule: ReportWeekMetrics;
    outsideScheduleNetSalesDeltaMinor: number;
    outsideScheduleSummary: ReportWeekSummary;
    summary: ReportWeekSummary;
  };
  /** The active briefing adds current truth beside, never over, the baseline. */
  current?: {
    included: ReportWeekMetrics;
    includedNetSalesDeltaMinor: number;
    outsideSchedule: ReportWeekMetrics;
    outsideScheduleNetSalesDeltaMinor: number;
    outsideScheduleSummary: ReportWeekSummary;
    summary: ReportWeekSummary;
  };
  inventoryAttention?: {
    newCount: number;
    carriedForwardCount: number;
    completeness: "complete" | "incomplete" | "unavailable";
  };
  priorPeriod?: {
    cycleStartDate: string;
    cycleEndDate: string;
    comparabilityReason:
      | "comparable"
      | "missing_schedule"
      | "missing_timezone"
      | "schedule_history_cap"
      | "scheduled_membership_changed"
      | "missing_prior_day_fold"
      | "prior_incomplete";
    currentScheduledPositionCount: number;
    equivalentScheduledPositions: boolean;
    priorScheduledPositionCount: number;
    values: ReportWeekMetrics | null;
    summary: ReportWeekSummary | null;
    netSalesChange: {
      amountMinor: number;
      direction: "higher" | "lower" | "unchanged";
    } | null;
  };
  variancePosture?: {
    closeVarianceMinor: number;
    coverage: "complete" | "partial" | "unavailable";
    coveredIncludedDayCount: number;
    includedDayCount: number;
  };
  ownerRoutes?: {
    transactions: {
      to: "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions";
      search: {
        startDate: string;
        endDate: string;
        order: "oldestFirst";
      };
    };
    dailyClose: {
      to:
        | "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close"
        | "/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close-history";
      search: { operatingDate: string } | { day: string };
    } | null;
    cashControls: {
      to: "/$orgUrlSlug/store/$storeUrlSlug/cash-controls";
    };
    openWork: {
      to: "/$orgUrlSlug/store/$storeUrlSlug/operations/open-work";
      search: { workType: "synced_sale_inventory_review" };
    };
  };
};

function completenessLabel(report: WeeklyReportProjection): string | null {
  if (report.completeness.complete) return null;
  const labels: Record<ReportWeekCompleteness["reason"], string> = {
    complete: "Reporting data is incomplete.",
    missing_schedule:
      "A reporting schedule is needed before this week can be summarized. Add at least one operational day in Store hours.",
    missing_timezone:
      "The store time zone is needed before this week can be summarized. Set the store time zone, then return here.",
    schedule_history_cap:
      "The reporting schedule exceeds the supported history limit. The last verified values remain visible while the report refresh is incomplete.",
    missing_day_fold:
      "Scheduled activity is still materializing. Check again after the current reporting update finishes.",
    mixed_currency:
      "This period includes more than one currency, so totals are unavailable. Review the source transactions for the affected dates.",
    payment_coverage_unknown:
      "Payment allocation is incomplete. Review payment evidence before relying on settlement totals.",
    fact_cap_exceeded:
      "This week exceeds the supported reporting limit, so totals are withheld. Contact support to review the reporting volume.",
    legacy_fact_without_observed_at:
      "Some earlier activity cannot be placed in the accepted reporting cutoff. The report remains unavailable until source verification finishes.",
  };
  return labels[report.completeness.reason];
}

function comparabilityLabel(
  priorPeriod: NonNullable<WeeklyReportProjection["priorPeriod"]>,
) {
  const labels: Record<
    NonNullable<WeeklyReportProjection["priorPeriod"]>["comparabilityReason"],
    string
  > = {
    comparable: "Comparable scheduled positions.",
    missing_schedule: "A prior reporting schedule is unavailable.",
    missing_timezone: "The prior reporting timezone is unavailable.",
    schedule_history_cap:
      "The prior reporting schedule exceeds the supported history limit.",
    scheduled_membership_changed:
      "Scheduled membership changed between these reporting periods.",
    missing_prior_day_fold:
      "Some prior scheduled dates are still materializing.",
    prior_incomplete: "The prior reporting period is incomplete.",
  };
  return labels[priorPeriod.comparabilityReason];
}

function varianceCoverageLabel(
  variancePosture: NonNullable<WeeklyReportProjection["variancePosture"]>,
) {
  if (variancePosture.coverage === "unavailable") {
    return "Daily Close variance is not available for this period.";
  }

  return `${variancePosture.coverage === "complete" ? "Complete" : "Partial"} coverage: ${variancePosture.coveredIncludedDayCount.toLocaleString()} of ${variancePosture.includedDayCount.toLocaleString()} scheduled ${variancePosture.includedDayCount === 1 ? "day" : "days"}.`;
}

function Section({
  children,
  className,
  title,
}: {
  children: React.ReactNode;
  className?: string;
  title: string;
}) {
  return (
    <section className={cn("border-t border-border pt-layout-lg", className)}>
      <h2 className="font-display text-lg font-semibold tracking-tight text-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

function MetricList({ children }: { children: React.ReactNode }) {
  return (
    <dl className="mt-layout-md grid gap-x-layout-xl gap-y-layout-md sm:grid-cols-2 lg:grid-cols-3">
      {children}
    </dl>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 font-numeric text-base font-medium text-foreground">
        {value}
      </dd>
    </div>
  );
}

/** A projection-only weekly briefing; arithmetic stays in Reports materializers. */
export function ReportsWeeklyView({
  ownerReturnContext,
  report,
}: {
  ownerReturnContext?: ReportsWeeklySearch;
  report: WeeklyReportProjection;
}) {
  const { currency } = report;
  const { orgUrlSlug, storeUrlSlug } = useParams({ strict: false });
  const completeness = completenessLabel(report);
  const baseline = report.summary;
  const amendment = report.current ?? report.amendment;
  const current = amendment?.summary ?? baseline;
  const currentOutsideSchedule = amendment?.outsideScheduleSummary;
  const hasCurrentAmendment = amendment !== undefined;
  const includedDates = report.scheduleLineage.filter((day) => day.included);
  const hasScheduledActivity =
    baseline.netSalesMinor !== 0 ||
    baseline.unitsSold !== 0 ||
    baseline.unitsReturned !== 0 ||
    baseline.paymentsCollectedMinor !== 0;
  const priorNetSalesChange = report.priorPeriod?.netSalesChange ?? null;
  const ownerLinkState = ownerReturnContext
    ? (weeklyOwnerReturnState(ownerReturnContext) as never)
    : undefined;

  return (
    <div
      className="space-y-layout-xl md:space-y-layout-2xl"
      data-testid="reports-weekly"
    >
      <section aria-labelledby="weekly-net-sales">
        <p className="text-sm text-muted-foreground">
          {formatReportDateRange(report.cycleStartDate, report.cycleEndDate)}
        </p>
        <h1
          className="mt-layout-sm font-display text-3xl font-semibold leading-tight tracking-tight text-foreground sm:text-4xl"
          id="weekly-net-sales"
        >
          Net sales
        </h1>
        <p
          className="mt-1 font-numeric text-4xl font-semibold leading-none tracking-tight text-foreground sm:text-5xl"
          data-testid="weekly-net-sales-value"
        >
          {formatReportMoney(baseline.netSalesMinor, currency)}
        </p>
        {priorNetSalesChange !== null ? (
          <p
            className="mt-layout-sm text-sm font-medium text-foreground"
            data-testid="weekly-prior-net-sales-delta"
          >
            {priorNetSalesChange.direction === "higher"
              ? `Higher than the prior period by ${formatReportMoney(priorNetSalesChange.amountMinor, currency)}`
              : priorNetSalesChange.direction === "lower"
                ? `Lower than the prior period by ${formatReportMoney(priorNetSalesChange.amountMinor, currency)}`
                : "No change from the prior period"}
          </p>
        ) : null}
        <dl className="mt-layout-md flex flex-wrap gap-x-layout-xl gap-y-layout-xs text-sm">
          <div>
            <dt className="inline text-muted-foreground">Lifecycle: </dt>
            <dd className="inline font-medium text-foreground">
              {weeklyLifecycleLabel(report)}
            </dd>
          </div>
          <div>
            <dt className="inline text-muted-foreground">Amendment: </dt>
            <dd className="inline font-medium text-foreground">
              {weeklyAmendmentLabel(report)}
            </dd>
          </div>
        </dl>
        {!hasScheduledActivity && report.completeness.complete ? (
          <p className="mt-layout-sm text-sm text-muted-foreground">
            No scheduled activity has been recorded for this reporting week.
          </p>
        ) : null}
        {hasCurrentAmendment ? (
          <p className="mt-layout-sm text-sm text-muted-foreground">
            Accepted baseline · Current after amendment:{" "}
            {formatReportMoney(current.netSalesMinor, currency)}
          </p>
        ) : null}
        {amendment ? (
          <p className="mt-layout-sm text-sm text-muted-foreground">
            {formatReportMoney(amendment.includedNetSalesDeltaMinor, currency)}{" "}
            scheduled ·{" "}
            {formatReportMoney(
              amendment.outsideScheduleNetSalesDeltaMinor,
              currency,
            )}{" "}
            outside schedule since acceptance
          </p>
        ) : null}
        {completeness ? (
          <p
            className="mt-layout-sm text-sm text-muted-foreground"
            role="status"
          >
            {completeness}
          </p>
        ) : null}
      </section>

      <Section title="Financial performance">
        <MetricList>
          <Metric
            label={hasCurrentAmendment ? "Accepted gross sales" : "Gross sales"}
            value={formatReportMoney(baseline.grossSalesMinor, currency)}
          />
          <Metric
            label={hasCurrentAmendment ? "Accepted refunds" : "Refunds"}
            value={formatReportMoney(baseline.refundsMinor, currency)}
          />
          <Metric
            label="Merchandise margin"
            value={formatReportProfit(
              baseline.merchandiseMarginMinor,
              currency,
            )}
          />
        </MetricList>
        {reportProfitHelper(baseline.merchandiseMarginMinor) ? (
          <p className="mt-layout-sm text-sm text-muted-foreground">
            {reportProfitHelper(baseline.merchandiseMarginMinor)}
          </p>
        ) : null}
        {hasCurrentAmendment ? (
          <p className="mt-layout-sm text-sm leading-6 text-muted-foreground">
            Current amendment:{" "}
            {formatReportMoney(current.netSalesMinor, currency)} scheduled net
            sales ·{" "}
            {formatReportMoney(
              currentOutsideSchedule?.netSalesMinor ?? 0,
              currency,
            )}{" "}
            outside schedule ·{" "}
            {formatReportProfit(current.merchandiseMarginMinor, currency)}{" "}
            merchandise margin
          </p>
        ) : null}
        {report.priorPeriod ? (
          <div className="mt-layout-md border-l-2 border-border pl-layout-md text-sm leading-6 text-muted-foreground">
            <p>
              Prior period:{" "}
              {formatReportDateRange(
                report.priorPeriod.cycleStartDate,
                report.priorPeriod.cycleEndDate,
              )}
            </p>
            {report.priorPeriod.summary ? (
              <p>
                {formatReportMoney(
                  report.priorPeriod.summary.netSalesMinor,
                  currency,
                )}{" "}
                net sales ·{" "}
                {formatReportMoney(
                  report.priorPeriod.summary.grossSalesMinor,
                  currency,
                )}{" "}
                gross sales ·{" "}
                {formatReportProfit(
                  report.priorPeriod.summary.merchandiseMarginMinor,
                  currency,
                )}{" "}
                merchandise margin
              </p>
            ) : (
              <p>Prior-period financial values are unavailable.</p>
            )}
            <p>{comparabilityLabel(report.priorPeriod)}</p>
          </div>
        ) : null}
        {report.ownerRoutes ? (
          <div className="mt-layout-md">
            <Link
              className="text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              params={
                {
                  orgUrlSlug: orgUrlSlug!,
                  storeUrlSlug: storeUrlSlug!,
                } as never
              }
              search={report.ownerRoutes.transactions.search as never}
              state={ownerLinkState}
              to={report.ownerRoutes.transactions.to}
            >
              View transaction evidence
            </Link>
          </div>
        ) : null}
      </Section>

      <Section title="Units moved">
        <MetricList>
          <Metric
            label="Current net units"
            value={formatUnits(current.netUnits)}
          />
          <Metric label="Current sold" value={formatUnits(current.unitsSold)} />
          <Metric
            label="Current returned"
            value={formatUnits(current.unitsReturned)}
          />
          <Metric
            label="Prior net units"
            value={
              report.priorPeriod?.summary
                ? formatUnits(report.priorPeriod.summary.netUnits)
                : "Unavailable"
            }
          />
        </MetricList>
      </Section>

      <Section title="Payment posture">
        <MetricList>
          <Metric
            label="Current collected"
            value={formatReportMoney(current.paymentsCollectedMinor, currency)}
          />
          <Metric
            label="Current refunded"
            value={formatReportMoney(current.paymentsRefundedMinor, currency)}
          />
          <Metric
            label="Current allocated"
            value={formatReportMoney(current.paymentAllocatedMinor, currency)}
          />
          <Metric
            label="Current unsettled"
            value={
              current.paymentAllocationCoverage === "unknown"
                ? "Settlement unavailable"
                : formatOptionalMoney(current.paymentUnsettledMinor, currency)
            }
          />
          <Metric
            label="Prior allocated"
            value={
              report.priorPeriod?.summary
                ? formatReportMoney(
                    report.priorPeriod.summary.paymentAllocatedMinor,
                    currency,
                  )
                : "Unavailable"
            }
          />
        </MetricList>
        {current.paymentAllocationCoverage === "unknown" ? (
          <p className="mt-layout-sm text-sm text-muted-foreground">
            Payment allocation is incomplete.
          </p>
        ) : null}
      </Section>

      <Section title="Variance">
        {report.variancePosture ? (
          <>
            <MetricList>
              <Metric
                label="Net close variance"
                value={formatReportMoney(
                  report.variancePosture.closeVarianceMinor,
                  currency,
                )}
              />
              <Metric
                label="Coverage"
                value={
                  report.variancePosture.coverage === "unavailable"
                    ? "Unavailable"
                    : report.variancePosture.coverage === "complete"
                      ? "Complete"
                      : "Partial"
                }
              />
            </MetricList>
            <p className="mt-layout-sm text-sm leading-6 text-muted-foreground">
              {varianceCoverageLabel(report.variancePosture)}
            </p>
          </>
        ) : (
          <p className="mt-layout-sm text-sm leading-6 text-muted-foreground">
            Daily Close variance is unavailable for this reporting record.
          </p>
        )}
        {report.ownerRoutes?.dailyClose ? (
          <div className="mt-layout-md flex flex-wrap gap-x-layout-md gap-y-layout-xs">
            <Link
              className="text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              params={
                {
                  orgUrlSlug: orgUrlSlug!,
                  storeUrlSlug: storeUrlSlug!,
                } as never
              }
              search={report.ownerRoutes.dailyClose.search as never}
              state={ownerLinkState}
              to={report.ownerRoutes.dailyClose.to as never}
            >
              Review Daily Close
            </Link>
            <Link
              className="text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              params={
                {
                  orgUrlSlug: orgUrlSlug!,
                  storeUrlSlug: storeUrlSlug!,
                } as never
              }
              state={ownerLinkState}
              to={report.ownerRoutes.cashControls.to}
            >
              View cash controls
            </Link>
          </div>
        ) : null}
      </Section>

      <Section title="Inventory attention">
        {report.inventoryAttention ? (
          <>
            <MetricList>
              <Metric
                label="New this week"
                value={`${report.inventoryAttention.newCount.toLocaleString()} new review ${report.inventoryAttention.newCount === 1 ? "group" : "groups"}`}
              />
              <Metric
                label="Carried forward"
                value={`${report.inventoryAttention.carriedForwardCount.toLocaleString()} carried-forward review ${report.inventoryAttention.carriedForwardCount === 1 ? "group" : "groups"}`}
              />
            </MetricList>
            {report.ownerRoutes ? (
              <div className="mt-layout-md">
                <Link
                  className="text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  params={
                    {
                      orgUrlSlug: orgUrlSlug!,
                      storeUrlSlug: storeUrlSlug!,
                    } as never
                  }
                  search={report.ownerRoutes.openWork.search as never}
                  state={ownerLinkState}
                  to={report.ownerRoutes.openWork.to}
                >
                  Open inventory review
                </Link>
              </div>
            ) : null}
          </>
        ) : (
          <p className="mt-layout-sm text-sm leading-6 text-muted-foreground">
            Inventory review is unavailable for this reporting record.
          </p>
        )}
      </Section>

      <Section title="Disclosures">
        <div className="mt-layout-sm space-y-1 text-sm leading-6 text-muted-foreground">
          {includedDates.length > 0 ? (
            <div>
              <p>Scheduled dates</p>
              <ul className="mt-layout-xs space-y-1" role="list">
                {includedDates.map((day) => (
                  <li className="flex flex-wrap gap-x-layout-sm" key={day.localDate}>
                    <span className="text-foreground">
                      {formatOperatingDate(day.localDate)}
                    </span>
                    <span>
                      {day.activityPosture === "zero_activity"
                        ? "Scheduled · No activity recorded"
                        : day.activityPosture === "unavailable"
                          ? "Scheduled activity unavailable"
                          : day.dayStatus === "reconciled"
                          ? "Reconciled activity"
                          : day.dayStatus === "amended"
                            ? "Amended activity"
                            : "Activity recorded"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p>
              No operational dates are included. Review Store hours before
              relying on this week.
            </p>
          )}
          {report.outsideSchedule.netSalesMinor !== 0 ? (
            <p>
              Accepted outside the reporting schedule:{" "}
              {formatReportMoney(
                report.outsideSchedule.netSalesMinor,
                currency,
              )}{" "}
              in net sales.
            </p>
          ) : null}
          {amendment && currentOutsideSchedule ? (
            <p>
              Current outside the reporting schedule:{" "}
              {formatReportMoney(
                currentOutsideSchedule.netSalesMinor,
                currency,
              )}{" "}
              in net sales (
              {formatReportMoney(
                amendment.outsideScheduleNetSalesDeltaMinor,
                currency,
              )}{" "}
              since acceptance).
            </p>
          ) : null}
        </div>
      </Section>
    </div>
  );
}
