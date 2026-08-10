import { Link, useParams } from "@tanstack/react-router";
import { ArrowUpRight, CheckCircle2, Info } from "lucide-react";
import { FlipNumber } from "@/components/common/FlipNumber";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { getOrigin } from "~/src/lib/navigationUtils";
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
  formatOperatingDateList,
  formatOptionalMoney,
  formatReportDateRange,
  formatReportMoney,
  formatReportProfit,
  formatUnits,
  reportProfitHelper,
} from "./reportFormat";
import {
  WEEKLY_WITHHELD_VALUE_LABEL,
  weeklyAmendmentLabel,
  weeklyLifecycleLabel,
  weeklyTotalsWithheld,
  weeklyValueLabelPrefix,
} from "./weeklyReportPresentation";
import { FadeIn } from "../common/FadeIn";
import {
  PaymentMethodsPanel,
  type StorePulsePaymentMixEntry,
} from "../store-pulse/StorePulseSummaryView";
import {
  ReportUnitsMovedChartSheet,
  type ReportUnitsMovedFocusSurface,
  type ReportUnitsMovedTab,
} from "./ReportUnitsMovedChartSheet";

/**
 * The server-owned weekly projection shown by both active and history reads.
 * Lifecycle and inventory are optional during the compatibility rollout; the
 * view never manufactures a conclusion when an older projection omits them.
 */
export type WeeklyReportProjection = {
  reportId?: string;
  /** Active-week projection time; absent on accepted historical reports. */
  materializedAt?: number;
  /** Acceptance time for a closed week; absent on the active projection. */
  acceptedAt?: number;
  /** Set-once accepted-report correction metadata. */
  correction?: { appliedAt: number };
  cycleStartDate: string;
  cycleEndDate: string;
  currency: string;
  included: ReportWeekMetrics;
  /** The scheduled lane — what ties to Daily Close and variance. */
  summary: ReportWeekSummary;
  outsideSchedule: ReportWeekMetrics;
  /** The outside-schedule lane on its own, for the breakdown. */
  outsideScheduleSummary: ReportWeekSummary;
  /** Both lanes combined — everything inside the labelled date range. */
  total: ReportWeekSummary;
  /** The combined verdict: incomplete when EITHER lane is incomplete. */
  totalCompleteness: ReportWeekCompleteness;
  scheduleLineage: ReportWeekLineage[];
  /** The scheduled lane's own verdict. */
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
    /** Both lane deltas together — the headline's movement. */
    netSalesDeltaMinor: number;
    outsideSchedule: ReportWeekMetrics;
    outsideScheduleNetSalesDeltaMinor: number;
    outsideScheduleSummary: ReportWeekSummary;
    summary: ReportWeekSummary;
    /** The amended conclusion for the labelled range. */
    totalSummary: ReportWeekSummary;
  };
  /** The active briefing adds current truth beside, never over, the baseline. */
  current?: {
    included: ReportWeekMetrics;
    includedNetSalesDeltaMinor: number;
    netSalesDeltaMinor: number;
    outsideSchedule: ReportWeekMetrics;
    outsideScheduleNetSalesDeltaMinor: number;
    outsideScheduleSummary: ReportWeekSummary;
    summary: ReportWeekSummary;
    totalSummary: ReportWeekSummary;
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
    /** The prior week's scheduled lane. */
    summary: ReportWeekSummary | null;
    /** The prior week's total — the only like-for-like counterpart. */
    totalSummary: ReportWeekSummary | null;
    /** Current total vs prior total. Never a scheduled-only comparison. */
    netSalesChange: {
      amountMinor: number;
      direction: "higher" | "lower" | "unchanged";
    } | null;
  };
  variancePosture?: {
    /** Every frame date with close evidence, both lanes. */
    closeVarianceMinor: number;
    coverage: "complete" | "partial" | "unavailable";
    coveredIncludedDayCount: number;
    includedDayCount: number;
    /** Null on a record written before the split existed. */
    scheduledVarianceMinor: number | null;
    outsideScheduleVarianceMinor: number | null;
    outsideScheduleCoveredDayCount: number | null;
  };
  closeEvidence?: WeeklyCloseEvidence;
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

type WeeklyEvidenceCoverage = {
  status: "complete" | "partial" | "unavailable";
  usableDayCount: number;
  scheduledDayCount: number;
};

type WeeklyExpenseProduct = {
  productSkuId: string;
  productName: string;
  productSku: string;
  quantity: number;
  spendMinor: number;
};

type WeeklyExpenseRemainder = {
  productCount: number;
  quantity: number;
  spendMinor: number;
} | null;

type WeeklyCloseEvidence = {
  cash: {
    cashVarianceMinor: number;
    coverage: WeeklyEvidenceCoverage;
  };
  payments: {
    coveredTenderValueMinor: number;
    coverage: WeeklyEvidenceCoverage;
    rows: Array<{
      method: string;
      amountMinor: number;
      tenderUseCount: number;
      shareBasisPoints: number;
    }>;
  };
  expenses: {
    coveredSpendMinor: number;
    coveredQuantity: number;
    coverage: WeeklyEvidenceCoverage;
    bySpend: WeeklyExpenseProduct[];
    byQuantity: WeeklyExpenseProduct[];
    spendRemainder: WeeklyExpenseRemainder;
    quantityRemainder: WeeklyExpenseRemainder;
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
    payment_invalid_allocation:
      "Payment allocation does not reconcile for this period. Review the payment evidence before relying on settlement totals.",
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

function closeEvidenceCoverageLabel(coverage: WeeklyEvidenceCoverage) {
  if (coverage.status === "unavailable") {
    return "Not available — no completed Daily Closes contain this information.";
  }
  if (coverage.status === "partial") {
    return `Based on ${coverage.usableDayCount.toLocaleString()} of ${coverage.scheduledDayCount.toLocaleString()} scheduled days`;
  }
  return `${coverage.usableDayCount.toLocaleString()} of ${coverage.scheduledDayCount.toLocaleString()} scheduled days`;
}

function weeklyPaymentMix(
  rows: WeeklyCloseEvidence["payments"]["rows"],
): StorePulsePaymentMixEntry[] {
  return rows.map((row) => ({
    count: row.tenderUseCount,
    label: row.method
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (character) => character.toUpperCase()),
    method: row.method,
    share: row.shareBasisPoints / 100,
    total: row.amountMinor,
  }));
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

/**
 * Route out to the workflow that owns a piece of evidence.
 *
 * `clear` plus a trailing `ArrowUpRight` is the app's convention for leaving
 * the current surface (see `CashControlsDashboard` and `OperationsQueueView`);
 * the briefing itself never mutates, so every action here is a departure. The
 * minimum height keeps the target touch-sized on compact viewports, and the
 * negative inline margin keeps the label optically flush with the text above
 * it — the same trick `ReportBackLink` uses.
 *
 * Return context travels as the app's standard `o` origin param, so the owning
 * surface renders the back control in its own page header rather than taking a
 * bespoke link injected above it.
 */
function OwnerRouteLink({
  children,
  params,
  search,
  to,
}: {
  children: React.ReactNode;
  params?: unknown;
  search?: unknown;
  to: string;
}) {
  const searchWithOrigin = {
    ...((search as object | undefined) ?? {}),
    o: getOrigin(),
  };

  return (
    <Button
      asChild
      className="-ml-2 h-auto min-h-control-standard gap-1.5 px-2 py-1 text-sm font-medium underline-offset-4 hover:underline"
      variant="clear"
    >
      <Link
        params={params as never}
        search={searchWithOrigin as never}
        to={to as never}
      >
        {children}
        <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      </Link>
    </Button>
  );
}

function Metric({
  detail,
  hint,
  label,
  value,
}: {
  detail?: React.ReactNode;
  hint?: string;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="flex min-h-8 items-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <span>{label}</span>
        {hint ? (
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  aria-label={`About ${label.toLocaleLowerCase()}`}
                  className="ml-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  type="button"
                >
                  <Info aria-hidden="true" className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-sm font-normal normal-case leading-5 tracking-normal">
                {hint}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : null}
      </dt>
      <dd className="mt-1">
        <span className="block font-numeric text-base font-medium text-foreground">
          {value}
        </span>
        {detail ? (
          <span className="mt-1 block text-sm leading-5 text-muted-foreground">
            {detail}
          </span>
        ) : null}
      </dd>
    </div>
  );
}

/** A projection-only weekly briefing; arithmetic stays in Reports materializers. */
export function ReportsWeeklyView({
  isUnitsSheetOpen,
  onUnitsSheetOpenChange,
  onUnitsSheetPageChange,
  onUnitsSheetRestoreComplete,
  onUnitsSheetSkuLinkNavigate,
  onUnitsSheetTabChange,
  report,
  unitsSheetPage,
  unitsSheetRestoreFocusSkuId,
  unitsSheetRestoreFocusSurface,
  unitsSheetRestoreScrollOffset,
  unitsSheetTab,
}: {
  isUnitsSheetOpen?: boolean;
  onUnitsSheetOpenChange?: (open: boolean) => void;
  onUnitsSheetPageChange?: (page: number) => void;
  onUnitsSheetRestoreComplete?: () => void;
  onUnitsSheetSkuLinkNavigate?: (context: {
    endDate: string;
    focusSurface: ReportUnitsMovedFocusSurface;
    productSkuId: string;
    scrollOffset?: number;
    startDate: string;
  }) => void | Promise<void>;
  onUnitsSheetTabChange?: (tab: ReportUnitsMovedTab) => void;
  report: WeeklyReportProjection;
  unitsSheetPage?: number;
  unitsSheetRestoreFocusSkuId?: string;
  unitsSheetRestoreFocusSurface?: ReportUnitsMovedFocusSurface;
  unitsSheetRestoreScrollOffset?: number;
  unitsSheetTab?: ReportUnitsMovedTab;
}) {
  const { currency } = report;
  const { orgUrlSlug, storeUrlSlug } = useParams({ strict: false });
  const completeness = completenessLabel(report);
  const scheduled = report.summary;
  const outside = report.outsideScheduleSummary;
  /**
   * The headline is the whole labelled date range. Money recorded on a date
   * the store was not scheduled to trade is still money the store took in that
   * week, so leaving it out of a figure printed under "Jul 27–Aug 2" made the
   * most prominent number on the screen wrong. The lanes stay separated
   * immediately underneath, where the split is evidence rather than a
   * correction the reader has to make themselves.
   */
  const baseline = report.total;
  const amendment = report.current ?? report.amendment;
  const current = amendment?.totalSummary ?? baseline;
  const currentOutsideSchedule = amendment?.outsideScheduleSummary;
  const hasCurrentAmendment = amendment !== undefined;
  const includedDates = report.scheduleLineage.filter((day) => day.included);
  /**
   * Only dates that actually recorded something get named. An excluded date
   * with no activity explains nothing about where the money came from.
   */
  const outsideActivityDates = report.scheduleLineage
    .filter((day) => !day.included && day.activityPosture === "recorded")
    .map((day) => day.localDate);
  /** Stays a statement about the scheduled lane, which is what it names. */
  const hasScheduledActivity =
    scheduled.netSalesMinor !== 0 ||
    scheduled.unitsSold !== 0 ||
    scheduled.unitsReturned !== 0 ||
    scheduled.paymentsCollectedMinor !== 0;
  const priorNetSalesChange = report.priorPeriod?.netSalesChange ?? null;
  const inventoryAttentionResolved =
    report.inventoryAttention?.completeness === "complete" &&
    report.inventoryAttention.newCount === 0 &&
    report.inventoryAttention.carriedForwardCount === 0;
  /**
   * Mixed currency and a breached fact cap both tell the operator that totals
   * are withheld. Sections keep their shape so the report stays navigable,
   * but every figure derived from those totals reads as unavailable rather
   * than contradicting the sentence directly above it.
   */
  const totalsWithheld = weeklyTotalsWithheld(report);
  const valuePrefix = weeklyValueLabelPrefix(report);
  const money = (amountMinor: number) =>
    totalsWithheld
      ? WEEKLY_WITHHELD_VALUE_LABEL
      : formatReportMoney(amountMinor, currency);
  const optionalMoney = (amountMinor: number | null | undefined) =>
    totalsWithheld
      ? WEEKLY_WITHHELD_VALUE_LABEL
      : formatOptionalMoney(amountMinor, currency);
  const profit = (amountMinor: number | null) =>
    totalsWithheld
      ? WEEKLY_WITHHELD_VALUE_LABEL
      : formatReportProfit(amountMinor, currency);
  const units = (value: number | null | undefined) =>
    totalsWithheld ? WEEKLY_WITHHELD_VALUE_LABEL : formatUnits(value);

  return (
    <FadeIn
      className="space-y-layout-xl md:space-y-layout-2xl"
      data-testid="reports-weekly"
    >
      {/*
        The headline and its schedule breakdown are one unit: the breakdown is
        the qualifier for the number above it, so it sits at the headline's own
        spacing rather than a full section gap away.
      */}
      <div className="space-y-layout-md">
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
            className={cn(
              "mt-1 font-semibold leading-none tracking-tight",
              totalsWithheld
                ? "text-2xl text-muted-foreground"
                : "font-numeric text-4xl text-foreground sm:text-5xl",
            )}
            data-testid="weekly-net-sales-value"
          >
            {totalsWithheld ? (
              money(baseline.netSalesMinor)
            ) : (
              <FlipNumber
                formatValue={(value) => formatReportMoney(value, currency)}
                testId="weekly-net-sales-flip"
                value={baseline.netSalesMinor}
              />
            )}
          </p>
          {priorNetSalesChange !== null && !totalsWithheld ? (
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
              <dt className="inline text-muted-foreground">Week status: </dt>
              <dd className="inline font-medium text-foreground">
                {report.correction ? "Report corrected" : weeklyLifecycleLabel(report)}
              </dd>
            </div>
            <div>
              <dt className="inline text-muted-foreground">Report changes: </dt>
              <dd className="inline font-medium text-foreground">
                {weeklyAmendmentLabel(report)}
              </dd>
            </div>
          </dl>
          {report.correction && report.acceptedAt ? (
            <p className="mt-layout-sm text-sm text-muted-foreground" role="status">
              Accepted {formatReportTimestamp(report.acceptedAt)} · Corrected{" "}
              {formatReportTimestamp(report.correction.appliedAt)}
            </p>
          ) : null}
          {!hasScheduledActivity && report.completeness.complete ? (
            <p className="mt-layout-sm text-sm text-muted-foreground">
              No scheduled activity has been recorded for this reporting week.
            </p>
          ) : null}
          {hasCurrentAmendment && !totalsWithheld ? (
            <p className="mt-layout-sm text-sm text-muted-foreground">
              Accepted baseline · Current after amendment:{" "}
              {formatReportMoney(current.netSalesMinor, currency)}
            </p>
          ) : null}
          {amendment && !totalsWithheld ? (
            <p className="mt-layout-sm text-sm text-muted-foreground">
              {formatReportMoney(amendment.netSalesDeltaMinor, currency)} since
              acceptance (
              {formatReportMoney(
                amendment.includedNetSalesDeltaMinor,
                currency,
              )}{" "}
              scheduled ·{" "}
              {formatReportMoney(
                amendment.outsideScheduleNetSalesDeltaMinor,
                currency,
              )}{" "}
              outside schedule)
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

        {/*
          Disclosed here, not at the foot of the page: the fact qualifies the
          largest number on the screen, and a reader who never scrolls to
          Reporting details would carry away a total they cannot account for. The
          scheduled figure stays labelled beside it because that is the number
          Daily Close and variance tie to.
        */}
        {outside.netSalesMinor !== 0 && !totalsWithheld ? (
          <div
            className="text-sm leading-6 text-muted-foreground"
            data-testid="weekly-outside-schedule-disclosure"
          >
            <p>
              {formatReportMoney(outside.netSalesMinor, currency)} of this total
              was recorded{" "}
              {outsideActivityDates.length > 0
                ? `on ${formatOperatingDateList(outsideActivityDates)}, `
                : ""}
              outside your operating schedule.
            </p>
            <dl className="mt-layout-xs flex flex-wrap gap-x-layout-xl gap-y-layout-xs">
              <div>
                <dt className="inline">Scheduled: </dt>
                <dd className="inline font-medium text-foreground">
                  {formatReportMoney(scheduled.netSalesMinor, currency)}
                </dd>
              </div>
              <div>
                <dt className="inline">Outside schedule: </dt>
                <dd className="inline font-medium text-foreground">
                  {formatReportMoney(outside.netSalesMinor, currency)}
                </dd>
              </div>
            </dl>
          </div>
        ) : null}
      </div>

      <Section title="Sales breakdown">
        <MetricList>
          <Metric
            label={hasCurrentAmendment ? "Accepted gross sales" : "Gross sales"}
            value={money(baseline.grossSalesMinor)}
          />
          <Metric
            label={hasCurrentAmendment ? "Accepted refunds" : "Refunds"}
            value={money(baseline.refundsMinor)}
          />
          <Metric
            detail={
              !totalsWithheld
                ? reportProfitHelper(baseline.merchandiseMarginMinor)
                : undefined
            }
            label="Merchandise margin"
            value={profit(baseline.merchandiseMarginMinor)}
          />
        </MetricList>
        {hasCurrentAmendment && !totalsWithheld ? (
          <p className="mt-layout-sm text-sm leading-6 text-muted-foreground">
            Current amendment:{" "}
            {formatReportMoney(current.netSalesMinor, currency)} net sales ·{" "}
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
            {totalsWithheld ? (
              <p>
                Prior-period comparison is unavailable while totals are
                withheld.
              </p>
            ) : report.priorPeriod.totalSummary ? (
              /* Total vs total — the same basis as the headline above. */
              <p>
                {formatReportMoney(
                  report.priorPeriod.totalSummary.netSalesMinor,
                  currency,
                )}{" "}
                net sales ·{" "}
                {formatReportMoney(
                  report.priorPeriod.totalSummary.grossSalesMinor,
                  currency,
                )}{" "}
                gross sales ·{" "}
                {formatReportProfit(
                  report.priorPeriod.totalSummary.merchandiseMarginMinor,
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
            <OwnerRouteLink
              params={{
                orgUrlSlug: orgUrlSlug!,
                storeUrlSlug: storeUrlSlug!,
              }}
              search={report.ownerRoutes.transactions.search}
              to={report.ownerRoutes.transactions.to}
            >
              View transaction evidence
            </OwnerRouteLink>
          </div>
        ) : null}
      </Section>

      <Section title="Item movement">
        <MetricList>
          <Metric
            label={`${valuePrefix} net units`}
            value={units(current.netUnits)}
          />
          <Metric
            label={`${valuePrefix} sold`}
            value={units(current.unitsSold)}
          />
          <Metric
            label={`${valuePrefix} returned`}
            value={units(current.unitsReturned)}
          />
          <Metric
            label="Prior net units"
            value={
              report.priorPeriod?.totalSummary && !totalsWithheld
                ? formatUnits(report.priorPeriod.totalSummary.netUnits)
                : WEEKLY_WITHHELD_VALUE_LABEL
            }
          />
        </MetricList>
        {totalsWithheld ? null : (
          <div className="mt-layout-md">
            <ReportUnitsMovedChartSheet
              activeTab={unitsSheetTab}
              currency={report.currency}
              granularPage={unitsSheetPage}
              isOpen={isUnitsSheetOpen}
              onActiveTabChange={onUnitsSheetTabChange}
              onGranularPageChange={onUnitsSheetPageChange}
              onOpenChange={onUnitsSheetOpenChange}
              onRestoreComplete={onUnitsSheetRestoreComplete}
              onSkuLinkNavigate={onUnitsSheetSkuLinkNavigate}
              orgUrlSlug={orgUrlSlug!}
              restoreFocusSkuId={unitsSheetRestoreFocusSkuId}
              restoreFocusSurface={unitsSheetRestoreFocusSurface}
              restoreScrollOffset={unitsSheetRestoreScrollOffset}
              periodEndDate={report.cycleEndDate}
              periodStartDate={report.cycleStartDate}
              scrollContextKey={`${orgUrlSlug}:${storeUrlSlug}:${report.reportId ?? `${report.cycleStartDate}:${report.cycleEndDate}`}`}
              storeUrlSlug={storeUrlSlug!}
            />
          </div>
        )}
      </Section>

      <Section title="Payments">
        <MetricList>
          <Metric
            hint="Money collected from customers during this reporting period, before refunds."
            label={`${valuePrefix} payments received`}
            value={money(current.paymentsCollectedMinor)}
          />
          <Metric
            label={`${valuePrefix} refunds issued`}
            value={money(current.paymentsRefundedMinor)}
          />
          <Metric
            hint="Payments Athena can match to recorded sales and refunds for this reporting period."
            label={`${valuePrefix} payments accounted for`}
            value={money(current.paymentAllocatedMinor)}
          />
          <Metric
            hint="Payments received, less refunds, that are not yet matched to recorded sales or refunds."
            label={`${valuePrefix} payments to reconcile`}
            value={
              current.paymentAllocationCoverage === "unknown" && !totalsWithheld
                ? "Settlement unavailable"
                : optionalMoney(current.paymentUnsettledMinor)
            }
          />
          <Metric
            hint="Payments Athena could match to recorded sales and refunds in the prior reporting period."
            label="Prior period payments accounted for"
            value={
              report.priorPeriod?.totalSummary && !totalsWithheld
                ? formatReportMoney(
                    report.priorPeriod.totalSummary.paymentAllocatedMinor,
                    currency,
                  )
                : WEEKLY_WITHHELD_VALUE_LABEL
            }
          />
        </MetricList>
        {current.paymentAllocationCoverage === "unknown" && !totalsWithheld ? (
          <p className="mt-layout-sm text-sm text-muted-foreground">
            Payment allocation is incomplete.
          </p>
        ) : null}
      </Section>

      {report.closeEvidence ? (
        <Section title="Payment mix">
          {report.closeEvidence.payments.coverage.status === "unavailable" ? (
            <p className="mt-layout-sm text-sm leading-6 text-muted-foreground">
              {closeEvidenceCoverageLabel(
                report.closeEvidence.payments.coverage,
              )}
            </p>
          ) : report.closeEvidence.payments.rows.length === 0 ? (
            /*
             * Certified zero: covered days exist but recorded no tender at
             * all. Mirrors the cash lane's covered-zero pattern rather than
             * the live-sync empty state, which promises data that will never
             * arrive for a closed week.
             */
            <p className="mt-layout-sm text-sm leading-6 text-muted-foreground">
              <span className="font-medium text-foreground">{money(0)}</span> ·{" "}
              {closeEvidenceCoverageLabel(report.closeEvidence.payments.coverage)}
            </p>
          ) : (
            <>
              <p className="mt-layout-sm text-sm text-muted-foreground">
                {closeEvidenceCoverageLabel(
                  report.closeEvidence.payments.coverage,
                )}
              </p>
              {/* The qualified subtotal: only the covered days' tender value. */}
              <p className="mt-layout-xs text-sm text-muted-foreground">
                Covered tender value:{" "}
                <span className="font-medium text-foreground">
                  {money(report.closeEvidence.payments.coveredTenderValueMinor)}
                </span>
              </p>
              <div className="mt-layout-md lg:w-1/2">
                <PaymentMethodsPanel
                  countNoun="tender use"
                  paymentMix={weeklyPaymentMix(
                    report.closeEvidence.payments.rows,
                  )}
                  shareSource="provided"
                  showHeader={false}
                  totalTransactions={report.closeEvidence.payments.rows.reduce(
                    (total, row) => total + row.tenderUseCount,
                    0,
                  )}
                  valueFormatter={(payment) => money(payment.total)}
                  variant="canvas"
                />
              </div>
              {report.closeEvidence.payments.rows.reduce(
                (total, row) => total + row.shareBasisPoints,
                0,
              ) !== 10_000 ? (
                <p className="mt-layout-sm text-xs text-muted-foreground">
                  Shares may not total 100% due to rounding.
                </p>
              ) : null}
            </>
          )}
        </Section>
      ) : null}

      <Section title="Variance">
        {report.variancePosture ? (
          <>
            <MetricList>
              {/*
                Closes are recorded on non-operational dates too, so this
                figure covers the whole frame. The split beneath names the
                lanes; coverage below stays a scheduled-day expectation.
              */}
              <Metric
                label="Close variance"
                value={money(report.variancePosture.closeVarianceMinor)}
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
            {report.variancePosture.scheduledVarianceMinor !== null &&
            report.variancePosture.outsideScheduleVarianceMinor !== null &&
            report.variancePosture.outsideScheduleVarianceMinor !== 0 ? (
              <dl
                className="mt-layout-sm flex flex-wrap gap-x-layout-xl gap-y-layout-xs text-sm leading-6 text-muted-foreground"
                data-testid="weekly-variance-split"
              >
                <div>
                  <dt className="inline">Scheduled: </dt>
                  <dd className="inline font-medium text-foreground">
                    {money(report.variancePosture.scheduledVarianceMinor)}
                  </dd>
                </div>
                <div>
                  <dt className="inline">Outside schedule: </dt>
                  <dd className="inline font-medium text-foreground">
                    {money(report.variancePosture.outsideScheduleVarianceMinor)}
                  </dd>
                </div>
              </dl>
            ) : null}
            <p className="mt-layout-sm text-sm leading-6 text-muted-foreground">
              {varianceCoverageLabel(report.variancePosture)}
            </p>
          </>
        ) : (
          <p className="mt-layout-sm text-sm leading-6 text-muted-foreground">
            Daily Close variance is unavailable for this reporting record.
          </p>
        )}
        {report.closeEvidence ? (
          <div className="mt-layout-lg border-t border-border pt-layout-md">
            <p className="text-sm font-medium text-foreground">
              Counted cash variance
            </p>
            {report.closeEvidence.cash.coverage.status === "unavailable" ? (
              <p className="mt-layout-xs text-sm leading-6 text-muted-foreground">
                {closeEvidenceCoverageLabel(
                  report.closeEvidence.cash.coverage,
                )}
              </p>
            ) : (
              <p className="mt-layout-xs text-sm leading-6 text-muted-foreground">
                {report.closeEvidence.cash.coverage.status === "partial" ? (
                  `${formatCashVariance(report.closeEvidence.cash.cashVarianceMinor, money)} · ${closeEvidenceCoverageLabel(report.closeEvidence.cash.coverage)}`
                ) : (
                  <span className="font-medium text-foreground">
                    {formatCashVariance(
                      report.closeEvidence.cash.cashVarianceMinor,
                      money,
                    )}
                  </span>
                )}
                {report.closeEvidence.cash.coverage.status === "complete" ? (
                  <span className="block">
                    {closeEvidenceCoverageLabel(
                      report.closeEvidence.cash.coverage,
                    )}
                  </span>
                ) : null}
              </p>
            )}
          </div>
        ) : null}
        {report.ownerRoutes?.dailyClose ? (
          <div className="mt-layout-md flex flex-wrap gap-x-layout-md gap-y-layout-xs">
            <OwnerRouteLink
              params={{
                orgUrlSlug: orgUrlSlug!,
                storeUrlSlug: storeUrlSlug!,
              }}
              search={report.ownerRoutes.dailyClose.search}
              to={report.ownerRoutes.dailyClose.to}
            >
              View EOD Review
            </OwnerRouteLink>
            <OwnerRouteLink
              params={{
                orgUrlSlug: orgUrlSlug!,
                storeUrlSlug: storeUrlSlug!,
              }}
              to={report.ownerRoutes.cashControls.to}
            >
              View Cash controls
            </OwnerRouteLink>
          </div>
        ) : null}
      </Section>

      {report.closeEvidence ? (
        <Section title="Expense products">
          {report.closeEvidence.expenses.coverage.status === "unavailable" ? (
            <p className="mt-layout-sm text-sm leading-6 text-muted-foreground">
              {closeEvidenceCoverageLabel(
                report.closeEvidence.expenses.coverage,
              )}
            </p>
          ) : (
            <>
              <p className="mt-layout-sm text-sm text-muted-foreground">
                {closeEvidenceCoverageLabel(
                  report.closeEvidence.expenses.coverage,
                )}
              </p>
              {/* The qualified subtotal: only the covered days' expense spend. */}
              <p className="mt-layout-xs text-sm text-muted-foreground">
                Covered expense spend:{" "}
                <span className="font-medium text-foreground">
                  {money(report.closeEvidence.expenses.coveredSpendMinor)}
                </span>{" "}
                ·{" "}
                {formatUnits(report.closeEvidence.expenses.coveredQuantity)}{" "}
                {report.closeEvidence.expenses.coveredQuantity === 1
                  ? "unit"
                  : "units"}
              </p>
              <div className="mt-layout-md grid gap-layout-xl lg:grid-cols-2">
                <ExpenseRanking
                  currency={currency}
                  emphasis="spend"
                  remainder={report.closeEvidence.expenses.spendRemainder}
                  rows={report.closeEvidence.expenses.bySpend}
                  title="Highest expense spend"
                />
                <ExpenseRanking
                  currency={currency}
                  emphasis="quantity"
                  remainder={report.closeEvidence.expenses.quantityRemainder}
                  rows={report.closeEvidence.expenses.byQuantity}
                  title="Most consumed expense products"
                />
              </div>
            </>
          )}
        </Section>
      ) : null}

      <Section title="Inventory attention">
        {report.inventoryAttention &&
        report.inventoryAttention.completeness !== "unavailable" ? (
          inventoryAttentionResolved ? (
            <div
              aria-live="polite"
              className="mt-layout-sm flex items-start gap-layout-sm"
              role="status"
            >
              <CheckCircle2
                aria-hidden="true"
                className="mt-0.5 h-4 w-4 shrink-0 text-success"
              />
              <div>
                <p className="text-sm font-medium text-foreground">Resolved</p>
                <p className="mt-0.5 text-sm leading-6 text-muted-foreground">
                  All synced sale inventory reviews for this reporting week are
                  closed.
                </p>
              </div>
            </div>
          ) : (
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
                <div className="mt-layout-md flex flex-wrap gap-x-layout-md gap-y-layout-xs">
                  <OwnerRouteLink
                    params={{
                      orgUrlSlug: orgUrlSlug!,
                      storeUrlSlug: storeUrlSlug!,
                    }}
                    search={report.ownerRoutes.openWork.search}
                    to={report.ownerRoutes.openWork.to}
                  >
                    Open inventory review
                  </OwnerRouteLink>
                  <OwnerRouteLink
                    params={{
                      orgUrlSlug: orgUrlSlug!,
                      storeUrlSlug: storeUrlSlug!,
                    }}
                    search={{
                      mode: "cycle_count",
                      work: "synced_sale_inventory_review",
                    }}
                    to="/$orgUrlSlug/store/$storeUrlSlug/operations/stock-adjustments"
                  >
                    Review stock adjustments
                  </OwnerRouteLink>
                </div>
              ) : null}
            </>
          )
        ) : (
          <p className="mt-layout-sm text-sm leading-6 text-muted-foreground">
            Inventory review is unavailable for this reporting record.
          </p>
        )}
      </Section>

      <Section title="Reporting details">
        <div className="mt-layout-sm max-w-2xl space-y-layout-md text-sm leading-6 text-muted-foreground">
          {includedDates.length > 0 ? (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide">
                Scheduled days
              </p>
              <ul
                aria-label="Scheduled days"
                className="mt-layout-xs space-y-1"
                role="list"
              >
                {includedDates.map((day) => (
                  <li
                    className="grid gap-x-layout-lg gap-y-0.5 py-0.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-baseline"
                    key={day.localDate}
                  >
                    <span className="text-foreground">
                      {formatOperatingDate(day.localDate)}
                    </span>
                    <span className="sm:text-right">
                      {day.activityPosture === "zero_activity"
                        ? "No activity recorded"
                        : day.activityPosture === "unavailable"
                          ? "Activity unavailable"
                          : day.dayStatus === "reconciled"
                            ? "Reconciled"
                            : day.dayStatus === "amended"
                              ? "Amended"
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
          {totalsWithheld ? (
            <p>
              Outside-schedule totals are unavailable for this reporting week.
            </p>
          ) : null}
          {/*
            The accepted outside-schedule figure now sits under the headline it
            qualifies, so it is not restated here. Only the current lane — a
            fact the headline breakdown does not carry — remains.
          */}
          {amendment && currentOutsideSchedule && !totalsWithheld ? (
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
    </FadeIn>
  );
}

function formatCashVariance(
  amountMinor: number,
  money: (amountMinor: number) => string,
) {
  if (amountMinor === 0) return money(0);
  return `${money(Math.abs(amountMinor))} ${amountMinor < 0 ? "short" : "over"}`;
}

function formatReportTimestamp(at: number): string {
  return new Date(at).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function ExpenseRanking({
  currency,
  emphasis,
  remainder,
  rows,
  title,
}: {
  currency: string;
  emphasis: "spend" | "quantity";
  remainder: WeeklyExpenseRemainder;
  rows: WeeklyExpenseProduct[];
  title: string;
}) {
  const productCountLabel = (count: number) =>
    count === 1 ? "1 other product" : `${count.toLocaleString()} other products`;
  const quantityLabel = (quantity: number) =>
    `${quantity.toLocaleString()} ${quantity === 1 ? "unit" : "units"}`;
  const valuesFor = (row: Pick<WeeklyExpenseProduct, "quantity" | "spendMinor">) =>
    emphasis === "spend"
      ? [formatReportMoney(row.spendMinor, currency), quantityLabel(row.quantity)]
      : [quantityLabel(row.quantity), formatReportMoney(row.spendMinor, currency)];

  return (
    <section aria-labelledby={`weekly-${emphasis}-expense-ranking`}>
      <h3
        className="text-sm font-semibold text-foreground"
        id={`weekly-${emphasis}-expense-ranking`}
      >
        {title}
      </h3>
      <ol className="mt-layout-sm divide-y divide-border" role="list">
        {rows.map((row) => {
          const [primary, secondary] = valuesFor(row);
          return (
            <li
              className="grid gap-x-layout-lg gap-y-1 py-layout-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-baseline"
              key={row.productSkuId}
            >
              <span>
                <span className="block font-medium text-foreground">
                  {row.productName}
                </span>
                <span className="block text-sm text-muted-foreground">
                  {row.productSku}
                </span>
              </span>
              <span className="sm:text-right">
                <span className="block font-numeric font-semibold text-foreground">
                  {primary}
                </span>
                <span className="block text-sm text-muted-foreground">
                  {secondary}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
      {remainder ? (
        <div
          aria-label={`${productCountLabel(remainder.productCount)}, ${quantityLabel(remainder.quantity)}, ${formatReportMoney(remainder.spendMinor, currency)}`}
          className="grid gap-x-layout-lg gap-y-1 border-t border-border py-layout-sm text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-baseline"
          role="note"
        >
          <span className="font-medium text-muted-foreground">
            {productCountLabel(remainder.productCount)}
          </span>
          <span className="sm:text-right">
            {valuesFor(remainder).join(" · ")}
          </span>
        </div>
      ) : null}
    </section>
  );
}
