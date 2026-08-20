import { v } from "convex/values";
import { internalQuery, type QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import type {
  DailyManagerReportProps,
  DailyManagerReportTopItem,
} from "../emails/DailyManagerReport";
import { resolveAppUrl } from "./dailyManagerReportEmail";
import { getStoreScheduleContextForStoreAtWithCtx } from "../inventory/storeSchedule";
import {
  addWeekMetrics,
  combineRevisionPaymentMix,
} from "../../shared/reportsContract";
import { buildManagerReportExpenseSections } from "./managerReportExpenseSections";
import type {
  ReportPaymentMix,
  ReportWeekCloseEvidence,
  ReportWeekCloseEvidenceCoverage,
} from "../../shared/reportsContract";
import { currencyFormatter } from "../utils";
import { toDisplayAmount } from "../lib/currency";

export type WeeklyManagerReportTopItems = {
  topItems: DailyManagerReportTopItem[];
  topItemsUrl: string;
};

export const getAcceptedWeeklyManagerReportPayload = internalQuery({
  args: { acceptedWeekId: v.id("reportWeekAccepted") },
  handler: async (ctx, args): Promise<DailyManagerReportProps | null> => {
    const accepted = await ctx.db.get(
      "reportWeekAccepted",
      args.acceptedWeekId,
    );
    if (!accepted) return null;
    const store = await ctx.db.get("store", accepted.storeId);
    if (!store) return null;
    const { context } = await getStoreScheduleContextForStoreAtWithCtx(ctx, {
      at: accepted.acceptedAt,
      storeId: accepted.storeId,
    });
    const timezone = context.kind === "resolved" ? context.timezone : "UTC";
    const topItems = await buildAcceptedWeeklyTopItems(
      ctx,
      accepted,
      store,
      accepted.topSkuLeaders,
    );
    return buildAcceptedWeeklyManagerReportPayload({
      accepted,
      closeEvidence: accepted.closeEvidence,
      // Baseline-only, exactly as before: the automatic email never consumes
      // amendment or current truth, so a delayed retry still describes the
      // report that was accepted. Both lanes combined — the same frame the
      // email's own totals cover.
      paymentMix: combineRevisionPaymentMix(
        accepted.paymentMix,
        accepted.outsideSchedulePaymentMix,
      ),
      scheduleLineage: accepted.scheduleLineage,
      store,
      timezone,
      ...topItems,
    });
  },
});

export const getCorrectedWeeklyManagerReportPayload = internalQuery({
  args: {
    acceptedWeekId: v.id("reportWeekAccepted"),
    candidateFingerprint: v.string(),
  },
  handler: async (ctx, args): Promise<DailyManagerReportProps | null> => {
    const accepted = await ctx.db.get("reportWeekAccepted", args.acceptedWeekId);
    const correction = accepted?.correction;
    if (!accepted || correction?.candidateFingerprint !== args.candidateFingerprint) {
      return null;
    }
    const store = await ctx.db.get("store", accepted.storeId);
    if (!store) return null;
    const { context } = await getStoreScheduleContextForStoreAtWithCtx(ctx, {
      at: correction.appliedAt,
      storeId: accepted.storeId,
    });
    const timezone = context.kind === "resolved" ? context.timezone : "UTC";
    const topItems = await buildAcceptedWeeklyTopItems(
      ctx,
      accepted,
      store,
      correction.topSkuLeaders ?? accepted.topSkuLeaders,
    );
    return buildAcceptedWeeklyManagerReportPayload({
      accepted,
      closeEvidence: correction.closeEvidence,
      correctedAt: correction.appliedAt,
      scheduleLineage: correction.scheduleLineage,
      store,
      timezone,
      ...topItems,
    });
  },
});

/**
 * Resolve the product leaders for one immutable accepted weekly baseline.
 * The accepted row owns the range; callers cannot substitute mutable dates.
 */
export async function buildAcceptedWeeklyTopItems(
  _ctx: QueryCtx,
  accepted: Pick<
    Doc<"reportWeekAccepted">,
    "cycleEndDate" | "cycleStartDate" | "storeId"
  >,
  store: Pick<Doc<"store">, "slug">,
  /**
   * Explicit so each caller states its own authority: the automatic accepted
   * path passes the baseline leaders and must never read the correction.
   */
  leaders:
    | readonly {
        productName?: string;
        productSku?: string;
        productSkuId: string;
        unitsSold: number;
      }[]
    | undefined,
): Promise<WeeklyManagerReportTopItems> {
  const topItems = leaders
    ? leaders.flatMap((leader) => {
        // Legacy leaders predate frozen display identity. Omit them instead
        // of hydrating mutable catalog state into an accepted report retry.
        if (!leader.productName || !leader.productSku) return [];
        return [
          {
            detail: leader.productSku,
            name: leader.productName,
            unitsSold: leader.unitsSold,
          },
        ];
      })
    : [];

  return {
    topItems,
    topItemsUrl: buildWeeklyTopMoversUrl({
      cycleStartDate: accepted.cycleStartDate,
      storeSlug: store.slug,
    }),
  };
}

export function buildWeeklyTopMoversUrl(args: {
  cycleStartDate: string;
  storeSlug: string;
}): string {
  const params = new URLSearchParams({
    reportId: `week:${args.cycleStartDate}`,
    units: "true",
  });
  return `${resolveAppUrl()}/${args.storeSlug}/store/${args.storeSlug}/reports/weekly?${params}`;
}

export function buildAcceptedWeeklyManagerReportPayload(args: {
  accepted: Doc<"reportWeekAccepted">;
  closeEvidence: Doc<"reportWeekAccepted">["closeEvidence"];
  correctedAt?: number;
  /** The revision's own fact-backed mix; absent means read close evidence. */
  paymentMix?: ReportPaymentMix;
  scheduleLineage: Doc<"reportWeekAccepted">["scheduleLineage"];
  store: Doc<"store">;
  timezone: string;
  topItems: DailyManagerReportTopItem[];
  topItemsUrl: string;
}): DailyManagerReportProps {
  const { accepted, store } = args;
  const total = addWeekMetrics(accepted.included, accepted.outsideSchedule);
  const prior =
    accepted.priorPeriod?.comparabilityReason === "comparable" &&
    accepted.priorPeriod.values &&
    accepted.priorPeriod.outsideScheduleValues
      ? addWeekMetrics(
          accepted.priorPeriod.values,
          accepted.priorPeriod.outsideScheduleValues,
        )
      : null;
  const money = moneyFor(accepted.currency);
  const netUnits = total.unitsSold - total.unitsReturned;
  const priorNetUnits = prior
    ? prior.unitsSold - prior.unitsReturned
    : undefined;
  const closedDayCount = args.scheduleLineage.filter(
    (day) => day.included && day.dayClosed,
  ).length;
  const scheduledDayCount = args.scheduleLineage.filter(
    (day) => day.included,
  ).length;
  const netSalesComparison = prior
    ? amountComparison(total.netSalesMinor, prior.netSalesMinor, money)
    : undefined;
  const priorTransactionCount =
    accepted.priorPeriod?.comparabilityReason === "comparable"
      ? accepted.priorPeriod.transactionCount
      : undefined;
  const allScheduledDaysClosed =
    scheduledDayCount > 0 && closedDayCount === scheduledDayCount;
  const executiveSummary = [
    netSalesComparison
      ? `Net sales finished ${netSalesComparison.replace("vs prior week", "than the prior week")}.`
      : undefined,
    allScheduledDaysClosed
      ? "All scheduled days closed."
      : `${closedDayCount} of ${scheduledDayCount} scheduled days closed.`,
    total.paymentAllocationCoverage === "complete"
      ? "Payments were fully accounted for."
      : undefined,
  ]
    .filter(Boolean)
    .join(" ");
  const variance = accepted.variancePosture;
  const cashVariance = accepted.cashVariancePosture;
  const inventory = accepted.inventoryAttention;
  const evidence = args.closeEvidence;
  const evidenceCoverage =
    evidence && evidence.cash.coverage.status !== "unavailable"
      ? scheduledCoverageLabel(
          evidence.cash.coverage.usableDayCount,
          evidence.cash.coverage.scheduledDayCount,
        )
      : undefined;
  /**
   * Revision selection, matching Reports exactly: this revision's own stored
   * mix wins, and frozen close-backed rows are the fallback ONLY when it has
   * none. A corrected preview is built from `correction.closeEvidence` and is
   * never handed a stored mix, so it stays close-backed by construction.
   */
  const storedMix = args.paymentMix;
  const paymentRows = storedMix
    ? storedMix.status === "complete"
      ? storedMix.rows
      : []
    : evidence && evidence.payments.coverage.status !== "unavailable"
      ? evidence.payments.rows
      : [];
  const paymentShareBasisPointsTotal = paymentRows.reduce(
    (total, row) => total + row.shareBasisPoints,
    0,
  );
  // Same three states the Reports panel names, so the two surfaces describe
  // one baseline identically instead of the email falling silent on a known
  // empty period.
  const paymentCoverageNote = storedMix
    ? storedMix.status === "unavailable"
      ? "Payment method details aren't available for this period."
      : storedMix.rows.length === 0
        ? "No payments were received in this period."
        : undefined
    : evidence && evidence.payments.coverage.status === "partial"
      ? `Payment mix reflects ${evidence.payments.coverage.usableDayCount} of ${evidence.payments.coverage.scheduledDayCount} scheduled days covered.`
      : undefined;
  // A zero-value mix has zero shares by construction, not by rounding.
  const paymentRoundingNote =
    paymentRows.length > 0 &&
    paymentShareBasisPointsTotal > 0 &&
    paymentShareBasisPointsTotal !== 10_000
      ? "Shares may not total 100% due to rounding."
      : undefined;
  const reportingNotes = [
    paymentCoverageNote,
    paymentRoundingNote,
    total.grossProfitMinor === null
      ? "Merchandise margin is unavailable because some sold items do not have a recorded cost."
      : undefined,
  ].filter((note): note is string => Boolean(note));

  return {
    attentionItems: [],
    cashMetrics: [
      { label: "Units sold", value: total.unitsSold.toLocaleString("en-US") },
      {
        label: "Units returned",
        value: total.unitsReturned.toLocaleString("en-US"),
      },
      {
        label: "Net units",
        value: netUnits.toLocaleString("en-US"),
        detail:
          priorNetUnits === undefined
            ? undefined
            : percentageComparison(netUnits, priorNetUnits),
      },
    ],
    completedAt: formatTime(args.correctedAt ?? accepted.acceptedAt, args.timezone),
    completedBy: "Athena",
    operatingDate: formatDateRange(
      accepted.cycleStartDate,
      accepted.cycleEndDate,
    ),
    presentation: {
      actionLabel: "View weekly report",
      cashSectionTitle: "Item movement",
      emptyAttentionCopy: executiveSummary,
      eyebrow: "Athena weekly report",
      handoffSectionTitle: "Executive summary",
      notesLabel: "Reporting note",
      paymentSectionPlacement: "after-summary",
      paymentSectionTitle: "Payment mix",
      previewText: args.correctedAt
        ? `${store.name} corrected weekly report preview · Not sent · ${formatDateRange(accepted.cycleStartDate, accepted.cycleEndDate)}`
        : `${store.name} weekly report · ${money(total.netSalesMinor)} net sales · ${formatDateRange(accepted.cycleStartDate, accepted.cycleEndDate)}`,
      summaryMetricLayout: "lead",
      summarySectionTitle: "Weekly performance",
      timestampDate: formatShortDate(args.correctedAt ?? accepted.acceptedAt, args.timezone),
      timestampLabel: args.correctedAt ? "Corrected" : "Accepted",
      topItemsPlacement: "after-cash",
      rankedSectionTitle: "Expenses",
    },
    reportSections: [
      ...(variance
        ? [
            {
              title: "Close variance",
              message: varianceMessage(variance.closeVarianceMinor, money),
              meta: scheduledCoverageLabel(
                variance.coveredIncludedDayCount,
                variance.includedDayCount,
              ),
            },
          ]
        : []),
      ...(evidence
        ? [
            evidence.cash.coverage.status === "unavailable"
              ? {
                  title: "Counted cash variance",
                  message: UNAVAILABLE_CLOSE_EVIDENCE_COPY,
                }
              : {
                  title: "Counted cash variance",
                  message: countedCashVarianceMessage(
                    evidence.cash.cashVarianceMinor,
                    money,
                    evidence.cash.coverage.status === "complete",
                  ),
                  meta: evidenceCoverage,
                },
          ]
        : cashVariance
          ? cashVariance.coverage === "unavailable"
            ? [
                {
                  title: "Counted cash variance",
                  message: UNAVAILABLE_CLOSE_EVIDENCE_COPY,
                },
              ]
            : [
                {
                  title: "Counted cash variance",
                  message: countedCashVarianceMessage(
                    cashVariance.cashVarianceMinor,
                    money,
                    cashVariance.coverage === "complete",
                  ),
                  meta: scheduledCoverageLabel(
                    cashVariance.coveredIncludedDayCount,
                    cashVariance.includedDayCount,
                  ),
                },
              ]
        : []),
      ...(inventory
        ? [
            {
              title: "Inventory attention",
              message: `${inventory.newCount} new review groups · ${inventory.carriedForwardCount} carried forward`,
              meta: "Review before the next operating week begins.",
            },
          ]
        : []),
    ],
    reportUrl: buildWeeklyReportUrl({
      cycleStartDate: accepted.cycleStartDate,
      storeSlug: store.slug,
    }),
    status: "applied",
    statusLabel: args.correctedAt ? "Report corrected" : "Week complete",
    statusSummary: `${
      allScheduledDaysClosed
        ? "All scheduled days are closed"
        : `${closedDayCount} of ${scheduledDayCount} scheduled days are closed`
    }. This weekly report is ready to review.`,
    storeCurrency: accepted.currency,
    storeName: store.name,
    summaryMetrics: [
      {
        label: "Net sales",
        value: money(total.netSalesMinor),
        detail: netSalesComparison,
      },
      { label: "Gross sales", value: money(total.grossSalesMinor) },
      {
        label: "Refunds",
        value: money(total.refundsMinor),
      },
      ...(evidence?.transactions &&
      evidence.transactions.coverage.status !== "unavailable"
        ? [
            {
              detail: [
                "Completed POS transactions",
                priorTransactionCount === undefined
                  ? undefined
                  : percentageComparison(
                      evidence.transactions.transactionCount,
                      priorTransactionCount,
                    ),
                coverageLabel(evidence.transactions.coverage),
              ]
                .filter(Boolean)
                .join(" · "),
              label: "Transactions",
              value: evidence.transactions.transactionCount.toLocaleString(
                "en-US",
              ),
            },
          ]
        : []),
    ],
    paymentTotals: paymentRows.map((row) => ({
      amount: money(row.amountMinor),
      method: titleCase(row.method),
      share: `${(row.shareBasisPoints / 100).toFixed(2)}%`,
      tenderUseCount: row.tenderUseCount,
    })),
    rankedSections:
      evidence?.expenses.coverage.status === "unavailable"
        ? []
        : evidence
          ? buildManagerReportExpenseSections(
              evidence.expenses,
              money,
              coverageLabel(evidence.expenses.coverage),
            )
          : [],
    rankedSectionSummary:
      evidence?.expenses.coverage.status === "unavailable"
        ? undefined
        : evidence
          ? {
              label: "Total expenses",
              value: money(evidence.expenses.coveredSpendMinor),
            }
          : undefined,
    topItems: args.topItems,
    topItemsUrl: args.topItemsUrl,
    notes: reportingNotes.length > 0 ? reportingNotes.join(" ") : undefined,
  };
}

/**
 * Shared unavailable-lane copy. Must stay byte-identical to the Reports
 * workspace string so email and Reports disclose the same way.
 */
const UNAVAILABLE_CLOSE_EVIDENCE_COPY =
  "Not available — no completed Daily Closes contain this information.";

function buildWeeklyReportUrl(args: {
  cycleStartDate: string;
  storeSlug: string;
}): string {
  const params = new URLSearchParams({
    reportId: `week:${args.cycleStartDate}`,
  });
  return `${resolveAppUrl()}/${args.storeSlug}/store/${args.storeSlug}/reports/weekly?${params}`;
}

function moneyFor(currency: string) {
  const formatter = currencyFormatter(currency);
  return (minor: number) => formatter.format(toDisplayAmount(minor));
}

function amountComparison(
  current: number,
  prior: number,
  money: (minor: number) => string,
): string {
  if (current === prior) return "In line with prior week";
  return `${money(Math.abs(current - prior))} ${current > prior ? "higher" : "lower"} vs prior week`;
}

function percentageComparison(current: number, prior: number): string {
  if (current === prior) return "In line with prior week";
  if (prior === 0)
    return `${Math.abs(current).toLocaleString("en-US")} ${current > 0 ? "higher" : "lower"} than prior week`;
  const percent = Math.round(
    (Math.abs(current - prior) / Math.abs(prior)) * 100,
  );
  return `${percent}% ${current > prior ? "higher" : "lower"} than prior week`;
}

function varianceMessage(
  varianceMinor: number,
  money: (minor: number) => string,
): string {
  // This lane reconciles folded sales against the close's net sales. Saying
  // "cash" here is what made the counted-cash card look redundant, and worse,
  // let the two cards contradict each other on a week with real cash variance.
  if (varianceMinor === 0)
    return "Recorded sales matched the closes across the week.";
  return `Net close variance was ${money(Math.abs(varianceMinor))} ${varianceMinor < 0 ? "short" : "over"}.`;
}

function countedCashVarianceMessage(
  varianceMinor: number,
  money: (minor: number) => string,
  coverageComplete: boolean,
): string {
  if (varianceMinor === 0) {
    // Partial coverage must not overstate: only a fully covered week can
    // claim the whole week matched. The card meta discloses the N-of-M count.
    return coverageComplete
      ? "Counted cash matched across the week."
      : "Counted cash matched across covered days.";
  }
  return `Counted cash was ${money(Math.abs(varianceMinor))} ${varianceMinor < 0 ? "short" : "over"}.`;
}

function coverageLabel(
  coverage: ReportWeekCloseEvidenceCoverage,
): string | undefined {
  if (coverage.status === "unavailable") {
    return "Not available";
  }
  return scheduledCoverageLabel(
    coverage.usableDayCount,
    coverage.scheduledDayCount,
  );
}

function scheduledCoverageLabel(
  coveredDayCount: number,
  scheduledDayCount: number,
): string | undefined {
  if (scheduledDayCount > 0 && coveredDayCount === scheduledDayCount) {
    return undefined;
  }
  return `Based on ${coveredDayCount} of ${scheduledDayCount} scheduled days`;
}

function titleCase(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1).toLowerCase()}`)
    .join(" ");
}

function formatDateRange(start: string, end: string): string {
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  const startLabel = startDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const endLabel =
    startDate.getUTCMonth() === endDate.getUTCMonth()
      ? `${endDate.getUTCDate()}, ${endDate.getUTCFullYear()}`
      : endDate.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
          timeZone: "UTC",
        });
  return `${startLabel}–${endLabel}`;
}

function formatShortDate(at: number, timezone: string): string {
  return new Date(at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: timezone,
  });
}

function formatTime(at: number, timezone: string): string {
  return new Date(at).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  });
}
