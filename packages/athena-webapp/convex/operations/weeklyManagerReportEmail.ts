import { v } from "convex/values";
import { internalQuery, type QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import type {
  DailyManagerReportProps,
  DailyManagerReportTopItem,
} from "../emails/DailyManagerReport";
import { resolveSkuIdentity } from "../reports/queries";
import { resolveAppUrl } from "./dailyManagerReportEmail";
import { getStoreScheduleContextForStoreAtWithCtx } from "../inventory/storeSchedule";
import { addWeekMetrics } from "../../shared/reportsContract";
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
    const topItems = await buildAcceptedWeeklyTopItems(ctx, accepted, store);
    return buildAcceptedWeeklyManagerReportPayload({
      accepted,
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
  ctx: QueryCtx,
  accepted: Pick<
    Doc<"reportWeekAccepted">,
    "cycleEndDate" | "cycleStartDate" | "storeId" | "topSkuLeaders"
  >,
  store: Pick<Doc<"store">, "slug">,
): Promise<WeeklyManagerReportTopItems> {
  const topItems = accepted.topSkuLeaders
    ? await Promise.all(
        accepted.topSkuLeaders.map(async (leader) => {
          const identity = await resolveSkuIdentity(ctx, leader.productSkuId);
          const name =
            identity?.displayName ?? identity?.sku ?? String(leader.productSkuId);
          const detail = [identity?.sku, identity?.size]
            .filter((value) => value && value !== name)
            .join(" · ");
          return {
            name,
            unitsSold: leader.unitsSold,
            ...(detail ? { detail } : {}),
          };
        }),
      )
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

function buildAcceptedWeeklyManagerReportPayload(args: {
  accepted: Doc<"reportWeekAccepted">;
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
  const closedDayCount = accepted.scheduleLineage.filter(
    (day) => day.included && day.dayClosed,
  ).length;
  const scheduledDayCount = accepted.scheduleLineage.filter(
    (day) => day.included,
  ).length;
  const netSalesComparison = prior
    ? amountComparison(total.netSalesMinor, prior.netSalesMinor, money)
    : undefined;
  const executiveSummary = [
    netSalesComparison
      ? `Net sales finished ${netSalesComparison.replace("vs prior week", "than the prior week")}.`
      : undefined,
    `${closedDayCount} of ${scheduledDayCount} scheduled days closed.`,
    total.paymentAllocationCoverage === "complete"
      ? "Payments were fully accounted for."
      : undefined,
  ]
    .filter(Boolean)
    .join(" ");
  const variance = accepted.variancePosture;
  const inventory = accepted.inventoryAttention;

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
    completedAt: formatTime(accepted.acceptedAt, args.timezone),
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
      previewText: `${store.name} weekly report · ${money(total.netSalesMinor)} net sales · ${formatDateRange(accepted.cycleStartDate, accepted.cycleEndDate)}`,
      summaryMetricLayout: "lead",
      summarySectionTitle: "Weekly performance",
      timestampDate: formatShortDate(accepted.acceptedAt, args.timezone),
      timestampLabel: "Accepted",
      topItemsPlacement: "after-cash",
    },
    reportSections: [
      ...(variance
        ? [
            {
              title: "Close variance",
              message: varianceMessage(variance.closeVarianceMinor, money),
              meta: `${variance.coveredIncludedDayCount} of ${variance.includedDayCount} scheduled days closed`,
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
    statusLabel: "Week complete",
    statusSummary: `${closedDayCount} of ${scheduledDayCount} scheduled days are closed. This weekly report is ready to review.`,
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
    ],
    topItems: args.topItems,
    topItemsUrl: args.topItemsUrl,
    notes:
      total.grossProfitMinor === null
        ? "Merchandise margin is unavailable because some sold items do not have a recorded cost."
        : undefined,
  };
}

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
  if (varianceMinor === 0) return "Closing cash matched across the week.";
  return `Net close variance was ${money(Math.abs(varianceMinor))} ${varianceMinor < 0 ? "short" : "over"}.`;
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
